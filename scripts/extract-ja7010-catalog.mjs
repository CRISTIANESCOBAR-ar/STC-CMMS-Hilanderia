/**
 * Extrae el catálogo de piezas del PDF JA7010 (Toyota JAT710-eurotech)
 * y genera: scripts/catalogo_toyota_ja7010_output.json
 *
 * Uso:
 *   node scripts/extract-ja7010-catalog.mjs
 *
 * Salida: array de objetos compatibles con catalogo_puestos_control de Firestore.
 */
import { getDocument } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH  = path.join(__dirname, '../public/REPUESTOS TOYOTA/CATALOGOS/JA7010.pdf');
const OUT_PATH  = path.join(__dirname, 'catalogo_toyota_ja7010_output.json');

const MODELO    = 'JA2S-190TP-EF-T710';
const MARCA     = 'TOYOTA';
const ASIGNACION = 'TEJEDURIA';

// ── Mapeo de prefijo de unidad → sección y abreviado ─────────────────────────
const SECCIONES = [
  { re: /^J-0[123]/, seccion: 'BASTIDOR / TRANSMISION / BATAN',  abreviado: 'BTB' },
  { re: /^J-11/,     seccion: 'ENJULLO (LET-OFF)',               abreviado: 'ENJ' },
  { re: /^J-12/,     seccion: 'AVANCE (TAKE-UP)',                abreviado: 'AVA' },
  { re: /^J-13/,     seccion: 'ORILLO / CUCHILLAS',             abreviado: 'ORC' },
  { re: /^J-14/,     seccion: 'TEMPLE',                          abreviado: 'TPL' },
  { re: /^J-21/,     seccion: 'GUIA LIZO (HEALD FRAME)',        abreviado: 'LIZ' },
  { re: /^J-24/,     seccion: 'MANDO LIZO (DOBBY)',              abreviado: 'DOB' },
  { re: /^J-31/,     seccion: 'INYECCION DE TRAMA',             abreviado: 'IYT' },
  { re: /^J-32/,     seccion: 'SOPLADO / NEUMATICA',            abreviado: 'NEU' },
  { re: /^J-33/,     seccion: 'CORTE TRAMA',                    abreviado: 'CRT' },
  { re: /^J-41/,     seccion: 'DETECTORES / SENSORES',          abreviado: 'DET' },
  { re: /^J-42/,     seccion: 'DETECTOR URDIMBRE',              abreviado: 'DUR' },
  { re: /^J-51/,     seccion: 'ORILLO LENO (GASA)',             abreviado: 'ORG' },
  { re: /^J-54/,     seccion: 'ORILLO LENO (GASA)',             abreviado: 'ORG' },
  { re: /^J-61/,     seccion: 'CUBIERTAS / CARCASAS',           abreviado: 'CUB' },
  { re: /^J-84/,     seccion: 'BASTIDOR / TRANSMISION / BATAN', abreviado: 'BTB' },
  { re: /^J-85/,     seccion: 'LUBRICACION',                    abreviado: 'LUB' },
  { re: /^J-91/,     seccion: 'PANEL / SISTEMA ELECTRICO',      abreviado: 'ELC' },
  { re: /^J-92/,     seccion: 'PANEL / SISTEMA ELECTRICO',      abreviado: 'ELC' },
  { re: /^J-95/,     seccion: 'CABLEADO / ARNES',               abreviado: 'CAB' },
];

function getSeccion(unitCode) {
  for (const s of SECCIONES) {
    if (s.re.test(unitCode)) return { seccion: s.seccion, abreviado: s.abreviado };
  }
  return { seccion: 'OTROS', abreviado: 'OTR' };
}

// ── X thresholds (basados en debug de coordenadas) ───────────────────────────
// Columnas del PDF (aproximadas):
//   x < 75       → número de línea
//   75 < x < 165 → código pieza (Toyota Jxxxx-xxxxx-xx o genérico)
//   165 < x < 385→ descripción (EN en y, ES en y-10)
//   385 < x < 425→ cantidad
//   425 < x < 470→ nivel
//   x > 470      → número artículo / referencia
const COL = { lineNum:[0,75], partCode:[75,165], desc:[165,385], qty:[385,425], lvl:[425,470], ref:[470,600] };
function inCol(x, col) { return x >= COL[col][0] && x < COL[col][1]; }

// ── Extracción de texto por página (con coordenadas) ─────────────────────────
async function extractAllPages(pdfPath) {
  const data = readFileSync(pdfPath);
  const pdf  = await getDocument({ data: new Uint8Array(data) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push({ pageNum: i, items: content.items });
  }
  return pages;
}

// ── Agrupar items por fila (Y) ────────────────────────────────────────────────
function groupByRow(items, yTolerance = 2) {
  const rows = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    const x = Math.round(it.transform[4]);
    let row = rows.find(r => Math.abs(r.y - y) <= yTolerance);
    if (!row) { row = { y, cells: [] }; rows.push(row); }
    row.cells.push({ x, str: it.str.trim() });
  }
  // Ordenar filas de arriba a abajo (Y mayor = arriba en PDF)
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.cells.sort((a, b) => a.x - b.x);
  return rows;
}

function rowText(row, col) {
  return row.cells.filter(c => inCol(c.x, col)).map(c => c.str).join(' ').trim();
}

// ── Regex para encabezado de dibujo ──────────────────────────────────────────
const RE_UNIT = /N[uú]m\.\s*DIBUJO\s+(J[-\s]?\d[\d-]+[A-Z]+\w*)/i;

// ── Parser principal ──────────────────────────────────────────────────────────
function parsePage(pageItems) {
  const rows      = groupByRow(pageItems);
  let unitCode    = null;
  let unitNameEN  = '';
  let unitNameES  = '';
  const components = [];

  // Buscar encabezado de dibujo en la fila que contenga "Núm. DIBUJO"
  for (const row of rows) {
    const fullText = row.cells.map(c => c.str).join(' ');
    const um = fullText.match(RE_UNIT);
    if (um) {
      unitCode = um[1].replace(/\s/g, '');
      // El nombre del dibujo viene a x > 350 aprox
      const nameItems = row.cells.filter(c => c.x > 350).map(c => c.str).join(' ').trim();
      unitNameEN = nameItems;
      unitNameES = nameItems;
    }
  }

  // Buscar nombre español del dibujo: la fila justo debajo del encabezado que tenga texto en x>350
  // (en la práctica, el nombre inglés y español del dibujo vienen en filas consecutivas y mismo x)
  // Lo obtenemos de las filas secundarias con x > 350 y y < headerY
  // (pero x>350 con texto en columna de descripcion es suficiente para los componentes)

  // Construir filas de componentes:
  // Patrón fila de componente: columna lineNum tiene un número, columna partCode tiene código, columna desc tiene texto
  // Las descripciones EN y ES vienen en dos sub-filas del mismo componente (mismo lineNum, y diff ~10pt)
  // Estrategia: agrupar sub-filas por cercanía vertical (delta Y <= 12)

  // Agrupar filas en "grupos de componente" (EN + ES)
  const compGroups = [];
  let prev = null;
  for (const row of rows) {
    const lineNumStr = rowText(row, 'lineNum');
    const partCode   = rowText(row, 'partCode');
    const descText   = rowText(row, 'desc');
    const qtyText    = rowText(row, 'qty');

    const isLineNum  = /^\d+$/.test(lineNumStr);
    const hasCode    = /^[A-Z0-9]{4,}[-][0-9]/.test(partCode);
    const hasQty     = /^\d+$/.test(qtyText);

    if (isLineNum && hasCode) {
      // Nueva fila primaria de componente
      const g = {
        lineNum:   parseInt(lineNumStr, 10),
        partCode,
        descEN:    descText,
        descES:    '',
        qty:       hasQty ? parseInt(qtyText, 10) : null,
        nivel:     rowText(row, 'lvl') ? parseInt(rowText(row, 'lvl'), 10) : null,
        ref:       rowText(row, 'ref') || null,
        y:         row.y,
      };
      compGroups.push(g);
      prev = g;
    } else if (prev && Math.abs(row.y - prev.y) <= 14 && descText && !isLineNum && !hasCode) {
      // Sub-fila ES (misma Y ± 14, sin línea, sin código → descripción española)
      prev.descES = descText;
    }
  }

  for (const g of compGroups) {
    if (!g.partCode) continue;
    components.push({
      lineNum:        g.lineNum,
      numeroCatalogo: g.partCode,
      denominacionEN: g.descEN,
      denominacion:   g.descES || g.descEN,
      cantidad:       g.qty,
      nivel:          g.nivel,
      numeroArticulo: g.ref,
    });
  }

  return { unitCode, unitNameEN, unitNameES, components };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📂 Leyendo JA7010.pdf...');
  const pages = await extractAllPages(PDF_PATH);
  console.log(`   ${pages.length} páginas extraídas.`);

  const catalogItems = [];
  let pagesConDatos = 0;
  let currentUnit   = null;

  for (const { pageNum, items } of pages) {
    const parsed = parsePage(items);

    if (parsed.unitCode) {
      currentUnit   = { unitCode: parsed.unitCode, unitNameEN: parsed.unitNameEN, unitNameES: parsed.unitNameES };
      pagesConDatos++;
    }

    if (!currentUnit) continue;

    const { seccion, abreviado } = getSeccion(currentUnit.unitCode);
    const grupo    = currentUnit.unitCode;
    const subGrupo = currentUnit.unitNameEN;

    for (const c of parsed.components) {
      catalogItems.push({
        marca:          MARCA,
        modelo:         MODELO,
        asignacion:     ASIGNACION,
        seccion,
        abreviado,
        grupo,
        subGrupo,
        unidadCodigo:   currentUnit.unitCode,
        unidadNombre:   currentUnit.unitNameES || currentUnit.unitNameEN,
        denominacion:   c.denominacion,
        denominacionEN: c.denominacionEN,
        numeroCatalogo: c.numeroCatalogo,
        numeroArticulo: c.numeroArticulo,
        cantidad:       c.cantidad,
        nivel:          c.nivel,
        tiempo:         null,
        observacion:    null,
      });
    }
  }

  console.log(`\n✅ ${catalogItems.length} componentes extraídos de ${pagesConDatos} dibujos.`);

  // Resumen por sección
  const porSeccion = {};
  for (const it of catalogItems) {
    porSeccion[it.seccion] = (porSeccion[it.seccion] || 0) + 1;
  }
  console.log('\nResumen por sección:');
  for (const [s, c] of Object.entries(porSeccion).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c}`);
  }

  // Muestra de las primeras 5 piezas
  console.log('\nPrimeras 5 piezas:');
  for (const it of catalogItems.slice(0, 5)) {
    console.log(`  [${it.grupo}] ${it.numeroCatalogo} | ${it.denominacion} | Art: ${it.numeroArticulo}`);
  }

  writeFileSync(OUT_PATH, JSON.stringify(catalogItems, null, 2), 'utf8');
  console.log(`\n💾 Guardado en: ${OUT_PATH}`);
}

main().catch(console.error);
