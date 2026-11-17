/** Ivory Dental appointment migration. Dry-run by default; --import writes atomically.
 * Usage: node scripts/importAppointments.cjs --file "Dental Clinic Database.xlsx" [--import]
 */
require('dotenv').config();
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const args = process.argv.slice(2);
const idx = args.indexOf('--file');
const filename = idx >= 0 ? args[idx + 1] : null;
const write = args.includes('--import');
if (!filename || !/\.xlsx$/i.test(filename)) {
  console.error('Usage: node scripts/importAppointments.cjs --file "file.xlsx" [--import]');
  process.exit(1);
}
const columns = {
  id: 'id', patient_id: 'patientId', dentist_id: 'dentistId',
  appointment_number: 'appointmentNumber', appointment_date: 'appointmentDate',
  appointment_time: 'appointmentTime', reason_for_visit: 'reasonForVisit',
  status: 'status', checked_in_time: 'checkedInTime',
  treatment_started_at: 'treatmentStartedAt',
  treatment_completed_at: 'treatmentCompletedAt', completed_at: 'completedAt',
  created_at: 'createdAt', updated_at: 'updatedAt'
};
function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (v.text !== undefined) return String(v.text).trim() || null;
    if (v.result !== undefined) return v.result == null ? null : String(v.result).trim() || null;
    if (Array.isArray(v.richText)) return v.richText.map(p => p.text || '').join('').trim() || null;
    throw new Error('Unsupported Excel cell type');
  }
  return String(v).trim() || null;
}
async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(filename));
  const sheet = workbook.getWorksheet('Appointments');
  if (!sheet) throw new Error('Appointments sheet not found');
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, col) => {
    const name = String(cell.value || '').trim();
    if (headers.has(name)) throw new Error('Duplicate column header: ' + name);
    headers.set(name, col);
  });
  const missing = Object.keys(columns).filter(c => !headers.has(c));
  if (missing.length) throw new Error('Missing Appointments columns: ' + missing.join(', '));
  const records = [], ids = new Set();
  for (let n = 2; n <= sheet.rowCount; n++) {
    const data = {};
    for (const [source, target] of Object.entries(columns)) {
      data[target] = cellText(sheet.getRow(n).getCell(headers.get(source)));
    }
    if (Object.values(data).every(v => v === null)) continue;
    if (!data.id) throw new Error('Missing appointment ID at worksheet row ' + n);
    if (ids.has(data.id)) throw new Error('Duplicate appointment ID at worksheet row ' + n);
    ids.add(data.id);
    records.push(data);
  }
  const prisma = new PrismaClient();
  try {
    const [patients, dentists, current] = await Promise.all([
      prisma.patient.findMany({select: {id: true}}),
      prisma.dentist.findMany({select: {id: true}}),
      prisma.appointment.count()
    ]);
    const patientIds = new Set(patients.map(p => p.id));
    const dentistIds = new Set(dentists.map(d => d.id));
    const missingPatients = records.filter(r => r.patientId && !patientIds.has(r.patientId));
    const missingDentists = records.filter(r => r.dentistId && !dentistIds.has(r.dentistId));
    const missingPatientValues = records.filter(r => !r.patientId);
    console.log('Appointments in workbook:', records.length);
    console.log('Existing PostgreSQL appointments:', current);
    console.log('Appointments referencing missing patients:', missingPatients.length);
    console.log('Appointments referencing missing dentists:', missingDentists.length);
    console.log('Appointments without patient ID:', missingPatientValues.length);
    if (missingPatients.length) console.log('Missing patient references (first 5 worksheet row numbers):', missingPatients.slice(0, 5).map(r => records.indexOf(r) + 2).join(', '));
    if (missingDentists.length) console.log('Missing dentist references (first 5 worksheet row numbers):', missingDentists.slice(0, 5).map(r => records.indexOf(r) + 2).join(', '));
    if (!write) { console.log('DRY RUN: no records written.'); return; }
    if (current) throw new Error('Import blocked: appointments table is not empty');
    if (missingPatients.length || missingDentists.length || missingPatientValues.length) {
      throw new Error('Import blocked: unresolved patient/dentist references. Review before importing.');
    }
    await prisma.$transaction(async tx => {
      if (await tx.appointment.count()) throw new Error('Appointments table is no longer empty');
      await tx.appointment.createMany({data: records});
    }, {timeout: 120000});
    console.log('IMPORT COMPLETE:', records.length, 'appointments');
  } finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error('Stopped:', e.message); process.exitCode = 1; });
