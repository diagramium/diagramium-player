import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The DEMO build: index.html as a static site (not the library), for GitHub
 * Pages. `base: './'` keeps every URL relative, so it works under
 * https://<owner>.github.io/diagramium-player/ and when opened from any folder.
 *
 *   npm run build:demo   -> demo-dist/
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'demo-dist',
    emptyOutDir: true,
    target: 'es2019',
  },
  plugins: [{
    // The page fetches ./examples/<file>.json at run time, so the files ship
    // beside it rather than through the bundler.
    name: 'copy-examples',
    closeBundle() {
      cpSync(resolve(__dirname, 'examples'), resolve(__dirname, 'demo-dist/examples'), { recursive: true });
    },
  }],
});
