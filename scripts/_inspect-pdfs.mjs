import { getDocument } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'fs';

async function extractPages(file, maxPages = 6) {
  const data = readFileSync(file);
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${file}  |  ${pdf.numPages} páginas`);
  console.log('='.repeat(60));
  const pages = Math.min(pdf.numPages, maxPages);
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str).join(' ').trim().replace(/\s+/g, ' ');
    if (text.length > 10) {
      console.log(`[Pág ${i}] ${text.slice(0, 500)}`);
    } else {
      console.log(`[Pág ${i}] (imagen sin capa de texto)`);
    }
  }
}

await extractPages('public/REPUESTOS TOYOTA/CATALOGOS/GRAUS.pdf');
await extractPages('public/REPUESTOS TOYOTA/CATALOGOS/pin.pdf');
await extractPages('public/REPUESTOS TOYOTA/CATALOGOS/ABS.pdf');
await extractPages('public/REPUESTOS TOYOTA/CATALOGOS/JA7010.pdf');
