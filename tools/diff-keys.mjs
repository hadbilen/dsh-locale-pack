// List keys present in English but missing in Korean (post-upgrade helper).
// Run: node tools/diff-keys.mjs [en-json]
//   en-json defaults to the newest tools/en.*.json (see extract-en.mjs).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [, , arg] = process.argv;
const enFile =
  arg ??
  readdirSync(join(root, 'tools'))
    .filter((f) => /^en\..*\.json$/.test(f))
    .sort()
    .map((f) => join(root, 'tools', f))
    .at(-1);
if (!enFile) {
  console.error('no tools/en.*.json — run: node tools/extract-en.mjs');
  process.exit(1);
}
const en = JSON.parse(readFileSync(enFile, 'utf8'));
const koFiles = Object.fromEntries(
  readdirSync(join(root, 'locale', 'ko'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => [basename(f, '.json'), JSON.parse(readFileSync(join(root, 'locale', 'ko', f), 'utf8'))]),
);
let missing = 0;
for (const [ns, dict] of Object.entries(en)) {
  const ko = koFiles[ns] ?? {};
  const fresh = Object.keys(dict).filter((k) => !(k in ko));
  if (fresh.length) {
    missing += fresh.length;
    console.log(`## ${ns} — ${fresh.length} missing`);
    for (const k of fresh) console.log(`  ${k} = ${JSON.stringify(dict[k]).slice(0, 120)}`);
  }
  // keys we translated but upstream removed
  const stale = Object.keys(ko).filter((k) => !(k in dict));
  if (stale.length) console.log(`## ${ns} — ${stale.length} stale (upstream removed): ${stale.join(', ')}`);
}
console.log(missing ? `\n${missing} keys need translation.` : '\nNo missing keys — Korean is complete for this build.');
