# Artifact Viewer Media Support — Research Report (2025/2026)

Webview-based desktop shell. Grading: 🔥 official docs/registry · 🌡️ reputable secondary source · ❄️ inference/agent judgment.

## Per-media-type matrix

### Images (raster)
- **Native**: JPEG/PNG/GIF/WebP/AVIF render natively via <img> in all modern webviews (Chromium/WebKit). 🔥 MDN "Image file type and format guide": https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types
- **Gotcha**: HEIC/HEIF (common from iPhones & some AI tools) is NOT supported in Chromium webviews → needs libheif-js conversion. 🌡️ caniuse https://caniuse.com/heif (shows near-zero Chromium support). TIFF/BMP/PSD also need libraries or conversion.
- **Pan/zoom**: **medium-zoom 1.1.0** (lightbox, tiny) or **PhotoSwipe 5.4.4** (full gallery w/ a11y, touch). For huge/tiled images (pathology-scale, deep zoom): **OpenSeadragon 6.1.0** + pyramidal tiles (or iiif). 🔥 npm registry versions. Choice guide ❄️: medium-zoom for inline, PhotoSwipe for galleries, OpenSeadragon only if >50MP/tiled.

### SVG
- **Native** via <img> or inline. 🔥 MDN. **Gotcha**: inline SVG executes scripts/<foreignObject> can smuggle HTML → sanitize with **DOMPurify 3.4.14** before inline render; <img>-embedded SVG is script-blocked by the browser (prefer that path for untrusted files). 🔥 DOMPurify https://github.com/cure53/DOMPurify ; 🌡️ SVG security writeups.

### Video
- **Native**: <video> handles MP4/H.264, VP8/VP9, AV1, and (Safari/WebKit only) HEVC. In a Chromium webview assume H.264+VP9+AV1; **HEVC/H.265 generally fails in Chromium unless OS-hardware-decode builds** (Edge/Safari ok). 🔥 caniuse https://caniuse.com/hevc ; 🔥 MDN codecs guide https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats
- **Library**: native <video> covers most needs; **video.js 8.24.0** (extensible, a11y-focused UI) or **plyr 3.8.4** (lightweight skin). For streaming AI-generated output: **hls.js 1.7.1**. Vidstack (1.x) is popular but npm shows 0.6.15 latest on the plain tag — check its scoped packages before adopting. 🔥 npm versions.
- **Gotcha**: codec support differs between webview engines (WKWebView ≠ WebView2 ≠ WebKitGTK); probe with MediaSource.isTypeSupported()/canPlayType at runtime. 🔥 MDN.

### Audio
- **Native** via <audio>: MP3, AAC, Opus, Vorbis, WAV, FLAC (Chromium+WebKit). 🔥 MDN formats guide. Native controls are a11y-complete; no library needed. ❄️

### PDF
- **Never native in webview** (except WKWebView inline PDF). Use **pdfjs-dist 6.3.289** (current major v6) — render to canvas; use the official viewer UI (web/pdf_viewer) for free toolbar/text-layer/search. 🔥 mozilla/pdf.js https://github.com/mozilla/pdf.js/releases
- **Gotchas**: must run in a Worker (off main thread); text layer needed for a11y/selection; embed untrusted PDFs with scripts/launch URLs disabled (disable annotations/JS — standard PDF.js hardening) and serve worker from same package version. 🔥 PDF.js docs ; 🌡️ hardening guidance.

### Plain text / code
- **Native** <pre> + monospace. **Shiki 4.4.3** for VS Code-accurate highlighting ( heavier, build-time/bundled grammars) or **highlight.js 11.12.0** (lighter, runtime). 🔥 npm.
- **Gotcha**: Shiki bundles are big — load grammars lazily per language. ❄️

### Markdown
- **markdown-it 15.0.1** (plugins, battle-tested) or **marked 18.0.11** (fast, minimal). Always pipe HTML through **DOMPurify 3.4.14**; render math with **KaTeX 0.18.4**, diagrams with **mermaid 11.17.2**. 🔥 npm; 🔥 DOMPurify docs (hook RENDER to sanitize).

### JSON
- **Native**: JSON.parse + custom tree, or CodeMirror/Monaco tree viewer. Shiki handles raw display. ❄️ No dominant lib; Monaco's built-in JSON tree is the free option if Monaco already ships.

### Notebooks (.ipynb)
- **Not native.** Options: JupyterLite (full kernel in webview, heavy), @jupyterlab/rendermime (output-block renderer, medium), or render converted HTML. 🌡️ JupyterLite https://jupyterlite.readthedocs.io . Recommendation ❄️: defer unless the studio emits notebooks; if yes, rendermime2 for read-only.

### 3D (glTF/GLB)
- **Not native.** **@google/model-viewer 4.3.1** web component — one-liner, AR/poster/env support, best for a viewer. **three 0.185.1** (via GLTFLoader) for interactive control. 🔥 npm; 🔥 https://modelviewer.dev
- **Gotcha**: GLB can embed textures that bypass CSP (data: URIs) — treat 3D files as untrusted content; model-viewer sandbox. 🌡️.

## Cross-cutting requirements

1. **Security / sandboxing**
   - Render every untrusted artifact (SVG, HTML-in-Markdown, PDF, GLB) in a **sandboxed iframe** (sandbox attr, no allow-scripts) or DOMPurify first. 🔥 MDN iframe sandbox: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
   - **CSP**: strict Content-Security-Policy in the webview (no unsafe-inline for untrusted contexts; object-src 'none'; frame-ancestors). 🔥 MDN CSP.
   - **Electron/WebView2 hardening**: contextIsolation, nodeIntegration:false, sandbox:true, disable webview tag navigation. 🔥 Electron Security Checklist: https://electronjs.org/docs/latest/tutorial/security
2. **Large files**
   - Grid/list virtualization: **@tanstack/react-virtual 3.14.10** (or react-window 2.3.0). 🔥 npm.
   - loading="lazy" + decoding="async" on <img>; thumbnails via object URLs (blob:) not data: URIs; stream video with range requests. 🔥 MDN https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/loading
   - >100MB text/code: cap render + paginate (CodeMirror viewport rendering). ❄️
3. **Accessibility**
   - All interactive viewers keyboard-operable (zoom/pan/page); alt text & aria-labels; video needs captions track + native controls baseline; PhotoSwipe & video.js ship good a11y, PDF.js text-layer exposes text to AT. 🔥 WCAG 2.2 media criteria https://www.w3.org/WAI/WCAG22/quickref/ ; 🌡️ per-lib docs.
4. **Runtime probing**: feature-detect codecs/decoders per webview engine rather than hardcoding. 🔥 MDN canPlayType.

## TL;DR stack recommendation (❄️)
<img>+medium-zoom/PhotoSwipe · DOMPurify for SVG/MD-HTML · native <audio>/<video> (+video.js skin) · pdfjs-dist 6 + worker · Shiki 4 (lazy) · markdown-it 15 · model-viewer 4 for glTF · TanStack Virtual for galleries · sandboxed iframe for anything executable.
