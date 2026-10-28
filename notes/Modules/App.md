---
tags: [module]
file: app/
updated: 2026-10-27
---
# App (`app/`, `scripts/build-app.mjs`)

Message Archivist as an app of its own: Chrome or Edge install it from its web address and it opens in its own window, with its own icon, without browser tabs, and works offline. It runs on the browser that's already there (the owner's brief: "launch this separately from Chrome/Edge but utilize them for the back end"; see [[Desktop app]] for the plan and what's next). It's the extension's own pages, not a second UI: one page, Settings, which opens on its **Archive** tab (the viewer, in a frame) once there's a folder. Published to GitHub Pages from release tags ([[Releasing]] → The app).

## What's in it
| File | What |
|---|---|
| `app/app.js` | loaded first in every page, in `<head>`: stand-ins for the extension APIs the pages use, marks `<html class="app">`, the install button, files the system opens with the app, the offline copy's registration and the "new version" notice |
| `app/sw.js` | the offline copy (service worker): keeps every file of the version, answers from it, swaps versions only between sessions |
| `app/manifest.webmanifest` | the web app manifest: name, `id` `/message-archivist/app/`, `start_url` `./` (Settings, opening on Archive), `scope` `./`, `display: standalone`, icons, shortcuts (Contacts: `./#archive/contacts`, Bring in files), `file_handlers` (`.tar`), `launch_handler` (`focus-existing`) |
| `app/icons/` | `icon-192.png`, `icon-512.png` (the extension's `icon.svg`, transparent) and `icon-maskable-512.png` (on the theme's blue, inside the safe zone), rendered with headless Chrome |
| `scripts/build-app.mjs` | puts it together (`npm run app [-- <folder>]`, default `dist/site`) |
| `scripts/serve-app.mjs` | `npm run serve-app [-- <port>]`: builds, then serves `dist/site` at `http://localhost:8080/app/` (127.0.0.1 only) to install and try before a release |

## Built (`scripts/build-app.mjs`)
- `index.html` is `extension/options.html` and `viewer.html` is `extension/viewer.html`, each with lines added after `<meta charset>`: a viewport, a **content security policy** (`default-src 'self'`; scripts only from the app; styles may be inline; pictures and media from the app, `blob:` and `data:`; `connect-src 'self'`; frames only of its own pages (the Archive tab), no objects or forms), the manifest, theme colours and `app.js`. The home page's title is "Message Archivist".
- Every script, style and icon those pages load comes along (parsed from the pages; `data.js` excepted), so a new module loaded by a page is picked up by itself.
- `archive/viewer.html` is `extension/viewer.html` **unchanged**: what Settings copies into a backup folder as `index.html` (`MA_APP.archiveURL`). The app's own viewer has the policy and `app.js`, which would break it opened from disk (a `file://` page's `'self'` doesn't cover its own folder's scripts).
- `app.js` and `sw.js` get the version; `sw.js` gets the list of every file with the first 16 hex digits of its SHA-256, and a build ID from the whole list, so any change to any file makes a new version.
- `SHA256SUMS.txt` lists every file's SHA-256; the release attaches the same list ([[Releasing]]). The build is deterministic: the same tag always makes the same files (`test/app/run.mjs` builds twice).
- The site's root `index.html` sends visitors to `app/`.

## The stand-ins (`app.js`)
Skipped on the extension's own pages (`chrome.runtime.id` is set there).
- **`chrome.storage.local`** (`get`, `set`, `remove`, `onChanged`) in the app's own IndexedDB (`ma-app` / `storage`); values pass through JSON, as chrome.storage keeps them; changes reach the app's other windows by `BroadcastChannel('ma-storage')`. It holds what Settings keeps there: settings, past runs, `myNames`, the theme. Not shared with the extension: its storage isn't reachable from a web page ([[Storage and settings]]).
- **`chrome.runtime.sendMessage`**: `gm-open-backup` goes to `./#archive/<hash>` (Settings' Archive tab) and `gm-open-settings` to `./#<hash>`, **in the same window** (`go()`: a hash change when it's already that page); anything else needs Google Messages, and answers `{ ok: false, error }` saying the extension does it, which Settings shows as it shows any failed run. `getManifest()` gives the app's version, `getURL()` a URL in the app.
- **`chrome.tabs.create`**: the viewer becomes `./#archive/<its hash>` in the same window (`go()`); anything else in a new one.
- **In a frame** (the viewer inside the Archive tab, `framed`): no install button, offline-copy registration or new-version notice; the page around it has them.
- **`window.MA_APP`**: `version`; `archiveURL(file)` (the pristine viewer for the backup folder); `onFiles(fn)`: phone backups the system opened with the app (`launchQueue`), held until Settings is ready, then imported (`importAnything(false, handles)`, on the Tools tab).
- **Install**: on either page, `beforeinstallprompt` puts an "Install the app" button beside the theme switch (Settings: the bottom of its menu) (Chrome and Edge also show an install icon in the address bar); it's gone once installed or when running as the app.
- **Updates**: `sw.js` is registered on load. When a new version has installed and is waiting, a notice says it starts next time, with **Restart now** (tells it to take over, then reloads).

## What the pages do differently (`window.MA_APP` / `html.app`)
- `theme.css`: `html.app .ext-only` is hidden; `.app-only` shows only in the app.
- **Settings** ([[Settings page]], `APP`): no "Back up everything", backup list or schedules (`runAll`, `addChats`, the fix bar, a row's *By itself* and *Back up*, `homeFinish`, `homePhotos`), and no settings that only the extension's backups use (photos, quality, window, notifications, corner, patience, full-size early, double-check, link previews, page markup, date-range zips). The setup steps and Home say the extension backs up Google Messages into the same folder, with a link to the releases. A `#delete:` or `#folder` link from the viewer works in a window that's already open (`hashchange`).
- **Viewer** ([[Viewer]], `APP`): shown in Settings' Archive tab (`viewer.html?library=1&embedded=1`, which the policy's `frame-src 'self'` allows); always library mode (the app has no `data.js` of its own). Opened by itself (`viewer.html`) it still works, with a ⚙ to Settings; no folder yet → Settings' setup steps (`./#welcome`).

## The offline copy (`sw.js`)
- **install**: caches every listed file (`ma-app-<version>-<build>`). **activate**: deletes other `ma-app-` caches, then `clients.claim()`, so the first visit is offline-ready without a reload.
- **fetch**: same-origin GETs from the cache (`ignoreSearch`, so `viewer.html?library=1` is `viewer.html`), else the network. The backup folder never goes through it: pages read it with the File System Access API.
- A new version **waits** for every window of the app to close (no `skipWaiting` unless "Restart now" posts `skip-waiting`), so a release never changes a page under someone mid-import.

## Using it
- Open the address in Chrome or Edge, **Install** (address bar, or the button in the header), then choose the backup folder in the app: **its folder access is its own**, so it asks once even if the extension already has it. Choose the same folder the extension saves to. "Allow on every visit" keeps it.
- Bring in, People, Obsidian, checks, Phone restore and the viewer work as in the extension's Settings and viewer; backing up Google Messages is still the extension's.
- Opening a phone backup with the app (Finder or Explorer → Open with → Message Archivist, or a double click once it's the default for `.tar`) brings it in.

## Tests
`test/app/run.mjs` (in `npm test`) builds the app twice into a temporary folder and checks the pages (policy, manifest, `app.js` first, no inline scripts, everything they load), the pristine `archive/viewer.html`, the offline copy's list and hashes, the manifest, `SHA256SUMS.txt`, that nothing of the extension's own (content script, background worker, writer, popup) is served, and that the two builds are identical. In a browser: see [[Testing]] → The app.

Related: [[Desktop app]], [[Releasing]], [[Settings page]], [[Viewer]], [[Storage and settings]], [[Decisions]].
