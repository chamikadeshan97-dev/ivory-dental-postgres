/** Ivory Dental: import only the TreatmentPayments worksheet.
 * Dry-run: node scripts/importTreatmentPayments.cjs --file "Dental Clinic Database.xlsx"
 * Import:  node scripts/importTreatmentPayments.cjs --file "Dental Clinic Database.xlsx" --import
 * Requires: exceljs, dotenv, @prisma/client. Does not alter routes or source workbook.
 */
require('dotenv').config();
const ExcelJS = require('exceljs');
const path = require('path');
const { PrismaClient, Prisma } = require('@prisma/client');

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const file = fileIndex < 0 ? null : args[fileIndex + 1];
const write = args.includes('--import');
if (!file || !/\.xlsx$/i.test(file)) {
  console.error('Usage: node scripts/importTreatmentPayments.cjs --file "file.xlsx" [--import]');
  process.exit(1);
}
const fields = {
  id: 'id', treatment_id: 'treatmentId', patient_id: 'patientId',
  treatment_name: 'treatmentName', total_fee: 'totalFee',
  payment_type: 'paymentType', total_paid: 'totalPaid', balance: 'balance',
  payment_history: 'paymentHistory', status: 'status',
  created_at: 'createdAt', updated_at: 'updatedAt'
};
function raw(cell) {
  const v = cell.value;
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
    if (Array.isArray(v.richText)) return v.richText.map(x => x.text || '').join('');
    throw new Error('Unsupported Excel cell value');
  }
  return v;
}
function stringValue(v) { return v == null ? null : String(v).trim() || null; }
function money(v, field, row) {
  const s = stringValue(v);
  if (s == null) throw new Error(`Missing ${field} at Excel row ${row}`);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error(`Invalid monetary value in ${field} at Excel row ${row}`);
  const d = new Prisma.Decimal(s);
  if (d.abs().greaterThanOrEqualTo('10000000000')) throw new Error(`Monetary value exceeds DECIMAL(12,2) at Excel row ${row}`);
  return d;
}
function paymentHistory(v, row) {
  const s = stringValue(v);
  if (s == null) throw new Error(`Missing payment_history at Excel row ${row}`);
  let parsed;
  try { parsed = JSON.parse(s); } catch { throw new Error(`Invalid payment_history JSON at Excel row ${row}`); }
  if (!Array.isArray(parsed)) throw new Error(`payment_history must be a JSON array at Excel row ${row}`);
  return parsed;
}
async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(file));
  const sheet = workbook.getWorksheet('TreatmentPayments');
  if (!sheet) throw new Error('Missing worksheet: TreatmentPayments');
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, col) => {
    const h = stringValue(raw(cell));
    if (!h) return;
    if (headers.has(h)) throw new Error('Duplicate worksheet column: ' + h);
    headers.set(h, col);
  });
  const missing = Object.keys(fields).filter(k => !headers.has(k));
  if (missing.length) throw new Error('Missing columns: ' + missing.join(', '));
  const records = [], seen = new Set();
  let totalFees = new Prisma.Decimal(0), totalPaid = new Prisma.Decimal(0), totalBalances = new Prisma.Decimal(0);
  for (let n = 2; n <= sheet.rowCount; n++) {
    const values = {};
    for (const col of Object.keys(fields)) values[col] = raw(sheet.getRow(n).getCell(headers.get(col)));
    if (Object.values(values).every(v => v === null || v === '')) continue;
    for (const required of ['id', 'treatment_id', 'patient_id', 'treatment_name', 'payment_type', 'status']) {
      if (!stringValue(values[required])) throw new Error(`Missing ${required} at Excel row ${n}`);
    }
    const id = stringValue(values.id);
    if (seen.has(id)) throw new Error(`Duplicate payment ID at Excel row ${n}`);
    seen.add(id);
    const record = {};
    for (const [source, target] of Object.entries(fields)) {
      if (['total_fee','total_paid','balance'].includes(source)) record[target] = money(values[source], source, n);
      else if (source === 'payment_history') record[target] = paymentHistory(values[source], n);
      else record[target] = stringValue(values[source]);
    }
    // This is a validation, not a recalculation: never silently change financial amounts.
    if (!record.totalFee.minus(record.totalPaid).equals(record.balance)) {
      throw new Error(`Fee / paid / balance mismatch at Excel row ${n}`);
    }
    totalFees = totalFees.plus(record.totalFee);
    totalPaid = totalPaid.plus(record.totalPaid);
    totalBalances = totalBalances.plus(record.balance);
    records.push(record);
  }
  const prisma = new PrismaClient();
  try {
    const [existing, patients] = await Promise.all([
      prisma.treatmentPayment.count(),
      prisma.patient.findMany({select:{id:true}})
    ]);
    const patientIds = new Set(patients.map(p => p.id));
    const missingPatients = records.filter(r => !patientIds.has(r.patientId));
    console.log('Source sheet: TreatmentPayments (not legacy treatment_payments)');
    console.log('Valid payment rows:', records.length);
    console.log('Existing PostgreSQL treatment payments:', existing);
    console.log('Missing patient references:', missingPatients.length);
    console.log('Total fees:', totalFees.toFixed(2));
    console.log('Total paid:', totalPaid.toFixed(2));
    console.log('Total balance:', totalBalances.toFixed(2));
    if (!write) { console.log('DRY RUN: no database changes.'); return; }
    if (existing) throw new Error('Import blocked: treatment_payments destination is not empty');
    if (missingPatients.length) throw new Error('Import blocked: unresolved patient references');
    await prisma.$transaction(async tx => {
      if (await tx.treatmentPayment.count()) throw new Error('Destination became nonempty');
      await tx.treatmentPayment.createMany({data:records});
    }, {timeout:120000});
    const count = await prisma.treatmentPayment.count();
    if (count !== records.length) throw new Error(`Post-import count mismatch: ${count} vs ${records.length}`);
    console.log('IMPORT COMPLETE:', count, 'treatment payments');
  } finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error('Stopped:', e.message); process.exitCode = 1; });
