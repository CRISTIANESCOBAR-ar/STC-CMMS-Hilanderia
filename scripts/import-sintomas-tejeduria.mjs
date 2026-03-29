/**
 * import-sintomas-tejeduria.mjs
 * Crea la colección `sintomas_tejeduria` con los síntomas colloquiales
 * identificados del chat de WhatsApp de la tejeduría.
 *
 * Schema de cada doc:
 *   id          – slug único (string, se usa como doc ID)
 *   nombre      – término colloquial que usa el operador/inspector
 *   categoria   – TRAMA | URDIMBRE | VISUAL | MECANICO | ELECTRICO | PROCESO
 *   derivaA     – MECANICO | ELECTRICO | AMBOS | TEJEDOR | CALIDAD
 *   descripcion – descripción interna para el admin (opcional)
 *   destacado   – boolean (aparece primero en el selector)
 *   activo      – boolean
 *   orden       – número para ordenar en el selector
 *
 * Uso:
 *   node scripts/import-sintomas-tejeduria.mjs          → dry-run
 *   node scripts/import-sintomas-tejeduria.mjs --apply  → escribe en Firestore
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'stc-cmms-hilanderia';
const APPLY      = process.argv.includes('--apply');

const initAdmin = () => {
  if (getApps().length) return;
  const saPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');
  if (saPath && existsSync(saPath)) {
    initializeApp({ projectId: PROJECT_ID, credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
  } else {
    initializeApp({ projectId: PROJECT_ID });
  }
};
initAdmin();
const db = getFirestore();

// ── Catálogo de síntomas ── (ordenado por frecuencia descendente)
const SINTOMAS = [
  {
    id: 'paros-por-trama',
    nombre: 'Paros por trama',
    categoria: 'TRAMA',
    derivaA: 'MECANICO',
    descripcion: 'El telar para repetidamente por detección de rotura de trama. Muy frecuente.',
    destacado: true,
    activo: true,
    orden: 1,
  },
  {
    id: 'corte-de-trama',
    nombre: 'Corte de trama',
    categoria: 'TRAMA',
    derivaA: 'MECANICO',
    descripcion: 'Rotura puntual del hilo de trama. Deja marca en la tela si el telar no detiene a tiempo.',
    destacado: true,
    activo: true,
    orden: 2,
  },
  {
    id: 'trama-floja',
    nombre: 'Trama floja',
    categoria: 'TRAMA',
    derivaA: 'MECANICO',
    descripcion: 'Defecto de tensión en la trama, visible en la tela. Requiere regulación mecánica.',
    destacado: true,
    activo: true,
    orden: 3,
  },
  {
    id: 'plegador-flojo',
    nombre: 'Plegador flojo',
    categoria: 'VISUAL',
    derivaA: 'MECANICO',
    descripcion: 'Problema de tensión en el plegado del tejido. Frecuente en varios telares.',
    destacado: true,
    activo: true,
    orden: 4,
  },
  {
    id: 'falla-wf1',
    nombre: 'Falla WF1',
    categoria: 'ELECTRICO',
    derivaA: 'ELECTRICO',
    descripcion: 'Paro por sensor Web Feeder 1. Falla eléctrica/electrónica del alimentador de trama 1.',
    destacado: true,
    activo: true,
    orden: 5,
  },
  {
    id: 'falla-wf2',
    nombre: 'Falla WF2',
    categoria: 'ELECTRICO',
    derivaA: 'ELECTRICO',
    descripcion: 'Paro por sensor Web Feeder 2. Falla eléctrica/electrónica del alimentador de trama 2.',
    destacado: true,
    activo: true,
    orden: 6,
  },
  {
    id: 'tijera-electrica',
    nombre: 'Tijera eléctrica',
    categoria: 'ELECTRICO',
    derivaA: 'AMBOS',
    descripcion: 'Falla en el sistema de corte de hilo. Puede requerir mecánico y eléctrico.',
    destacado: true,
    activo: true,
    orden: 7,
  },
  {
    id: 'colita-tejida',
    nombre: 'Colita tejida',
    categoria: 'VISUAL',
    derivaA: 'MECANICO',
    descripcion: 'Defecto visual recurrente. Hilo de trama que queda tejido fuera de lugar.',
    destacado: false,
    activo: true,
    orden: 8,
  },
  {
    id: 'enrollador',
    nombre: 'Enrollador',
    categoria: 'MECANICO',
    derivaA: 'MECANICO',
    descripcion: 'Problema en el enrollador: gira lento, genera arrugas o falla de tensión.',
    destacado: false,
    activo: true,
    orden: 9,
  },
  {
    id: 'para-en-falso-urdimbre',
    nombre: 'Para en falso (urdimbre)',
    categoria: 'URDIMBRE',
    derivaA: 'ELECTRICO',
    descripcion: 'El telar se detiene sin rotura real de hilo. Falla del sensor de urdimbre.',
    destacado: false,
    activo: true,
    orden: 10,
  },
  {
    id: 'cambio-bateria-tci',
    nombre: 'Cambio batería TCI',
    categoria: 'ELECTRICO',
    derivaA: 'ELECTRICO',
    descripcion: 'Batería del control TCI descargada. Requiere reemplazo por electricista.',
    destacado: false,
    activo: true,
    orden: 11,
  },
  {
    id: 'templazo',
    nombre: 'Templazo',
    categoria: 'VISUAL',
    derivaA: 'MECANICO',
    descripcion: 'Marca de templaza visible en la tela. Defecto por regulación de templaza.',
    destacado: false,
    activo: true,
    orden: 12,
  },
  {
    id: 'pliegues',
    nombre: 'Pliegues',
    categoria: 'VISUAL',
    derivaA: 'MECANICO',
    descripcion: 'Arrugas o pliegues en la tela. Puede estar relacionado con enrollador o plegador.',
    destacado: false,
    activo: true,
    orden: 13,
  },
  {
    id: 'nivel-de-aceite',
    nombre: 'Nivel de aceite',
    categoria: 'MECANICO',
    derivaA: 'MECANICO',
    descripcion: 'Paro por nivel de aceite bajo o alarma de lubricación.',
    destacado: false,
    activo: true,
    orden: 14,
  },
  {
    id: 'pantalla-en-blanco',
    nombre: 'Pantalla en blanco',
    categoria: 'ELECTRICO',
    derivaA: 'ELECTRICO',
    descripcion: 'Panel de control sin imagen. Puede requerir reemplazo de placa o CPU.',
    destacado: false,
    activo: true,
    orden: 15,
  },
  {
    id: 'falla-cpu',
    nombre: 'CPU / Placa electrónica',
    categoria: 'ELECTRICO',
    derivaA: 'ELECTRICO',
    descripcion: 'Falla en placa CPU del control del telar. Requiere reemplazo o reparación.',
    destacado: false,
    activo: true,
    orden: 16,
  },
  {
    id: 'puntas-sueltas',
    nombre: 'Puntas sueltas',
    categoria: 'PROCESO',
    derivaA: 'TEJEDOR',
    descripcion: 'Hilos de urdimbre sueltos o sin tensar. No es falla del telar — problema del proceso de urdido anterior. Lo resuelve el tejedor o atador.',
    destacado: false,
    activo: true,
    orden: 17,
  },
];

async function main() {
  console.log(APPLY ? '🚀 APPLY — Escribiendo en Firestore...' : '👁  DRY-RUN — No se escribe nada');
  console.log(`\n📋 Síntomas a importar: ${SINTOMAS.length}\n`);

  const col = db.collection('sintomas_tejeduria');

  // Chequear cuáles ya existen
  const existing = new Set((await col.get()).docs.map(d => d.id));

  let nuevo = 0, existente = 0;

  for (const s of SINTOMAS) {
    const exists = existing.has(s.id);
    const status = exists ? '⚠️  YA EXISTE' : '✅ NUEVO     ';
    console.log(`${status}  [${String(s.orden).padStart(2, '0')}] ${s.derivaA.padEnd(8)} | ${s.categoria.padEnd(10)} | ${s.nombre}`);
    if (exists) { existente++; continue; }
    nuevo++;
    if (APPLY) {
      await col.doc(s.id).set(s);
    }
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`  Nuevos:     ${nuevo}`);
  console.log(`  Ya existen: ${existente}`);
  if (!APPLY) {
    console.log('\n💡 Ejecutar con --apply para escribir en Firestore.');
  } else {
    console.log('\n✅ Importación completa.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
