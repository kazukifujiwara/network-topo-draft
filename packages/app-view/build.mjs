// Widget build (#28): bundle src/main.ts (+ the CSS it pulls in via
// webview-ui) with esbuild, then inline BOTH into src/template.html to emit
// ONE self-contained dist/app.html. MCP Apps UI resources
// (text/html;profile=mcp-app) render in a sandboxed iframe and must not
// load anything remote — the build fails on any http(s) src/href.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(here, 'dist'), { recursive: true });

await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  outfile: resolve(here, 'dist/app.js'),
  logLevel: 'warning',
});

// '</script' inside the inlined JS would terminate the <script> element —
// escape it (harmless inside JS strings/regexes: '\/' === '/')
const js = readFileSync(resolve(here, 'dist/app.js'), 'utf8').replaceAll('</script', '<\\/script');
const css = readFileSync(resolve(here, 'dist/app.css'), 'utf8');
const template = readFileSync(resolve(here, 'src/template.html'), 'utf8');
// replacement callbacks: literal insertion, no $-pattern substitution
const html = template.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);

const remote = /\b(?:src|href)\s*=\s*["']https?:\/\//i.exec(html);
if (remote) throw new Error(`dist/app.html references a remote resource: ${remote[0]}`);

writeFileSync(resolve(here, 'dist/app.html'), html);
// (globalThis: eslint has no node-globals block for these build scripts)
globalThis.console.log(`app.html: ${(html.length / 1024).toFixed(1)} KB (self-contained)`);
