// Generates a reviewable runbook. It does not invoke gcloud or change any resource.
const value=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const project=value('project'),bucket=value('bucket'),testProject=value('test-project');
if(!/^[a-z][a-z0-9-]{4,62}$/.test(project || '') || !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(bucket || '') || !/^[a-z][a-z0-9-]{4,62}$/.test(testProject || '') || testProject===project || process.argv.includes('--apply')) {
  console.error('Uso: node scripts/plan-recovery.mjs --project=ORIGEN --bucket=RESPALDO --test-project=DESTINO_DISTINTO'); process.exit(1);
}
const prefix=`gs://${bucket}/firestore/${project}/${new Date().toISOString().replace(/[:.]/g,'-')}`;
console.log(JSON.stringify({ executed:false,sourceProject:project,restoreProject:testProject,backupPrefix:prefix,commands:[
  `gcloud firestore export ${prefix} --project=${project}`,
  `gcloud firestore operations list --project=${project}`,
  `gcloud firestore import ${prefix} --project=${testProject}`,
],checks:[ 'Confirmar permisos, ubicación, costos y acceso privado al bucket antes de ejecutar.', 'Exportar toda la base, incluidas subcolecciones de eventos; esperar confirmación de finalización.', 'Respaldar las fotos operativas de Storage por separado; exportar Firestore no incluye sus archivos.', 'Restaurar solamente en el proyecto de prueba indicado y comparar tareas, perfiles, eventos y referencias de fotos.', 'No se habilita el piloto por generar este plan; documentar duración y pérdida máxima de datos aceptable.' ] },null,2));
