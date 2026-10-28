---
tags: [architecture, reference]
updated: 2026-10-27
---
# Code map

`Code map.canvas`, next to this note, is a map of the whole project you open in Obsidian's canvas view: zoom out for the shape of it, zoom in for every function. [[Architecture]] tells the story; the canvas shows where each piece of it lives.

## What's on it
- **Features**, the cards across the top: Google Messages backup, automatic backups, photos, the library, people across apps, each other app (WhatsApp, Telegram, Discord, Instagram and Messenger, TikTok, Snapchat), each web page reader (Snapchat for Web), bringing in exports, Settings, the viewer, notes for Obsidian, the installable app, Android restore and Android phone backup. Each links to its note and has an edge, in its colour, to the files and sections that do it.
- **Areas**, one row each: the extension's backup (content script, writer frame, background worker, zip), the shared library and Obsidian notes, the extension pages, the importers and web page readers, the app and tooling, the Android app.
- **Files**, a group each, headed with a link to the module note and how many functions it has (not its length, which would put the map out of date on every edit).
- **Sections**, a group each inside the file: the `// ---------- name ----------` comments in the code. In Kotlin, each top-level class or object is a section too (`MainActivity · backing up`).
- **Functions**, a card each: its name and parameters (a value built once by a function that runs straight away, like `HUD`, reads `HUD = (…)()`), and the first sentence of the comment above it. Only functions at a section's own level (and the methods of objects one level in) are shown; helpers inside a function aren't.
- **Messages**: purple edges between files for the `gm-*` messages one sends (`type: 'gm-…'`) and the other handles (`case 'gm-…'`), labelled with their names. The full list is [[Messages between parts]].

## Keeping it up to date
`npm run code-map` reads the code and writes the canvas again. `npm run check` warns when the canvas no longer matches the code; run it after adding, renaming or moving functions or sections.

What it keeps when it writes the canvas again:
- anything you add by hand in Obsidian: cards, notes, groups and edges (an edge stays while both its ends exist)
- where you dragged the feature cards, and their size

Everything else (areas, files, sections, function cards and the edges it draws) is laid out from scratch each time, so move or edit those in the code, not on the canvas.

The features and what they point at are the `SEGMENTS` list at the top of `scripts/code-map.mjs`, and the rows are `AREAS`; a target is a file (`extension/importers/snapchat.js`), a section (`extension/library.js#the restore package`) or a function (`extension/content.js:folderRun`). A new app's importer (a file in `extension/modules/`, or `extension/importers/` before the move) or web page reader (`extension/web/`) gets its own feature card and a Kotlin file its own group by themselves, and `APPS` gives an app's card a proper name and description; a new feature, or a file outside those folders and `scripts/`, needs a line there. When a feature points at a section or file that's gone, the script says so and exits with an error.

## Why a generated canvas
A hand-drawn diagram goes stale the first time a function is renamed. Reading the code each time keeps the map true, while the hand-made parts it keeps let it carry the notes and arrows a person adds. It reads the code with patterns, not a parser (no dependencies, see [[Decisions]]), which relies on the two-space indentation and the section comments the code already has.
