import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const target = args[0] || 'main';
if (args.length > 1 || !['main', 'legacy'].includes(target)) {
  console.error('Uso: node scripts/verify-hosting-release.mjs [main|legacy]');
  process.exit(1);
}
try {
  const config = JSON.parse(await readFile(new URL('../.firebaserc', import.meta.url), 'utf8'));
  const sites = config.targets?.[config.projects.default]?.hosting?.[target];
  if (sites?.length !== 1) throw new Error('El destino Hosting debe identificar exactamente un sitio.');
  const origin = `https://${sites[0]}.web.app`;
  const localHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const asset = html => html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)?.[1];
  const expected = asset(localHtml);
  if (!expected) throw new Error('No se encontró el bundle local. Ejecutá npm run build.');
  const response = await fetch(origin, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Hosting respondió HTTP ${response.status}.`);
  const actual = asset(await response.text());
  console.log(`Sitio: ${origin}\nBuild local: ${expected}\nPublicado: ${actual || 'no identificado'}`);
  if (actual !== expected) {
    console.error('El sitio todavía no sirve el build local. Revisá carpeta, build y destino del despliegue.');
    process.exitCode = 2;
  } else {
    const bundle = await fetch(origin + expected, { signal: AbortSignal.timeout(15000) });
    if (!bundle.ok || !(bundle.headers.get('content-type') || '').includes('javascript')) throw new Error('El bundle publicado no está disponible como JavaScript.');
    console.log('El bundle de entrada publicado coincide con el build local. No verifica login, reglas ni operaciones.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
