import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The DEMO build: index.html and the docs sample as a static site (not the
 * library), for GitHub Pages. `base: './'` keeps every URL relative, so it works under
 * https://<owner>.github.io/diagramium-player/ and when opened from any folder.
 *
 *   npm run build:demo   -> demo-dist/
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'demo-dist',
    emptyOutDir: true,
    target: 'es2022',        // demo pages only: current browsers (top-level await)
    rollupOptions: {
      input: {
        demo: resolve(import.meta.dirname, 'index.html'),
        docs: resolve(import.meta.dirname, 'docs-sample/index.html'),
        docsStatic: resolve(import.meta.dirname, 'docs-sample/static.html'),
        docsAnimated: resolve(import.meta.dirname, 'docs-sample/animated.html'),
      },
    },
  },
  plugins: [{
    // The page fetches ./examples/<file>.json at run time, so the files ship
    // beside it rather than through the bundler.
    name: 'copy-examples',
    closeBundle() {
      cpSync(resolve(import.meta.dirname, 'examples'), resolve(import.meta.dirname, 'demo-dist/examples'), { recursive: true });
      // the docs sample fetches its diagram file the same way
      cpSync(resolve(import.meta.dirname, 'docs-sample/checkout-flow.json'), resolve(import.meta.dirname, 'demo-dist/docs-sample/checkout-flow.json'));
    },
  }],
});
