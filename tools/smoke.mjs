// Smoke test: load the built client bundle against a stub locale runtime
// that mirrors the real LocaleRuntime contract (addLanguage/register/bind
// with en fallback). Run: node tools/smoke.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'lib', 'client.js'), 'utf8');

const fail = (msg) => { throw new Error(msg); };
const expect = (cond, msg) => { if (!cond) fail(msg); };

// --- minimal ModuleLoader stub ---
let captured;
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m; } } };
(0, eval)(src);
expect(captured?.id === 'dsh-locale-pack', 'bundle id mismatch: ' + captured?.id);
const { apply, inject } = captured.factory(() => { fail('no requires expected'); });
expect(JSON.stringify(inject) === JSON.stringify(['locale']), 'inject must be ["locale"]');

// --- what the bundle claims to ship ---
const LANGS = JSON.parse(src.match(/const LANGS = (\[[\s\S]*?\n\]);/)[1]);
const DICTS = JSON.parse(src.match(/const DICTS = (\{[\s\S]*\n\});/)[1]);
expect(LANGS.length >= 2, 'bundle must ship at least 2 languages');
console.log(`bundle: ${LANGS.length} languages, ${Object.values(DICTS).reduce((n, d) => n + Object.keys(d).length, 0)} namespace registrations`);

// --- minimal locale runtime stub (en fallback like the real one) ---
const catalog = new Map([['en', { id: 'en' }]]);
const dicts = new Map([
  ['common', new Map([['en', { ok: 'OK', 'fmt.name': 'Hello {name}' }]])],
]);
const locale = {
  addLanguage: (input) => {
    if (catalog.has(input.id)) throw new Error(`locale "${input.id}" is already registered`);
    catalog.set(input.id, input);
    return () => {};
  },
  register: (ns, pairs) => {
    let m = dicts.get(ns);
    if (!m) { m = new Map(); dicts.set(ns, m); }
    for (const [l, d] of Object.entries(pairs)) {
      if (m.has(l)) throw new Error(`locale namespace "${ns}" already has locale "${l}"`);
      m.set(l, d);
    }
    return () => {};
  },
  bind: (ns) => (key, params) => {
    for (const l of ['ja', 'ko', 'en']) {
      const v = dicts.get(ns)?.get(l)?.[key];
      if (v !== undefined) return params ? v.replace(/\{(\w+)\}/g, (mm, n) => (n in params ? String(params[n]) : mm)) : v;
    }
    return key;
  },
};

const ctx = { effect: (fn) => fn(), locale };
apply(ctx);

// 1. every language in the bundle is registered with an en fallback
for (const { id, label } of LANGS) {
  const entry = catalog.get(id);
  expect(entry, `language ${id} was not registered`);
  expect(entry.label === label, `language ${id} label mismatch`);
  expect(entry.fallback === 'en', `language ${id} must fall back to en`);
}

// 2. every namespace of every language landed in the runtime
for (const [lang, namespaces] of Object.entries(DICTS)) {
  for (const ns of Object.keys(namespaces)) {
    expect(dicts.get(ns)?.get(lang), `${lang}/${ns} was not registered`);
    expect(Object.keys(dicts.get(ns).get(lang)).length > 0, `${lang}/${ns} is empty`);
  }
}

// 3. lookup falls back to English for keys a language does not carry
const bind = locale.bind('common');
expect(bind('ok') === 'OK', 'en fallback lookup failed');
expect(bind('fmt.name', { name: 'Ana' }) === 'Hello Ana', 'param substitution failed');

// 4. double load is idempotent (duplicate registration is swallowed)
apply(ctx);
console.log('double-load OK (idempotent)');

console.log(`smoke OK — ${LANGS.length} languages verified`);
