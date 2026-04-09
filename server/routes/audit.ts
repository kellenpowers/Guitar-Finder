import { Router } from "express";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";

const router = Router();

// Path to the shared Excel file — update this to point to the Bigfoot Technology shared drive
const EXCEL_DIR = process.env.AUDIT_EXCEL_DIR || path.join(process.cwd(), "server", "data");
const EXCEL_FILE = path.join(EXCEL_DIR, "audit-bookings.xlsx");

const COLUMNS = [
  { header: "Date Submitted", key: "dateSubmitted", width: 18 },
  { header: "Business Name", key: "businessName", width: 30 },
  { header: "Contact Name", key: "contactName", width: 25 },
  { header: "Phone", key: "phone", width: 18 },
  { header: "Email", key: "email", width: 30 },
  { header: "Street Address", key: "street", width: 35 },
  { header: "City", key: "city", width: 20 },
  { header: "State", key: "state", width: 8 },
  { header: "Zip", key: "zip", width: 10 },
  { header: "Status", key: "status", width: 14 },
];

async function getOrCreateWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();

  if (fs.existsSync(EXCEL_FILE)) {
    await workbook.xlsx.readFile(EXCEL_FILE);
    return workbook;
  }

  // Create new workbook with formatted header row
  const sheet = workbook.addWorksheet("Audit Bookings");
  sheet.columns = COLUMNS;

  // Style the header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  // Ensure directory exists
  fs.mkdirSync(path.dirname(EXCEL_FILE), { recursive: true });
  await workbook.xlsx.writeFile(EXCEL_FILE);
  return workbook;
}

router.post("/", async (req, res) => {
  const { businessName, contactName, phone, email, street, city, state, zip } = req.body;

  if (!businessName || !contactName || !phone || !email || !street || !city || !state || !zip) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    const workbook = await getOrCreateWorkbook();
    const sheet = workbook.getWorksheet("Audit Bookings")!;

    sheet.addRow({
      dateSubmitted: new Date().toLocaleDateString("en-US"),
      businessName,
      contactName,
      phone,
      email,
      street,
      city,
      state,
      zip,
      status: "New",
    });

    await workbook.xlsx.writeFile(EXCEL_FILE);

    res.status(201).json({ ok: true, message: "Audit booking submitted successfully." });
  } catch (err) {
    console.error("Failed to save audit booking:", err);
    res.status(500).json({ error: "Failed to save booking. Please try again." });
  }
});

export default router;
