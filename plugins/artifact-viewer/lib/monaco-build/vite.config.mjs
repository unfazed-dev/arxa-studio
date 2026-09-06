// Vite build for the Monaco/VS Code viewer bundle (G7-G12).
//
// Vite, not esbuild: @codingame/monaco-vscode-api ships `?worker` / `?raw`
// imports, CSS side-effects and a rollup vsix plugin — it is a Rollup-family
// library and esbuild-IIFE (what lib/vendor.js produces for CodeMirror) is not
// a supported output shape for it.
//
// Output MUST be flat: the host's vendor route
// (lib/index.js createVendorRoutes) resolves path.basename() against one flat
// directory and cannot serve subpaths.
import { defineConfig } from 'vite'

const flat = '[name]-[hash][extname]'

export default defineConfig({
  // Worker URLs and asset URLs are emitted absolute from `base`; the host
  // serves this bundle at exactly this path (lib/index.js vendor route).
  base: '/__arxa/artifacts/vendor/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0, // a data: URI can't be served by the vendor route either
    rollupOptions: {
      input: { 'arxa-monaco': 'src/entry.mjs' },
      output: {
        format: 'es',
        dir: 'dist',
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: flat,
      },
    },
  },
  worker: { format: 'es', rollupOptions: { output: { entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js', assetFileNames: flat } } },
})
