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
    cssCodeSplit: false,
    rollupOptions: {
      // An application entry has its exports tree-shaken away (nothing imports
      // them at build time): the bundle built clean and then threw "openFile is
      // not a function" in the browser. build.lib fixes that but ALSO turns off
      // code splitting — one 45.7 MB chunk the browser cannot parse inside the
      // lens's 30 s navigate budget. preserveEntrySignatures keeps the exports
      // AND the split. Both failures exited 0; only the lens saw them.
      preserveEntrySignatures: 'strict',
      input: { 'arxa-monaco': 'src/entry.mjs' },
      output: {
        format: 'es',
        dir: 'dist',
        // Stable entry name: client.js import()s this path directly and the
        // vendor route already answers no-store, so there is nothing to bust.
        entryFileNames: 'arxa-monaco.js',
        chunkFileNames: '[name]-[hash].js',
        // The ONE stylesheet (cssCodeSplit: false) gets a stable name so the
        // entry can inject it by name at runtime. Nothing emits an index.html
        // here, so no <link> is generated for us — and without the stylesheet
        // monaco renders unstyled across the whole page, which is exactly how
        // it shipped once. Everything else stays content-hashed.
        assetFileNames: (info) =>
          (info.names ?? [info.name]).some((n) => n && n.endsWith('.css'))
            ? 'arxa-monaco.css'
            : flat,
      },
    },
  },
  worker: { format: 'es', rollupOptions: { output: { entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js', assetFileNames: flat } } },
})
