// Self-update check: compare the INSTALLED plugin against the latest
// GitHub release. Run: node tools/self-update.mjs [--apply]
//   (default) report only. --apply attempts the documented update command.
// Requires package.json repository.url to point at the real repo
// (still "<계정>" placeholder = not published yet -> exits 3).
//
// Why not silent auto-update: installed Host code runs outside the sandbox,
// so updates must stay an explicit user action. This checker is meant for a
// scheduler (Windows Task Scheduler / DSH schedule): notify on new release,
// apply with --apply only where you already trust the source.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const repoUrl = manifest.repository?.url ?? '';
const slugMatch = /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?/i.exec(repoUrl);
if (!slugMatch) {
  console.log('Not published yet: set package.json repository.url to the real GitHub repo first.');
  process.exit(3);
}
const slug = slugMatch[1];
const local = manifest.version;
console.log(`local plugin: ${local} (${root})`);

let latest;
try {
  const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-ko-locale' },
  });
  if (res.status === 404) {
    console.log(`No releases yet at github.com/${slug}. Publish a release (tag v${local}) first.`);
    process.exit(3);
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  latest = (await res.json()).tag_name.replace(/^v/, '');
} catch (error) {
  console.error(`Release check failed (offline?): ${error.message}`);
  process.exit(1);
}
console.log(`latest release: ${latest}`);

const cmp = latest.localeCompare(local, undefined, { numeric: true });
if (cmp <= 0) {
  console.log('OK — already up to date.');
  process.exit(0);
}

const cmd = `dsh plugin --profile desktop add github:${slug}#v${latest}`;
console.log(`\nUpdate available: ${local} -> ${latest}`);
console.log(`Run: ${cmd}`);
if (!process.argv.includes('--apply')) {
  console.log('(report only; re-run with --apply to attempt it now)');
  process.exit(2);
}
try {
  execSync(cmd, { stdio: 'inherit', shell: true });
  console.log('Update applied. Restart DSH, then check Settings → General → Language.');
} catch {
  console.error('Could not run the update automatically (is `dsh` on PATH?). Run the command above by hand.');
  process.exit(1);
}
