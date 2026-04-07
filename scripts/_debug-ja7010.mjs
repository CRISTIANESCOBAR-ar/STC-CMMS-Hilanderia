// Ver el texto crudo de una página con componentes para calibrar el regex
import { getDocument } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'fs';

const data = readFileSync('public/REPUESTOS TOYOTA/CATALOGOS/JA7010.pdf');
const pdf  = await getDocument({ data: new Uint8Array(data) }).promise;

// Páginas 11-15 tienen componentes confirmados
for (const pn of [11, 12, 13, 14, 21]) {
  const page   = await pdf.getPage(pn);
  const content = await page.getTextContent();
  console.log(`\n${'='.repeat(70)}\nPágina ${pn} — items raw (primeros 60):`);
  for (const it of content.items.slice(0, 60)) {
    console.log(JSON.stringify({ str: it.str, x: Math.round(it.transform[4]), y: Math.round(it.transform[5]) }));
  }
}
