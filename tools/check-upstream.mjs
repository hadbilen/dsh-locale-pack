// Upstream check: compare the INSTALLED DSH build against SUPPORTED_DSH.json.
// Run: node tools/check-upstream.mjs
// Exit 0 = supported build. Exit 2 = DSH moved ahead; a maintenance report
// follows (run extract + diff, then translate the listed keys).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const supported = JSON.parse(readFileSync(join(root, 'SUPPORTED_DSH.json'), 'utf8'));

function installedVersion() {
  const base = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar');
  if (!existsSync(base)) throw new Error(`app.asar not found: ${base}`);
  // desktop-runtime.json sits inside the asar next to dsh/package.json.
  // Reuse the already-extracted copy when present, else read via asar CLI.
  const tmpPkg = join(process.env.TEMP ?? '.', 'dsh-asar', 'dsh', 'package.json');
  if (existsSync(tmpPkg)) {
    return JSON.parse(readFileSync(tmpPkg, 'utf8')).version;
  }
  const out = execSync(`asar list "${base}"`, { encoding: 'utf8' });
  if (!out.includes('dsh')) throw new Error('dsh payload not found in app.asar');
  const tmp = join(process.env.TEMP ?? '.', 'dsh-asar');
  execSync(`asar extract "${base}" "${tmp}"`, { stdio: 'inherit' });
  return JSON.parse(readFileSync(join(tmp, 'dsh', 'package.json'), 'utf8')).version;
}

const installed = installedVersion();
console.log(`installed DSH: ${installed}`);
console.log(`supported DSH: ${supported.dsh} (${supported.translatedKeys}/${supported.keys} keys)`);
if (installed === supported.dsh) {
  console.log('OK — this build is covered. Nothing to do.');
  process.exit(0);
}

console.log(`\nDSH moved from ${supported.dsh} to ${installed}. Refreshing baselines…`);
execSync('node tools/extract-en.mjs', { cwd: root, stdio: 'inherit' });
console.log('\nMissing translations for the new build:');
try {
  execSync(`node tools/diff-keys.mjs tools/en.${installed}.json`, { cwd: root, stdio: 'inherit' });
} catch {
  /* diff-keys exits non-zero output only; continue to the instructions */
}
console.log(`
Next steps:
  1. Translate the keys listed above into locale/ko/<ns>.json
     (keep {placeholders} byte-identical; leave product names in English).
  2. node tools/build-client.mjs && node tools/smoke.mjs
  3. Update SUPPORTED_DSH.json (dsh/namespaces/keys/translated counts/date),
     CHANGELOG.md, and package.json version.
  4. Restart DSH to apply. To ship it: git tag + GitHub release
     (see README "배포·업데이트").`);
process.exit(2);
