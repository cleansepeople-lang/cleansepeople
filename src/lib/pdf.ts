import { jsPDF } from "jspdf";
import autoTable, { type CellHookData, type UserOptions } from "jspdf-autotable";
import type { CompanyReportData, SalaryReportRow } from "./hrms-db";

type PdfDoc = jsPDF & { lastAutoTable?: { finalY: number } };

const BLUE = [28, 87, 155] as [number, number, number];
const BLUE_DARK = [16, 52, 96] as [number, number, number];
const BLUE_SOFT = [229, 240, 252] as [number, number, number];
const BORDER = [206, 214, 224] as [number, number, number];
const TEXT = [31, 41, 55] as [number, number, number];
const MUTED = [99, 115, 129] as [number, number, number];
const ROW_ALT = [248, 250, 252] as [number, number, number];

function money(value: number) {
  return `Rs ${Math.round(value).toLocaleString("en-IN")}`;
}

function number(value: number, digits = 1) {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function reportId(prefix: string, seed: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
  return `${prefix}-${seed
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase()}-${stamp}`;
}

function payTypeLabel(value: SalaryReportRow["payType"]) {
  return value === "hourly" ? "Hourly" : "Monthly";
}

function designation(row: SalaryReportRow) {
  return (row as SalaryReportRow & { designation?: string }).designation ?? "Employee";
}

async function createDoc(title: string, subtitle: string, id: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as PdfDoc;
  const generated = new Date().toLocaleString("en-IN");

  doc.setProperties({
    title,
    subject: subtitle,
    author: "Cleans",
    creator: "Cleans",
  });

  await drawHeader(doc, title, subtitle, id);

  return {
    doc,
    generated,
    addFooter: () => drawFooter(doc, generated, id),
  };
}

async function drawHeader(doc: jsPDF, title: string, subtitle: string, id: string) {
  doc.setFillColor(...BLUE_DARK);
  doc.rect(0, 0, 210, 32, "F");

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(14, 8, 17, 17, 3, 3, "F");

  try {
    const img = new Image();
    img.src = "/cleans-logo.png";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const radius = img.width * (3 / 17);
      ctx.beginPath();
      ctx.moveTo(radius, 0);
      ctx.lineTo(canvas.width - radius, 0);
      ctx.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
      ctx.lineTo(canvas.width, canvas.height - radius);
      ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
      ctx.lineTo(radius, canvas.height);
      ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
      ctx.lineTo(0, radius);
      ctx.quadraticCurveTo(0, 0, radius, 0);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      doc.addImage(canvas.toDataURL("image/png"), "PNG", 14, 8, 17, 17);
    } else {
      doc.addImage(img, "PNG", 14, 8, 17, 17);
    }
  } catch (e) {
    doc.setTextColor(...BLUE_DARK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("HT", 22.5, 19.5, { align: "center" });
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Cleans", 36, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("DRY CLEANING & LAUNDRY SERVICES", 36, 20);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, 196, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(subtitle, 196, 19, { align: "right" });
  doc.text(id, 196, 25, { align: "right" });
}

function drawFooter(doc: jsPDF, generated: string, id: string) {
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.line(14, 282, 196, 282);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Generated ${generated}`, 14, 288);
    doc.text(`Report ID: ${id}`, 105, 288, { align: "center" });
    doc.text(`Page ${page} of ${pageCount}`, 196, 288, { align: "right" });
  }
}

function sectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BLUE_DARK);
  doc.text(title, 14, y);
}

function infoCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
) {
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x + 4, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT);
  doc.text(doc.splitTextToSize(value || "-", w - 8).slice(0, 2), x + 4, y + 13);
}

function summaryCard(doc: jsPDF, x: number, y: number, w: number, label: string, value: string) {
  doc.setFillColor(...BLUE_SOFT);
  doc.setDrawColor(188, 211, 238);
  doc.roundedRect(x, y, w, 20, 3, 3, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x + 4, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...BLUE_DARK);
  doc.text(value, x + 4, y + 15);
}

function table(doc: PdfDoc, options: UserOptions) {
  autoTable(doc, {
    theme: "grid",
    margin: { left: 14, right: 14, bottom: 20 },
    styles: {
      font: "helvetica",
      fontSize: 8.2,
      cellPadding: { top: 2.6, right: 2.5, bottom: 2.6, left: 2.5 },
      lineColor: BORDER,
      lineWidth: 0.15,
      textColor: TEXT,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: BLUE,
      textColor: 255,
      fontStyle: "bold",
      lineColor: BLUE,
      lineWidth: 0.15,
    },
    alternateRowStyles: { fillColor: ROW_ALT },
    didParseCell: (data: CellHookData) => {
      if (data.section === "body" && typeof data.cell.raw === "number") {
        data.cell.text = [String(data.cell.raw)];
        data.cell.styles.halign = "right";
      }
    },
    ...options,
  });
}

function finalY(doc: PdfDoc, fallback: number) {
  return doc.lastAutoTable?.finalY ?? fallback;
}

export async function downloadSalaryPdf(
  filename: string,
  row: SalaryReportRow,
  options?: { title?: string; startDate?: string; endDate?: string },
) {
  const period =
    options?.startDate && options?.endDate
      ? `${options.startDate} to ${options.endDate}`
      : row.period;
  const id = reportId("PAY", `${row.empCode}${row.endDate}`);
  const { doc, addFooter } = await createDoc(
    options?.title ?? "Corporate Payroll Report",
    `Employee salary report | ${period}`,
    id,
  );

  sectionTitle(doc, "Employee Information", 44);
  infoCard(doc, 14, 49, 43, 21, "Employee", row.name);
  infoCard(doc, 61, 49, 32, 21, "Employee ID", row.empCode);
  infoCard(doc, 97, 49, 41, 21, "Department", row.department);
  infoCard(doc, 142, 49, 54, 21, "Designation", designation(row));

  summaryCard(doc, 14, 79, 42, "Net Salary", money(row.net));
  summaryCard(doc, 60.5, 79, 42, "Worked Days", `${row.workedDays}/${row.expectedDays}`);
  summaryCard(doc, 107, 79, 42, "Hours", `${number(row.regularHours)}/${row.expectedDays * 10}`);
  summaryCard(doc, 153.5, 79, 42.5, "Overtime", number(row.overtimeHours));

  sectionTitle(doc, "Attendance and Work Summary", 112);
  table(doc, {
    startY: 117,
    head: [
      [
        "Pay Period",
        "Pay Type",
        "Expected Days",
        "Worked Days",
        "Absent Days",
        "Regular Hours",
        "Overtime Hours",
        "Status",
      ],
    ],
    body: [
      [
        period,
        payTypeLabel(row.payType),
        row.expectedDays,
        row.workedDays,
        row.absentDays,
        number(row.regularHours),
        number(row.overtimeHours),
        row.status,
      ],
    ],
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
  });

  const baseHours = row.payType === "hourly" ? row.regularHours : row.expectedDays;
  const baseRate =
    row.payType === "hourly" && row.regularHours ? row.base / row.regularHours : row.base;
  const overtimeRate = row.overtimeHours ? row.overtime / row.overtimeHours : 0;
  const taxableTotal = row.base + row.overtime + row.bonus;

  const breakdownY = finalY(doc, 135) + 12;
  sectionTitle(doc, "Salary Breakdown", breakdownY);
  table(doc, {
    startY: breakdownY + 5,
    head: [["Description", "Units", "Rate", "Amount"]],
    body: [
      ["Basic salary", number(baseHours), money(baseRate), money(row.base)],
      ["Overtime earnings", number(row.overtimeHours), money(overtimeRate), money(row.overtime)],
      ["Fixed bonus", row.overtimeHours > 0 ? "Credited" : "Not credited", "-", money(row.bonus)],
      ["Advance deduction", "-", "-", `-${money(row.advance)}`],
    ],
    foot: [
      ["Gross earnings", "", "", money(taxableTotal)],
      ["Total deductions", "", "", `-${money(row.advance)}`],
      ["Net payable", "", "", money(row.net)],
    ],
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right", fontStyle: "bold" },
    },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: BLUE_DARK,
      fontStyle: "bold",
      lineColor: BORDER,
    },
  });

  const totalY = finalY(doc, breakdownY + 60) + 9;
  doc.setFillColor(...BLUE_DARK);
  doc.roundedRect(14, totalY, 182, 18, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Total Net Payable", 20, totalY + 11);
  doc.setFontSize(15);
  doc.text(money(row.net), 190, totalY + 11, { align: "right" });

  sectionTitle(doc, "Payment Details", totalY + 31);
  table(doc, {
    startY: totalY + 36,
    head: [["Method", "Reference", "Notes"]],
    body: [
      [
        "Bank transfer",
        `${row.empCode}-${row.endDate}`,
        "Generated for manager-approved salary request",
      ],
    ],
  });

  addFooter();
  doc.save(filename);
}

export async function downloadCompanyReportPdf(filename: string, report: CompanyReportData) {
  const id = reportId("COMP", `${report.startDate}${report.endDate}`);
  const { doc, addFooter } = await createDoc(
    "Company Payroll Report",
    `${report.startDate} to ${report.endDate}`,
    id,
  );

  summaryCard(doc, 14, 44, 42, "Employees", String(report.employeeCount));
  summaryCard(
    doc,
    60.5,
    44,
    42,
    "Attendance",
    `${report.totals.present}/${report.totals.present + report.totals.absent}`,
  );
  summaryCard(doc, 107, 44, 42, "Hours", `${number(report.totals.hours)}/${report.totals.expectedHours}`);
  summaryCard(doc, 153.5, 44, 42.5, "Net Payroll", money(report.totals.net));

  sectionTitle(doc, "Company Spending Summary", 78);
  table(doc, {
    startY: 83,
    head: [["Base Payroll", "Overtime", "Bonuses", "Advances", "Net Payroll"]],
    body: [
      [
        money(report.payrollRows.reduce((sum, row) => sum + row.base, 0)),
        money(report.totals.overtime),
        money(report.totals.bonuses),
        `-${money(report.totals.advances)}`,
        money(report.totals.net),
      ],
    ],
  });

  const payrollY = finalY(doc, 105) + 12;
  sectionTitle(doc, "Employee Payroll Evaluation", payrollY);
  table(doc, {
    startY: payrollY + 5,
    head: [
      [
        "Emp ID",
        "Employee",
        "Department",
        "Attendance",
        "Hours",
        "Overtime",
        "Bonuses",
        "Advances",
        "Net",
      ],
    ],
    body: report.payrollRows.map((row) => [
      row.empCode,
      row.name,
      row.department,
      `${row.workedDays}/${row.expectedDays}`,
      number(row.regularHours),
      money(row.overtime),
      money(row.bonus),
      `-${money(row.advance)}`,
      money(row.net),
    ]),
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 30 },
      2: { cellWidth: 20 },
      3: { halign: "center", cellWidth: 18 },
      4: { halign: "right", cellWidth: 14 },
      5: { halign: "right", cellWidth: 18 },
      6: { halign: "right", cellWidth: 16 },
    },
  });

  addFooter();
  doc.save(filename);
}
