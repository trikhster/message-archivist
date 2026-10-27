// Builds dist/message-archivist-extension-vP.M.m.p.zip from the extension folder,
// ready for a GitHub release or the Chrome Web Store, and prints its SHA-256.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const EXT = 'extension';
const { version } = JSON.parse(readFileSync(`${EXT}/manifest.json`, 'utf8'));
mkdirSync('dist', { recursive: true });
const out = resolve(`dist/message-archivist-extension-v${version}.zip`);
if (existsSync(out)) rmSync(out);

// -X leaves out macOS extra attributes; manifest.json ends up at the zip root,
// which is what the Chrome Web Store expects.
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', '.*', '*/.*', '__MACOSX/*'], { cwd: EXT, stdio: 'inherit' });
// The license and attributions travel with every copy (Apache-2.0 section 4).
execFileSync('zip', ['-j', '-X', '-q', out, 'LICENSE', 'NOTICE'], { stdio: 'inherit' });

const sha = createHash('sha256').update(readFileSync(out)).digest('hex');
console.log(`✓ ${out}\n  SHA-256 ${sha}`);
