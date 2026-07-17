# NOTICE

GIFit bundles third-party open-source software.

## gifski (GIF encoder)

- Upstream: https://github.com/ImageOptim/gifski
- Vendored runtime: `gifski-wasm` 2.2.0 — see `public/vendor/gifski-wasm/`
- Copyright © Kornel Lesiński and contributors
- License: **GNU Affero General Public License v3.0** (`AGPL-3.0-or-later`)
  - Full text: `public/vendor/gifski-wasm/LICENSE`
  - https://www.gnu.org/licenses/agpl-3.0.html

## AGPL-3.0 network-use obligation (§13)

Because GIFit incorporates gifski (AGPL-3.0) into the combined work and is
served to users over a network, AGPL-3.0 §13 applies: users interacting with
the deployed app must be offered the **Corresponding Source** of the running
version. The app surfaces this in-product via the **"Open source"** control in
the top navigation bar, which links to:

- **Corresponding Source (this app):** https://github.com/raymondliang905/gif-it
- **gifski upstream:** https://github.com/ImageOptim/gifski

This entire repository is licensed under AGPL-3.0-or-later (see `LICENSE`),
which is what satisfies §13 for this public deployment.

This program comes with ABSOLUTELY NO WARRANTY, to the extent permitted by
applicable law.

## Origin

This app started as an internal Affirm tool (Quicksilver `gif-it`) at
https://github.com/Affirm/lakehouse/tree/main/quicksilver/apps/gif-it, which
runs the same frontend behind Affirm SSO. This repository is a standalone,
publicly-licensed fork of that frontend, adapted to be served from GitHub
Pages (see `README.md`). The two copies are not kept in sync automatically.
