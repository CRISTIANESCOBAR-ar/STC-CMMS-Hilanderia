/**
 * Servicio para parsear CSV de ShiftReport Toyota y preparar datos para PRD.
 */

/**
 * Limpia valores con formato ="xxxxx" del CSV Toyota
 */
const cleanQuoted = (val) => {
  if (!val) return '';
  return val.replace(/^="/, '').replace(/"$/, '').trim();
};

/**
 * Parsea el contenido completo del CSV de ShiftReport Toyota.
 * @param {string} csvText - Contenido crudo del archivo CSV
 * @returns {{ meta: Object, headers: string[], rows: Object[] }}
 */
export function parseShiftReportCSV(csvText) {
  const lines = csvText.split('\n').map(l => l.replace(/\r$/, ''));

  // Línea 1: timestamp de generación
  const generatedAt = (lines[0] || '').replace(/[()]/g, '').trim();

  // Línea 2: rango de turnos
  const rangoRaw = (lines[1] || '').trim();
  const [rangoDesde, rangoHasta] = rangoRaw.split('->').map(s => s.trim());

  // Línea 5 (index 4): headers
  const headerLine = lines.findIndex(l => l.startsWith('SORTKEY,'));
  if (headerLine === -1) throw new Error('No se encontró la línea de encabezados (SORTKEY)');
  const rawHeaders = lines[headerLine].split(',');

  // Desambiguar headers duplicados (ej: PRODUCT&PICK aparece 2 veces)
  const headers = [];
  const seen = {};
  for (const h of rawHeaders) {
    if (seen[h]) {
      headers.push(`${h}_2`);
    } else {
      headers.push(h);
      seen[h] = true;
    }
  }

  // Datos a partir del header
  const rows = [];
  for (let i = headerLine + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('PARAM') || line.startsWith('VALUE')) continue;
    const cols = line.split(',');
    if (cols.length < 10) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] || '';
    });
    rows.push(row);
  }

  return {
    meta: { generatedAt, rangoDesde, rangoHasta },
    headers,
    rows
  };
}

/**
 * Transforma filas crudas del CSV en registros estructurados para la vista.
 * @param {Object[]} rows - Filas parseadas
 * @returns {Object[]} Registros con campos tipados
 */
export function transformRows(rows) {
  return rows.map(r => {
    const shiftRaw = (r['SHIFT'] || '').trim();
    const [fecha, turno] = shiftRaw.includes('.') ? shiftRaw.split('.') : [shiftRaw, ''];
    const loom = cleanQuoted(r['LOOM']);
    // Detectar si LOOM es una IP (telar sin identificar)
    const isIP = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(loom);

    const picks = parseFloat(r['PRODUCT&PICK']) || 0;
    const runMin = parseFloat(r['RUN&MINUTE']) || 0;

    // RPM = (PRODUCT&PICK / RUN&MINUTE) * 1000 — si hay datos; sino tomar del campo crudo
    const rpmRaw = parseFloat(r['RPM']) || null;
    const rpmCalc = runMin > 0 ? Math.round((picks / runMin) * 1000) : null;
    const rpm = rpmCalc || rpmRaw;

    return {
      fecha,
      turno,
      loom,
      loomSinIdentificar: isIP,
      style: cleanQuoted(r['STYLE']),
      beam: cleanQuoted(r['BEAM']),
      rpm,
      eficiencia: parseFloat(r['EFFIC&PERCENT']) || null,
      runMin,
      stopMin: parseFloat(r['STOP&MINUTE']) || 0,
      picks,
      metros: parseFloat(r['PRODUCT&METER']) || 0,
      otherCount: parseInt(r['OTHER&COUNT']) || 0,
      otherMin: parseFloat(r['OTHER&MINUTE']) || 0,
      warpCount: parseInt(r['WARP&COUNT']) || 0,
      warpMin: parseFloat(r['WARP&MINUTE']) || 0,
      weftCount: parseInt(r['WEFT&COUNT']) || 0,
      weftMin: parseFloat(r['WEFT&MINUTE']) || 0,
      totalCount: parseInt(r['TOTAL&COUNT']) || 0,
      totalMin: parseFloat(r['TOTAL&MINUTE']) || 0,
      doffCount: parseInt(r['DOFF&COUNT']) || 0,
      manualCount: parseInt(r['MANUAL&COUNT']) || 0,
      pwrOffCount: parseInt(r['PWR_OFF&COUNT']) || 0,
      warpOutCount: parseInt(r['WARP_OUT&COUNT']) || 0,
      falsCount: parseInt(r['FALS&COUNT']) || 0,
    };
  });
}

/**
 * Agrupa registros por turno.
 * @param {Object[]} records
 * @returns {{ [turno: string]: Object[] }}
 */
export function groupByTurno(records) {
  const grouped = {};
  for (const r of records) {
    const key = r.turno || 'SIN_TURNO';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }
  // Ordenar dentro de cada turno por loom
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.loom.localeCompare(b.loom, undefined, { numeric: true }));
  }
  return grouped;
}

/**
 * Filtra registros para incluir solo los telares que existen en la colección de máquinas.
 * @param {Object[]} records - Registros del CSV
 * @param {Object[]} maquinas - Lista de máquinas de Firestore (tipo TELAR)
 * @returns {Object[]}
 */
export function filterByMaquinas(records, maquinas) {
  const maqNums = new Set(maquinas.map(m => String(m.maquina)));
  return records.filter(r => maqNums.has(r.loom));
}

/**
 * Genera el archivo TXT para el sistema PRD.
 * Formato: tab-separated, sin encabezado, ordenado por telar luego turno A→B→C.
 * Columnas: Fecha(DDMMYYYY) Turno Telar RPM PICK Rot.Trama Rot.Urdido OtrasRot.
 * @param {Object[]} records - Registros finales (CSV + manual mergeados)
 * @returns {string}
 */
export function generarReportePRD(records) {
  const turnoOrder = { A: 0, B: 1, C: 2 };
  const sorted = [...records].sort((a, b) => {
    const loomCmp = a.loom.localeCompare(b.loom, undefined, { numeric: true });
    if (loomCmp !== 0) return loomCmp;
    return (turnoOrder[a.turno] ?? 9) - (turnoOrder[b.turno] ?? 9);
  });

  const lines = sorted.map(r => {
    // Convertir fecha YYYY/MM/DD → DDMMYYYY
    const parts = (r.fecha || '').split('/');
    const fechaPRD = parts.length === 3 ? `${parts[2]}${parts[1]}${parts[0]}` : r.fecha;
    return [
      fechaPRD,
      r.turno,
      r.loom,
      r.rpm ?? '',
      Math.round(r.picks),
      r.weftCount,
      r.warpCount,
      r.otherCount
    ].join('\t');
  });
  return lines.join('\n');
}
