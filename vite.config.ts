import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Library mode: one entry, two formats.
 *   dist/index.js   — ES module  (import)
 *   dist/index.cjs  — CommonJS   (require)
 * Type declarations are emitted separately by `tsc -p tsconfig.build.json`
 * (see the `build` script), so the build needs no Vite plugin.
 *
 * `npm run dev` serves index.html (the demo page) straight from src/.
 */
export default defineConfig({
  build: {
    target: 'es2019',
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'Diagramium',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
  },
});
