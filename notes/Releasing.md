---
tags: [workflow, release]
updated: 2026-10-27
---
# Releasing

Only when the owner asks ("Commit X, push it, and publish the vX release"). The repo `trikhster/message-archivist` is public; see [[Decisions]] for why it's a new repo and where the old private one is.

## Versioning
Four parts, `P.M.m.p` (production.major.minor.patch), written in `CHANGELOG.md`, `package.json`, `manifest.json` and the Android app (one version for both):
- **Production**: 0 for every development release so far; 1 with the first production release.
- **Major**: breaks existing libraries or needs setup again.
- **Minor**: new features; existing backups keep working.
- **Patch**: fixes only.

Chrome allows four-part versions; npm's `npm version` doesn't, so `npm run set-version -- P.M.m.p` writes it (and the app's `versionCode`, which must only grow). `npm run check` fails if the three disagree. The app's `versionCode` is P·1,000,000 + M·10,000 + m·100 + p (0.0.1.0 is 100).

## Steps
1. Move the **Unreleased** notes in `CHANGELOG.md` under `## [P.M.m.p] - YYYY-MM-DD` (Added / Changed / Fixed, written for users).
2. Update the user guide (`extension/README.md`), the project README, `PRIVACY.md` and `GMLib.README` if what people see or what's written to disk changed.
3. `npm run set-version -- P.M.m.p` (package.json, manifest.json, the Android app).
4. `npm run check`.
5. Commit on a branch (`release/P.M.m.p`), message `Message Archivist P.M.m.p: <summary>`, with the `Co-Authored-By` line. Push, open a PR into `main` (template: `.github/pull_request_template.md`), merge when approved.
6. Tag the merge commit `vP.M.m.p` and push the tag. `release.yml` checks the tag matches the manifest, runs `npm run package`, builds the signed APK (below), builds release notes from the changelog section, and publishes the release with `message-archivist-extension-vP.M.m.p.zip`, `message-archivist-android-vP.M.m.p.apk`, their SHA-256 and the APK's signing-key fingerprint. A tag starting `v0.` makes a **pre-release** (production digit 0). Push one tag at a time: GitHub skips tag workflows when more than three tags are pushed at once.
7. The workflow titles the release just `vP.M.m.p`. Give it a descriptive title: `gh release edit vP.M.m.p --title "vP.M.m.p: <what's new>"`.

PRs are merged with a merge commit (`gh pr merge N --merge`), and tags are annotated: `git tag -a vP.M.m.p -m "Message Archivist P.M.m.p"`.

## The Android app
`android/app/build.gradle.kts` has its own `versionName`/`versionCode` (set by `set-version`). CI builds a debug APK on every push (artifact `message-archivist-debug-apk`, test builds only). Releases get a **release build signed with the project's key**: no debug-only test hooks (`restore_path`, `backup_path`), not debuggable.

**The signing key** (made 2026-10-27): a PKCS12 keystore, alias `message-archivist`, RSA 4096, valid to 2126, `CN=Message Archivist, O=trikhster`; certificate SHA-256 `32:00:07:C0:76:01:73:AE:D5:4C:66:4A:3A:D1:96:05:29:B7:7E:E6:67:42:85:48:4F:23:FB:7D:3F:5F:F3:32`. It lives on the owner's Mac at `~/.android/message-archivist-release.p12` (mode 600), its password in the login Keychain as `message-archivist-release-key` (store and key share it). **Every later release must be signed with this key**, or phones refuse the update and people must uninstall (losing the app's settings): keep a backup of both somewhere safe and offline. Never commit it (`.gitignore` refuses `*.p12`, `*.jks`, `*.keystore`).

The Release workflow gets it from two repository secrets, set by the owner (not by an agent):
```bash
base64 -i ~/.android/message-archivist-release.p12 | gh secret set ANDROID_KEYSTORE_BASE64 -R trikhster/message-archivist
security find-generic-password -s message-archivist-release-key -w | gh secret set ANDROID_KEYSTORE_PASSWORD -R trikhster/message-archivist
```
The workflow writes the key to the runner's temp folder only for the build step (`MA_KEYSTORE`, `MA_KEYSTORE_PASSWORD`, read by `build.gradle.kts`), deletes it after, and fails if the secrets are missing, so a release never goes out without its APK. To build a signed APK locally: `MA_KEYSTORE=~/.android/message-archivist-release.p12 MA_KEYSTORE_PASSWORD="$(security find-generic-password -s message-archivist-release-key -w)" ./gradlew assembleRelease` in `android/`. Without those variables `assembleRelease` makes an unsigned APK.

## History
0.0.1.0 (2026-10-27): the first public release, and the repository's first commit (see [[Decisions]]); the first with the signed APK. Version numbers from 0.3.5.0 to 0.5.0.1 in these notes are from the project's private development before then.
