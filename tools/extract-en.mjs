// Dump English dictionaries from the INSTALLED DSH build (upgrade helper).
// Run: node tools/extract-en.mjs
// Output: tools/en.<version>.json  (namespace -> {key: en text})
// Use with diff-keys.mjs after a DSH upgrade to find new untranslated keys.
//
// Method: regex over the LAST `const en = {…}` block per client bundle
// (string-literal values only — both "quoted" and bare keys). Dicts that
// build values from in-file constants (spreads/identifiers) contribute only
// their literal entries; product-name maps shared verbatim across languages
// are intentionally left out (ko ships them unchanged).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function asarRoot() {
  // Installed location of the running DSH build.
  const base = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar');
  if (!existsSync(base)) throw new Error(`app.asar not found: ${base}`);
  const tmp = join(process.env.TEMP ?? '.', 'dsh-asar');
  if (!existsSync(join(tmp, 'dsh'))) {
    console.log('extracting app.asar (one-time, ~1min)…');
    execSync(`asar extract "${base}" "${tmp}"`, { stdio: 'inherit' });
  }
  return tmp;
}

function blockAfter(src, marker) {
  const start = src.lastIndexOf(marker);
  if (start < 0) return null;
  const i = src.indexOf('{', start);
  let depth = 0, end = -1, inS = null, esc = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inS) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inS) inS = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  return end < 0 ? null : src.slice(i, end + 1);
}

const PAIR = /(?:\"((?:[^\"\\\n]|\\.)*)\"|([A-Za-z_$][\w$]*))\s*:\s*\"((?:[^\"\\\n]|\\.)*)\"/g;

function stringPairs(block) {
  const out = {};
  let m;
  PAIR.lastIndex = 0;
  while ((m = PAIR.exec(block)) !== null) {
    const k = m[1] !== undefined ? m[1] : m[2];
    if (k.trim() === '') continue;
    try {
      out[k] = JSON.parse('"' + m[3] + '"');
    } catch { /* keep going */ }
  }
  return out;
}

const tmp = asarRoot();
const pkgs = join(tmp, 'dsh', 'node_modules', '@deepseek-ai');
const result = {};
let files = 0;

// 1) canonical `const NS = "…" + const en = {…}` plugins
for (const name of readdirSync(pkgs)) {
  const client = join(pkgs, name, 'lib', 'client.js');
  if (!existsSync(client)) continue;
  const src = readFileSync(client, 'utf8');
  const nsMatch = /const NS = "([^"]+)"/.exec(src);
  if (!nsMatch) continue;
  const block = blockAfter(src, 'const en = {');
  if (!block) continue;
  const pairs = stringPairs(block);
  if (Object.keys(pairs).length) {
    result[nsMatch[1]] = pairs;
    files++;
  }
}

// 2) plugins with `const namespace = "…"` (terminal/browser seats)
for (const [file, ns] of [
  ['dsh-client-ui-sidebar-terminal', 'sidebarTerminal'],
  ['dsh-client-ui-sidebar-browser', 'sidebarBrowser'],
]) {
  const client = join(pkgs, file, 'lib', 'client.js');
  if (!existsSync(client)) continue;
  const block = blockAfter(readFileSync(client, 'utf8'), 'const en = {');
  if (!block) continue;
  const pairs = stringPairs(block);
  if (Object.keys(pairs).length) {
    result[ns] = pairs;
    files++;
  }
}

// 3) literal-namespace registrations and non-NS const dicts
for (const [file, marker, ns] of [
  ['dsh-client-ui-settings-account', 'const en = {', 'settings.account'],
  ['dsh-client-ui-agent-preset', 'const en = {', 'settings.agentPreset'],
  ['dsh-client-ui-theme', 'const en = {', 'settings.theme'],
  ['dsh-client-ui-settings-session-log', 'const en = {', 'settings.sessionLog'],
  ['dsh-client-ui-permission-presets', 'const accessEn = {', 'permission.access'],
  ['dsh-client-ui-permission-presets', 'const en = {', 'settings.permission'],
  ['dsh-client-ui-shortcuts', 'const en = {', 'shortcuts'],
  ['dsh-client-locale', 'const en$1 = {', 'common'],
]) {
  const client = join(pkgs, file, 'lib', 'client.js');
  if (!existsSync(client)) continue;
  const block = blockAfter(readFileSync(client, 'utf8'), marker);
  if (!block) continue;
  const pairs = stringPairs(block);
  if (Object.keys(pairs).length) {
    result[ns] = pairs;
    files++;
  }
}

// 4) settings.agentPreset: en spreads guideEn (markdown guides built with
// .join), so regex misses them — evaluate the two consts together instead.
{
  const client = join(pkgs, 'dsh-client-ui-agent-preset', 'lib', 'client.js');
  if (existsSync(client)) {
    const src = readFileSync(client, 'utf8');
    const guide = blockAfter(src, 'const guideEn = {');
    const enBlock = blockAfter(src, 'const en = {');
    if (guide && enBlock) {
      try {
        const obj = new Function(`${'const guideEn = ' + guide};\nreturn (${enBlock});`)();
        const flat = Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === 'string'));
        if (Object.keys(flat).length) {
          result['settings.agentPreset'] = flat;
          files++;
        }
      } catch { /* keep going */ }
    }
  }
}

const version = JSON.parse(readFileSync(join(tmp, 'dsh', 'package.json'), 'utf8')).version ?? 'unknown';
const out = join(root, 'tools', `en.${version}.json`);
writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
const keys = Object.values(result).reduce((n, o) => n + Object.keys(o).length, 0);
console.log(`DSH ${version}: ${files} files, ${Object.keys(result).length} namespaces, ${keys} keys -> ${out}`);
