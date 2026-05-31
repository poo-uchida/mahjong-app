const GAS_URL = 'https://script.google.com/macros/s/AKfycbyrGE95bSjDTIJKAI8lMaYpE6oIJqecBZv4iCH2ULHXAgtjiBRzt72p4-QzU5vF_khh/exec';

const STORAGE_KEY = 'mahjong-app-state';
const ONE_DAY_MS  = 24 * 60 * 60 * 1000;

let state = {
  password: '',
  date: '',
  players: ['', '', '', ''],
  uma1: 10,
  uma2: 5,
  rounds: [],
  venue: null,
  drinks: [],
  currentPage: 0,
  spreadsheetId: null,
  sheetUrl: null,
  expireAt: null,
  errorMessage: '',
  lastAssignment: null,
};

// --- localStorage ---

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadSavedState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const saved = JSON.parse(raw);
  if (saved.expireAt && Date.now() > saved.expireAt) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return saved;
}

// --- GAS API ---

async function gasRequest(body) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ ...body, password: state.password }),
  });
  return res.json();
}

// --- エラー表示 ---

function showError(msg) {
  const el = document.getElementById('errorArea');
  el.textContent = msg;
  el.className = `alert alert-danger mx-3 mt-3 py-2${msg ? '' : ' d-none'}`;
  state.errorMessage = msg;
}

function clearError() {
  showError('');
}

function showInfo(msg) {
  const el = document.getElementById('errorArea');
  el.textContent = msg;
  el.className = 'alert alert-info mx-3 mt-3 py-2';
}

// --- ページ切替 ---

function showPage(n) {
  [0, 1, 2, 3].forEach(i => {
    const el = document.getElementById(`page${i}`);
    if (el) el.classList.toggle('d-none', i !== n);
  });
  document.getElementById('pageIndicator').textContent = n > 0 ? `${n}/3ページ` : '';
  document.getElementById('btnSync').classList.toggle('d-none', n < 2);
  state.currentPage = n;
}

// --- 同期 ---

async function handleSync() {
  if (!confirm('同期しますか？未送信の変更は失われます')) return;
  clearError();
  const btn = document.getElementById('btnSync');
  btn.disabled = true;
  btn.textContent = '同期中...';
  let success = false;
  try {
    const res = await gasRequest({ action: 'load', spreadsheetId: state.spreadsheetId });
    if (!res.ok) throw new Error(res.error);
    state = { ...res.data, password: state.password };
    saveState();
    showPage(state.currentPage);
    if (state.currentPage === 2) renderPage2();
    if (state.currentPage === 3) renderPage3();
    success = true;
  } catch (err) {
    showError('同期に失敗しました: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = success ? '✓ 同期済み' : '同期';
    if (success) setTimeout(() => { btn.textContent = '同期'; }, 2000);
  }
}

// --- レジューム ---

function checkResume() {
  const saved = loadSavedState();
  if (!saved) return;
  state = saved;
  showPage(state.currentPage);
  if (state.currentPage === 1) initPage1Values();
  if (state.currentPage === 2) renderPage2();
  if (state.currentPage === 3) renderPage3();
  showInfo('前回の続きを再開しました');
}

// --- 初期化 ---

document.addEventListener('focusin', (e) => {
  if (e.target.tagName === 'INPUT') e.target.select();
});

document.addEventListener('DOMContentLoaded', () => {
  initPage0();
  initPage1();
  initPage2();
  initPage3();
  document.getElementById('btnSync').addEventListener('click', handleSync);
  document.getElementById('btnOcrOk').addEventListener('click', applyOcrResults);
  document.getElementById('ocrOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('ocrOverlay')) closeOcrDialog();
  });
  checkResume();
});
