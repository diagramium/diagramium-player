// CommonJS consumers resolve `require` types from dist/index.d.cts (see the
// "exports" map). The declarations are identical for both formats, so the
// build copies index.d.ts rather than running tsc twice.
import { copyFileSync, existsSync } from 'node:fs';

const from = new URL('../dist/index.d.ts', import.meta.url);
const to = new URL('../dist/index.d.cts', import.meta.url);
if (!existsSync(from)) {
  console.error('dist/index.d.ts is missing — did `tsc -p tsconfig.build.json` run?');
  process.exit(1);
}
copyFileSync(from, to);
console.log('wrote dist/index.d.cts');
