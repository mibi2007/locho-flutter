import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const output = new URL('web/locho/', root);
await mkdir(output, { recursive: true });
await copyFile(require.resolve('locho_web/wasm'), new URL('locho_web_bg.wasm', output));
await build({
  entryPoints: [fileURLToPath(new URL('tool/web-entry.mjs', root))],
  outfile: fileURLToPath(new URL('bridge.js', output)),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});
console.log('Prepared published locho_web JavaScript + WASM in web/locho/.');
