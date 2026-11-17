/** Ivory Dental: first-stage import of Patients and Dentists only.
 * Dry-run: node scripts/importPatientsDentists.cjs --file "...xlsx"
 * Write:   node scripts/importPatientsDentists.cjs --file "...xlsx" --import
 * Never prints patient details or credentials.
 */
require('dotenv').config();
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const file = fileIndex >= 0 ? args[fileIndex + 1] : null;
const shouldImport = args.includes('--import');
if (!file || !file.toLowerCase().endsWith('.xlsx')) {
  console.error('Usage: node scripts/importPatientsDentists.cjs --file "path-to-export.xlsx" [--import]');
  process.exit(1);
}

const fields = {
  Patients: ['id','name','phone','age','gender','address','is_allergies','allergies','location','distance','created_at','updated_at'],
  Dentists: ['id','name','phone','specialization','created_at','updated_at']
};
const rename = {
  is_allergies:'isAllergies', created_at:'createdAt', updated_at:'updatedAt'
};
function textValue(cell, key) {
  const v = cell.value;
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text).trim() || null;
    if (v.result != null) return String(v.result).trim() || null;
    if (v.richText) return v.richText.map(x => x.text || '').join('').trim() || null;
    throw new Error(`Unsupported cell value in column ${key}`);
  }
  // Excel serial dates occur in the original Dentists.created_at column.
  if ((key === 'created_at' || key === 'updated_at') && typeof v === 'number' && v >= 20000 && v <= 100000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString();
  }
  return String(v).trim() || null;
}
function parseSheet(book, sheetName) {
  const sheet = book.getWorksheet(sheetName);
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, col) => {
    const key = String(cell.value || '').trim();
    if (headers.has(key)) throw new Error(`Duplicate header ${key} in ${sheetName}`);
    headers.set(key, col);
  });
  const missing = fields[sheetName].filter(key => !headers.has(key));
  if (missing.length) throw new Error(`${sheetName}: missing columns ${missing.join(', ')}`);
  const seen = new Set();
  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const data = {};
    for (const key of fields[sheetName]) {
      data[rename[key] || key] = textValue(row.getCell(headers.get(key)), key);
    }
    if (Object.values(data).every(v => v == null)) continue;
    if (!data.id) throw new Error(`${sheetName}: missing ID at Excel row ${r}`);
    if (seen.has(data.id)) throw new Error(`${sheetName}: duplicate ID at Excel row ${r}`);
    seen.add(data.id);
    rows.push(data);
  }
  return rows;
}
(async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(file));
  const patients = parseSheet(workbook, 'Patients');
  const dentists = parseSheet(workbook, 'Dentists');
  console.log(`Validated: Patients=${patients.length}, Dentists=${dentists.length}`);
  console.log('No personal information printed.');
  if (!shouldImport) {
    console.log('DRY RUN ONLY: no database changes. Re-run with --import to write.');
    return;
  }
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async tx => {
      const [pCount, dCount] = await Promise.all([tx.patient.count(), tx.dentist.count()]);
      if (pCount || dCount) throw new Error('Import stopped: target patients or dentists table is not empty. No records written.');
      await tx.patient.createMany({data: patients});
      await tx.dentist.createMany({data: dentists});
    }, {timeout: 120000});
    console.log(`IMPORT COMPLETE: Patients=${patients.length}, Dentists=${dentists.length}`);
  } finally { await prisma.$disconnect(); }
})().catch(err => { console.error('Import stopped:', err.message); process.exitCode = 1; });
