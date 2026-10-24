// Kompiluje Tailwind CSS i wstawia go do <style> w index.html (między znacznikami tailwind:start / tailwind:end).
// Użycie: npm install && npm run build:css
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'index.html');
const START = '/*! tailwind:start */';
const END = '/*! tailwind:end */';

const html = readFileSync(htmlPath, 'utf8');
const s = html.indexOf(START);
const e = html.indexOf(END);
if (s < 0 || e < s) throw new Error('Brak znaczników tailwind:start / tailwind:end w index.html');

const tmp = mkdtempSync(join(tmpdir(), 'tw-'));
try {
  // Skanujemy HTML bez wcześniej wygenerowanego CSS, aby wynik był powtarzalny.
  const contentFile = join(tmp, 'content.html');
  writeFileSync(contentFile, html.slice(0, s) + html.slice(e + END.length));
  const outFile = join(tmp, 'out.css');
  execFileSync(process.execPath, [
    join(root, 'node_modules', 'tailwindcss', 'lib', 'cli.js'),
    '-c', join(root, 'tailwind.config.js'),
    '-i', join(root, 'scripts', 'tailwind.input.css'),
    '-o', outFile,
    '--content', contentFile,
    '--minify'
  ], { stdio: 'inherit' });
  const css = readFileSync(outFile, 'utf8').trim();
  writeFileSync(htmlPath, html.slice(0, s + START.length) + '\n' + css + '\n' + html.slice(e));
  console.log(`CSS wstawiony do index.html (${(css.length / 1024).toFixed(1)} KB).`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
