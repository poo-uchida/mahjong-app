const STORAGE_KEY = 'mahjong-app-state';
const GAS_URL_KEY  = 'mahjong-gas-url';
const ONE_DAY_MS   = 24 * 60 * 60 * 1000;

let state = {
  date: '',
  players: ['', '', '', ''],
  uma1: 10,
  uma2: 5,
  rounds: [],
  venue: null,
  drink: null,
  currentPage: 1,
  phase: 'venue',
  finalized: false,
  spreadsheetId: null,
  sheetUrl: null,
};

// --- localStorage ---

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), state }));
}

function loadSavedState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const { savedAt, state: saved } = JSON.parse(raw);
  if (Date.now() - savedAt > ONE_DAY_MS) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return saved;
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

// --- GAS API ---

function getGasUrl() {
  return localStorage.getItem(GAS_URL_KEY) || '';
}

async function gasRequest(body) {
  const url = getGasUrl();
  if (!url) throw new Error('GAS URLが設定されていません');
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

// --- ページ切替 ---

function showPage(n) {
  document.getElementById('page1').classList.toggle('d-none', n !== 1);
  document.getElementById('page2').classList.toggle('d-none', n !== 2);
}

// --- 1ページ目 ---

function initPage1() {
  const urlInput = document.getElementById('gasUrl');
  urlInput.value = getGasUrl();
  urlInput.addEventListener('change', () => {
    localStorage.setItem(GAS_URL_KEY, urlInput.value.trim());
  });

  const today = new Date().toLocaleDateString('sv'); // yyyy-mm-dd
  document.getElementById('date').value = today;

  document.getElementById('btnStart').addEventListener('click', handleStart);
}

async function handleStart() {
  const gasUrl = getGasUrl();
  if (!gasUrl) { alert('GAS URLを入力してください'); return; }

  const date    = document.getElementById('date').value;
  const players = [0, 1, 2, 3].map(i => document.getElementById(`player${i}`).value.trim());
  const uma1    = parseInt(document.getElementById('uma1').value) || 10;
  const uma2    = parseInt(document.getElementById('uma2').value) || 5;

  if (!date || players.some(p => !p)) {
    alert('日付とプレイヤー名を全て入力してください');
    return;
  }

  const btn = document.getElementById('btnStart');
  btn.disabled = true;
  btn.textContent = '作成中...';

  try {
    const res = await gasRequest({ action: 'create', date });
    if (!res.ok) throw new Error(res.error);

    state = { ...state, date, players, uma1, uma2,
              spreadsheetId: res.spreadsheetId, sheetUrl: res.sheetUrl,
              currentPage: 2 };
    saveState();
    showPage(2);
    renderPage2();
  } catch (err) {
    alert('エラー: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'ゲーム開始';
  }
}

// --- 2ページ目（スタブ） ---

function renderPage2() {
  document.getElementById('p2Date').textContent = state.date + ' の成績入力';
  const link = document.getElementById('p2SheetUrl');
  link.href = state.sheetUrl || '#';
}

// --- レジューム ---

function checkResume() {
  const saved = loadSavedState();
  if (!saved || saved.finalized) return;
  if (confirm('前回の続きから再開しますか？')) {
    state = saved;
    showPage(state.currentPage);
    if (state.currentPage >= 2) renderPage2();
  } else {
    clearState();
  }
}

// --- 初期化 ---

document.addEventListener('DOMContentLoaded', () => {
  initPage1();
  checkResume();
});
