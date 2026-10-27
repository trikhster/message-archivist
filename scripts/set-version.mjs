// Sets the version everywhere it's written: package.json, the extension's
// manifest, and the Android app (versionName, and a versionCode that grows
// with it). Versions have four parts, production.major.minor.patch; the first
// is 0 until the first production release.
//   npm run set-version -- 0.0.2.0
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2] || '';
if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run set-version -- P.M.m.p   (four numbers, e.g. 0.0.2.0)');
  process.exit(1);
}
const [p, major, minor, patch] = version.split('.').map(Number);
if ([major, minor, patch].some((x) => x > 99)) {
  console.error('Major, minor and patch go up to 99 (they share the Android versionCode).');
  process.exit(1);
}
// 0.0.1.0 → 100, 0.1.0.0 → 10000: always higher for a later version, so phones take it as an update.
const code = p * 1_000_000 + major * 10_000 + minor * 100 + patch;

const edit = (file, change) => {
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  if (after !== before) writeFileSync(file, after);
  console.log(`${file} → ${version}`);
};
edit('package.json', (s) => s.replace(/"version": "[^"]*"/, `"version": "${version}"`));
edit('extension/manifest.json', (s) => s.replace(/"version": "[^"]*"/, `"version": "${version}"`));
edit('android/app/build.gradle.kts', (s) => s.replace(/versionCode = \d+/, `versionCode = ${code}`).replace(/versionName = "[^"]*"/, `versionName = "${version}"`));
