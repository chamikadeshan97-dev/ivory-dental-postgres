/** Ivory Dental orthodontics import. Dry-run by default; --import writes all four tables atomically. */
require('dotenv').config();
const ExcelJS = require('exceljs');
const path = require('path');
const { PrismaClient, Prisma } = require('@prisma/client');
const args = process.argv.slice(2);
const fi = args.indexOf('--file');
const file = fi >= 0 ? args[fi + 1] : null;
const write = args.includes('--import');
if (!file || !/\.xlsx$/i.test(file)) {
  console.error('Usage: node scripts/importOrthodontics.cjs --file "Dental Clinic Database.xlsx" [--import]');
  process.exit(1);
}
const specs = [
  {sheet:'Ortho_Cases', model:'orthoCase', id:'ortho_case_id', columns:{ortho_case_id:'orthoCaseId',patient_id:'patientId',dentist_id:'dentistId',start_date:'startDate',treatment_type:'treatmentType',treatment_area:'treatmentArea',diagnosis:'diagnosis',estimated_duration:'estimatedDuration',total_treatment_fee:'totalTreatmentFee',payment_plan:'paymentPlan',monthly_payment:'monthlyPayment',next_visit_date:'nextVisitDate',status:'status',notes:'notes',completed_date:'completedDate',created_at:'createdAt',updated_at:'updatedAt'}, required:['ortho_case_id','patient_id'], money:['total_treatment_fee','monthly_payment']},
  {sheet:'Ortho_Visits', model:'orthoVisit', id:'ortho_visit_id', columns:{ortho_visit_id:'orthoVisitId',ortho_case_id:'orthoCaseId',patient_id:'patientId',appointment_id:'appointmentId',dentist_id:'dentistId',visit_number:'visitNumber',visit_date:'visitDate',procedure:'procedure',clinical_notes:'clinicalNotes',appliance_changes:'applianceChanges',elastics:'elastics',next_visit_date:'nextVisitDate',next_visit_plan:'nextVisitPlan',created_at:'createdAt',updated_at:'updatedAt'}, required:['ortho_visit_id','ortho_case_id','patient_id'], integer:['visit_number']},
  {sheet:'Ortho_Payments', model:'orthoPayment', id:'ortho_payment_id', columns:{ortho_payment_id:'orthoPaymentId',ortho_case_id:'orthoCaseId',ortho_visit_id:'orthoVisitId',patient_id:'patientId',payment_date:'paymentDate',amount:'amount',payment_method:'paymentMethod',payment_type:'paymentType',receipt_no:'receiptNo',notes:'notes',recorded_by:'recordedBy',created_at:'createdAt',updated_at:'updatedAt'}, required:['ortho_payment_id','ortho_case_id','patient_id'], money:['amount']},
  {sheet:'Ortho_Media', model:'orthoMedia', id:'ortho_media_id', columns:{ortho_media_id:'orthoMediaId',ortho_case_id:'orthoCaseId',patient_id:'patientId',ortho_visit_id:'orthoVisitId',media_date:'mediaDate',media_type:'mediaType',category:'category',stage:'stage',description:'description',drive_file_id:'driveFileId',drive_folder_id:'driveFolderId',file_name:'fileName',mime_type:'mimeType',file_size:'fileSize',uploaded_by:'uploadedBy',uploaded_at:'uploadedAt',is_deleted:'isDeleted',storage_provider:'storageProvider',s3_bucket:'s3Bucket',s3_key:'s3Key',deleted_at:'deletedAt'}, required:['ortho_media_id','ortho_case_id','patient_id']}
];
function raw(cell) {
  const v = cell.value;
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if (Array.isArray(v.richText)) return v.richText.map(x=>x.text||'').join('');
    throw new Error(`Unsupported cell type at ${cell.address}`);
  }
  return v;
}
function str(v) { return v == null ? null : String(v).trim() || null; }
function decimal(v, sheet, row, field) {
  const s = str(v);
  if (s == null) return null;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error(`${sheet} row ${row}: invalid ${field}: ${s}`);
  const d = new Prisma.Decimal(s);
  if (d.abs().gte('10000000000')) throw new Error(`${sheet} row ${row}: ${field} exceeds DECIMAL(12,2)`);
  return d;
}
function parseSheet(workbook, spec) {
  const sheet = workbook.getWorksheet(spec.sheet);
  if (!sheet) throw new Error(`Missing worksheet: ${spec.sheet}`);
  const headers = new Map();
  sheet.getRow(1).eachCell((cell,col)=>{
    const name=str(raw(cell));
    if (!name) return;
    if (headers.has(name)) throw new Error(`${spec.sheet}: duplicate header ${name}`);
    headers.set(name,col);
  });
  const missing = Object.keys(spec.columns).filter(x=>!headers.has(x));
  if (missing.length) throw new Error(`${spec.sheet}: missing columns ${missing.join(', ')}`);
  const records=[], seen=new Set();
  for (let n=2;n<=sheet.rowCount;n++) {
    const vals={};
    for (const name of Object.keys(spec.columns)) vals[name]=raw(sheet.getRow(n).getCell(headers.get(name)));
    if (Object.values(vals).every(v=>str(v)==null)) continue;
    for (const name of spec.required) if (!str(vals[name])) throw new Error(`${spec.sheet} row ${n}: missing ${name}`);
    const id=str(vals[spec.id]);
    if (seen.has(id)) throw new Error(`${spec.sheet} row ${n}: duplicate ID ${id}`);
    seen.add(id);
    const rec={};
    for (const [source,target] of Object.entries(spec.columns)) {
      if ((spec.money||[]).includes(source)) rec[target]=decimal(vals[source],spec.sheet,n,source);
      else if ((spec.integer||[]).includes(source)) {
        const s=str(vals[source]);
        if (s!=null && (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)) || Number(s)>2147483647)) throw new Error(`${spec.sheet} row ${n}: invalid integer ${source}`);
        rec[target]=s==null?null:Number(s);
      } else rec[target]=str(vals[source]);
    }
    records.push(rec);
  }
  return records;
}
async function main() {
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(file));
  const data=Object.fromEntries(specs.map(spec=>[spec.model,parseSheet(workbook,spec)]));
  const prisma=new PrismaClient();
  try {
    const [patients,dentists,appointments,existing]=await Promise.all([
      prisma.patient.findMany({select:{id:true}}),
      prisma.dentist.findMany({select:{id:true}}),
      prisma.appointment.findMany({select:{id:true}}),
      Promise.all(specs.map(s=>prisma[s.model].count()))
    ]);
    const ids={patients:new Set(patients.map(x=>x.id)),dentists:new Set(dentists.map(x=>x.id)),appointments:new Set(appointments.map(x=>x.id)),cases:new Set(data.orthoCase.map(x=>x.orthoCaseId)),visits:new Set(data.orthoVisit.map(x=>x.orthoVisitId))};
    const errors=[];
    const check=(rows,field,set,label,optional=false)=>rows.forEach((r,i)=>{
      if (r[field]==null && optional) return;
      if (!set.has(r[field])) errors.push(`${label} row ${i+2}: unknown ${field} ${r[field]||'(blank)'}`);
    });
    for (const s of specs) {
      const rows=data[s.model];
      check(rows,'patientId',ids.patients,s.sheet);
      if (s.model==='orthoCase') check(rows,'dentistId',ids.dentists,s.sheet,true);
      else {
        check(rows,'orthoCaseId',ids.cases,s.sheet);
        if (s.model==='orthoVisit') {
          check(rows,'dentistId',ids.dentists,s.sheet,true);
          check(rows,'appointmentId',ids.appointments,s.sheet,true);
        }
        if (s.model==='orthoPayment'||s.model==='orthoMedia') check(rows,'orthoVisitId',ids.visits,s.sheet,true);
      }
      console.log(`${s.sheet}: ${rows.length} valid source rows; PostgreSQL existing: ${existing[specs.indexOf(s)]}`);
    }
    // Additional cross-table consistency checks.
    const casePatients=new Map(data.orthoCase.map(x=>[x.orthoCaseId,x.patientId]));
    const visitCases=new Map(data.orthoVisit.map(x=>[x.orthoVisitId,x.orthoCaseId]));
    for (const s of specs.slice(1)) data[s.model].forEach((r,i)=>{
      if (casePatients.has(r.orthoCaseId) && casePatients.get(r.orthoCaseId)!==r.patientId) errors.push(`${s.sheet} row ${i+2}: patient does not match case`);
      if (r.orthoVisitId && visitCases.has(r.orthoVisitId) && visitCases.get(r.orthoVisitId)!==r.orthoCaseId) errors.push(`${s.sheet} row ${i+2}: visit does not match case`);
    });
    console.log('Reference/consistency errors:',errors.length);
    errors.slice(0,20).forEach(e=>console.error(' -',e));
    if (errors.length>20) console.error(`... ${errors.length-20} more errors`);
    if (!write) { console.log('DRY RUN: no database changes.'); return; }
    if (errors.length) throw new Error('Import blocked: resolve reference errors first');
    if (existing.some(n=>n!==0)) throw new Error('Import blocked: one or more orthodontic destination tables are not empty');
    await prisma.$transaction(async tx=>{
      for (const s of specs) {
        if (await tx[s.model].count()) throw new Error(`${s.sheet}: destination became nonempty`);
      }
      for (const s of specs) if (data[s.model].length) await tx[s.model].createMany({data:data[s.model]});
    },{timeout:120000});
    for (const s of specs) {
      const count=await prisma[s.model].count();
      if (count!==data[s.model].length) throw new Error(`Count mismatch in ${s.sheet}: ${count} vs ${data[s.model].length}`);
      console.log(`VERIFIED ${s.sheet}: ${count}`);
    }
    console.log('ORTHODONTIC IMPORT COMPLETE');
  } finally { await prisma.$disconnect(); }
}
main().catch(e=>{console.error('Stopped:',e.message);process.exitCode=1;});
