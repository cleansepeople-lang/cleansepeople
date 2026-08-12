-- 1. Drop unused tables
DROP TABLE IF EXISTS public.designation_deductions;

-- 2. Remove columns from employees table
ALTER TABLE public.employees 
  DROP COLUMN IF EXISTS fixed_bonus,
  DROP COLUMN IF EXISTS hourly_rate,
  DROP COLUMN IF EXISTS salary,
  DROP COLUMN IF EXISTS pay_type;

-- 3. Rename incentives table to payroll_adjustments
ALTER TABLE public.incentives RENAME TO payroll_adjustments;

-- Since the type was 'bonus' by default, it is fine.
-- Let's ensure the type is allowed to be 'advance' as well.
-- If it was a text column with no constraint, we are safe.
-- But let's alter the default from 'bonus' to 'bonus' (already done).

-- 4. Update the settings table to remove automated incentives config
ALTER TABLE public.company_settings
  DROP COLUMN IF EXISTS automated_incentives_enabled,
  DROP COLUMN IF EXISTS perfect_attendance_reward,
  DROP COLUMN IF EXISTS absent_penalty;
