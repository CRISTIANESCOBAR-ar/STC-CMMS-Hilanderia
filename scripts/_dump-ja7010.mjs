// Extrae texto de TODAS las páginas de JA7010.pdf y muestra las que tienen contenido
import { getDocument } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'fs';

const data = readFileSync('public/REPUESTOS TOYOTA/CATALOGOS/JA7010.pdf');
const pdf = await getDocument({ data: new Uint8Array(data) }).promise;
console.log(`Total páginas: ${pdf.numPages}`);

for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  const text = content.items.map(it => it.str).join(' ').trim().replace(/\s+/g, ' ');
  if (text.length > 20) {
    console.log(`\n--- Pág ${i} ---`);
    console.log(text.slice(0, 1000));
  }
}
