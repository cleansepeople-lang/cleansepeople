-- =====================================================================================
-- MASTER SCHEMA INITIALIZATION SCRIPT FOR CLEANS HRMS
-- This script reconstructs the entire database schema including tables,
-- triggers, RPC functions, RLS policies, and default seed data.
-- Run this script in your Supabase SQL Editor.
-- =====================================================================================

-- 1. CLEAN SLATE: Drop the public schema and recreate it
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres, public, anon, authenticated, service_role;

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUM TYPES
CREATE TYPE public.app_role AS ENUM ('manager', 'employee');

-- 3. HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = _role
  );
END;
$$;

-- 4. TABLES

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  is_super_admin boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- USER ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'employee',
  UNIQUE (user_id, role)
);

-- OUTLETS
CREATE TABLE public.outlets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  latitude numeric NOT NULL DEFAULT 0,
  longitude numeric NOT NULL DEFAULT 0,
  geofence_radius_meters numeric NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- KIOSK DEVICES
CREATE TABLE public.kiosk_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  device_secret uuid NOT NULL DEFAULT gen_random_uuid(),
  name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- EMPLOYEES
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_code text UNIQUE NOT NULL,
  full_name text NOT NULL,
  email text UNIQUE,
  role text NOT NULL,
  department text NOT NULL,
  phone text,
  monthly_salary numeric NOT NULL DEFAULT 0,
  manager text,
  initial_login text,
  status text NOT NULL DEFAULT 'Active',
  join_date date NOT NULL DEFAULT current_date,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  profile_image text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ATTENDANCE SESSIONS
CREATE TABLE public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outlet_id uuid REFERENCES public.outlets(id) ON DELETE RESTRICT, -- NULLABLE FOR MANUAL CHECK-INS
  date date NOT NULL,
  check_in timestamptz NOT NULL,
  check_out timestamptz,
  hours_worked numeric NOT NULL DEFAULT 0,
  face_confidence numeric,
  status text NOT NULL DEFAULT 'Present',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- FACE DESCRIPTORS
CREATE TABLE public.face_descriptors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES public.employees(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  descriptor double precision[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- FACE RESET REQUESTS
CREATE TABLE public.face_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  manager_note text,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- COMPANY SETTINGS
CREATE TABLE public.company_settings (
  id boolean PRIMARY KEY DEFAULT true,
  face_threshold numeric NOT NULL DEFAULT 80,
  shift_start time NOT NULL DEFAULT '09:30',
  shift_end time NOT NULL DEFAULT '18:30',
  overtime_multiplier numeric NOT NULL DEFAULT 1.5,
  attendance_cooldown_minutes integer NOT NULL DEFAULT 1,
  half_day_threshold numeric NOT NULL DEFAULT 4,
  full_day_hours numeric NOT NULL DEFAULT 8,
  grace_minutes integer NOT NULL DEFAULT 10,
  leave_days text[] NOT NULL DEFAULT ARRAY['Sunday'],
  ot_automated boolean NOT NULL DEFAULT false,
  lunch_break_minutes integer NOT NULL DEFAULT 60,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_settings_singleton CHECK (id)
);
INSERT INTO public.company_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- DEPARTMENTS
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DESIGNATIONS
CREATE TABLE public.designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  absent_day_deduction numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  department text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ANNOUNCEMENTS
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- PAYROLL ADJUSTMENTS (BONUS & ADVANCE)
CREATE TABLE public.payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'bonus',
  reason text,
  amount numeric NOT NULL DEFAULT 0,
  month text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. RPC & TRIGGERS

-- Handle New Auth User
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.email)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, coalesce((new.raw_user_meta_data->>'role')::app_role, 'employee'))
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Handle Kiosk Check-In / Check-Out
CREATE OR REPLACE FUNCTION public.mark_session_attendance(
  _device_secret uuid,
  _lat numeric,
  _long numeric,
  _employee_id uuid,
  _action text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _outlet record;
  _device record;
  _distance numeric;
  _session record;
BEGIN
  SELECT * INTO _device FROM public.kiosk_devices WHERE device_secret = _device_secret AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or inactive device secret.');
  END IF;

  SELECT * INTO _outlet FROM public.outlets WHERE id = _device.outlet_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Outlet not found or inactive.');
  END IF;

  IF _lat IS NOT NULL AND _long IS NOT NULL AND _lat != 0 AND _long != 0 THEN
    _distance := 6371000 * acos(
      cos(radians(_outlet.latitude)) * cos(radians(_lat)) *
      cos(radians(_long) - radians(_outlet.longitude)) +
      sin(radians(_outlet.latitude)) * sin(radians(_lat))
    );
    IF _distance > _outlet.geofence_radius_meters THEN
      RETURN jsonb_build_object('success', false, 'error', 'Device is outside designated outlet geofence. Distance: ' || _distance || 'm');
    END IF;
  END IF;

  IF _action = 'in' THEN
    SELECT * INTO _session FROM public.attendance_sessions 
    WHERE employee_id = _employee_id AND check_out IS NULL 
    ORDER BY check_in DESC LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Employee already has an open session. Please check out first.');
    END IF;

    INSERT INTO public.attendance_sessions (employee_id, outlet_id, date, check_in)
    VALUES (_employee_id, _outlet.id, current_date, now());
    RETURN jsonb_build_object('success', true, 'message', 'Checked in successfully at ' || _outlet.name);

  ELSIF _action = 'out' THEN
    SELECT * INTO _session FROM public.attendance_sessions 
    WHERE employee_id = _employee_id AND check_out IS NULL 
    ORDER BY check_in DESC LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'No open session found to check out of.');
    END IF;

    UPDATE public.attendance_sessions 
    SET 
      check_out = now(),
      hours_worked = extract(epoch from (now() - check_in)) / 3600.0
    WHERE id = _session.id;
    RETURN jsonb_build_object('success', true, 'message', 'Checked out successfully at ' || _outlet.name);
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action.');
  END IF;
END;
$$;


-- 6. RLS & PERMISSIONS

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_descriptors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_reset_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role, anon;

-- Profiles & Roles Policies
CREATE POLICY "profiles_read_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "user_roles_read_all" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "user_roles_insert_all" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (true);

-- Outlets Policies
CREATE POLICY "outlets_anon_select" ON public.outlets FOR SELECT TO anon USING (true);
CREATE POLICY "outlets_auth_select" ON public.outlets FOR SELECT TO authenticated USING (true);
CREATE POLICY "outlets_manager_write" ON public.outlets FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Kiosk Devices Policies
CREATE POLICY "devices_select_all" ON public.kiosk_devices FOR SELECT USING (true);
CREATE POLICY "devices_write_all" ON public.kiosk_devices FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Employees Policies
CREATE POLICY "employees_select_all" ON public.employees FOR SELECT USING (true);
CREATE POLICY "employees_write_all" ON public.employees FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Attendance Sessions Policies
CREATE POLICY "sessions_anon_all" ON public.attendance_sessions FOR ALL TO anon USING (true) WITH CHECK(true);
CREATE POLICY "sessions_auth_select" ON public.attendance_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "sessions_auth_write" ON public.attendance_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Face Descriptors Policies
CREATE POLICY "face_public_select" ON public.face_descriptors FOR SELECT USING (true);
CREATE POLICY "face_auth_write" ON public.face_descriptors FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "face_anon_write" ON public.face_descriptors FOR ALL TO anon USING (true) WITH CHECK (true);

-- Face Reset Requests Policies
CREATE POLICY "face_reset_select_all" ON public.face_reset_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "face_reset_insert_all" ON public.face_reset_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "face_reset_update_all" ON public.face_reset_requests FOR UPDATE TO authenticated USING (true);

-- Settings & Master Data Policies
CREATE POLICY "settings_select_all" ON public.company_settings FOR SELECT USING (true);
CREATE POLICY "settings_write_all" ON public.company_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "depts_select_all" ON public.departments FOR SELECT USING (true);
CREATE POLICY "depts_write_all" ON public.departments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "desigs_select_all" ON public.designations FOR SELECT USING (true);
CREATE POLICY "desigs_write_all" ON public.designations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Announcements & Payroll Adjustments
CREATE POLICY "announcements_read_all" ON public.announcements FOR SELECT USING (true);
CREATE POLICY "announcements_write_all" ON public.announcements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "payroll_adjustments_read_all" ON public.payroll_adjustments FOR SELECT USING (true);
CREATE POLICY "payroll_adjustments_write_all" ON public.payroll_adjustments FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 7. SEED INITIAL MASTER DATA

INSERT INTO public.outlets (name, latitude, longitude, geofence_radius_meters, active) VALUES 
  ('Adyar Branch', 13.0012, 80.2565, 100, true),
  ('Avadi Branch', 13.1143, 80.1022, 100, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.departments (name, active) VALUES 
  ('Cleaning Staff', true),
  ('Management', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.designations (name, absent_day_deduction, active, department) VALUES 
  ('Cleaner', 0, true, 'Cleaning Staff'),
  ('Washer', 0, true, 'Cleaning Staff'),
  ('Presser / Ironer', 0, true, 'Cleaning Staff'),
  ('Spotter', 0, true, 'Cleaning Staff'),
  ('Packer', 0, true, 'Cleaning Staff'),
  ('Supervisor', 0, true, 'Management'),
  ('Store Manager', 0, true, 'Management')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.employees (emp_code, full_name, email, role, department, monthly_salary, manager, status) VALUES 
  ('EMP001', 'Arun Kumar', 'arun@example.com', 'Cleaner', 'Cleaning Staff', 15000, 'System Manager', 'Active'),
  ('EMP002', 'Priya Sharma', 'priya@example.com', 'Washer', 'Cleaning Staff', 16000, 'System Manager', 'Active'),
  ('EMP003', 'Rajesh Singh', 'rajesh@example.com', 'Supervisor', 'Management', 35000, 'System Manager', 'Active')
ON CONFLICT (emp_code) DO NOTHING;

-- END OF SCRIPT
