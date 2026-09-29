'use strict';
// Splits Japanese text into words with kuromoji and attaches a short English gloss (JMdict)
// and furigana to each word. Content scripts send text here so the dictionaries (~150MB in
// memory) are loaded once for all tabs.
//
// The dictionaries ship inside the extension and are read from disk, never downloaded. They are
// loaded on the first Japanese text a page sends and dropped after 10 minutes without any, after
// which Chrome stops the idle worker and frees the memory.

// kuromoji's browser loader uses XMLHttpRequest, which service workers don't have.
self.XMLHttpRequest = class {
  open(method, url) {
    this.url = url;
  }
  send() {
    fetch(this.url)
      .then((res) => res.arrayBuffer())
      .then((buf) => {
        this.status = 200;
        this.response = buf;
        this.onload();
      }, (err) => this.onerror(err));
  }
};
importScripts('../lib/kuromoji.js');

// Part-of-speech bits, shared with tools/build-dict.js
const N = 1, V = 2, A = 4, NA = 8, ADV = 16, PN = 32, INT = 64, CONJ = 128, EXP = 256, PRT = 512, SUF = 1024, PREF = 2048;

const KANJI = /[\u3400-\u9fff\uf900-\ufaff々〆ヵヶ]/;
const KANJI_RUNS = /[\u3400-\u9fff\uf900-\ufaff々〆ヵヶ]+|[^\u3400-\u9fff\uf900-\ufaff々〆ヵヶ]+/g;
const hira = (s) => s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// Particles with a stable meaning get a gloss; purely grammatical ones (は, が, を, に, の...) don't.
const PARTICLES = {
  から格助詞: 'from', から接続助詞: 'because', まで副助詞: 'until', より格助詞: 'than',
  だけ副助詞: 'only', しか係助詞: 'only', も係助詞: 'also', など副助詞: 'etc.',
  ので接続助詞: 'because', のに接続助詞: 'although', けど接続助詞: 'but', けれど接続助詞: 'but',
  けれども接続助詞: 'but', が接続助詞: 'but', ながら接続助詞: 'while', ば接続助詞: 'if',
  へ格助詞: 'to', や並立助詞: 'and',
  について格助詞: 'about', によって格助詞: 'by', として格助詞: 'as', にとって格助詞: 'for',
  に対して格助詞: 'toward', に関して格助詞: 'regarding', において格助詞: 'in', における格助詞: 'in',
};
const QUESTION_WORDS = /^(何|なに|なん|誰|だれ|どこ|いつ|どれ|どちら|どっち)$/;

// Grammar after a verb or adjective, put in front of its gloss: 行かなければならない -> "must go"
const ENDINGS = [
  [/^(?:なければ|なくては|なくちゃ)(?:ならない|ならなかった|なりません|いけない|いけなかった|いけません|だめ|ダメ)/, 'must'],
  [/^(?:ては|では|ちゃ|じゃ)(?:いけない|いけません|ならない|なりません|だめ|ダメ)/, 'must not'],
  [/^なくても(?:いい|良い|よい|構わない|かまわない)/, "needn't"],
  [/^(?:ても|でも)(?:いい|良い|よい|構わない|かまわない)/, 'may'],
  [/^[てで](?:いただけ(?:ませんか|ますか|ないでしょうか)|ください|下さい|くださいませんか)/, 'please'],
];
// Grammar expressions annotated as a single unit
const PHRASES = [
  [/^かもしれ(?:ない|ません|なかった)/, 'might'],
  [/^かどうか/, 'whether'],
  [/^によ(?:ると|れば)/, 'according to'],
  [/^申し訳(?:ございません|ありません|ない|なかった)/, 'sorry'],
];
// Verb forms missing from JMdict are mapped back to the dictionary form:
// masu stems after お/ご (お使いください: 使い -> 使う) and potential verbs (会える -> 会う)
const STEM_ENDINGS = { い: 'う', き: 'く', ぎ: 'ぐ', し: 'す', ち: 'つ', に: 'ぬ', び: 'ぶ', み: 'む', り: 'る' };
const POTENTIAL_ENDINGS = { え: 'う', け: 'く', げ: 'ぐ', せ: 'す', て: 'つ', ね: 'ぬ', べ: 'ぶ', め: 'む', れ: 'る' };
const HONORIFIC_VERB = /^(?:いただ|頂|くださ|下さ|なさ)/;
const isHonorific = (x) => x && x.pos === '接頭詞' && /^(お|ご|御)$/.test(x.surface_form);
// お+stem before one of these is a verb: お待ちください, お送りします
const beforeHonorificVerb = (x) => x && (HONORIFIC_VERB.test(x.surface_form) || /^(する|いたす|致す)$/.test(x.basic_form));
// Day of the week in dates: ３月１４日（金）
const WEEKDAYS = { 月: ['げつ', 'Mon'], 火: ['か', 'Tue'], 水: ['すい', 'Wed'], 木: ['もく', 'Thu'], 金: ['きん', 'Fri'], 土: ['ど', 'Sat'], 日: ['にち', 'Sun'] };

const UNLOAD_AFTER = 10 * 60 * 1000;
let ready = null;
let lastUse = 0;
let keepAlive = 0;

function load() {
  lastUse = Date.now();
  if (!keepAlive) {
    // Chrome stops a service worker after 30s without activity; an extension API call counts as activity
    keepAlive = setInterval(() => {
      if (Date.now() - lastUse < UNLOAD_AFTER) return void chrome.runtime.getPlatformInfo();
      clearInterval(keepAlive);
      keepAlive = 0;
      ready = null;
      cache.clear();
    }, 20000);
  }
  return (ready ||= Promise.all([
    new Promise((resolve, reject) =>
      kuromoji.builder({ dicPath: '/dict/' }).build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)))),
    fetch('/dict/jmdict.json').then((res) => res.json()),
  ]).catch((err) => {
    ready = null;
    throw err;
  }));
}

const isFunctional = (t) => t.pos === '助詞' || t.pos === '助動詞' || t.pos === '記号';
const base = (t) => (t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form);

const READINGS = { 日本: 'にほん', 日本人: 'にほんじん' }; // IPADIC prefers the rarer にっぽん

function reading(t) {
  if (READINGS[t.surface_form]) return READINGS[t.surface_form];
  if (t.reading && t.reading !== '*') return hira(t.reading);
  return /^[\u3041-\u30ff]+$/.test(t.surface_form) ? hira(t.surface_form) : '';
}

// Reading of the dictionary form: 読ん/ヨン + 読む -> よむ
function baseReading(t) {
  const r = reading(t), s = t.surface_form, b = base(t);
  if (!r || s === b) return r;
  let p = 0;
  while (p < s.length && s[p] === b[p]) p++;
  return r.slice(0, r.length - (s.length - p)) + hira(b.slice(p));
}

function posMask(t) {
  switch (t.pos) {
    case '名詞':
      // Suffixes and counters: さん is "Mr" not "three", 日 after a number is "nth day";
      // place suffixes (駅, 県, 都) keep their noun sense
      if (t.pos_detail_1 === '接尾') return t.pos_detail_2 === '地域' ? N | SUF : SUF;
      return { サ変接続: N | V, 形容動詞語幹: N | NA, 副詞可能: N | ADV, ナイ形容詞語幹: N | A }[t.pos_detail_1] || N;
    case '動詞': return V;
    case '形容詞': return A;
    case '副詞': return ADV;
    case '連体詞': return PN;
    case '感動詞': case 'フィラー': return INT;
    case '接続詞': return CONJ;
    case '接頭詞': return PREF;
    default: return PRT;
  }
}

// Picks the entry whose reading matches the tokenizer's reading, then part of speech, then
// frequency, and returns { gloss, reading } using that entry's first sense matching the part of
// speech. `exact` (for multi-token matches) requires both reading and part of speech to match.
function lookup(dict, word, read, mask, exact) {
  let cands = dict[word];
  if (!cands) return null;
  if (typeof cands === 'string') {
    // Parse "reading|score|mask|gloss|mask|gloss^..." on first use: [reading, score, posMaskUnion, mask, gloss, ...]
    cands = dict[word] = cands.split('^').map((s) => {
      const c = s.split('|');
      let m = 0;
      for (let i = 2; i < c.length; i += 2) m |= c[i] = Number(c[i]);
      return [c[0] || hira(word), Number(c[1]), m, ...c.slice(2)];
    });
  }
  let best, bestRank = -Infinity, bestExact = false;
  for (const c of cands) {
    const sameReading = c[0] === read, samePos = (c[2] & mask) !== 0;
    const rank = (sameReading ? 1000 : 0) + (samePos ? 500 : 0) + c[1];
    if (rank > bestRank) [best, bestRank, bestExact] = [c, rank, sameReading && samePos];
  }
  if (exact && !bestExact) return null;
  let gloss = best[4];
  for (let i = 3; i < best.length; i += 2) {
    if (best[i] & mask) {
      gloss = best[i + 1];
      break;
    }
  }
  return { gloss, reading: best[0] };
}

// 使い -> 使う, 食べ -> 食べる
function verbFromStem(dict, stem, read) {
  const godan = STEM_ENDINGS[stem.slice(-1)];
  return (godan && lookup(dict, stem.slice(0, -1) + godan, read.slice(0, -1) + godan, V, true)) ||
    lookup(dict, `${stem}る`, `${read}る`, V, true);
}

// Kanji numerals: 二〇二一 -> "2021", 三百五十 -> "350", 一万二千 -> "12,000"
function kanjiNumber(s) {
  const DIGITS = '〇一二三四五六七八九';
  if ([...s].every((c) => DIGITS.includes(c))) return [...s].map((c) => DIGITS.indexOf(c)).join('');
  let total = 0, section = 0, digit = 0;
  for (const c of s) {
    const d = DIGITS.indexOf(c), small = { 十: 10, 百: 100, 千: 1000 }[c], big = { 万: 1e4, 億: 1e8, 兆: 1e12 }[c];
    if (d >= 0) digit = d;
    else if (small) [section, digit] = [section + (digit || 1) * small, 0];
    else if (big) [total, section, digit] = [total + (section + digit || 1) * big, 0, 0];
    else return '';
  }
  return (total + section + digit).toLocaleString('en-US');
}

// Most common reading among entries with this gloss. Numbers are read token by token
// (一+人 = いち+にん), while the word is usually read differently (一人 = ひとり).
function commonReading(dict, word, gloss) {
  let best = null;
  for (const c of dict[word]) if (c.includes(gloss) && (!best || c[1] > best[1])) best = c;
  return best[0];
}

const ROMA_KANA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわゐゑをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉゔ';
const ROMA = ('a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ' +
  'ma mi mu me mo ya yu yo ra ri ru re ro wa i e o n ga gi gu ge go za ji zu ze zo da ji zu de do ' +
  'ba bi bu be bo pa pi pu pe po a i u e o vu').split(' ');

// Names aren't in JMdict, so show them romanized: たなか -> Tanaka
function romaji(kana) {
  let out = '';
  for (let i = 0; i < kana.length; i++) {
    const c = kana[i], small = 'ゃゅょ'.indexOf(c);
    if (small >= 0 && out.endsWith('i')) out = out.replace(/(sh|ch|j)?i$/, (m, p) => p || 'y') + 'auo'[small];
    else if (c === 'っ') out += (ROMA[ROMA_KANA.indexOf(kana[i + 1])] || '').replace(/^ch.*/, 't')[0] || '';
    else if (ROMA_KANA.includes(c)) out += ROMA[ROMA_KANA.indexOf(c)];
  }
  return out && out[0].toUpperCase() + out.slice(1);
}

function glossOf(dict, t, prev, next) {
  const s = t.surface_form;
  if (t.pos === '記号' || /^[ー〜～・]+$|[0-9０-９]/.test(s)) return '';
  if (t.pos === '助詞') {
    if (s === 'も' && prev && QUESTION_WORDS.test(prev.surface_form)) return ''; // 何も, 誰も: "nothing", "nobody"
    if (s === 'も' && prev && prev.pos_detail_1 === '接続助詞') return 'even if'; // 降っても
    return PARTICLES[s + t.pos_detail_1] || '';
  }
  if (t.pos === '助動詞') return { ない: 'not', ぬ: 'not', ん: 'not', たい: 'want to' }[t.basic_form] || '';
  if (t.pos === '形容詞' && t.basic_form === 'ない') return 'not';
  if (isHonorific(t)) return '';
  if (t.pos_detail_2 === '助動詞語幹') {
    // おいしそう "looks", but after a plain form そう is hearsay: 多いそう, 降るそう
    if (s === 'そう') return prev && prev.conjugated_form === '基本形' ? 'reportedly' : 'looks';
    return s === 'みたい' ? 'like' : ''; // 学生みたい; ように stays unglossed
  }
  if (t.pos_detail_1 === '非自立' && (s === 'の' || s === 'ん')) return ''; // nominalizer: 勉強するのが
  // A na-adjective directly before a word is used as an adverb: 大変申し訳ない is "very", not "immense"
  const adverbial = t.pos_detail_1 === '形容動詞語幹' && next && !isFunctional(next);
  const mask = adverbial ? ADV | N | NA : posMask(t);
  let hit = lookup(dict, base(t), baseReading(t), mask) || lookup(dict, s, reading(t), mask);
  if (t.pos_detail_1 === '固有名詞' && (t.pos_detail_2 === '人名' || !hit)) return romaji(reading(t));
  if (!hit && /^[おご御]./.test(s)) hit = lookup(dict, s.slice(1), reading(t).slice(1), mask); // お待ち -> 待ち
  if (!hit && t.pos === '副詞' && s.length > 2 && /[はにとも]$/.test(s)) {
    hit = lookup(dict, s.slice(0, -1), reading(t).slice(0, -1), N | NA | ADV); // 本当は -> 本当
  }
  if (!hit && t.pos === '動詞') {
    // Potential verb (会える -> "can meet"); IPADIC also parses imperatives this way (待てよ -> "wait")
    const b = base(t), r = baseReading(t), godan = POTENTIAL_ENDINGS[b.slice(-2, -1)];
    hit = godan && b.endsWith('る') && lookup(dict, b.slice(0, -2) + godan, r.slice(0, -2) + godan, V, true);
    if (hit) return t.conjugated_form.startsWith('命令') ? hit.gloss : `can ${hit.gloss}`;
  }
  return hit ? hit.gloss : '';
}

// Splits a token into kanji/kana parts so furigana sits over the kanji only: 食べ物 -> 食(た)べ物(もの)
function splitFurigana(surface, read) {
  if (!read || !KANJI.test(surface)) return [[surface, '']];
  const parts = surface.match(KANJI_RUNS);
  const pattern = parts.map((p) => (KANJI.test(p) ? '(.+?)' : `(${hira(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`));
  const m = read.match(new RegExp(`^${pattern.join('')}$`));
  return m ? parts.map((p, i) => [p, KANJI.test(p) ? m[i + 1] : '']) : [[surface, read]];
}

// pieces: [[surface, reading], ...]
function furigana(pieces) {
  const pairs = [];
  for (const [surface, read] of pieces) {
    for (const [text, rt] of splitFurigana(surface, read)) {
      const last = pairs[pairs.length - 1];
      if (!rt && last && !last[1]) last[0] += text;
      else pairs.push([text, rt]);
    }
  }
  return pairs.some((p) => p[1]) ? pairs : 0;
}

// Verb/adjective endings that belong to the word before them: 食べ|させ|られ|ませ|ん|でし|た
function attaches(t, next) {
  if (t.pos === '助動詞') return true;
  if (t.pos === '動詞' || t.pos === '形容詞') return t.pos_detail_1 === '接尾' || t.pos_detail_1 === '非自立';
  return t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && (t.surface_form === 'て' || t.surface_form === 'で') &&
    !!next && next.pos_detail_1 === '非自立';
}

// Matches the first of `patterns` that ends on a token boundary at toks[j]; returns [tokenCount, gloss]
function matchPattern(patterns, toks, j) {
  const text = toks.slice(j, j + 8).map((x) => x.surface_form).join('');
  for (const [re, gloss] of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    let k = 0, len = 0;
    while (len < m[0].length) len += toks[j + k++].surface_form.length;
    if (len === m[0].length) return [k, gloss];
  }
  return null;
}

// Returns the text as a list of plain strings and [word, gloss, furigana] triples.
// pre/post are neighbouring text from the page (<b>山田</b>さん), used only as context.
function analyze(tokenizer, dict, text, pre, post) {
  const full = pre + text + post, start = pre.length, end = start + text.length;
  // IPADIC only knows full-width digits (３月 = March, 3月 = "3 moon"); tokenize a normalized
  // copy, then take each token's surface back from the original text.
  const all = tokenizer.tokenize(full.replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0)));
  const toks = [];
  let cutStart = '', cutEnd = ''; // parts of tokens that straddle the node's boundaries
  for (let i = 0, pos = 0; i < all.length; i++) {
    const s = pos, e = (pos += all[i].surface_form.length);
    all[i].surface_form = full.slice(s, e);
    if (s >= start && e <= end) toks.push(all[i]);
    else if (s < start && e > start) cutStart = full.slice(start, Math.min(e, end));
    else if (s < end && e > end) cutEnd = full.slice(s, end);
  }
  // Kana in parentheses right after a kanji word is its reading (<b>富士山</b>（ふじさん）) and is left
  // as is; it would be glossed as other words (ふじ "wisteria", さん "Mr"). Checked on all tokens, as
  // the word may be in the context.
  const readingNotes = new Set();
  for (let p = 1; p < all.length; p++) {
    if (!/^[（(]$/.test(all[p].surface_form)) continue;
    let q = p + 1;
    while (q < all.length && q < p + 12 && !/^[）)]$/.test(all[q].surface_form)) q++;
    const inner = hira(all.slice(p + 1, q).map((x) => x.surface_form).join(''));
    if (q === all.length || !/^[\u3041-\u3096ー]+$/.test(inner)) continue;
    if (KANJI.test(all[p - 1].surface_form)) all.slice(p + 1, q).forEach((x) => readingNotes.add(x));
  }

  const out = cutStart ? [cutStart] : [];
  const plain = (s) => (typeof out[out.length - 1] === 'string' ? (out[out.length - 1] += s) : out.push(s));
  let i = 0;
  while (i < toks.length) {
    const t = toks[i], prev = toks[i - 1], next = toks[i + 1];
    if (readingNotes.has(t)) {
      plain(t.surface_form);
      i++;
      continue;
    }
    let n = 1, gloss = '', read = ''; // read: dictionary reading for the first n tokens, if the tokenizer's is unreliable

    const inNumber = t.pos_detail_1 === '数' && prev && prev.pos_detail_1 === '数';
    let digits = 0; // length of a run of number tokens starting here
    while (!inNumber && toks[i + digits] && toks[i + digits].pos_detail_1 === '数') digits++;

    const phrase = matchPattern(PHRASES, toks, i);
    if (phrase) [n, gloss] = phrase;
    else if (WEEKDAYS[t.surface_form] && prev && /^[（(]$/.test(prev.surface_form) && next && /^[）)・]$/.test(next.surface_form)) {
      [read, gloss] = WEEKDAYS[t.surface_form]; // ３月１４日（金）
    } else if (t.pos === '名詞' && beforeHonorificVerb(next)) {
      // お使いください: 使い -> 使う; the prefix may be its own token or part of this one (お待ち)
      const fused = /^[おご御]./.test(t.surface_form) && !isHonorific(prev) ? 1 : 0;
      if (fused || isHonorific(prev)) gloss = verbFromStem(dict, t.surface_form.slice(fused), reading(t).slice(fused))?.gloss || '';
    } else if (digits > 2) {
      const value = kanjiNumber(toks.slice(i, i + digits).map((x) => x.surface_form).join(''));
      if (value) [n, gloss] = [digits, value];
    }

    // Longest dictionary match across tokens: 携帯+電話 -> 携帯電話, 目+に+見える -> 目に見える.
    // Not from a suffix (本+目 is not a "knot"), from inside a number (1+万+人 is not 万人 "everyone"),
    // or from an honorific prefix before a verb stem (お使いください is "please use", not お使い "errand").
    const honorificStem = isHonorific(t) && beforeHonorificVerb(toks[i + 2]);
    if (!gloss && !isFunctional(t) && t.pos_detail_1 !== '接尾' && !inNumber && !honorificStem) {
      for (let k = Math.min(5, toks.length - i); k > 1 && !gloss; k--) {
        const span = toks.slice(i, i + k), stem = span.slice(0, -1), final = span[k - 1];
        if (isFunctional(final) || span.some((x) => x.pos === '記号')) continue;
        const word = stem.map((x) => x.surface_form).join('') + base(final);
        // Kana-only matches are mostly idioms (そんな+もの -> "that's the way it is"); allow katakana compounds only
        if (!KANJI.test(word) && !/^[\u30a0-\u30ff]+$/.test(word)) continue;
        // 全国+的 is an adjective, 東京+都 a noun
        const mask = final.pos_detail_1 === '接尾' ? N | NA | SUF : posMask(final);
        const hit = lookup(dict, word, stem.map(reading).join('') + baseReading(final), mask, true);
        if (!hit) continue;
        [n, gloss] = [k, hit.gloss];
        if (span.some((x) => x.pos_detail_1 === '数')) read = commonReading(dict, word, gloss);
      }
    }
    if (!gloss && digits === 2) {
      const value = kanjiNumber(toks.slice(i, i + 2).map((x) => x.surface_form).join(''));
      if (value) [n, gloss] = [2, value]; // 二十 -> 20 (after dictionary matches like 二十日, 一人)
    }
    if (!gloss && n === 1) gloss = glossOf(dict, t, prev, next);

    let j = i + n;
    const last = toks[j - 1];
    // する verbs: 勉強+する, わくわく+する, お+届け+する, 発送+いたす, ライトアップ+する
    const suru = toks[j] && toks[j].pos === '動詞' && /^(する|できる|いたす|致す)$/.test(toks[j].basic_form) &&
      (last.pos_detail_1 === 'サ変接続' || last.pos === '副詞' || (last.pos === '名詞' && (t.pos === '接頭詞' || /^[ァ-ヺー]+$/.test(last.surface_form))));
    if (suru) j++;
    if (suru || last.pos === '動詞' || last.pos === '形容詞') {
      let ending = '', neg = false, want = false;
      while (j < toks.length) {
        const m = !ending && matchPattern(ENDINGS, toks, j);
        if (m) {
          j += m[0];
          ending = `${m[1]} `;
          continue;
        }
        if (!attaches(toks[j], toks[j + 1])) break;
        const b = !ending && toks[j].pos === '助動詞' && toks[j].basic_form; // after an ending, it's part of it
        if (b === 'ない' || b === 'ぬ' || b === 'ん') neg = true;
        if (b === 'たい') want = true;
        j++;
      }
      if (neg && gloss.startsWith('can ')) [neg, gloss] = [false, `can't ${gloss.slice(4)}`]; // 会えない
      if (suru && ending === 'please ') ending = ''; // する nouns have noun glosses: "please contacting"
      if (gloss) gloss = ending + (neg ? 'not ' : '') + (want ? 'want to ' : '') + gloss;
    }

    const group = toks.slice(i, j);
    const word = group.map((x) => x.surface_form).join('');
    // Set phrases that look like verb forms: いらっしゃいませ -> "welcome", 失礼します -> "excuse me".
    // Not after an object (お茶をいただきます is "receive", not a greeting).
    if (!phrase && j > i + n && !(prev && /^[をがに]$/.test(prev.surface_form))) {
      const hit = lookup(dict, word, group.map(reading).join(''), INT | EXP, true);
      if (hit) gloss = hit.gloss;
    }
    const pieces = group.map((x) => [x.surface_form, reading(x)]);
    if (read) pieces.splice(0, n, [group.slice(0, n).map((x) => x.surface_form).join(''), read]);
    const furi = furigana(pieces);
    if (gloss || furi) out.push([word, gloss, furi]);
    else plain(word);
    i = j;
  }
  if (cutEnd) plain(cutEnd);
  return out;
}

const cache = new Map();
function analyzeCached(tokenizer, dict, [pre, text, post]) {
  const key = `${pre}\0${text}\0${post}`;
  let result = cache.get(key);
  if (!result) {
    if (cache.size > 5000) cache.clear();
    cache.set(key, (result = analyze(tokenizer, dict, text, pre, post)));
  }
  return result;
}

// msg.texts: [[textBefore, text, textAfter], ...]; 'css': content.css for shadow roots, which it
// doesn't reach (fetched here so the file needn't be exposed to web pages)
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg === 'css') {
    fetch('/src/content.css').then((res) => res.text()).then(reply, () => reply(''));
    return true;
  }
  if (!msg || !msg.texts) return;
  load().then(
    ([tokenizer, dict]) => reply(msg.texts.map((t) => analyzeCached(tokenizer, dict, t))),
    (err) => {
      console.error(err);
      reply(null);
    });
  return true;
});

// Ruby reads page text, so it asks for the user's agreement first (see welcome.html)
chrome.runtime.onInstalled.addListener(async () => {
  const { consented } = await chrome.storage.local.get({ consented: false });
  if (!consented) chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome.html') });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'toggle') {
    if (tab && tab.id >= 0) chrome.tabs.sendMessage(tab.id, 'toggle').catch(() => {});
    return;
  }
  // Settings are shared with content.js and popup.js (defaults as in content.js)
  const s = await chrome.storage.local.get({ furigana: false, hoverMode: 'swap', hoverModeBefore: 'swap' });
  if (command === 'furigana') await chrome.storage.local.set({ furigana: !s.furigana });
  // Reveal mode (annotations only on hover) on, or back to the previous hover mode
  if (command === 'reveal') {
    await chrome.storage.local.set(s.hoverMode === 'reveal' ? { hoverMode: s.hoverModeBefore } : { hoverMode: 'reveal', hoverModeBefore: s.hoverMode });
  }
});
