// Spell checking in the background, so loading a big dictionary (Swedish is ~2 MB) never freezes typing.
// Bundled to public/vendor/spell-worker.js by `npm run build`. Dictionaries live in public/dict/<lang>.aff/.dic.
import nspell from 'nspell';

const spellers = {}; // lang -> nspell instance
const loading = {}; // lang -> promise

function load(lang) {
  if (spellers[lang]) return Promise.resolve(spellers[lang]);
  loading[lang] ??= Promise.all(
    ['aff', 'dic'].map((ext) => fetch(new URL(`../dict/${lang}.${ext}`, self.location)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status)))))
  ).then(([aff, dic]) => {
    // The Swedish dictionary's compound rules make nspell accept any string at all, so they're dropped here
    // and Swedish compound words are checked by `compound` below instead
    if (lang === 'sv') aff = aff.split('\n').filter((l) => !/^(COMPOUNDRULE|COMPOUNDMIN)\b/.test(l)).join('\n');
    return (spellers[lang] = nspell(aff, dic));
  });
  return loading[lang];
}

// Swedish joins words freely: föreningsformer = förening + s + former, företrädaransvar = företrädar(e) + ansvar.
// A word counts as right if it splits into known words (each at least 4 letters), the first part optionally
// with a joining -s or a dropped -e, up to 3 parts.
function compound(sp, w, depth = 0) {
  const lower = w.toLowerCase();
  for (let i = 4; i <= lower.length - 4; i++) {
    const left = lower.slice(0, i);
    const right = lower.slice(i);
    const leftOk =
      sp.correct(left) ||
      (left.endsWith('s') && left.length > 3 && sp.correct(left.slice(0, -1))) ||
      sp.correct(left + 'e') ||
      (left.endsWith('ie') && sp.correct(left.slice(0, -1) + 'um')); // gymnasie- (gymnasium)
    if (!leftOk) continue;
    if (sp.correct(right) || (depth < 1 && compound(sp, right, depth + 1))) return true;
  }
  return false;
}

const ok = (word, langs) => langs.some((l) => spellers[l]?.correct(word)) || (langs.includes('sv') && spellers.sv && word.length >= 8 && compound(spellers.sv, word));

self.onmessage = async ({ data }) => {
  const langs = (data.langs || []).filter((l) => /^[a-z]{2}$/.test(l));
  try {
    await Promise.all(langs.map(load));
  } catch {
    self.postMessage({ type: 'error', id: data.id });
    return;
  }
  if (data.type === 'check') {
    // A word counts as right if any chosen language knows it (also with a lower-case first letter,
    // since sentences start with a capital)
    const results = data.words.map((w) => ok(w, langs) || (w[0] !== w[0].toLowerCase() && ok(w[0].toLowerCase() + w.slice(1), langs)));
    self.postMessage({ type: 'checked', id: data.id, words: data.words, results });
  } else if (data.type === 'suggest') {
    const seen = new Set();
    const out = [];
    for (const l of langs) for (const s of spellers[l]?.suggest(data.word) || []) if (!seen.has(s)) { seen.add(s); out.push(s); }
    self.postMessage({ type: 'suggested', id: data.id, word: data.word, suggestions: out.slice(0, 7) });
  } else if (data.type === 'load') {
    self.postMessage({ type: 'ready', id: data.id });
  }
};
