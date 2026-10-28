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
  // A pattern ("modules/*.js") must match a file; anything else must be one.
  const matches = (f) => {
    if (!f.includes('*')) return existsSync(join(EXT, f));
    const dir = f.slice(0, f.lastIndexOf('/') + 1);
    const re = new RegExp(`^${f.slice(dir.length).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    return existsSync(join(EXT, dir)) && readdirSync(join(EXT, dir)).some((n) => re.test(n));
  };
  for (const f of new Set(referenced)) if (!matches(f)) fail(`manifest references missing file: ${f}`);
}

// Pages must load only files that exist (extension pages can't run inline scripts).
for (const page of readdirSync(EXT).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(EXT, page), 'utf8');
  // An empty or script-less page passes everything else and shows nothing.
  if (!html.trim()) { fail(`${page} is empty`); continue; }
  if (!/<script[^>]+\bsrc="[^"]+\.js"/.test(html)) fail(`${page} loads no script`);
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html)) fail(`${page} has an inline <script>; Chrome blocks those in extension pages`);
  for (const [, src] of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^":#]+\.(?:js|css))"/g)) {
    if (src !== 'data.js' && !existsSync(join(EXT, src))) fail(`${page} loads missing file: ${src}`);
  }
}

// Every app module (modules/<app>.js) must be loaded wherever the archive is
// read or written: Settings, the viewer (and so the backup folder's
// index.html and the app), and the Messages page's content script. Adding an
// app is one file, then a line in each of these.
const appModules = readdirSync(join(EXT, 'modules')).filter((f) => f.endsWith('.js')).map((f) => `modules/${f}`);
const contentScript = new Set((manifest?.content_scripts || []).flatMap((c) => c.js || []));
for (const page of ['options.html', 'viewer.html']) {
  const html = readFileSync(join(EXT, page), 'utf8');
  for (const m of appModules) if (!html.includes(`<script src="${m}"></script>`)) fail(`${page} doesn't load the app module ${m} (add <script src="${m}"></script> after library.js)`);
}
for (const m of appModules) if (!contentScript.has(m)) fail(`manifest.json's content script doesn't load the app module ${m} (add it after library.js)`);
// An app's web page reader (a module's `web.script`, in web/) is registered
// by Settings when it's turned on, so the file has to be there.
const webReaders = existsSync(join(EXT, 'web')) ? readdirSync(join(EXT, 'web')).filter((f) => f.endsWith('.js')).map((f) => `web/${f}`) : [];
for (const m of appModules) {
  const script = readFileSync(join(EXT, m), 'utf8').match(/\bweb:\s*\{[^}]*\bscript:\s*'([^']+)'/)?.[1];
  if (script && !webReaders.includes(script)) fail(`${m} names a web page reader that isn't there: ${script}`);
}

// Syntax-check every script.
const scripts = [...readdirSync(EXT).filter((f) => f.endsWith('.js')).map((f) => join(EXT, f)), ...appModules.map((f) => join(EXT, f)), ...webReaders.map((f) => join(EXT, f)), ...readdirSync('scripts').map((f) => join('scripts', f)), ...readdirSync('app').filter((f) => f.endsWith('.js')).map((f) => join('app', f))];

// The app (app/, built by scripts/build-app.mjs): its manifest must be valid JSON.
try { JSON.parse(readFileSync(join('app', 'manifest.webmanifest'), 'utf8')); } catch (e) { fail(`app/manifest.webmanifest is not valid JSON: ${e.message}`); }
for (const f of scripts) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail(`syntax error in ${f}:\n${e.stderr.toString().trim()}`);
  }
}

// The code map (notes/Code map.canvas) should match the code; a warning, not a failure.
try {
  execFileSync(process.execPath, ['scripts/code-map.mjs', '--check'], { stdio: 'pipe' });
} catch {
  console.warn('! notes/Code map.canvas is out of date (or a feature points at code that\'s gone): run npm run code-map');
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`✓ Message Archivist extension v${manifest.version}: manifest, ${scripts.length} scripts and all referenced files OK`);
