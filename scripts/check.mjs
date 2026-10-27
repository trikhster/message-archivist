// Checks the extension before packaging: script syntax, manifest validity,
// referenced files, and that package.json and manifest.json agree on the version.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXT = 'extension';
const errors = [];
const fail = (msg) => errors.push(msg);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
} catch (e) {
  fail(`manifest.json is not valid JSON: ${e.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  // Four parts, production.major.minor.patch (0 until the first production release).
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(manifest.version)) fail(`manifest version "${manifest.version}" must be P.M.m.p (four numbers)`);
  if (manifest.version !== pkg.version) fail(`version mismatch: package.json ${pkg.version}, manifest.json ${manifest.version} (run: npm run set-version -- ${pkg.version})`);
  const app = readFileSync('android/app/build.gradle.kts', 'utf8').match(/versionName = "([^"]*)"/)?.[1];
  if (app !== pkg.version) fail(`version mismatch: package.json ${pkg.version}, the Android app ${app} (run: npm run set-version -- ${pkg.version})`);

  // Every file the manifest points at must exist.
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources),
  ].filter(Boolean);
  for (const f of new Set(referenced)) if (!existsSync(join(EXT, f))) fail(`manifest references missing file: ${f}`);
}

// Pages must load only files that exist (extension pages can't run inline scripts).
for (const page of readdirSync(EXT).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(EXT, page), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html)) fail(`${page} has an inline <script>; Chrome blocks those in extension pages`);
  for (const [, src] of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^":#]+\.(?:js|css))"/g)) {
    if (src !== 'data.js' && !existsSync(join(EXT, src))) fail(`${page} loads missing file: ${src}`);
  }
}

// Syntax-check every script.
const scripts = [...readdirSync(EXT).filter((f) => f.endsWith('.js')).map((f) => join(EXT, f)), ...readdirSync(join(EXT, 'importers')).filter((f) => f.endsWith('.js')).map((f) => join(EXT, 'importers', f)), ...readdirSync('scripts').map((f) => join('scripts', f))];
for (const f of scripts) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail(`syntax error in ${f}:\n${e.stderr.toString().trim()}`);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`✓ Message Archivist extension v${manifest.version}: manifest, ${scripts.length} scripts and all referenced files OK`);
