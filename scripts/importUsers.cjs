/**
 * Ivory Dental: safe, dry-run-first Users import.
 * Usage:
 *   node scripts/importUsers.cjs --file "Dental Clinic Database.xlsx"
 *   node scripts/importUsers.cjs --file "Dental Clinic Database.xlsx" --import
 */
require('dotenv').config();
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const prisma = new PrismaClient();

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const file = fileIndex >= 0 ? args[fileIndex + 1] : null;
const doImport = args.includes('--import');
const excluded = new Set(['kanchana']);
const bcryptPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const expectedUsers = new Set(['deshjayasingha', 'ivorydental26', 'monashi', 'chamika']);
const text = (v) => v == null ? '' : (typeof v === 'object' && v.text != null ? String(v.text) : String(v)).trim();

async function main() {
  if (!file) throw new Error('Supply --file "Dental Clinic Database.xlsx"');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(file));
  const sheet = wb.getWorksheet('Users');
  if (!sheet) throw new Error('Missing worksheet: Users');
  const headers = sheet.getRow(1).values.map(v => text(v));
  const required = ['id','name','username','password_hash','password','role','status','created_at','updated_at','email','phone','appointment_history','queue_manager','doctor_treatment','payment_history','common_treatments','drugs','locations'];
  for (const h of required) if (!headers.includes(h)) throw new Error(`Missing column: ${h}`);
  const col = (name) => headers.indexOf(name);
  const records = [];
  const errors = [];
  const seenIds = new Set();
  const seenNames = new Set();
  const fields = {
    id:'id', name:'name', username:'username', role:'role', status:'status',
    created_at:'createdAt', updated_at:'updatedAt', email:'email', phone:'phone',
    appointment_history:'appointmentHistory', queue_manager:'queueManager',
    doctor_treatment:'doctorTreatment', payment_history:'paymentHistory',
    common_treatments:'commonTreatments', drugs:'drugs', locations:'locations'
  };
  let skippedExcluded = 0, skippedBlank = 0;
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const get = (name) => text(row.getCell(col(name)).value);
    const id = get('id');
    const username = get('username');
    if (!id && !username) { skippedBlank++; continue; }
    if (excluded.has(username.toLowerCase())) { skippedExcluded++; continue; }
    if (!id || !username) { errors.push(`Row ${i}: missing ID or username`); continue; }
    if (seenIds.has(id) || seenNames.has(username.toLowerCase())) { errors.push(`Row ${i}: duplicate ID or username`); continue; }
    seenIds.add(id); seenNames.add(username.toLowerCase());
    const hash = get('password_hash');
    const legacy = get('password');
    const validHash = [hash, legacy].find(v => bcryptPattern.test(v));
    if (!validHash) { errors.push(`Row ${i}: no valid bcrypt hash`); continue; }
    const data = {};
    for (const [source, target] of Object.entries(fields)) {
      const value = get(source);
      data[target] = value || null;
    }
    data.id = id;
    data.username = username;
    data.passwordHash = validHash;
    data.password = null;
    records.push(data);
  }
  const names = new Set(records.map(r => r.username.toLowerCase()));
  for (const name of expectedUsers) if (!names.has(name)) errors.push(`Expected account not found: ${name}`);
  for (const name of names) if (!expectedUsers.has(name)) errors.push(`Unexpected account: ${name}`);
  console.log(`Users worksheet: ${sheet.name}`);
  console.log(`Valid users: ${records.length}`);
  console.log(`Excluded users: ${skippedExcluded}`);
  console.log(`Blank rows: ${skippedBlank}`);
  console.log(`Validation errors: ${errors.length}`);
  for (const error of errors) console.error(`- ${error}`);
  if (errors.length) throw new Error('Validation failed; no records imported.');
  const existing = await prisma.user.count();
  console.log(`Existing PostgreSQL users: ${existing}`);
  if (existing !== 0) throw new Error('Destination users table is not empty; refusing to import.');
  if (!doImport) { console.log('DRY RUN PASSED. No data written.'); return; }
  await prisma.$transaction(async tx => {
    const count = await tx.user.count();
    if (count !== 0) throw new Error('Destination users table changed; refusing to import.');
    await tx.user.createMany({ data: records });
  });
  console.log(`IMPORTED ${records.length} users successfully.`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
