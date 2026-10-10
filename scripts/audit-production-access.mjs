import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { compatibilityIssues } from './production-compatibility.mjs';

// Read-only. Explicit project, ADC credentials, no mutation flag or implicit production target.
const argument = process.argv.find(value => value.startsWith('--project='));
const projectId = argument?.slice('--project='.length);
if (!projectId || process.argv.includes('--apply')) {
  console.error('Uso (solo lectura): node scripts/audit-production-access.mjs --project=ID');
  process.exit(1);
}
initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore();
const report = { projectId, readOnly: true, collections: {}, blockingDocuments: 0 };
for (const name of ['usuarios', 'novedades', 'intervenciones', 'patrullas', 'notas_turno']) {
  const summary = { documents: 0, affectedDocuments: 0, issues: {} };
  let cursor = null;
  while (true) {
    let page = db.collection(name).orderBy(FieldPath.documentId()).limit(300);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    if (snapshot.empty) break;
    for (const document of snapshot.docs) {
      summary.documents++;
      const issues = compatibilityIssues(name, document.data());
      if (issues.length) summary.affectedDocuments++;
      if (issues.some(issue => issue !== 'pending-approval')) report.blockingDocuments++;
      for (const issue of issues) summary.issues[issue] = (summary.issues[issue] || 0) + 1;
    }
    cursor = snapshot.docs.at(-1);
  }
  report.collections[name] = summary;
}
// Aggregate counts only; do not print users, emails, incidents or credentials.
console.log(JSON.stringify(report, null, 2));
if (report.blockingDocuments) process.exitCode = 2;
