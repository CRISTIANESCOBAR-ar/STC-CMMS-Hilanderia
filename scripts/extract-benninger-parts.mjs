#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

async function extractTextFromPdfBuffer(buf) {
  const uint8 = new Uint8Array(buf);
  const loadingTask = pdfjsLib.getDocument({ data: uint8 });
  const doc = await loadingTask.promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str || '');
    text += strings.join(' ') + '\n';
  }
  return text;
}

const ROOT = path.join(process.cwd(), 'public', 'BENNINGER');
const OUT_CSV = path.join(process.cwd(), 'public', 'BENNINGER', 'BENNINGER_Catalogo_Previo.csv');
const OUT_MD  = path.join(process.cwd(), 'docs', 'BENNINGER_Extracted_Components.md');

const KEYWORDS = [
  'bomba','rodill','correa','cojinete','válvula','valvula','polea','árbol','arbol','eje','motor','sensor','cilindr','engranaje',
  'tapa','brida','sello','tensor','banda','cinta','buje','rodamiento','cabezal','acumulador','cocina','presecador','secador',
  'enclo','encolad','recirc','bomba','pieza','válvul','valvul','agitador'
];

const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const escapeCSV = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...await listFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function looksLikeComponent(line) {
  const L = line.trim();
  if (L.length < 4) return false;
  const lower = L.toLowerCase();
  for (const k of KEYWORDS) if (lower.includes(k)) return true;
  // uppercase phrase heuristic
  const letters = L.replace(/[^A-ZÁÉÍÓÚÑ0-9\- \/]+/g, '').trim();
  if (letters.length > 6 && /^[A-Z0-9\- \/ÁÉÍÓÚÑ]+$/.test(letters) && letters.split(/\s+/).length <= 10) return true;
  if (/[A-Z]{2,}-?\d{2,}/i.test(L)) return true;
  if (/\b\d{5,}\b/.test(L)) return true;
  return false;
}

function inferGroupFromFilename(fname) {
  const b = path.basename(fname);
  const m = b.match(/(25\d{3})/);
  if (m) return m[1];
  // look for patterns like D400, D4x0, D4x0
  const m2 = b.match(/D(\d{2,3})/i);
  if (m2) return '25' + String(m2[1]).padStart(3, '0');
  // try to catch numbers like 25400 inside name
  const m3 = b.match(/(\d{3,5})/);
  if (m3) return m3[1];
  return '';
}

(async () => {
  try {
    console.log('Listando PDFs en', ROOT);
    const all = await listFiles(ROOT);
    const pdfs = all.filter(f => f.toLowerCase().endsWith('.pdf'));
    console.log('PDFs encontrados:', pdfs.length);

    const candidates = [];
    for (const pdf of pdfs) {
      try {
        const buf = await fs.readFile(pdf);
        const text = await extractTextFromPdfBuffer(buf);
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const groupGuess = inferGroupFromFilename(pdf);
        for (let i = 0; i < lines.length; i++) {
          const L = lines[i];
          if (looksLikeComponent(L)) {
            candidates.push({ file: pdf, line: normalize(L), idx: i, groupGuess });
          }
        }
      } catch (e) {
        console.warn('No se pudo procesar PDF:', pdf, e.message.substring(0,120));
      }
    }

    console.log('Candidatos extraídos (sin deduplicar):', candidates.length);

    // Deduplicate by normalized line
    const map = new Map();
    for (const c of candidates) {
      const key = c.line.toLowerCase();
      if (!map.has(key)) map.set(key, { ...c, count: 1 }); else map.get(key).count++;
    }

    const items = Array.from(map.values()).sort((a,b)=>b.count-a.count).slice(0,2000);

    // Build CSV
    const headers = ['Marca','Modelo','Asignacion','Seccion','Abreviado','Grupo','SubGrupo','Denominacion','NumeroCatalogo','NumeroArticulo','Tiempo','Observacion'];
    const rows = [headers.map(escapeCSV).join(',')];

    for (const it of items) {
      const grupo = it.groupGuess || '';
      const seccion = grupo ? 'AUTOINFERIDO' : '';
      const abreviado = seccion ? 'AUTO' : '';
      rows.push([
        escapeCSV('BENNINGER'),
        escapeCSV('BENNINGER'),
        escapeCSV(grupo),
        escapeCSV(seccion),
        escapeCSV(abreviado),
        escapeCSV(grupo),
        escapeCSV('-'),
        escapeCSV(it.line),
        escapeCSV('-'),
        escapeCSV('-'),
        escapeCSV(''),
        escapeCSV('Fuente: ' + path.basename(it.file))
      ].join(','));
    }

    await fs.writeFile(OUT_CSV, rows.join('\n'), 'utf8');
    console.log('CSV escrito en', OUT_CSV);

    // MD summary
    const mdLines = [];
    mdLines.push('# Componentes extraídos — BENNINGER (preliminar)\n');
    mdLines.push(`Fecha: ${new Date().toISOString()}\n`);
    mdLines.push(`Archivos procesados: ${pdfs.length}`);
    mdLines.push('\n## Resumen (top candidatos)\n');
    mdLines.push('|#|Denominación (extraída)|Grupo inferido|Fuente|Veces encontrados|');
    mdLines.push('|---:|---|---|---|---:|');
    let idx=1;
    for (const it of items) {
      mdLines.push(`|${idx++}|${it.line.replace(/\|/g,' ')}|${it.groupGuess||''}|${path.basename(it.file)}|${it.count}|`);
    }

    mdLines.push('\n\n> Nota: estas filas son _preliminares_. Revisar y limpiar antes de importar con `import-catalogo-excel.mjs --apply`.');
    await fs.writeFile(OUT_MD, mdLines.join('\n'), 'utf8');
    console.log('MD resumen escrito en', OUT_MD);

    console.log('Hecho: revisá', OUT_CSV, 'y', OUT_MD);
  } catch (err) {
    console.error('Error general:', err);
    process.exit(1);
  }
})();
