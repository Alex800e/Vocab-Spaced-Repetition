'use strict';

// ==========================================
// 定数・記憶モデル
//   定着率 R = exp(-t / S)   t:最後の学習からの経過時間(時間)  S:記憶の強さ(時間)
// ==========================================
const H = 3600000;                 // 1時間(ms)
const S0 = 24;                     // 初期の記憶の強さ(時間) → 1日後の定着率 約37%
const THRESH = 0.7;                // この定着率を下回ったら復習対象
const STORAGE_KEY = 'kb7_state_v1';

const MODES = [
  { key: 'card', label: 'カード' },
  { key: 'tap',  label: '並び替え' },
  { key: 'hint', label: '最初の文字ヒント＋タイピング' },
  { key: 'type', label: '完全タイピング' }
];
const MODE_LABEL = {};
MODES.forEach(m => MODE_LABEL[m.key] = m.label);

const BY_ID = {};
WORDS.forEach(w => BY_ID[w.id] = w);

// 同じ意味(日本語)を持つ単語。タイピングではどちらを答えても正解にする
const ALT = {};
(function () {
  const byJa = {};
  WORDS.forEach(w => (byJa[w.ja] = byJa[w.ja] || []).push(w.id));
  WORDS.forEach(w => ALT[w.id] = byJa[w.ja].filter(i => i !== w.id));
})();

// ==========================================
// 文字列ヘルパー
// ==========================================
const lettersOf = en => en.replace(/[^A-Za-z]/g, '').toLowerCase();             // 判定に使うアルファベットのみ
const layoutOf = en => en.replace(/\s*\.\.\.\s*$/, '').replace(/’/g, "'").trim(); // 表示用(末尾の「...」は除く)
const pad = n => String(n).padStart(2, '0');
const pct = r => Math.round(r * 100);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtDate(t) {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDur(ms) {
  const m = ms / 60000;
  if (m < 1) return '1分未満';
  if (m < 60) return Math.round(m) + '分';
  const h = ms / H;
  if (h < 48) return (Math.round(h * 10) / 10) + '時間';
  return (Math.round(h / 24 * 10) / 10) + '日';
}
function dateKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ==========================================
// 状態の保存・読み込み
// ==========================================
function defaultState() {
  return {
    learned: {},                                   // id -> {first, last, S, reviews:[{t, ok, R, S0, S1, mode, hint}]}
    settings: { mode: 'tap', newPerDay: 10, sound: true },
    offsetMs: 0,                                   // テスト用の仮想時間
    daily: { date: '', count: 0 }                  // 今日の新規学習数
  };
}
function loadState() {
  const base = defaultState();
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && typeof s.learned === 'object' && s.learned) {
      return Object.assign(base, s, { settings: Object.assign(base.settings, s.settings || {}) });
    }
  } catch (e) { /* 初回など */ }
  return base;
}
let state = loadState();
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn('保存に失敗しました', e); }
}
const now = () => Date.now() + (state.offsetMs || 0);

// ==========================================
// 忘却曲線の計算
// ==========================================
function retention(rec, t) {
  const e = Math.max(0, (t - rec.last) / H);
  return Math.exp(-e / rec.S);
}
function dueTime(rec) {
  return rec.last + (-Math.log(THRESH) * rec.S) * H;
}
function todayNewCount() {
  return state.daily.date === dateKey(now()) ? state.daily.count : 0;
}

// 1回目の学習
function learnNew(id) {
  const t = now();
  state.learned[id] = { first: t, last: t, S: S0, reviews: [] };
  const key = dateKey(t);
  if (state.daily.date !== key) state.daily = { date: key, count: 0 };
  state.daily.count++;
  saveState();
}

// 復習結果の反映
function applyReview(id, ok, mode, hint) {
  const rec = state.learned[id];
  if (!rec) return null;
  const t = now();
  const R = retention(rec, t);
  const sBefore = rec.S;
  let sAfter;
  if (ok) {
    // 思い出しにくい(Rが低い)ときに思い出せるほど大きく伸びる
    sAfter = sBefore * (1.8 + 1.2 * (1 - R));
  } else {
    sAfter = Math.max(S0, sBefore * 0.5);
  }
  sAfter = Math.min(sAfter, 24 * 365);
  rec.reviews.push({ t, ok, R, S0: sBefore, S1: sAfter, mode, hint: !!hint });
  rec.last = t;
  rec.S = sAfter;
  saveState();
  return { R, sBefore, sAfter, due: dueTime(rec), t };
}

// ==========================================
// 音声・効果音
// ==========================================
let userActed = false;
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { userActed = true; }, { once: false, passive: true }));

let cachedVoices = [];
let currentUtterance = null;
function refreshVoices() {
  if ('speechSynthesis' in window) cachedVoices = window.speechSynthesis.getVoices();
}
function getEnglishCandidates() {
  refreshVoices();
  const en = cachedVoices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
  const preferred = localStorage.getItem('kb7_voice');
  const score = v => {
    if (preferred && v.name === preferred) return 0;
    if (v.name === 'Google US English') return 1;
    if (v.lang === 'en-US' && !/mobile/i.test(v.name)) return 2;
    if (/^Google/.test(v.name)) return 3;
    if (!/mobile/i.test(v.name)) return 4;
    return 5;
  };
  return en.slice().sort((a, b) => score(a) - score(b));
}
function speakWord(text, attempt = 0) {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const candidates = getEnglishCandidates();
  const voice = candidates[attempt] || null;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  u.volume = 1;
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  u.onstart = () => { if (voice) localStorage.setItem('kb7_voice', voice.name); };
  u.onerror = e => {
    if (e.error === 'canceled' || e.error === 'interrupted') return;
    if (voice && localStorage.getItem('kb7_voice') === voice.name) localStorage.removeItem('kb7_voice');
    if (voice && attempt + 1 <= candidates.length) speakWord(text, attempt + 1);
  };
  currentUtterance = u;
  setTimeout(() => { synth.resume(); synth.speak(u); }, 80);
}
function speakEn(w) { speakWord(layoutOf(w.en)); }
function autoSpeak(w) { if (userActed) speakEn(w); }

let actx = null;
function beep(freq, dur) {
  if (!state.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = 0.07;
    o.connect(g);
    g.connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + (dur || 0.08));
  } catch (e) { /* 音が出なくても学習は続行 */ }
}

// ==========================================
// 学習セッション
// ==========================================
let session = { queue: [], i: 0, ok: 0, ng: 0, learned: 0, total: 0 };
let cur = null;     // 現在のカードの状態

const $ = id => document.getElementById(id);
const cardEl = $('card');

function buildQueue() {
  const tn = now();
  const due = [];
  Object.keys(state.learned).forEach(k => {
    const id = Number(k);
    const R = retention(state.learned[id], tn);
    if (R <= THRESH) due.push({ id, kind: 'review', R });
  });
  due.sort((a, b) => a.R - b.R);
  const remain = Math.max(0, state.settings.newPerDay - todayNewCount());
  const news = [];
  for (const w of WORDS) {
    if (news.length >= remain) break;
    if (!state.learned[w.id]) news.push({ id: w.id, kind: 'new' });
  }
  return due.concat(news);
}

function startSession(items) {
  session = { queue: items, i: 0, ok: 0, ng: 0, learned: 0, total: items.length };
  showItem();
}

function showItem() {
  updateLearnStats();
  if (session.i >= session.queue.length) {
    cur = null;
    renderDone();
    return;
  }
  const it = session.queue[session.i];
  cur = {
    item: it,
    word: BY_ID[it.id],
    phase: it.kind === 'new' ? 'intro' : 'q',
    mistake: false, hint: false, assist: false, ok: null, info: null,
    revealed: false
  };
  renderCard();
}

function goNext() {
  session.i++;
  showItem();
}

function updateLearnStats() {
  const tn = now();
  let due = 0;
  Object.keys(state.learned).forEach(k => { if (retention(state.learned[k], tn) <= THRESH) due++; });
  const learnedN = Object.keys(state.learned).length;
  const newLeft = Math.max(0, state.settings.newPerDay - todayNewCount());
  const prog = session.total ? `　進行 ${Math.min(session.i + 1, session.total)} / ${session.total}` : '';
  $('learnStats').textContent = `復習対象 ${due}語 ／ 今日の新規 あと${newLeft}語 ／ 学習済み ${learnedN} / ${WORDS.length}語${prog}`;
}

function renderModeChips() {
  $('modeChips').innerHTML = MODES.map(m =>
    `<button class="chip${state.settings.mode === m.key ? ' on' : ''}" data-mode="${m.key}">${m.label}</button>`
  ).join('');
}

function renderHelp() {
  const m = state.settings.mode;
  let t = '※ヒントを使う・つづりを間違える・「わからない」を押すと不正解（要復習）として記録されます。';
  if (m === 'card') t = '※PCは [Space] で答え表示、[←] 忘れた / [→] 覚えている でも操作できます。';
  $('helpText').textContent = t;
}

// ---------- カード描画の振り分け ----------
function renderCard() {
  if (!cur) return;
  if (cur.phase === 'intro') return renderIntro();
  if (cur.phase === 'result') return renderResult();
  const m = state.settings.mode;
  if (m === 'card') return renderQCard();
  if (m === 'tap') return renderQTap();
  return renderQType();
}

function tagLine(w, extra) {
  return `<div class="tag-line"><span class="tag">${esc(w.pos)}</span>${extra || ''}</div>`;
}

// ---------- 新しい単語（1回目の学習） ----------
function renderIntro() {
  const w = cur.word;
  cardEl.innerHTML = `
    <div class="tag-line"><span class="tag new">新しい単語</span><span class="tag">${esc(w.pos)}</span></div>
    <div class="word-container">
      <div class="word">${esc(layoutOf(w.en))}</div>
      <button class="btn-audio" id="btnSpeak" aria-label="発音">🔊</button>
    </div>
    <div class="meaning-big">${esc(w.ja)}</div>
    <div class="intro-note">声に出して読んで、意味といっしょに覚えましょう。<br>覚えたら記録します（ここが1回目の学習です）。</div>
    <div class="btn-group"><button class="btn-success" id="btnLearned">覚えた！学習を記録する [Enter]</button></div>`;
  $('btnSpeak').onclick = () => speakEn(w);
  $('btnLearned').onclick = () => { learnNew(w.id); session.learned++; goNext(); };
  autoSpeak(w);
}

// ---------- カードモード ----------
function renderQCard() {
  const w = cur.word;
  cardEl.innerHTML = `
    ${tagLine(w)}
    <div class="prompt">${esc(w.ja)}</div>
    <div id="cardAnswer" class="answer" style="display:${cur.revealed ? 'flex' : 'none'}">
      <div class="word-container"><div class="word">${esc(layoutOf(w.en))}</div>
      <button class="btn-audio" id="btnSpeak" aria-label="発音">🔊</button></div>
    </div>
    <div class="btn-group" id="cardButtons">
      ${cur.revealed
        ? `<button class="btn-danger" id="btnNg">忘れた [←]</button><button class="btn-success" id="btnOk">覚えている [→]</button>`
        : `<button class="btn-primary" id="btnReveal">英語を見る [Space]</button>`}
    </div>`;
  if (cur.revealed) {
    $('btnSpeak').onclick = () => speakEn(w);
    $('btnNg').onclick = () => cardAnswer(false);
    $('btnOk').onclick = () => cardAnswer(true);
  } else {
    $('btnReveal').onclick = revealCard;
  }
}
function revealCard() {
  if (!cur || cur.phase !== 'q' || state.settings.mode !== 'card' || cur.revealed) return;
  cur.revealed = true;
  renderQCard();
  autoSpeak(cur.word);
}
function cardAnswer(ok) {
  if (!cur || cur.phase !== 'q' || !cur.revealed) return;
  applyReview(cur.word.id, ok, 'card', false);
  ok ? session.ok++ : session.ng++;
  goNext();
}

// ---------- 共通：スロット(1文字ずつのボックス)表示 ----------
// getInfo(li, ch) -> {cls, ch}   li: アルファベットの通し番号
function slotsHTML(layout, getInfo) {
  let li = 0;
  let html = '';
  for (const ch of layout) {
    if (/[A-Za-z]/.test(ch)) {
      const info = getInfo(li, ch);
      html += `<span class="slot ${info.cls}">${esc(info.ch || '')}</span>`;
      li++;
    } else if (ch === ' ') {
      html += '<span class="sep gap"></span>';
    } else {
      html += `<span class="sep">${esc(ch)}</span>`;
    }
  }
  return html;
}

function sameMeaningNote(w) {
  const n = ALT[w.id].length;
  return n ? `<span class="tag soft">同じ意味の単語が他に${n}語あります（どれでも正解）</span>` : '';
}

// ---------- タイピング（最初の文字ヒント付き / 完全） ----------
function fixedCount(n) { return n <= 2 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : 3; }

function renderQType() {
  const w = cur.word;
  const tgt = lettersOf(w.en);
  cur.prefixLen = state.settings.mode === 'hint' ? fixedCount(tgt.length) : 0;
  const pre = tgt.slice(0, cur.prefixLen);
  cur.cands = [w].concat(ALT[w.id].map(i => BY_ID[i])).filter(c => lettersOf(c.en).startsWith(pre));
  cur.active = w;
  cur.full = pre;
  cur.validLen = pre.length;
  cur.wrongIdx = -1;
  cur.ghostIdx = -1;

  cardEl.innerHTML = `
    ${tagLine(w, sameMeaningNote(w))}
    <div class="prompt">${esc(w.ja)}</div>
    <div class="slots" id="slots"></div>
    <input id="typeInput" class="type-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="ここにスペルを入力">
    <div class="msg" id="msg"></div>
    <div class="btn-row">
      <button class="btn-secondary" id="btnHint">ヒント（不正解扱い）</button>
      <button class="btn-secondary" id="btnGiveUp">わからない</button>
    </div>`;
  const inp = $('typeInput');
  inp.addEventListener('input', onTypeInput);
  inp.addEventListener('compositionend', onTypeInput);
  $('slots').onclick = () => inp.focus();
  $('btnHint').onclick = () => {
    cur.hint = true;
    cur.ghostIdx = cur.full.length;
    $('btnHint').disabled = true;
    updateTyping();
    inp.focus();
  };
  $('btnGiveUp').onclick = () => {
    cur.hint = true;
    cur.assist = true;
    $('btnHint').disabled = true;
    $('btnGiveUp').disabled = true;
    updateTyping();
    inp.focus();
  };
  updateTyping();
  setTimeout(() => inp.focus(), 0);
}

function onTypeInput(ev) {
  if (!cur || cur.phase !== 'q' || ev.isComposing) return;
  const inp = $('typeInput');
  const w = cur.word;
  const tgt = lettersOf(w.en);
  const pre = tgt.slice(0, cur.prefixLen);
  let raw = inp.value.toLowerCase().replace(/[^a-z]/g, '');
  let full = pre + raw;

  let best = cur.cands[0], bestL = -1, done = null, valid = false;
  for (const c of cur.cands) {
    const L = lettersOf(c.en);
    let k = 0;
    while (k < L.length && k < full.length && L[k] === full[k]) k++;
    if (k > bestL) { bestL = k; best = c; }
    if (L.startsWith(full)) valid = true;
    if (L === full) done = c;
  }

  if (valid) {
    cur.wrongIdx = -1;
    cur.validLen = full.length;
    cur.active = done || best;
    if (full.length > cur.full.length) beep(660 + Math.min(full.length, 12) * 25, 0.06);
  } else {
    // 間違えた文字は赤で表示し、バックスペースで消すまで先へ進めない
    full = full.slice(0, bestL + 1);
    raw = full.slice(pre.length);
    inp.value = raw;
    cur.wrongIdx = bestL;
    cur.validLen = bestL;
    cur.active = best;
    if (!cur.mistake) beep(180, 0.18);
    cur.mistake = true;
  }
  cur.full = full;
  updateTyping();

  if (valid && done) {
    inp.blur();
    finishQuestion(!cur.mistake && !cur.hint);
  }
}

function updateTyping() {
  const L = lettersOf(cur.active.en);
  $('slots').innerHTML = slotsHTML(layoutOf(cur.active.en), (li, ch) => {
    if (li < cur.prefixLen) return { cls: 'fixed', ch };
    if (li === cur.wrongIdx) return { cls: 'bad', ch: cur.full[li] };
    if (li < cur.validLen) return { cls: 'ok', ch };
    if (cur.assist || li === cur.ghostIdx) return { cls: 'ghost', ch };
    return { cls: 'empty', ch: '' };
  });
  const msg = $('msg');
  if (cur.wrongIdx >= 0) { msg.className = 'msg bad'; msg.textContent = '間違えました。バックスペース(⌫)で消して入力し直してください'; }
  else if (cur.assist) { msg.className = 'msg warn'; msg.textContent = '答えをなぞってください（不正解として記録されます）'; }
  else if (cur.hint) { msg.className = 'msg warn'; msg.textContent = 'ヒントを使ったので不正解として記録されます'; }
  else if (cur.mistake) { msg.className = 'msg warn'; msg.textContent = 'つづりを間違えたので不正解として記録されます'; }
  else { msg.className = 'msg'; msg.textContent = ''; }
  void L;
}

// ---------- 並び替え（タップ式） ----------
function renderQTap() {
  const w = cur.word;
  const L = lettersOf(w.en).split('');
  const nDummy = L.length <= 3 ? 0 : L.length <= 7 ? 1 : 2;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(c => L.indexOf(c) < 0);
  const dummies = [];
  while (dummies.length < nDummy && alphabet.length) {
    dummies.push(alphabet.splice(Math.floor(Math.random() * alphabet.length), 1)[0]);
  }
  const pool = L.concat(dummies);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  cur.target = L;
  cur.pool = pool;
  cur.used = {};
  cur.pos = 0;
  cur.hintPos = -1;

  cardEl.innerHTML = `
    ${tagLine(w)}
    <div class="prompt">${esc(w.ja)}</div>
    <div class="slots" id="slots"></div>
    <div class="msg" id="msg"></div>
    <div class="pool" id="pool"></div>
    <div class="btn-row">
      <button class="btn-secondary" id="btnHint">ヒント（不正解扱い）</button>
      <button class="btn-secondary" id="btnGiveUp">わからない</button>
    </div>`;
  $('pool').onclick = ev => {
    const b = ev.target.closest('button[data-i]');
    if (b) tapKey(Number(b.dataset.i), b);
  };
  $('btnHint').onclick = () => { cur.hint = true; cur.hintPos = cur.pos; updateTap(); };
  $('btnGiveUp').onclick = () => { cur.hint = true; cur.assist = true; $('btnGiveUp').disabled = true; updateTap(); };
  updateTap();
}

function updateTap() {
  const w = cur.word;
  $('slots').innerHTML = slotsHTML(layoutOf(w.en), (li, ch) =>
    li < cur.pos ? { cls: 'ok', ch } : { cls: 'empty', ch: '' });
  const next = cur.target[cur.pos];
  const showHint = cur.assist || cur.hintPos === cur.pos;
  let hinted = false;
  $('pool').innerHTML = cur.pool.map((c, i) => {
    const used = !!cur.used[i];
    let cls = 'key';
    if (used) cls += ' used';
    else if (showHint && !hinted && c === next) { cls += ' hint'; hinted = true; }
    return `<button class="${cls}" data-i="${i}" ${used ? 'disabled' : ''}>${c}</button>`;
  }).join('');
  const msg = $('msg');
  if (cur.assist) { msg.className = 'msg warn'; msg.textContent = '光っている文字を順にタップしてください（不正解として記録されます）'; }
  else if (cur.hint) { msg.className = 'msg warn'; msg.textContent = 'ヒントを使ったので不正解として記録されます'; }
  else if (cur.mistake) { msg.className = 'msg warn'; msg.textContent = '間違えたので不正解として記録されます'; }
  else { msg.className = 'msg'; msg.textContent = ''; }
}

function tapKey(i, btn) {
  if (!cur || cur.phase !== 'q' || cur.used[i]) return;
  const ch = cur.pool[i];
  if (ch === cur.target[cur.pos]) {
    cur.used[i] = true;
    cur.pos++;
    beep(520 + cur.pos * 40, 0.07);
    updateTap();
    if (cur.pos >= cur.target.length) finishQuestion(!cur.mistake && !cur.hint);
  } else {
    cur.mistake = true;
    beep(180, 0.18);
    btn.classList.add('shake');
    setTimeout(() => btn.classList.remove('shake'), 400);
    updateTap();
  }
}

// ---------- 結果 ----------
function finishQuestion(ok) {
  cur.phase = 'result';
  cur.ok = ok;
  cur.info = applyReview(cur.word.id, ok, state.settings.mode, cur.hint);
  ok ? session.ok++ : session.ng++;
  updateLearnStats();
  renderResult();
  autoSpeak(cur.word);
}

function renderResult() {
  const w = cur.word;
  const info = cur.info;
  let detail = '';
  if (info) {
    const dueTxt = info.due - info.t <= 0 ? 'すぐ' : fmtDur(info.due - info.t) + '後';
    detail = `思い出した時の定着率 <b>${pct(info.R)}%</b><br>
      次の復習の目安：<b>${dueTxt}</b>（${fmtDate(info.due)}ごろ）`;
  }
  cardEl.innerHTML = `
    <div class="result-mark ${cur.ok ? 'ok' : 'ng'}">${cur.ok ? '○ 正解！' : '× 要復習'}</div>
    <div class="word-container">
      <div class="word">${esc(layoutOf(w.en))}</div>
      <button class="btn-audio" id="btnSpeak" aria-label="発音">🔊</button>
    </div>
    <div class="meaning-big">${esc(w.ja)}</div>
    <div class="result-info">${detail}</div>
    <div class="btn-group">
      <button class="btn-secondary" id="btnGraph">忘却曲線を見る</button>
      <button class="btn-primary" id="btnNext">次へ [Enter]</button>
    </div>`;
  $('btnSpeak').onclick = () => speakEn(w);
  $('btnGraph').onclick = () => openDetail(w.id);
  $('btnNext').onclick = goNext;
}

function renderDone() {
  const tn = now();
  let nextDue = Infinity, nextCount = 0;
  Object.keys(state.learned).forEach(k => {
    const d = dueTime(state.learned[k]);
    if (d > tn) {
      if (d < nextDue - 60000) { nextDue = d; nextCount = 1; }
      else if (d <= nextDue + 60000) nextCount++;
    }
  });
  const sum = session.ok + session.ng;
  const newLeft = Math.max(0, state.settings.newPerDay - todayNewCount());
  cardEl.innerHTML = `
    <div class="done-title">今回の学習はおしまいです 🎉</div>
    ${sum || session.learned ? `<div class="result-info">新しく学習：<b>${session.learned}語</b>　復習：<b>${sum}問</b>（正解 ${session.ok} / 不正解 ${session.ng}）</div>` : ''}
    <div class="result-info">${nextDue < Infinity
      ? `次の復習：<b>${fmtDur(nextDue - tn)}後</b>（${fmtDate(nextDue)}ごろ、約${nextCount}語）`
      : 'まだ学習した単語がありません。'}
      ${newLeft === 0 ? '<br>今日の新規単語は上限に達しました（設定で変更できます）。' : ''}</div>
    <div class="btn-group">
      <button class="btn-secondary" id="btnToGraph">定着度グラフを見る</button>
      <button class="btn-primary" id="btnAgain">もう一度確認する</button>
    </div>`;
  $('btnToGraph').onclick = () => switchTab('graph');
  $('btnAgain').onclick = () => startSession(buildQueue());
}

// ==========================================
// 定着度グラフ（一覧）
// ==========================================
let gFilter = 'all', gSort = 'Rasc', gQuery = '';
const FILTERS = [
  { key: 'all', label: 'すべて' },
  { key: 'due', label: '要復習(70%以下)' },
  { key: 'strong', label: '定着(80%以上)' },
  { key: 'new', label: '未学習' }
];

function levelOf(R) {
  if (R >= 0.8) return { cls: 'lv-high', text: 'しっかり定着しています' };
  if (R >= 0.5) return { cls: 'lv-mid', text: 'まだ覚えていそうです' };
  if (R >= 0.3) return { cls: 'lv-low', text: '忘れかけています' };
  return { cls: 'lv-none', text: 'ほぼ忘れていそうです' };
}
function colorCls(R) {
  return R >= 0.8 ? 'lv-high' : R >= 0.5 ? 'lv-mid' : 'lv-low';
}

function renderGraphTab() {
  const tn = now();
  const rows = WORDS.map(w => {
    const rec = state.learned[w.id];
    return { w, rec, R: rec ? retention(rec, tn) : null };
  });
  const learned = rows.filter(r => r.rec);
  const sumR = learned.reduce((s, r) => s + r.R, 0);
  const avgLearned = learned.length ? sumR / learned.length : 0;
  const overall = sumR / WORDS.length;
  const cHigh = learned.filter(r => r.R >= 0.8).length;
  const cMid = learned.filter(r => r.R >= 0.5 && r.R < 0.8).length;
  const cLow = learned.filter(r => r.R < 0.5).length;
  const cNew = WORDS.length - learned.length;
  const cDue = learned.filter(r => r.R <= THRESH).length;

  $('summary').innerHTML = `
    <div class="kpi"><div class="kpi-v">${pct(overall)}%</div><div class="kpi-l">全${WORDS.length}語の定着率</div></div>
    <div class="kpi"><div class="kpi-v">${learned.length ? pct(avgLearned) + '%' : '-'}</div><div class="kpi-l">学習済み${learned.length}語の平均</div></div>
    <div class="kpi"><div class="kpi-v">${cDue}</div><div class="kpi-l">復習対象（70%以下）</div></div>`;

  const seg = (n, cls) => n ? `<i class="${cls}" style="width:${n / WORDS.length * 100}%"></i>` : '';
  $('stackbar').innerHTML = seg(cHigh, 'lv-high') + seg(cMid, 'lv-mid') + seg(cLow, 'lv-low') + seg(cNew, 'lv-new');
  $('legend').innerHTML = `
    <span><i class="lv-high"></i>80%以上 ${cHigh}語</span>
    <span><i class="lv-mid"></i>50〜80% ${cMid}語</span>
    <span><i class="lv-low"></i>50%未満 ${cLow}語</span>
    <span><i class="lv-new"></i>未学習 ${cNew}語</span>`;

  $('gFilter').innerHTML = FILTERS.map(f =>
    `<button class="chip${gFilter === f.key ? ' on' : ''}" data-filter="${f.key}">${f.label}</button>`).join('');

  const q = gQuery.trim().toLowerCase();
  let list = rows.filter(r => {
    if (gFilter === 'due' && !(r.rec && r.R <= THRESH)) return false;
    if (gFilter === 'strong' && !(r.rec && r.R >= 0.8)) return false;
    if (gFilter === 'new' && r.rec) return false;
    if (q && !(r.w.en.toLowerCase().includes(q) || r.w.ja.includes(q))) return false;
    return true;
  });
  const key = r => r.rec ? r.R : 2;   // 未学習は最後
  if (gSort === 'Rasc') list.sort((a, b) => key(a) - key(b) || a.w.id - b.w.id);
  else if (gSort === 'Rdesc') list.sort((a, b) => (b.rec ? b.R : -1) - (a.rec ? a.R : -1) || a.w.id - b.w.id);
  else if (gSort === 'due') list.sort((a, b) => (a.rec ? dueTime(a.rec) : Infinity) - (b.rec ? dueTime(b.rec) : Infinity) || a.w.id - b.w.id);
  else list.sort((a, b) => a.w.id - b.w.id);

  $('wordList').innerHTML = list.length ? list.map(r => {
    const bar = r.rec
      ? `<span class="bar"><i class="${colorCls(r.R)}" style="width:${pct(r.R)}%"></i></span><span class="pc">${pct(r.R)}%</span>`
      : `<span class="bar"></span><span class="pc dim">未学習</span>`;
    return `<div class="row" data-id="${r.w.id}">
      <span class="no">${r.w.id}</span>
      <span class="en">${esc(layoutOf(r.w.en))}</span>
      <span class="ja">${esc(r.w.ja)}</span>${bar}</div>`;
  }).join('') : '<div class="empty-list">該当する単語がありません</div>';
}

// ==========================================
// 単語ごとの忘却曲線グラフ
// ==========================================
const RANGES = { auto: null, '1d': 24, '3d': 72, '7d': 168, '30d': 720, '90d': 2160 };
const RANGE_LABEL = { auto: '自動', '1d': '1日', '3d': '3日', '7d': '7日', '30d': '30日', '90d': '90日' };
let detailId = null, detailRange = 'auto';

function chartSVG(rec, rangeKey) {
  const W = 680, HT = 330, ml = 48, mr = 18, mt = 20, mb = 56;
  const iw = W - ml - mr, ih = HT - mt - mb;
  const t0 = rec.first;
  const tn = Math.max(now(), t0);
  const due = dueTime(rec);
  const xMaxH = RANGES[rangeKey] || Math.max(24, ((Math.max(tn, due) - t0) / H) * 1.15);
  const tEnd = t0 + xMaxH * H;
  const X = ms => ml + iw * Math.min(Math.max((ms - t0) / H / xMaxH, 0), 1);
  const Y = r => mt + ih * (1 - r);
  let s = '';

  // 横線(定着率)
  [0, 0.25, 0.5, 0.75, 1].forEach(v => {
    s += `<line class="c-grid" x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}"/>
          <text class="c-ylab" x="${ml - 8}" y="${Y(v) + 4}" text-anchor="end">${v * 100}%</text>`;
  });
  s += `<line class="c-thresh" x1="${ml}" x2="${W - mr}" y1="${Y(THRESH)}" y2="${Y(THRESH)}"/>
        <text class="c-thlab" x="${W - mr - 4}" y="${Y(THRESH) - 5}" text-anchor="end">復習ライン 70%</text>`;

  // 横軸(最初の学習からの経過時間)
  const steps = [1, 2, 3, 6, 12, 24, 48, 72, 168, 336, 720, 1440, 2160];
  const step = steps.find(v => xMaxH / v <= 8) || 2160;
  for (let h = 0; h <= xMaxH + 1e-9; h += step) {
    const t = t0 + h * H;
    const x = X(t);
    const lab = h === 0 ? '学習開始' : (step < 24 ? `${h}時間` : `${h / 24}日`);
    const d = new Date(t);
    const sub = step < 24 ? fmtDate(t) : `${d.getMonth() + 1}/${d.getDate()}`;
    s += `<line class="c-tick" x1="${x}" x2="${x}" y1="${Y(0)}" y2="${Y(0) + 5}"/>
          <text class="c-xlab" x="${x}" y="${Y(0) + 19}" text-anchor="middle">${lab}</text>
          <text class="c-xsub" x="${x}" y="${Y(0) + 33}" text-anchor="middle">${sub}</text>`;
  }

  // 区間ごとの曲線（復習のたびに100%に戻り、記憶の強さSに応じて緩やかになる）
  const segs = [];
  let start = rec.first, S = S0;
  rec.reviews.forEach(rv => { segs.push({ a: start, b: rv.t, S }); start = rv.t; S = rv.S1; });
  segs.push({ a: start, b: Infinity, S: rec.S });

  const pathOf = (seg, ta, tb) => {
    const n = 70;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const t = ta + (tb - ta) * i / n;
      const r = Math.exp(-((t - seg.a) / H) / seg.S);
      d += (i ? 'L' : 'M') + X(t).toFixed(1) + ',' + Y(r).toFixed(1);
    }
    return d;
  };
  segs.forEach(seg => {
    const a = seg.a, b = Math.min(seg.b, tEnd);
    if (a >= tEnd || b <= a) return;
    const pastEnd = Math.min(b, tn);
    if (pastEnd > a) s += `<path class="c-line" d="${pathOf(seg, a, pastEnd)}"/>`;
    const fs = Math.max(a, tn);
    if (b > fs) s += `<path class="c-line future" d="${pathOf(seg, fs, b)}"/>`;
  });

  // 復習した時点（思い出した時の定着率）
  rec.reviews.forEach((rv, i) => {
    if (rv.t > tEnd) return;
    const x = X(rv.t);
    s += `<line class="c-drop" x1="${x}" x2="${x}" y1="${Y(rv.R)}" y2="${Y(1)}"/>
          <circle class="c-dot ${rv.ok ? 'ok' : 'ng'}" cx="${x}" cy="${Y(rv.R)}" r="5.5">
            <title>${i + 2}回目 ${fmtDate(rv.t)}／想起時の定着率 ${pct(rv.R)}%／${rv.ok ? '思い出せた' : '忘れた'}</title></circle>`;
  });
  // 1回目の学習
  s += `<circle class="c-dot first" cx="${X(t0)}" cy="${Y(1)}" r="5.5"><title>1回目の学習 ${fmtDate(t0)}</title></circle>`;

  // 次回復習の目安
  if (due <= tEnd && due >= t0) {
    const x = X(due), y = Y(THRESH);
    s += `<polygon class="c-due" points="${x},${y - 7} ${x + 7},${y} ${x},${y + 7} ${x - 7},${y}"><title>次回復習の目安 ${fmtDate(due)}</title></polygon>`;
  }

  // 現在
  if (tn <= tEnd) {
    const x = X(tn), R = retention(rec, tn), y = Y(R);
    const right = x > W - 150;
    const ly = y < mt + 30 ? y + 24 : y - 12;
    s += `<line class="c-now" x1="${x}" x2="${x}" y1="${mt}" y2="${Y(0)}"/>
          <circle class="c-nowdot" cx="${x}" cy="${y}" r="6.5"/>
          <text class="c-nowlab" x="${x + (right ? -10 : 10)}" y="${ly}" text-anchor="${right ? 'end' : 'start'}">いま ${pct(R)}%</text>`;
  }

  return `<svg class="chart" viewBox="0 0 ${W} ${HT}" role="img" aria-label="忘却曲線">${s}</svg>`;
}

function openDetail(id) {
  detailId = id;
  renderDetail();
  $('modal').hidden = false;
  document.body.classList.add('modal-open');
}
function closeDetail() {
  $('modal').hidden = true;
  document.body.classList.remove('modal-open');
  detailId = null;
  if (!$('tab-graph').hidden) renderGraphTab();
}

function renderDetail() {
  const w = BY_ID[detailId];
  if (!w) return;
  const rec = state.learned[w.id];
  const head = `
    <div class="d-head">
      <div class="d-word">${esc(layoutOf(w.en))}</div>
      <button class="btn-audio" id="dSpeak" aria-label="発音">🔊</button>
      <span class="tag">${esc(w.pos)}</span>
    </div>
    <div class="d-ja">#${w.id}　${esc(w.ja)}</div>`;

  if (!rec) {
    $('modalBody').innerHTML = head + `
      <div class="d-empty">この単語はまだ学習していません。<br>学習すると、ここに忘却曲線が表示されます。</div>
      <div class="btn-group"><button class="btn-primary" id="dStudy">今すぐ学習する</button></div>`;
    $('dSpeak').onclick = () => speakEn(w);
    $('dStudy').onclick = () => { closeDetail(); switchTab('learn'); startSession([{ id: w.id, kind: 'new' }]); };
    return;
  }

  const tn = now();
  const R = retention(rec, tn);
  const lv = levelOf(R);
  const due = dueTime(rec);
  const dueTxt = due <= tn ? 'いま復習のタイミングです' : `${fmtDur(due - tn)}後（${fmtDate(due)}ごろ）`;

  const rangeChips = Object.keys(RANGES).map(k =>
    `<button class="chip small${detailRange === k ? ' on' : ''}" data-range="${k}">${RANGE_LABEL[k]}</button>`).join('');

  let hist = `<tr><td>1</td><td>${fmtDate(rec.first)}</td><td>—</td><td>—</td><td>初回の学習</td></tr>`;
  rec.reviews.forEach((rv, i) => {
    const prev = i === 0 ? rec.first : rec.reviews[i - 1].t;
    hist += `<tr><td>${i + 2}</td><td>${fmtDate(rv.t)}</td><td>${fmtDur(rv.t - prev)}後</td><td>${pct(rv.R)}%</td>
      <td class="${rv.ok ? 'ok' : 'ng'}">${rv.ok ? '○' : '×'}${rv.hint ? '（ヒントあり）' : ''} <span class="dim">${esc(MODE_LABEL[rv.mode] || rv.mode)}</span></td></tr>`;
  });

  $('modalBody').innerHTML = head + `
    <div class="d-level ${lv.cls}">
      <div class="d-pct">${pct(R)}%</div>
      <div><div class="d-lvl-t">現在の定着率</div><div class="d-lvl-s">${lv.text}</div></div>
    </div>
    <div class="d-facts">
      <div><span>次の復習の目安</span><b>${dueTxt}</b></div>
      <div><span>記憶の強さ S</span><b>${rec.S < 48 ? (Math.round(rec.S * 10) / 10) + '時間' : (Math.round(rec.S / 24 * 10) / 10) + '日'}</b></div>
      <div><span>学習回数</span><b>${rec.reviews.length + 1}回（復習${rec.reviews.length}回）</b></div>
    </div>
    <div class="d-range"><span>表示範囲</span>${rangeChips}</div>
    ${chartSVG(rec, detailRange)}
    <div class="chart-legend">
      <span><i class="dot first"></i>初回の学習</span>
      <span><i class="dot ok"></i>思い出せた</span>
      <span><i class="dot ng"></i>忘れた</span>
      <span><i class="dia"></i>次回復習の目安</span>
      <span><i class="ln"></i>実線＝これまで／破線＝今後の予測</span>
    </div>
    <div class="table-wrap"><table class="hist">
      <thead><tr><th>回</th><th>日時</th><th>前回から</th><th>想起時の定着率</th><th>結果</th></tr></thead>
      <tbody>${hist}</tbody></table></div>
    <div class="btn-group"><button class="btn-primary" id="dReview">今すぐこの単語を復習する</button></div>
    <div class="note-small">※エビングハウスの忘却曲線をもとにした推定値です。</div>`;
  $('dSpeak').onclick = () => speakEn(w);
  $('dReview').onclick = () => { closeDetail(); switchTab('learn'); startSession([{ id: w.id, kind: 'review' }]); };
}

// ==========================================
// タブ・設定・データ操作
// ==========================================
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('tab-learn').hidden = name !== 'learn';
  $('tab-graph').hidden = name !== 'graph';
  if (name === 'graph') renderGraphTab();
  if (name === 'learn') {
    updateLearnStats();
    // 学習が完了画面なら最新の状態で作り直す
    if (!cur) startSession(buildQueue());
  }
}

function renderTimeNow() {
  const off = state.offsetMs || 0;
  $('timeNow').textContent = off
    ? `仮想時刻：${fmtDate(now())}（実際より ${fmtDur(off)} 進めています）`
    : `現在の時刻：${fmtDate(now())}（時間は進めていません）`;
}

function exportData() {
  const str = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state));
  const a = document.createElement('a');
  a.setAttribute('href', str);
  a.setAttribute('download', `kb7_progress_backup_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function importData(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imp = JSON.parse(e.target.result);
      if (!imp || typeof imp.learned !== 'object') { alert('ファイルの形式が正しくありません'); return; }
      if (confirm('現在の学習記録が上書きされます。よろしいですか？')) {
        const base = defaultState();
        state = Object.assign(base, imp, { settings: Object.assign(base.settings, imp.settings || {}) });
        saveState();
        refreshAll();
        alert('学習記録をインポートしました');
      }
    } catch (err) {
      alert('ファイルの読み込みに失敗しました');
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

function resetAll() {
  if (!confirm('これまでの学習記録がすべて消えます。よろしいですか？')) return;
  state = defaultState();
  saveState();
  refreshAll();
  alert('学習記録をリセットしました');
}

function refreshAll() {
  $('newPerDay').value = String(state.settings.newPerDay);
  $('soundOn').checked = !!state.settings.sound;
  renderModeChips();
  renderHelp();
  renderTimeNow();
  startSession(buildQueue());
  if (!$('tab-graph').hidden) renderGraphTab();
}

// ==========================================
// イベント登録
// ==========================================
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

$('modeChips').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-mode]');
  if (!b) return;
  state.settings.mode = b.dataset.mode;
  saveState();
  renderModeChips();
  renderHelp();
  if (cur && cur.phase === 'q') {
    // 出題形式を変えたら、いまの問題を新しい形式でやり直す
    cur.mistake = false; cur.hint = false; cur.assist = false; cur.revealed = false;
    renderCard();
  }
});

$('gFilter').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-filter]');
  if (!b) return;
  gFilter = b.dataset.filter;
  renderGraphTab();
});
$('gQuery').addEventListener('input', ev => { gQuery = ev.target.value; renderGraphTab(); });
$('gSort').addEventListener('change', ev => { gSort = ev.target.value; renderGraphTab(); });
$('wordList').addEventListener('click', ev => {
  const row = ev.target.closest('.row');
  if (row) openDetail(Number(row.dataset.id));
});

$('modalClose').addEventListener('click', closeDetail);
$('modal').addEventListener('click', ev => { if (ev.target === $('modal')) closeDetail(); });
$('modalBody').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-range]');
  if (b) { detailRange = b.dataset.range; renderDetail(); }
});

$('newPerDay').addEventListener('change', ev => {
  state.settings.newPerDay = Number(ev.target.value);
  saveState();
  updateLearnStats();
});
$('soundOn').addEventListener('change', ev => { state.settings.sound = ev.target.checked; saveState(); });
$('btnExport').addEventListener('click', exportData);
$('btnImport').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', importData);
$('btnReset').addEventListener('click', resetAll);

document.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', () => {
  const h = Number(b.dataset.skip);
  state.offsetMs = h === 0 ? 0 : (state.offsetMs || 0) + h * H;
  saveState();
  renderTimeNow();
  updateLearnStats();
  if (!$('tab-graph').hidden) renderGraphTab();
  if (!cur) startSession(buildQueue());
}));

// キーボード操作
document.addEventListener('keydown', ev => {
  if (!$('modal').hidden) {
    if (ev.key === 'Escape') closeDetail();
    return;
  }
  if ($('tab-learn').hidden || !cur) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (cur.phase === 'intro' && ev.key === 'Enter') {
    ev.preventDefault();
    learnNew(cur.word.id); session.learned++; goNext();
  } else if (cur.phase === 'result' && ev.key === 'Enter') {
    ev.preventDefault();
    goNext();
  } else if (cur.phase === 'q' && state.settings.mode === 'card' && tag !== 'INPUT' && tag !== 'SELECT') {
    if (ev.code === 'Space') { ev.preventDefault(); revealCard(); }
    else if (ev.code === 'ArrowLeft') cardAnswer(false);
    else if (ev.code === 'ArrowRight') cardAnswer(true);
  }
});

// ==========================================
// 起動
// ==========================================
if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}
refreshAll();
