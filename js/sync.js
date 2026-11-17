// ==========================================
// Googleアカウントでの同期
//   学習記録を、ログインしたGoogleアカウントの Google Drive（アプリ専用の非表示フォルダ）に保存し、
//   別の端末で同じアカウントでログインすると、自動で取り込みます。
//   使う権限は drive.appdata（このアプリ専用のフォルダだけ）と、メールアドレスの表示だけです。
// ==========================================
(function () {
  'use strict';
  const CLIENT_ID = (typeof GOOGLE_CLIENT_ID !== 'undefined' ? String(GOOGLE_CLIENT_ID) : '').trim();
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email';
  const FILE_NAME = 'kb7_progress.json';
  const META_KEY = 'kb7_sync_meta';
  const $ = id => document.getElementById(id);
  const K = () => window.KB7;

  // ---------- 同期の設定（この端末だけ） ----------
  function loadMeta() {
    try { return Object.assign({ linked: false, email: '', lastSync: 0, fileId: '', uploadedSavedAt: 0 }, JSON.parse(localStorage.getItem(META_KEY)) || {}); }
    catch (e) { return { linked: false, email: '', lastSync: 0, fileId: '', uploadedSavedAt: 0 }; }
  }
  let meta = loadMeta();
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* 無視 */ } }

  let token = null, tokenExp = 0, tokenClient = null, pending = null;
  let busy = false, queued = false, timer = null, lastTokenTry = 0;
  const tokenValid = () => !!token && Date.now() < tokenExp - 60000;

  // ---------- 画面の表示 ----------
  function setStatus(kind, text) {
    const st = $('syncStatus'), btn = $('syncBtn');
    if (st) { st.textContent = text; st.className = 'sync-status ' + kind; }
    if (btn) {
      btn.className = 'sync-btn ' + kind;
      btn.title = text;
      btn.textContent = kind === 'syncing' ? '⟳' : kind === 'ok' ? '☁✓' : kind === 'error' ? '☁!' : kind === 'need' ? '☁?' : '☁';
    }
    const li = $('btnGLogin'), sy = $('btnGSync'), lo = $('btnGLogout');
    if (li) li.hidden = !CLIENT_ID || meta.linked;
    if (sy) sy.hidden = !(CLIENT_ID && meta.linked);
    if (lo) lo.hidden = !(CLIENT_ID && meta.linked);
  }
  function statusOK() {
    const f = K() ? K().fmtDate : (t => new Date(t).toLocaleString());
    setStatus('ok', `同期済み（${meta.email || 'Googleアカウント'}）／最終同期：${f(meta.lastSync)}`);
  }

  // ---------- Googleへのログイン（アクセストークン） ----------
  const gisReady = () => !!(window.google && google.accounts && google.accounts.oauth2);
  function initClient() {
    if (tokenClient) return tokenClient;
    if (!gisReady()) return null;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: resp => {
        if (!pending) return;
        const p = pending; pending = null;
        if (resp.error) return p.reject(Object.assign(new Error(resp.error), { kind: 'auth' }));
        token = resp.access_token;
        tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        p.resolve(token);
      },
      error_callback: err => {
        if (!pending) return;
        const p = pending; pending = null;
        p.reject(Object.assign(new Error((err && err.type) || 'popup_error'), { kind: 'auth' }));
      }
    });
    return tokenClient;
  }
  // prompt: 'none'＝画面を出さずに取得（ログイン済みのとき）／''＝必要なら画面を出す
  function ensureToken(prompt) {
    if (tokenValid()) return Promise.resolve(token);
    return new Promise((resolve, reject) => {
      const c = initClient();
      if (!c) return reject(Object.assign(new Error('Googleのログイン機能を読み込めていません（ネットワークを確認してください）'), { kind: 'net' }));
      pending = { resolve, reject };
      lastTokenTry = Date.now();
      try { c.requestAccessToken({ prompt: prompt === undefined ? 'none' : prompt }); }
      catch (e) { pending = null; reject(Object.assign(e, { kind: 'auth' })); }
    });
  }

  // ---------- Google Drive（アプリ専用フォルダ）の操作 ----------
  async function dfetch(url, opts, prompt, retried) {
    const t = await ensureToken(prompt);
    const res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, (opts && opts.headers) || {}, { Authorization: 'Bearer ' + t }) }));
    if (res.status === 401 && !retried) { token = null; return dfetch(url, opts, prompt, true); }
    if (!res.ok) { const e = new Error('Google Drive のエラー（' + res.status + '）'); e.status = res.status; e.kind = 'api'; throw e; }
    return res;
  }
  async function findFile(prompt) {
    const q = encodeURIComponent(`name='${FILE_NAME}'`);
    const res = await dfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=${encodeURIComponent('files(id,name,modifiedTime)')}&orderBy=${encodeURIComponent('modifiedTime desc')}`, {}, prompt);
    const j = await res.json();
    return (j.files && j.files[0]) || null;
  }
  async function download(id, prompt) {
    const res = await dfetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, prompt);
    return JSON.parse(await res.text());
  }
  async function upload(id, payload, prompt) {
    const body = JSON.stringify(payload);
    if (id) {
      await dfetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, prompt);
      return id;
    }
    const b = 'kb7b' + Date.now();
    const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
    const res = await dfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multipart }, prompt);
    return (await res.json()).id;
  }
  async function fetchEmail(prompt) {
    try { const res = await dfetch('https://www.googleapis.com/oauth2/v3/userinfo', {}, prompt); return (await res.json()).email || ''; }
    catch (e) { return ''; }
  }

  // ---------- 学習記録の統合 ----------
  const clone = o => JSON.parse(JSON.stringify(o));
  const sig = r => r ? `${r.last}|${(r.reviews || []).length}|${Math.round((r.B || 0) * 1e6)}` : '';
  function sameLearned(a, b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => b[k] && sig(a[k]) === sig(b[k]));
  }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.last !== b.last) return a.last > b.last ? a : b;
    const la = (a.reviews || []).length, lb = (b.reviews || []).length;
    if (la !== lb) return la > lb ? a : b;
    return (a.B || 0) >= (b.B || 0) ? a : b;
  }
  // リセット・インポートをした側（epochが新しい側）を優先。同じなら、単語ごとに新しいほうを採用する。
  function merge(local, remote) {
    const le = local.epoch || 0, re = remote.epoch || 0;
    if (le > re) return { learned: clone(local.learned), epoch: le, mode: 'local' };
    if (re > le) return { learned: clone(remote.learned), epoch: re, mode: 'remote' };
    const learned = {};
    new Set(Object.keys(local.learned).concat(Object.keys(remote.learned))).forEach(id => {
      learned[id] = clone(newer(local.learned[id], remote.learned[id]));
    });
    return { learned, epoch: le, mode: 'merge' };
  }
  const payloadOf = st => ({ app: 'kb7', schema: 1, version: st.version, epoch: st.syncEpoch || 0, savedAt: Date.now(), learned: st.learned });

  // ---------- 同期の本体 ----------
  async function syncNow(manual) {
    if (!CLIENT_ID || !meta.linked || !K()) return;
    if (busy) { queued = true; return; }
    busy = true;
    setStatus('syncing', '同期中…');
    const prompt = manual ? '' : 'none';
    try {
      await ensureToken(prompt);
      const st = K().getState();
      let file = meta.fileId ? { id: meta.fileId } : await findFile(prompt);
      let remote = null;
      if (file) {
        try { remote = await download(file.id, prompt); }
        catch (e) {
          if (e.status !== 404) throw e;
          meta.fileId = ''; file = await findFile(prompt); remote = file ? await download(file.id, prompt) : null;
        }
      }
      let remoteLearned = null;
      if (remote && remote.learned && typeof remote.learned === 'object') {
        const tmp = { version: remote.version || 2, learned: clone(remote.learned) };
        K().migrateState(tmp);                      // 古い形式の記録も取り込めるようにする
        remoteLearned = tmp.learned;
      }
      let result = { learned: st.learned, epoch: st.syncEpoch || 0, mode: 'local' };
      if (remoteLearned) result = merge({ learned: st.learned, epoch: st.syncEpoch || 0 }, { learned: remoteLearned, epoch: remote.epoch || 0 });
      // この端末の記録が変わるとき
      if (!sameLearned(result.learned, st.learned) || result.epoch !== (st.syncEpoch || 0)) {
        if (result.mode === 'remote' && Object.keys(st.learned).length) {
          try { localStorage.setItem('kb7_state_v1_presync', JSON.stringify(st)); } catch (e) { /* 無視 */ }   // 置き換える前の記録を退避
        }
        K().applyRemote(result.learned, result.epoch);
      }
      // Drive の記録と違うとき（またはファイルが無いとき）はアップロード
      const now = K().getState();
      if (!remote || !sameLearned(now.learned, remoteLearned || {}) || (now.syncEpoch || 0) !== (remote.epoch || 0)) {
        meta.fileId = await upload(file ? file.id : null, payloadOf(now), prompt);
      }
      meta.lastSync = Date.now();
      meta.uploadedSavedAt = now.savedAt || 0;
      saveMeta();
      statusOK();
    } catch (e) {
      if (e && e.kind === 'auth') setStatus('need', manual ? 'ログインできませんでした。もう一度お試しください。' : '同期を再開するには、☁ をクリックしてください。');
      else if (e && e.kind === 'net') setStatus('error', e.message);
      else setStatus('error', '同期できませんでした：' + ((e && e.message) || '不明なエラー') + '（あとで自動的にやり直します）');
    } finally {
      busy = false;
      if (queued) { queued = false; schedule(3000); }
    }
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => syncNow(false), ms); }
  const dirty = () => K() && (K().getState().savedAt || 0) > (meta.uploadedSavedAt || 0);

  async function login() {
    if (!CLIENT_ID) { setStatus('off', '同期は未設定です（js/config.js にGoogleのクライアントIDが必要です）。'); return; }
    try {
      setStatus('syncing', 'Googleにログインしています…');
      await ensureToken('');
      meta.email = await fetchEmail('');
      meta.linked = true; meta.fileId = '';
      saveMeta();
      await syncNow(true);
    } catch (e) {
      setStatus('need', 'ログインできませんでした。ポップアップがブロックされていないか確認して、もう一度お試しください。');
    }
  }
  function logout() {
    try { if (token && gisReady()) google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* 無視 */ }
    token = null; tokenExp = 0;
    meta.linked = false; meta.email = ''; meta.fileId = '';
    saveMeta();
    setStatus('off', '同期をやめました（この端末の学習記録はそのまま残ります。Google Drive の記録も残ります）。');
  }

  // ---------- 自動で動かす仕組み ----------
  window.KB7_onSaved = () => { if (CLIENT_ID && meta.linked) schedule(15000); };      // 学習するたびに、少しまとめてアップロード
  setInterval(() => { if (meta.linked && tokenValid()) syncNow(false); }, 5 * 60 * 1000); // 5分ごとに、ほかの端末の記録を確認
  document.addEventListener('visibilitychange', () => {
    if (!meta.linked || !CLIENT_ID) return;
    if (document.visibilityState === 'hidden') { if (dirty() && tokenValid()) syncNow(false); }
    else syncNow(false);
  });
  // 画面を触った最初のタイミングで、ログインを自動で再開する（ブラウザのポップアップ制限に引っかからないため）
  document.addEventListener('pointerdown', () => {
    if (CLIENT_ID && meta.linked && !tokenValid() && !busy && Date.now() - lastTokenTry > 60000) syncNow(false);
  });

  // ---------- 画面とのつなぎ ----------
  function init() {
    const btn = $('syncBtn');
    if (btn) { btn.hidden = !CLIENT_ID; btn.addEventListener('click', () => { if (!meta.linked) login(); else syncNow(true); }); }
    const li = $('btnGLogin'), sy = $('btnGSync'), lo = $('btnGLogout');
    if (li) li.addEventListener('click', login);
    if (sy) sy.addEventListener('click', () => syncNow(true));
    if (lo) lo.addEventListener('click', logout);
    if (!CLIENT_ID) { setStatus('off', '同期は未設定です（js/config.js にGoogleのクライアントIDを入れると使えます。手順は README.md にあります）。'); return; }
    if (meta.linked) { setStatus('need', 'Googleアカウントと同期中…（最初に画面をタップすると再開します）'); setTimeout(() => syncNow(false), 1500); }
    else setStatus('off', 'ログインすると、学習記録がほかの端末とも共有されます。');
  }
  window.KB7_sync = { syncNow, login, logout, merge, getMeta: () => meta, tokenValid };
  init();
})();
