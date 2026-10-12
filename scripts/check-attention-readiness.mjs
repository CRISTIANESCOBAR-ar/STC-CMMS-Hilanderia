import { initializeApp,applicationDefault } from 'firebase-admin/app';
import { getFirestore,FieldPath } from 'firebase-admin/firestore';
import { attentionPilotEnabled,attentionCan,ATTENTION_STATES } from '../functions/attentionPolicy.js';
import { automaticReportEnabled,reportTime } from '../functions/reportAttention.js';
// Explicit project and ADC; strictly read-only, never print identities or task content.
const project=process.argv.find(value=>value.startsWith('--project='))?.slice(10);
if (!project || process.argv.includes('--apply')) { console.error('Uso (solo lectura): node scripts/check-attention-readiness.mjs --project=ID'); process.exit(1); }
initializeApp({ projectId:project,credential:applicationDefault() });
const db=getFirestore(),[pilotSnap,organizationSnap]=await Promise.all([db.doc('config/attentionPilot').get(),db.doc('config/organization').get()]);
const pilot=pilotSnap.data() || {},organization=organizationSnap.data() || {},profiles=new Map();
const report={ project,readOnly:true,pilotEnabled:pilot.enabled===true,managedTasks:0,legacyTasks:0,issues:{},fieldValidationPending:true };
const issue=key=>report.issues[key]=(report.issues[key] || 0)+1;
async function profile(uid) { if(!profiles.has(uid)) profiles.set(uid,(await db.doc(`usuarios/${uid}`).get()).data() || {}); return profiles.get(uid); }
if(pilot.enabled===true && (pilot.version!==1 || !Array.isArray(pilot.userIds) || !pilot.userIds.length || pilot.userIds.length>30 || !Array.isArray(pilot.sectors) || !pilot.sectors.length)) issue('invalid-pilot-configuration');
if(pilot.automaticReports===true && !Number.isFinite(reportTime(pilot.reportsFrom))) issue('automatic-start-missing');
let cursor;
while(true) {
  let query=db.collection('intervenciones').orderBy(FieldPath.documentId()).limit(200); if(cursor) query=query.startAfter(cursor);
  const page=await query.get();
  for(const snapshot of page.docs) {
    const record=snapshot.data(); if(!record.atencionVersion) { report.legacyTasks++; continue; } report.managedTasks++;
    if(record.atencionVersion!==1 || !Object.hasOwn(ATTENTION_STATES,record.atencionEstado) || !Number.isInteger(record.atencionRevision)) issue('invalid-workflow-record');
    if(!['REPORTADA','CERRADA','COMPLETADA'].includes(record.atencionEstado)) {
      if(!record.asignadoA) issue('missing-assignee');
      else { const responsible=await profile(record.asignadoA); if(!attentionCan(responsible,organization,record,'execute')) issue('ineligible-assignee'); if(!attentionPilotEnabled(pilot,record.asignadoA,record.sector)) issue('assignee-outside-active-pilot'); }
    }
    if(record.atencionEstado==='EN_ESPERA' && (!record.esperaMotivo || !record.proximaAccion || !record.revisarAt)) issue('incomplete-wait');
    if(record.reporteOrigenId) { const source=(await db.doc(`novedades/${record.reporteOrigenId}`).get()).data(); if(!source || source.sector!==record.sector || String(source.numeroMaquina)!==String(record.numeroMaquina) || source.tipoMaquina!==record.tipoMaquina) issue('invalid-source-link'); }
  }
  if(page.size<200) break; cursor=page.docs.at(-1);
}
cursor=null;
while(pilot.automaticReports===true) {
  let query=db.collection('novedades').orderBy(FieldPath.documentId()).limit(200); if(cursor) query=query.startAfter(cursor);
  const page=await query.get();
  for(const snapshot of page.docs) {
    const source=snapshot.data();
    if(automaticReportEnabled(pilot,source.creadoPorUid,source.sector,source.createdAt) && source.estado!=='resuelto' && !source.intervencionId && Date.now()-reportTime(source.createdAt)>120000) issue('report-without-automatic-work');
  }
  if(page.size<200) break; cursor=page.docs.at(-1);
}
console.log(JSON.stringify(report,null,2));
if(Object.keys(report.issues).length) process.exitCode=2;
