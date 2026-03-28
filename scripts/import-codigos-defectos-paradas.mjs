/**
 * import-codigos-defectos-paradas.mjs
 * Importa códigos de defectos de calidad y paradas de máquina a Firestore.
 * 
 * Uso:
 *   node scripts/import-codigos-defectos-paradas.mjs          → dry-run (solo muestra)
 *   node scripts/import-codigos-defectos-paradas.mjs --apply  → escribe en Firestore
 *   node scripts/import-codigos-defectos-paradas.mjs --reset  → borra todo y reimporta
 */

import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const ExcelJS  = require('exceljs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'stc-cmms-hilanderia';

const APPLY = process.argv.includes('--apply') || process.argv.includes('--reset');
const RESET = process.argv.includes('--reset');

// ── Firebase Admin ────────────────────────────────────────────────────────────
const initAdmin = () => {
  if (getApps().length) return;
  const saPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');
  const appConfig = { projectId: PROJECT_ID };
  if (saPath && existsSync(saPath)) {
    initializeApp({ ...appConfig, credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
  } else {
    initializeApp({ ...appConfig, credential: applicationDefault() });
  }
};
initAdmin();
const db = getFirestore();

// ── Traducciones manuales ─────────────────────────────────────────────────────
// Clave: código numérico → valor: traducción española
const TRAD_DEFECTOS = {
  // ── HILANDERIA ──
  205: 'Hilo irregular',
  206: 'Ancho irregular SSM',
  207: 'Trama irregular SSM',
  208: 'Hilo oscuro',
  210: 'Contaminación polipropileno',
  211: 'Contaminación poliéster',
  212: 'Trama con pilosidad',
  213: 'Suciedad adherida en hilo de urdimbre',
  214: 'Suciedad adherida en trama OE',
  215: 'Hilo mezclado (Hilandería)',
  219: 'Empalme irregular',
  220: 'Franja de trama',
  221: 'Trama irregular (tramo)',
  222: 'Trama irregular (completa)',
  223: 'Neps',
  224: 'Suciedad adherida en trama convencional',
  225: 'Trama irregular tramo tercerizado',
  226: 'Moiré',
  229: 'Desarrollo Hilandería',
  230: 'Hilo rozado (Hilandería)',
  231: 'Hilo 100% algodón irregular',
  232: 'Trama irregular OE convencional',
  233: 'Color irregular en trama convencional',
  234: 'Hilo escuro (Hilandería)',
  235: 'Mecha caída',
  236: 'Empalme en urdimbre',
  237: 'Empalme en trama convencional',
  238: 'Empalme en trama OE',
  239: 'Trama con pilosidad convencional',
  240: 'Falla de torsión en hilo',
  241: 'Hilo engomado defectuoso',
  242: 'Hilo con polvo de hilandería',
  243: 'Trama irregular (parcial)',
  244: 'Contamminación de grasa',
  245: 'Hilo corto en urdimbre',
  246: 'Neps en trama OE',
  299: 'Otros (Hilandería)',

  // ── TEJEDURIA ──
  307: 'Hilo doble en encolado',
  308: 'Hilván',
  309: 'Falta de hilo',
  310: 'Hilo doble',
  311: 'Hilo estirado',
  312: 'Hilo flojo (Tejeduría)',
  313: 'Hilo roto',
  314: 'Pasado incorrecto (ligamento/peine)',
  315: 'Trama rozada',
  316: 'Peine abierto',
  317: 'Morrón (nudo grueso)',
  318: 'Raya de tensor de temperatura',
  319: 'Trama rota',
  320: 'Nudo',
  321: 'Ligamento incorrecto',
  322: 'Trama irregular SSM (Tejeduría)',
  323: 'Batida incorrecta',
  324: 'Raya de peine',
  325: 'Variación de ancho SSM',
  326: 'Nudo de trama',
  328: 'Falta de trama',
  329: 'Tela batida',
  330: 'Falta de trama pequeña (raleira)',
  331: 'Falta de trama grande (ralão)',
  332: 'Defecto de regulador',
  333: 'Parada de telar',
  334: 'Suciedad de tejeduría',
  335: 'Agujero de peine',
  338: 'Trama mezclada',
  340: 'Trama floja',
  341: 'Trama tirada/jalada',
  342: 'Trama sucia',
  343: 'Hilo jalado',
  345: 'Rozamiento de tejeduría',
  346: 'Canastra (sel. de lizos)',
  347: 'Elastano roto',
  348: 'Defecto de lizos',
  349: 'Óxido/Herrumbre',
  350: 'Mancha de grasa (Tejeduría)',
  351: 'Tela con orillo defectuoso (fuera de ancho)',
  352: 'Marcación de tejeduría',
  354: 'Trama floja larga',
  363: 'Agujeros, roturas y cortes',
  366: 'Mancha de aceite (Tejeduría)',
  374: 'Rotura de costura tejeduría',
  375: 'Roturas de tejeduría',
  380: 'Trama lacada',
  381: 'Trama cortada',
  382: 'Trama corta',
  383: 'Pata de gallo (ligamento)',
  384: 'Falla de cobertura',
  385: 'Pedazos de trama en la tela',
  386: 'Trama doble',
  387: 'Trama doblada',
  388: 'Raya de urdimbre fuerte',
  390: 'Hilo mezclado (Tejeduría)',
  398: 'Retazo Tejeduría',
  399: 'Desarrollo Tejeduría',
};

const TRAD_PARADAS = {
  // ── MECANICA ──
  201: 'Intervención mecánica',
  202: 'Mantenimiento preventivo',
  203: 'Revisión semestral',
  204: 'Modificaciones mecánicas',
  205: 'Mantenimiento mensual',
  206: 'Problema hidráulico',
  207: 'Rectificado del cilindro',
  208: 'Cambio de cilindro',
  209: 'Alineación del fieltro',
  210: 'Mantenimiento anual (A)',
  211: 'Mantenimiento anual (B)',
  212: 'Mantenimiento correctivo',
  213: 'Caída de balanza',
  214: 'Defecto en polipasto/tecle',
  215: 'Cambio de gas',
  216: 'Agua en tubería',
  217: 'Revisión semanal',
  218: 'Parada en compresores',
  219: 'Montaje de máquinas',
  220: 'Def. mecánico en balanza',
  221: 'Def. mecánico en embaladora',
  222: 'Def. mecánico en horno',
  223: 'Def. mecánico en cintas transportadoras',
  224: 'Def. mecánico en revisadora',
  225: 'Caída/falta de vapor (mecánica)',
  226: 'Pasado post-intervención mecánica',
  227: 'Mantenimiento semestral',
  228: 'Verificación pérdida aire comprimido',
  229: 'Mantenimiento preventivo (caldera)',
  230: 'Intervención contramestre',
  231: 'Mantenimiento trimestral',
  232: 'Excéntrico roto',
  233: 'Rozamiento de tejeduría (mecánica)',
  234: 'Cambio de fieltro (palmer)',
  235: 'Soldadura en línea de aire comprimido',
  236: 'Mantenimiento bimestral',
  237: 'Lubricación semanal de telares',
  299: 'Otros (Mecánica)',

  // ── ELECTRICA ──
  401: 'Falta de energía eléctrica',
  402: 'Intervención eléctrica',
  403: 'Defecto eléctrico y electrónico',
  404: 'Defecto de sistemas informáticos',
  405: 'Defecto eléctrico en balanza',
  406: 'Defecto eléctrico en embaladora',
  407: 'Defecto eléctrico en horno',
  408: 'Defecto eléctrico en cinta transportadora',
  409: 'Defecto eléctrico en polipasto/tecle',
  410: 'Defecto eléctrico en revisadora',
  411: 'Caída/falta de vapor (eléctrica)',
  412: 'Defecto eléctrico general',
  413: 'Pasado post-intervención eléctrica',
  414: 'Mantenimiento de subestación eléctrica',
  499: 'Otros (Eléctrica)',
};

// Códigos que arrancan desactivados (muy específicos de otras plantas/equipos no presentes en STC)
const INACTIVOS_DEFECTOS = new Set([229, 398]); // desarrollo, retazo (informativos)
const INACTIVOS_PARADAS  = new Set([213, 220, 221, 222, 223, 224, 404, 405, 406, 407, 408, 409, 410]);

// Sectores relevantes a importar
const LOCALES_DEFECTOS  = new Set(['TEJEDURIA', 'HILANDERIA']);
const GRUPOS_PARADAS    = new Set([2, 4]); // MECANICA, ELECTRICA

async function run() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./public/Codigos_Defectos_y_Paradas.xlsx');

  const wsDefectos = wb.getWorksheet('Codigos Defectos');
  const wsParadas  = wb.getWorksheet('Codigos Paradas');

  // ── Procesar DEFECTOS ──────────────────────────────────────────────────────
  const defectos = [];
  wsDefectos.eachRow((row, i) => {
    if (i === 1) return;
    const codigo = Number(row.getCell(1).value);
    const desc_pt = String(row.getCell(2).value || '').trim();
    const local   = String(row.getCell(3).value || '').trim().toUpperCase();
    if (!codigo || !LOCALES_DEFECTOS.has(local)) return;
    const desc_es = TRAD_DEFECTOS[codigo] || desc_pt; // fallback al portugués si no hay trad
    defectos.push({
      codigo,
      descripcion_pt: desc_pt,
      descripcion_es: desc_es,
      local,
      activo: !INACTIVOS_DEFECTOS.has(codigo),
      orden: i,
      _hasTrad: !!TRAD_DEFECTOS[codigo],
    });
  });

  // ── Procesar PARADAS ───────────────────────────────────────────────────────
  const paradas = [];
  wsParadas.eachRow((row, i) => {
    if (i === 1) return;
    const grupo = Number(row.getCell(1).value);
    if (!GRUPOS_PARADAS.has(grupo)) return;
    const grupo_nombre = String(row.getCell(2).value || '').trim();
    const codigo  = Number(row.getCell(3).value);
    const mot_pt  = String(row.getCell(4).value || '').trim();
    if (!codigo) return;
    const mot_es = TRAD_PARADAS[codigo] || mot_pt;
    paradas.push({
      codigo,
      grupo,
      grupo_nombre,
      motivo_pt: mot_pt,
      motivo_es: mot_es,
      activo: !INACTIVOS_PARADAS.has(codigo),
      orden: i,
      _hasTrad: !!TRAD_PARADAS[codigo],
    });
  });

  // ── Reporte ────────────────────────────────────────────────────────────────
  const defSinTrad = defectos.filter(d => !d._hasTrad);
  const parSinTrad = paradas.filter(p => !p._hasTrad);

  console.log(`\n📦 DEFECTOS a importar: ${defectos.length}`);
  console.log(`   TEJEDURIA: ${defectos.filter(d => d.local === 'TEJEDURIA').length}`);
  console.log(`   HILANDERIA: ${defectos.filter(d => d.local === 'HILANDERIA').length}`);
  console.log(`   Activos: ${defectos.filter(d => d.activo).length} | Inactivos: ${defectos.filter(d => !d.activo).length}`);
  if (defSinTrad.length) {
    console.log(`   ⚠️  SIN traducción propia (usarán PT): ${defSinTrad.length}`);
    defSinTrad.forEach(d => console.log(`      ${d.codigo} | ${d.descripcion_pt} [${d.local}]`));
  } else {
    console.log(`   ✅ Todos con traducción`);
  }

  console.log(`\n🛑 PARADAS a importar: ${paradas.length}`);
  console.log(`   MECANICA: ${paradas.filter(p => p.grupo === 2).length}`);
  console.log(`   ELECTRICA: ${paradas.filter(p => p.grupo === 4).length}`);
  console.log(`   Activos: ${paradas.filter(p => p.activo).length} | Inactivos: ${paradas.filter(p => !p.activo).length}`);
  if (parSinTrad.length) {
    console.log(`   ⚠️  SIN traducción propia: ${parSinTrad.length}`);
    parSinTrad.forEach(p => console.log(`      ${p.codigo} | ${p.motivo_pt}`));
  } else {
    console.log(`   ✅ Todos con traducción`);
  }

  if (!APPLY) {
    console.log('\n⚡ DRY-RUN — ningún dato fue escrito. Usá --apply para importar.\n');
    return;
  }

  // ── Escribir en Firestore ──────────────────────────────────────────────────
  if (RESET) {
    console.log('\n🗑️  Borrando colecciones existentes...');
    for (const col of ['codigos_defectos', 'codigos_paradas']) {
      const snap = await db.collection(col).get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      console.log(`   ✅ ${col}: ${snap.size} docs eliminados`);
    }
  }

  // Defectos
  console.log('\n✍️  Escribiendo codigos_defectos...');
  let batchDef = db.batch(); let countDef = 0;
  for (const d of defectos) {
    const { _hasTrad, ...data } = d;
    const ref = db.collection('codigos_defectos').doc(String(d.codigo));
    batchDef.set(ref, data, { merge: true });
    countDef++;
    if (countDef % 400 === 0) { await batchDef.commit(); batchDef = db.batch(); }
  }
  await batchDef.commit();
  console.log(`   ✅ ${countDef} documentos escritos`);

  // Paradas
  console.log('\n✍️  Escribiendo codigos_paradas...');
  let batchPar = db.batch(); let countPar = 0;
  for (const p of paradas) {
    const { _hasTrad, ...data } = p;
    const ref = db.collection('codigos_paradas').doc(String(p.codigo));
    batchPar.set(ref, data, { merge: true });
    countPar++;
    if (countPar % 400 === 0) { await batchPar.commit(); batchPar = db.batch(); }
  }
  await batchPar.commit();
  console.log(`   ✅ ${countPar} documentos escritos`);

  console.log('\n🎉 Importación completada.\n');
}

run().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
