# GIFit

Record a Figma prototype playback and export a local GIF — entirely in the
browser. Paste a Figma prototype link, play through it, trim, crop, and
export a GIF encoded with [gifski](https://github.com/ImageOptim/gifski)
(via [gifski-wasm](https://github.com/jamsinclair/gifski-wasm)). No server,
no upload — recording, encoding, and the "restore last recording" feature
all run client-side (canvas capture + WebAssembly + IndexedDB).

**Live:** https://raymondliang905.github.io/gif-it/

## Origin

This is a public, standalone fork of the frontend for the internal Affirm
Quicksilver app
[`gif-it`](https://github.com/Affirm/lakehouse/tree/main/quicksilver/apps/gif-it),
adapted to be served as a static site from GitHub Pages instead of behind
Affirm SSO on Snowflake SPCS. The two copies are not kept in sync
automatically — see [NOTICE.md](./NOTICE.md).

The Pages deployment exists because Quicksilver's SPCS ingress proxy injects
its own baseline Content-Security-Policy, and the browser applies the
strictest intersection of that proxy CSP and any app-set CSP — so the app
cannot loosen `frame-src` enough to reliably render the cross-origin Figma
prototype iframe. GitHub Pages injects no CSP, so the iframe renders natively
with no workaround needed.

## Development

```bash
npm install
npm run dev       # http://localhost:5173/
```

## Build

```bash
npm run build     # outputs dist/, base path /gif-it/
npm run preview   # serve the production build locally
```

Deploys to GitHub Pages automatically on push to `main` via
[`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml).

## License

AGPL-3.0-or-later — see [LICENSE](./LICENSE). This app bundles
[gifski](https://github.com/ImageOptim/gifski) (AGPL-3.0); see
[NOTICE.md](./NOTICE.md) for the full third-party notice and the AGPL §13
corresponding-source statement.
