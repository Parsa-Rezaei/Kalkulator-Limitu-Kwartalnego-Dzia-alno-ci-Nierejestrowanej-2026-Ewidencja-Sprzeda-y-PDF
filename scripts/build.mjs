// Budowanie i kontrola bezpieczeństwa.
//   npm ci            – instaluje zależności, weryfikując skróty z package-lock.json
//   npm run build     – kompiluje assets/app.css i kopiuje biblioteki do vendor/ (+ vendor/SHA256SUMS)
//   npm run check     – sprawdza, czy vendor/ i CSS są aktualne oraz czy index.html spełnia zasady bezpieczeństwa
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// Biblioteki uruchamiane w przeglądarce – serwowane z tej samej domeny (bez zewnętrznego CDN).
const VENDOR = [
  ['node_modules/chart.js/dist/chart.umd.min.js', 'vendor/chart.umd.min.js'],
  ['node_modules/pdfmake/build/pdfmake.min.js', 'vendor/pdfmake.min.js'],
  ['node_modules/pdfmake/build/vfs_fonts.js', 'vendor/vfs_fonts.js'],
  ['node_modules/chart.js/LICENSE.md', 'vendor/LICENSE-chart.js.md'],
  ['node_modules/pdfmake/LICENSE', 'vendor/LICENSE-pdfmake.txt']
];

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const problems = [];

function buildCss() {
  const tmp = mkdtempSync(join(tmpdir(), 'tw-'));
  try {
    const out = join(tmp, 'app.css');
    execFileSync(process.execPath, [
      join(root, 'node_modules', 'tailwindcss', 'lib', 'cli.js'),
      '-c', join(root, 'tailwind.config.js'),
      '-i', join(root, 'scripts', 'tailwind.input.css'),
      '-o', out, '--minify'
    ], { stdio: ['ignore', 'ignore', 'inherit'], cwd: root });
    return readFileSync(out);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function checkHtml() {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  if (!csp) problems.push('index.html: brak nagłówka Content-Security-Policy');
  else {
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", 'http:', 'https:', '*']) {
      if (csp[1].split(/[\s;]+/).includes(bad)) problems.push(`CSP zawiera niebezpieczny wpis ${bad}`);
    }
  }
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
    const attrs = m[1];
    if (/type="application\/ld\+json"/.test(attrs)) continue;
    const src = /src="([^"]+)"/.exec(attrs);
    if (!src) problems.push('index.html: skrypt inline (zablokowany przez CSP) – przenieś kod do assets/app.js');
    else if (/^(https?:)?\/\//.test(src[1])) problems.push(`index.html: skrypt z zewnętrznej domeny ${src[1]}`);
  }
  if (/<style\b/.test(html)) problems.push('index.html: blok <style> (zablokowany przez CSP) – użyj assets/app.css');
  const markup = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  if (/<[^>]*\son[a-z]+\s*=/i.test(markup)) problems.push('index.html: atrybut on*= (zablokowany przez CSP)');
  if (/<[^>]*\sstyle\s*=/i.test(markup)) problems.push('index.html: atrybut style= (zablokowany przez CSP)');
  if (/href="javascript:/i.test(markup)) problems.push('index.html: link javascript:');
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!/rel="[^"]*noopener/.test(m[0])) problems.push(`link target="_blank" bez rel="noopener": ${m[0].slice(0, 80)}`);
  }
}

const css = buildCss();
const cssPath = join(root, 'assets', 'app.css');
if (CHECK) {
  if (!existsSync(cssPath) || !readFileSync(cssPath).equals(css)) problems.push('assets/app.css jest nieaktualny – uruchom npm run build');
} else {
  writeFileSync(cssPath, css);
}

const sums = [];
mkdirSync(join(root, 'vendor'), { recursive: true });
for (const [from, to] of VENDOR) {
  const src = readFileSync(join(root, from));
  const dst = join(root, to);
  if (CHECK) {
    if (!existsSync(dst) || !readFileSync(dst).equals(src)) problems.push(`${to} różni się od ${from} (zmodyfikowany lub nieaktualny plik)`);
  } else {
    copyFileSync(join(root, from), dst);
  }
  sums.push(`${sha256(src)}  ${to.replace('vendor/', '')}`);
}
const sumsText = sums.join('\n') + '\n';
const sumsPath = join(root, 'vendor', 'SHA256SUMS');
if (CHECK) {
  if (!existsSync(sumsPath) || readFileSync(sumsPath, 'utf8') !== sumsText) problems.push('vendor/SHA256SUMS jest nieaktualny');
} else {
  writeFileSync(sumsPath, sumsText);
}

checkHtml();

if (problems.length) {
  console.error('BŁĘDY:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(CHECK ? 'Kontrola OK: vendor/, assets/app.css i index.html są poprawne.' : `Zbudowano: assets/app.css (${(css.length / 1024).toFixed(1)} KB), vendor/ (${VENDOR.length} plików).`);
