// Gate: keep the English-kept terms English and catch translation damage.
// Run: node tools/check-keep.mjs        (also via `npm run check-keep`)
//
// Checks every locale/<lang>/*.json against the English baseline:
//   A. placeholders survive unchanged
//   B. product names and protocol names survive unchanged
//   C. no Chinese/Japanese characters outside the CJK languages
//   D. no em dashes or en dashes
//   E. no empty values, no keys outside the baseline
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(join(root, 'tools', 'en.baseline.json'), 'utf8'));
const policy = JSON.parse(readFileSync(join(root, 'locale', '_policy', 'keep-english.json'), 'utf8'));

const CJK_LANGS = new Set(['ja', 'zh-tw', 'zh-hk']);
const PLACEHOLDER = /\{[A-Za-z0-9_.]+\}/g;
const CJK = /[\u4e00-\u9fff\u3040-\u30ff]/;
const DASH = /[—–]/;

const MUST_KEEP = [
  'DeepSeek Harness', 'DSH', 'Cordis', 'MCP', 'JSON Schema', 'JSONL', 'JSON', 'YAML',
  'CLI', 'API', 'URL', 'SDK', 'LLM', 'KV Cache', 'Function Calling', 'TTFT',
  'OpenAI Chat Completions', 'OpenAI Responses', 'Anthropic Messages',
];

const localeRoot = join(root, 'locale');
const langs = readdirSync(localeRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_policy')
  .map((d) => d.name)
  .sort();

const hard = [];
const soft = [];
const summary = [];

const tokenIn = (haystack, needle) =>
  new RegExp(`(^|[^\\w-])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`).test(haystack);

for (const lang of langs) {
  const dir = join(localeRoot, lang);
  let keys = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const ns = basename(file, '.json');
    const dict = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const [key, value] of Object.entries(dict)) {
      keys += 1;
      const en = baseline[ns]?.[key];
      const where = `${lang}/${ns}.${key}`;
      if (en === undefined) {
        soft.push(`${where}: 기준선에 없는 키`);
        continue;
      }
      if (typeof value !== 'string' || (!value.trim() && en.trim())) {
        hard.push(`${where}: 빈 값`);
        continue;
      }
      const srcPh = (en.match(PLACEHOLDER) || []).sort().join(',');
      const dstPh = (value.match(PLACEHOLDER) || []).sort().join(',');
      if (srcPh !== dstPh) hard.push(`${where}: 플레이스홀더 불일치 (${srcPh} → ${dstPh})`);
      if (!CJK_LANGS.has(lang) && CJK.test(value)) hard.push(`${where}: 한자·가나 혼입`);
      // 줄표 금지는 한국어 문장 규칙이므로 한국어에서만 실패로 잡는다.
      if (DASH.test(value)) (lang === 'ko' ? hard : soft).push(`${where}: 줄표 사용`);
      for (const term of MUST_KEEP) {
        if (tokenIn(en, term) && !value.includes(term)) hard.push(`${where}: 식별자 소실 "${term}"`);
      }
    }
  }
  summary.push([lang, keys]);
}

console.log('언어별 키 수');
for (const [lang, keys] of summary) console.log(`  ${lang}: ${keys}`);
console.log(`\n기준선 ${Object.keys(baseline).length} 네임스페이스, ${Object.values(baseline).reduce((n, d) => n + Object.keys(d).length, 0)}키`);
if (soft.length) {
  console.log(`\n경고 ${soft.length}건`);
  for (const line of soft.slice(0, 20)) console.log('  ' + line);
  if (soft.length > 20) console.log(`  ... 그 외 ${soft.length - 20}건`);
}
if (hard.length) {
  console.log(`\n실패 ${hard.length}건`);
  for (const line of hard.slice(0, 40)) console.log('  ' + line);
  if (hard.length > 40) console.log(`  ... 그 외 ${hard.length - 40}건`);
  console.error(`\nkeep check failed: ${hard.length}`);
  process.exit(1);
}
console.log('\nkeep check passed');
