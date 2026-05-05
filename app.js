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
  el.classList.toggle('d-none', !msg);
  state.errorMessage = msg;
}

function clearError() {
  showError('');
}

// --- ページ切替 ---

const PAGES = [0, 1, 2];

function showPage(n) {
  PAGES.forEach(i => {
    document.getElementById(`page${i}`).classList.toggle('d-none', i !== n);
  });
  document.getElementById('pageIndicator').textContent = n > 0 ? `${n}/3ページ` : '';
  document.getElementById('btnSync').classList.toggle('d-none', n < 2);
  state.currentPage = n;
}

// --- Page 0: ログイン ---

function initPage0() {
  document.getElementById('btnLogin').addEventListener('click', handleLogin);
}

async function handleLogin() {
  clearError();
  const pw = document.getElementById('password').value;
  const btn = document.getElementById('btnLogin');
  btn.disabled = true;
  btn.textContent = '確認中...';

  try {
    state.password = pw;
    const res = await gasRequest({ action: 'auth' });
    if (!res.ok) throw new Error(res.error === 'unauthorized' ? 'パスワードが違います' : res.error);
    saveState();
    showPage(1);
    initPage1Values();
  } catch (err) {
    state.password = '';
    showError(err.message === 'Failed to fetch' ? '通信に失敗しました' : err.message);
  } finally {
    btn.disabled = !document.getElementById('password').value;
    btn.textContent = 'ログイン';
  }
}

// --- Page 1: 設定 ---

function initPage1() {
  const btnStart = document.getElementById('btnStart');
  const inputs = ['date', 'player0', 'player1', 'player2', 'player3'];

  inputs.forEach(id => {
    document.getElementById(id).addEventListener('input', validatePage1);
  });

  btnStart.addEventListener('click', handleStart);
}

function initPage1Values() {
  const today = new Date().toLocaleDateString('sv');
  document.getElementById('date').value = today;
  validatePage1();
}

function validatePage1() {
  const date    = document.getElementById('date').value;
  const players = [0, 1, 2, 3].map(i => document.getElementById(`player${i}`).value.trim());
  document.getElementById('btnStart').disabled = !date || players.some(p => !p);
}

async function handleStart() {
  clearError();
  const date    = document.getElementById('date').value;
  const players = [0, 1, 2, 3].map(i => document.getElementById(`player${i}`).value.trim());
  const uma1    = parseInt(document.getElementById('uma1').value) || 10;
  const uma2    = parseInt(document.getElementById('uma2').value) || 5;

  const btn = document.getElementById('btnStart');
  btn.disabled = true;
  btn.textContent = '作成中...';

  try {
    const res = await gasRequest({ action: 'create', date });
    if (!res.ok) throw new Error(res.error);

    state = { ...state, date, players, uma1, uma2,
              spreadsheetId: res.spreadsheetId,
              sheetUrl: res.sheetUrl,
              expireAt: Date.now() + ONE_DAY_MS };
    saveState();
    showPage(2);
    renderPage2();
  } catch (err) {
    showError('スプレッドシート作成に失敗しました: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'ゲーム開始';
    validatePage1();
  }
}

// --- Page 2: 素点入力（スタブ） ---

function renderPage2() {
  document.getElementById('p2Date').textContent = state.date + ' の成績入力';
  document.getElementById('p2SheetUrl').href = state.sheetUrl || '#';
}

// --- レジューム ---

function checkResume() {
  const saved = loadSavedState();
  if (!saved) return;
  state = saved;
  showPage(state.currentPage);
  if (state.currentPage >= 2) renderPage2();
}

// --- 初期化 ---

document.addEventListener('DOMContentLoaded', () => {
  initPage0();
  initPage1();
  checkResume();
});
