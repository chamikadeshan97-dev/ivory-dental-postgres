/** Ivory Dental supporting tables. Dry-run by default; --import inserts atomically. */
require('dotenv').config();
const ExcelJS = require('exceljs');
const path = require('path');
const { PrismaClient, Prisma } = require('@prisma/client');
const argv = process.argv.slice(2);
const pos = argv.indexOf('--file');
const file = pos >= 0 ? argv[pos + 1] : null;
const write = argv.includes('--import');
if (!file || !/\.xlsx$/i.test(file)) {
  console.error('Usage: node scripts/importSupporting.cjs --file "Dental Clinic Database.xlsx" [--import]');
  process.exit(1);
}
const specs = [
  {sheet:'QueueOrder', model:'queueOrder', id:'date', columns:{date:'date',queue_order:'queueOrder',updated_at:'updatedAt'}},
  {sheet:'Locations', model:'location', id:'id', columns:{id:'id',location:'location',distance_km:'distanceKm'}},
  {sheet:'Common_Treatments', model:'commonTreatment', id:'id', columns:{id:'id',treatment_name:'treatmentName',fee:'fee',created_at:'createdAt',updated_at:'updatedAt'}},
  {sheet:'SMSLogs', model:'smsLog', id:null, columns:{'Date':'date','SMS Type':'smsType','Status':'status','Total':'total','Sent':'sent','Fail':'fail','Sent By':'sentBy','Sent At':'sentAt','Failed':'failed','Batch Token':'batchToken'}}
];
function raw(cell) {
  const v = cell.value;
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if (Array.isArray(v.richText)) return v.richText.map(x=>x.text||'').join('');
    throw new Error(`Unsupported cell type ${cell.address}`);
  }
  return v;
}
function str(v) { return v == null ? null : String(v).trim() || null; }
function integer(v, label) {
  const s=str(v);
  if (s==null) return null;
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)) || Number(s)>2147483647) throw new Error(`${label}: invalid integer ${s}`);
  return Number(s);
}
function decimal(v,label) {
  const s=str(v);
  if (s==null) return null;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error(`${label}: invalid amount ${s}`);
  const d=new Prisma.Decimal(s);
  if (d.abs().gte('10000000000')) throw new Error(`${label}: exceeds DECIMAL(12,2)`);
  return d;
}
function queueJson(v,label) {
  if (v == null || String(v).trim() === '') throw new Error(`${label}: queue_order is blank`);
  if (typeof v !== 'string') throw new Error(`${label}: expected JSON string`);
  let parsed;
  try { parsed=JSON.parse(v); } catch { throw new Error(`${label}: invalid JSON`); }
  if (parsed===null || typeof parsed !== 'object') throw new Error(`${label}: expected JSON object or array`);
  return parsed;
}
function readSheet(workbook,spec) {
  const ws=workbook.getWorksheet(spec.sheet);
  if (!ws) throw new Error(`Missing worksheet ${spec.sheet}`);
  const headers=new Map();
  ws.getRow(1).eachCell((cell,index)=>{
    const h=str(raw(cell));
    if (!h) return;
    if (headers.has(h)) throw new Error(`${spec.sheet}: duplicate header ${h}`);
    headers.set(h,index);
  });
  const missing=Object.keys(spec.columns).filter(h=>!headers.has(h));
  if (missing.length) throw new Error(`${spec.sheet}: missing headers ${missing.join(', ')}`);
  const rows=[], seen=new Set();
  for(let n=2;n<=ws.rowCount;n++) {
    const values=Object.fromEntries(Object.keys(spec.columns).map(h=>[h,raw(ws.getRow(n).getCell(headers.get(h)))]));
    if(Object.values(values).every(v=>str(v)==null)) continue;
    if(spec.id) {
      const id=str(values[spec.id]);
      if(!id) throw new Error(`${spec.sheet} row ${n}: missing ${spec.id}`);
      if(seen.has(id)) throw new Error(`${spec.sheet} row ${n}: duplicate ${spec.id} ${id}`);
      seen.add(id);
    }
    const item={};
    for(const [h,field] of Object.entries(spec.columns)) {
      const label=`${spec.sheet} row ${n} ${h}`;
      if(h==='queue_order') item[field]=queueJson(values[h],label);
      else if(h==='fee') item[field]=decimal(values[h],label);
      else if(spec.model==='smsLog' && ['Total','Sent','Fail'].includes(h)) item[field]=integer(values[h],label);
      else item[field]=str(values[h]);
    }
    if(spec.model==='smsLog') {
      if(item.total!=null && item.sent!=null && item.fail!=null && item.sent+item.fail>item.total)
        throw new Error(`${spec.sheet} row ${n}: sent + fail exceeds total`);
    }
    rows.push(item);
  }
  return rows;
}
async function main() {
  const wb=new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(file));
  const data=Object.fromEntries(specs.map(s=>[s.model,readSheet(wb,s)]));
  const db=new PrismaClient();
  try {
    const counts=await Promise.all(specs.map(s=>db[s.model].count()));
    specs.forEach((s,i)=>console.log(`${s.sheet}: ${data[s.model].length} valid source rows; PostgreSQL existing: ${counts[i]}`));
    if(counts.some(n=>n!==0)) throw new Error('At least one destination table is not empty. Import refused to prevent duplicates.');
    if(!write) { console.log('DRY RUN PASSED. No database changes.'); return; }
    await db.$transaction(async tx=>{
      // Recheck inside transaction to reduce accidental duplicate imports.
      for(const s of specs) if(await tx[s.model].count()!==0) throw new Error(`${s.sheet}: destination no longer empty`);
      for(const s of specs) if(data[s.model].length) await tx[s.model].createMany({data:data[s.model]});
    },{timeout:60000});
    console.log('IMPORT COMPLETE. Verify record counts in pgAdmin.');
  } finally { await db.$disconnect(); }
}
main().catch(e=>{console.error('STOPPED:',e.message);process.exitCode=1;});
