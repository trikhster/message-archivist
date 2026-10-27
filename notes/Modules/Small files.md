---
tags: [module]
updated: 2026-10-26
---
# Small files

## `zip.js` (`GMZip`)
A minimal zip writer and reader (store only, no compression: photos and videos are already compressed). The writer makes date-range copies (`ZipSink` in the [[Content script]]); the reader lets Settings import zips made by older versions. `new GMZip.ZipWriter()`, `add(name, data)`, `names`, `size`.

## `theme.js`, `theme.css`
`GMTheme` (`set`, `toggle`, `bind(button)`, `effective`): light/dark from the system, overridable, remembered in `localStorage` `gm-theme` and mirrored to `chrome.storage.local.theme` for the progress panel. `theme.css` holds the Material 3-style tokens shared by the popup, Settings and the viewer. Both are copied into each backup folder.

## `manifest.json`
MV3. Permissions: `activeTab`, `scripting`, `storage`, `unlimitedStorage`, `downloads`, `alarms`, `notifications`. Hosts: messages.google.com, googleusercontent.com, google.com, googleapis.com, gstatic.com; optional `https://*/*` for link-preview pictures. Content scripts: `zip.js`, `library.js`, `content.js` at `document_idle`. Web-accessible to messages.google.com: viewer, theme, writer files. Why each permission: `PRIVACY.md`.

## `scripts/`
| Script | Does |
|---|---|
| `check.mjs` (`npm run check`) | manifest valid and MV3, versions match `package.json`, every referenced file exists, no inline `<script>` in pages, `node --check` on every script |
| `package.mjs` (`npm run package`) | check, then zip `extension/` (no dotfiles) plus LICENSE and NOTICE into `dist/`, prints SHA-256 |
| `set-version.mjs` | `npm run set-version -- 0.0.2.0`: writes the version into `package.json`, `manifest.json` and the Android app (`versionName`, and `versionCode` = P·1,000,000 + M·10,000 + m·100 + p) |

## `.github/`
`workflows/ci.yml` (runs the check), `workflows/release.yml` (on a `v*.*.*` tag: version must match the manifest, build, release notes from `CHANGELOG.md`, attach the zip), `pull_request_template.md`, issue templates (bug report, feature request). See [[Releasing]].
