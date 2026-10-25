// Bundles src/ (plus ../shared) into a single Apps Script file at dist/Code.js.
// Apps Script only sees top-level function declarations, so the footer re-exports the entry points.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'FairShare',
  target: 'es2019',
  outfile: 'dist/Code.js',
  legalComments: 'none',
  footer: {
    js: [
      'function doGet(e) { return FairShare.doGet(e); }',
      'function doPost(e) { return FairShare.doPost(e); }',
      'function setup() { return FairShare.setup(); }',
    ].join('\n'),
  },
});

copyFileSync('appsscript.json', 'dist/appsscript.json');
console.log('Built dist/Code.js');
