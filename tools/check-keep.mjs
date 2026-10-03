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

// keep-english 정책의 용어를 두 갈래로 나눈다.
//   PRODUCT_TERMS  : 제품명·파일 형식·프로토콜명. 값 안 어디에든 영어로 남는 것이 맞다.
//   TOOL_NAMES     : 도구 이름. 그 자체가 값일 때만 영어로 두고, 더 긴 문구에 들어가면 번역한다.
//                    예) 값이 "Read" → 유지. 원문 "Read Only"인데 번역 "Read Saja" → 오류.
const ALL_TERMS = [
  ...(policy.ui?.terms ?? []),
  ...(policy.upstreamDocs?.englishKept ?? []),
  ...(policy.upstreamDocs?.abbreviations ?? []),
];
const TOOL_NAMES = new Set([
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Finder', 'Terminal', 'File Explorer', 'Files', 'Bash', 'PowerShell', 'cmd',
]);
const PRODUCT_TERMS = new Set(ALL_TERMS.filter((t) => !TOOL_NAMES.has(t)));

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

      // F. 도구 이름이 더 긴 문구에 남은 것.
      //    도구 이름은 '그 자체가 값'일 때만 영어로 둔다. 문구 안에 들어가면 함께 번역한다.
      if (value !== en.trim()) {
        for (const m of value.matchAll(/[A-Za-z][A-Za-z-]{2,}/g)) {
          const word = m[0];
          if (!TOOL_NAMES.has(word)) continue;
          if (en.trim() === word || en.trim() === word + '.') continue;
          if (!tokenIn(en, word)) continue;
          // Read/Write/Edit는 번역해야 하는 동사라 남으면 오류.
          // Terminal/Files는 여러 언어에서 빌려 쓰므로 경고로만 둔다.
          const line = `${where}: 도구 이름이 문구에 남음 "${word}"`;
          (['Read', 'Write', 'Edit'].includes(word) ? hard : soft).push(line);
        }
      }
    }
  }
  summary.push([lang, keys]);
}

// G. 조각 짝 검사.
//    이름이 Prefix/Suffix로 끝나는 키는 짝과 이어 붙여 한 문장이 된다.
//    조각만 떼어 놓고 판단하면 고친 자리에서 문장이 다시 깨진다.
//    여기서는 짝을 합친 결과를 눈으로 읽을 수 있게 출력한다.
{
  const pairs = new Map(); // stem -> {prefix: {lang: val}, suffix: {lang: val}}
  for (const lang of langs) {
    const dir = join(localeRoot, lang);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const ns = basename(file, '.json');
      const dict = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      for (const [key, value] of Object.entries(dict)) {
        const m = key.match(/^(.*)(Prefix|Suffix)$/);
        if (!m) continue;
        const stem = `${ns}.${m[1]}`;
        const side = m[2].toLowerCase();
        if (!pairs.has(stem)) pairs.set(stem, { prefix: {}, suffix: {} });
        pairs.get(stem)[side][lang] = value;
      }
    }
  }
  if (pairs.size) {
    console.log(`\n조각 짝 ${pairs.size}묶음 (합쳐 읽을 것)`);
    for (const [stem, sides] of pairs) {
      const langsIn = new Set([...Object.keys(sides.prefix), ...Object.keys(sides.suffix)]);
      for (const lang of [...langsIn].sort()) {
        if (!(sides.prefix[lang] ?? '').trim() && !(sides.suffix[lang] ?? '').trim()) continue;
        const p = sides.prefix[lang] ?? '(없음)';
        const s2 = sides.suffix[lang] ?? '(없음)';
        const joined = (sides.prefix[lang] ?? '') + (sides.suffix[lang] ?? '');
        const hasP = sides.prefix[lang] !== undefined;
        const hasS = sides.suffix[lang] !== undefined;
        const warn = (!hasP || !hasS)
          ? ((p !== '' && p !== '(없음)') || (s2 !== '' && s2 !== '(없음)') ? '  ← 짝 없음' : '')
          : (joined.includes('  ') ? '  ← 이중 공백' : '');
        console.log(`  [${lang}] ${stem}`);
        console.log(`      ${JSON.stringify(p)} + ${JSON.stringify(s2)}`);
        console.log(`      → ${JSON.stringify(joined)}${warn}`);
      }
    }
  }
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
