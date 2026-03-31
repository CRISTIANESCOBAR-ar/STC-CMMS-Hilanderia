/**
 * Servicio Firestore para persistencia de Shift Reports.
 * Colección: shift_reports/{YYYY-MM-DD}
 *
 * Documento:
 *   fecha        – "YYYY/MM/DD"
 *   csvMeta      – { generatedAt, rangoDesde, rangoHasta } | null
 *   registros    – Map<"loom_turno", RegistroSR>
 *   createdAt    – serverTimestamp
 *   updatedAt    – serverTimestamp
 *
 * RegistroSR:
 *   loom, turno, rpm, picks, weftCount, warpCount, otherCount,
 *   style, beam, source ("csv"|"manual")
 */
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

const COLLECTION = 'shift_reports';

/** "2026/03/30" → "2026-03-30" */
export function fechaToDocId(fecha) {
  return (fecha || '').replace(/\//g, '-');
}

/** "2026-03-30" → "2026/03/30" */
export function docIdToFecha(docId) {
  return (docId || '').replace(/-/g, '/');
}

/**
 * Guarda registros extraídos del CSV en Firestore.
 * Preserva registros manuales existentes que no tengan equivalente CSV.
 */
export async function guardarReporteCSV(fecha, csvMeta, registros) {
  const docId = fechaToDocId(fecha);
  const docRef = doc(db, COLLECTION, docId);

  const registrosMap = {};
  for (const r of registros) {
    const key = `${r.loom}_${r.turno}`;
    registrosMap[key] = {
      loom: r.loom,
      turno: r.turno,
      rpm: r.rpm ?? null,
      picks: r.picks ?? null,
      weftCount: r.weftCount ?? 0,
      warpCount: r.warpCount ?? 0,
      otherCount: r.otherCount ?? 0,
      style: r.style || '',
      beam: r.beam || '',
      source: 'csv'
    };
  }

  // Preservar registros manuales que no fueron sobreescritos por CSV
  const existing = await getDoc(docRef);
  if (existing.exists()) {
    const existingRegs = existing.data().registros || {};
    for (const [key, val] of Object.entries(existingRegs)) {
      if (!registrosMap[key] && val.source === 'manual') {
        registrosMap[key] = val;
      }
    }
  }

  await setDoc(docRef, {
    fecha,
    csvMeta: csvMeta || null,
    registros: registrosMap,
    updatedAt: serverTimestamp(),
    ...(!existing?.exists() ? { createdAt: serverTimestamp() } : {})
  }, { merge: true });

  return docId;
}

/**
 * Guarda/actualiza un registro individual (ingreso manual o corrección).
 * Usa updateDoc con dot-notation; si el documento no existe, lo crea.
 */
export async function guardarRegistro(fecha, loom, turno, fields) {
  const docId = fechaToDocId(fecha);
  const docRef = doc(db, COLLECTION, docId);
  const key = `${loom}_${turno}`;

  const record = {
    loom,
    turno,
    rpm: fields.rpm ?? null,
    picks: fields.picks ?? null,
    weftCount: fields.weftCount ?? 0,
    warpCount: fields.warpCount ?? 0,
    otherCount: fields.otherCount ?? 0,
    style: fields.style || '',
    beam: fields.beam || '',
    source: fields.source || 'manual'
  };

  try {
    await updateDoc(docRef, {
      [`registros.${key}`]: record,
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    if (e.code === 'not-found') {
      await setDoc(docRef, {
        fecha,
        csvMeta: null,
        registros: { [key]: record },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      throw e;
    }
  }
}

/**
 * Suscripción en tiempo real a un reporte por fecha.
 * @returns {Function} unsubscribe
 */
export function suscribirReporte(fecha, callback) {
  const docId = fechaToDocId(fecha);
  return onSnapshot(doc(db, COLLECTION, docId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}
