// Builds dict/jmdict.json (Japanese word -> short English gloss) from JMdict.
//
//   node tools/build-dict.js [path/to/JMdict_e.gz]
//
// Without an argument it downloads the latest JMdict_e.gz from EDRDG.
// JMdict is property of the EDRDG, used under CC BY-SA 4.0: https://www.edrdg.org/edrdg/licence.html
// The licence requires regular updates: rebuild for every release and at least every three months.
//
// Output: { "<written form>": "reading|score|posMask|gloss|posMask|gloss^reading|score|..." }
// One "^"-separated candidate per (entry, reading); reading is hiragana, empty when it equals the key.
// Senses are kept only when they add a new part of speech, so the runtime can pick the sense
// matching the tokenizer's part of speech. Values are plain strings to keep memory use low.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const URL = 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz';
const OUT = path.join(__dirname, '..', 'dict', 'jmdict.json');

// Part-of-speech bits, shared with src/background.js
const N = 1, V = 2, A = 4, NA = 8, ADV = 16, PN = 32, INT = 64, CONJ = 128, EXP = 256, PRT = 512, SUF = 1024, PREF = 2048;

function posMask(p) {
  if (p === 'vi' || p === 'vt') return 0; // transitivity markers, not a POS
  if (/^v/.test(p)) return V;
  if (/^(adj-i|adj-ix|adj-ku|adj-shiku|adj-kari|aux-adj)$/.test(p)) return A;
  if (/^(adj-na|adj-nari|adj-t)$/.test(p)) return NA;
  if (/^(adj-pn|adj-f)$/.test(p)) return PN;
  if (/^(adv|adv-to)$/.test(p)) return ADV;
  if (/^(n-adv|n-t)$/.test(p)) return N | ADV;
  if (p === 'n-pref') return N | PREF;
  if (p === 'n-suf') return N | SUF;
  if (/^(n|n-pr|pn|num|adj-no)$/.test(p)) return N;
  if (p === 'pref') return PREF;
  if (p === 'suf') return SUF;
  if (p === 'ctr') return N | SUF; // counters
  if (p === 'int') return INT;
  if (p === 'conj') return CONJ;
  if (p === 'exp') return EXP;
  if (/^(prt|aux|aux-v|cop)/.test(p)) return PRT;
  return 0;
}

function priority(tags) {
  let s = 0;
  for (const t of tags) {
    if (/^(news1|ichi1|spec1|spec2|gai1)$/.test(t)) s += 20;
    else if (/^(news2|ichi2|gai2)$/.test(t)) s += 5;
    else if (/^nf\d\d$/.test(t)) s += 50 - Number(t.slice(2)); // newspaper frequency band, 01 = most frequent
  }
  return s;
}

// Very common words whose first JMdict sense is dated or misleading in modern text, and common
// kana-written verbs whose homophones (要る, 生る...) would otherwise win the ranking.
const OVERRIDES = {
  凄い: 'amazing', すごい: 'amazing', 大丈夫: 'all right', 本当: 'true', ほんと: 'true',
  好き: 'like', 大好き: 'love', 優しい: 'kind', やさしい: 'kind', 問題: 'problem',
  美味しい: 'delicious', おいしい: 'delicious', 中止: 'cancellation', 提出: 'submission', 表示: 'display',
  ため: 'for', いける: 'be good', 肉: 'meat',
  // common on websites
  ホーム: 'home', 送信: 'send', 更新: 'update', 履歴: 'history', 閲覧: 'view', 複数: 'multiple', 改善: 'improvement',
  いる: 'be', なる: 'become', くる: 'come', みる: 'see', いく: 'go', ゆく: 'go', おく: 'put',
  しまう: 'finish', もらう: 'receive', くれる: 'give', あげる: 'give', いう: 'say', わかる: 'understand',
};

const hira = (s) => s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const unxml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]);
const all = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]);
const ents = (xml, tag) => all(xml, tag).map((v) => v.replace(/^&|;$/g, ''));

// Shorten a gloss for display above a word; wide glosses spread the Japanese text apart.
// "(one's) head" -> "head", "Japanese (language)" -> "Japanese", "to eat" -> "eat",
// "... years old" -> "years old"; "(not) at all" keeps its qualifier since it carries the meaning.
function cleanGloss(g, isVerb) {
  g = unxml(g);
  const stripped = g.replace(/\s*\((?!not\))[^()]*\)/g, '').trim();
  if (stripped) g = stripped;
  // "counter for years, grades" -> "years", but "counter for long, cylindrical things" stays whole
  if (/^counter for /.test(g)) g = g.slice(12).replace(/^(\w+s),.*/, '$1');
  g = g.replace(/\s*\.\.\.\s*/g, ' ');
  if (isVerb) g = g.replace(/^to /, '');
  return g.trim();
}

function pickGloss(glosses, isVerb) {
  // Prefer literal glosses over explanatory ones ("indicates ...")
  const ordered = [...glosses.filter((g) => !g.expl), ...glosses.filter((g) => g.expl)];
  const cleaned = ordered.map((g) => cleanGloss(g.text, isVerb)).filter(Boolean);
  const best = cleaned.find((g) => g.length <= 20) || cleaned.sort((a, b) => a.length - b.length)[0] || '';
  return best.replace(/[|^]/g, '/');
}

function parseEntry(xml) {
  const kanji = [...xml.matchAll(/<k_ele>([\s\S]*?)<\/k_ele>/g)].map(([, k]) => ({
    text: all(k, 'keb')[0],
    inf: ents(k, 'ke_inf'),
    pri: all(k, 'ke_pri'),
  }));
  const kana = [...xml.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/g)].map(([, r]) => ({
    text: all(r, 'reb')[0],
    noKanji: r.includes('<re_nokanji/>'),
    restr: all(r, 're_restr'),
    inf: ents(r, 're_inf'),
    pri: all(r, 're_pri'),
  }));
  let lastPos = [];
  const senses = [...xml.matchAll(/<sense>([\s\S]*?)<\/sense>/g)].map(([, s]) => {
    const pos = ents(s, 'pos');
    if (pos.length) lastPos = pos; // POS carries over to following senses
    const mask = lastPos.reduce((m, p) => m | posMask(p), 0);
    const misc = ents(s, 'misc');
    const glosses = [...s.matchAll(/<gloss( g_type="([^"]*)")?>([^<]*)<\/gloss>/g)].map((m) => ({ text: m[3], expl: m[2] === 'expl' }));
    return { mask, misc, stagk: all(s, 'stagk'), stagr: all(s, 'stagr'), gloss: pickGloss(glosses, mask & V && !(mask & N)) };
  });
  return { kanji, kana, senses };
}

// Keep senses that add a part of speech not already covered, skipping archaic ones when possible.
function senseList(senses) {
  const modern = senses.filter((s) => !s.misc.some((m) => m === 'arch' || m === 'obs'));
  const out = [];
  let covered = -1;
  for (const s of modern.length ? modern : senses) {
    if (!s.gloss) continue;
    if (out.length && !(s.mask & ~covered)) continue;
    covered = out.length ? covered | s.mask : s.mask;
    out.push(s.mask, s.gloss);
    if (out.length >= 6) break;
  }
  return out;
}

const BAD_FORM = /^(iK|ik|oK|ok|rK|rk|io)$/;

async function main() {
  let gz;
  if (process.argv[2]) gz = fs.readFileSync(process.argv[2]);
  else {
    console.log('Downloading', URL);
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    gz = Buffer.from(await res.arrayBuffer());
  }
  const xml = zlib.gunzipSync(gz).toString('utf8');
  const dict = Object.create(null);
  const add = (key, cand) => {
    if (cand[0] === hira(key)) cand[0] = '';
    if (OVERRIDES[key]) cand[3] = OVERRIDES[key];
    const list = (dict[key] ||= []);
    const same = list.find((c) => c[0] === cand[0] && c[3] === cand[3]);
    if (!same) list.push(cand);
    else if (cand[1] > same[1]) same[1] = cand[1];
  };

  let count = 0;
  for (const [, body] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const { kanji, kana, senses } = parseEntry(body);
    const tiebreak = Math.min(senses.length, 5); // broader words tend to be the more common reading
    count++;
    for (const r of kana) {
      if (r.inf.includes('sk')) continue; // search-only form
      const reading = hira(r.text);
      const rPri = priority(r.pri) - (r.inf.some((i) => BAD_FORM.test(i)) ? 40 : 0);

      // Kanji spellings this reading belongs to
      for (const k of kanji) {
        if (r.noKanji || k.inf.includes('sK')) continue;
        if (r.restr.length && !r.restr.includes(k.text)) continue;
        const list = senseList(senses.filter((s) => (!s.stagk.length || s.stagk.includes(k.text)) && (!s.stagr.length || s.stagr.includes(r.text))));
        if (!list.length) continue;
        const score = priority(k.pri) + Math.round(rPri / 2) + tiebreak - (k.inf.some((i) => BAD_FORM.test(i)) ? 40 : 0);
        add(k.text, [reading, score, ...list]);
      }

      // The kana spelling itself; boosted when the word is normally written in kana.
      // Kana spellings of rare kanji words are dropped: they almost never appear in text.
      const own = senses.filter((s) => !s.stagr.length || s.stagr.includes(r.text));
      const list = senseList(own);
      // Kana-form frequency tags describe the string, shared by all homophones, so lean on how
      // strongly the word itself is marked as written in kana.
      const ukShare = own.filter((s) => s.misc.includes('uk')).length / (own.length || 1);
      const rareKanji = kanji.every((k) => k.inf.some((i) => /^(rK|sK|oK|iK)$/.test(i)));
      let bonus = -30;
      if (!kanji.length || r.noKanji) bonus = 60;
      else if (own[0] && own[0].misc.includes('uk')) bonus = 30 + Math.round(30 * ukShare) + (rareKanji ? 30 : 0);
      else if (ukShare) bonus = 20;
      if (!list.length || (bonus < 0 && rPri <= 0)) continue;
      add(r.text, [reading, Math.round(rPri / 2) + tiebreak * 2 + bonus, ...list]);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (const key in dict) dict[key] = dict[key].map((c) => c.join('|')).join('^');
  fs.writeFileSync(OUT, JSON.stringify(dict));
  console.log(`${count} entries, ${Object.keys(dict).length} keys, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB -> ${OUT}`);

  // The JMdict licence asks for the data version to be identified: keep the notice in sync
  const created = (xml.match(/<!-- JMdict created: ([\d-]+) -->/) || [])[1];
  const notices = path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.md');
  if (created) {
    fs.writeFileSync(notices, fs.readFileSync(notices, 'utf8').replace(/^- Version used: .*$/m, `- Version used: JMdict_e created ${created}`));
    console.log(`JMdict version ${created} recorded in THIRD_PARTY_NOTICES.md`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
