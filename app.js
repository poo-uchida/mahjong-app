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

function showPage(n) {
  [0, 1, 2, 3].forEach(i => {
    const el = document.getElementById(`page${i}`);
    if (el) el.classList.toggle('d-none', i !== n);
  });
  document.getElementById('pageIndicator').textContent = n > 0 ? `${n}/3ページ` : '';
  document.getElementById('btnSync').classList.toggle('d-none', n < 2);
  state.currentPage = n;
}

// ---- Page 0: ログイン ---

function initPage0() {
  document.getElementById('btnLogin').addEventListener('click', handleLogin);
}

async function handleLogin() {
  clearError();
  const pw  = document.getElementById('password').value;
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
    btn.disabled = false;
    btn.textContent = 'ログイン';
  }
}

// --- Page 1: 設定 ---

function initPage1() {
  ['date', 'player0', 'player1', 'player2', 'player3'].forEach(id => {
    document.getElementById(id).addEventListener('input', validatePage1);
  });
  document.getElementById('btnStart').addEventListener('click', handleStart);
}

function initPage1Values() {
  document.getElementById('date').value = new Date().toLocaleDateString('sv');
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
  const uma1    = parseInt(document.getElementById('inputUma1').value) || 10;
  const uma2    = parseInt(document.getElementById('inputUma2').value) || 5;

  const btn = document.getElementById('btnStart');
  btn.disabled = true;
  btn.textContent = '作成中...';

  try {
    const res = await gasRequest({ action: 'create', date });
    if (!res.ok) throw new Error(res.error);
    state = { ...state, date, players, uma1, uma2,
              spreadsheetId: res.spreadsheetId, sheetUrl: res.sheetUrl,
              expireAt: Date.now() + ONE_DAY_MS, rounds: [] };
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

// --- Page 2: 素点入力 ---

let listMode = 'scaled'; // 'scaled' | 'raw'
let calcDone = false;

function gosharokunyu(v) {
  return Math.floor(v + 0.4);
}

function calcRound(raw, uma1, uma2) {
  // 降順で順位決定
  const order = [0, 1, 2, 3].sort((a, b) => raw[b] - raw[a]);
  const umaList = [uma1, uma2, -uma2, -uma1];

  // ウマ(プレイヤー別)
  const uma = new Array(4);
  order.forEach((pi, rank) => { uma[pi] = umaList[rank]; });

  // 五捨六入
  const rounded = raw.map(s => gosharokunyu(s / 1000));

  // 2〜4位の勝点(ウマ込み前)
  const base = new Array(4);
  order.slice(1).forEach(pi => { base[pi] = rounded[pi] - 30; });

  // 1位の勝点(ウマ込み前) = 残りの合計を打ち消す
  const firstIdx = order[0];
  base[firstIdx] = -order.slice(1).reduce((sum, pi) => sum + base[pi], 0);

  // ウマを加算
  const points = base.map((p, i) => p + uma[i]);

  return { points, uma };
}

function initPage2() {
  document.getElementById('btnConfirm').addEventListener('click', handleConfirm);
  document.getElementById('btnToggle').addEventListener('click', () => {
    listMode = listMode === 'scaled' ? 'raw' : 'scaled';
    renderRoundsTable();
  });
  document.getElementById('btnEndGame').addEventListener('click', handleEndGame);
  document.getElementById('multiplier').addEventListener('input', validateConfirmButton);
}

function renderPage2() {
  calcDone = false;
  document.getElementById('p2RoundLabel').textContent = `第${state.rounds.length + 1}局の入力`;

  // 入力テーブル生成
  const tbody = document.getElementById('p2InputBody');
  tbody.innerHTML = '';
  state.players.forEach((name, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="align-middle">${name}</td>
      <td><input type="number" id="score${i}" class="form-control form-control-sm" inputmode="numeric"></td>
      <td class="align-middle text-end" id="uma${i}"></td>
      <td class="align-middle text-end" id="pts${i}"></td>
    `;
    tbody.appendChild(tr);
    document.getElementById(`score${i}`).addEventListener('focusin', handleFocusIn);
    document.getElementById(`score${i}`).addEventListener('focusout', handleFocusOut);
    document.getElementById(`score${i}`).addEventListener('input', validateConfirmButton);
  });

  renderRoundsTable();
  validateConfirmButton();
  validateEndGame();
}

function getScores() {
  return [0, 1, 2, 3].map(i => {
    const v = document.getElementById(`score${i}`).value;
    return v === '' ? null : Number(v);
  });
}

function handleFocusIn() {
  [0, 1, 2, 3].forEach(i => {
    document.getElementById(`uma${i}`).textContent = '';
    document.getElementById(`pts${i}`).textContent = '';
  });
  calcDone = false;
  validateConfirmButton();
}

function handleFocusOut() {
  const scores = getScores();
  const nullCount = scores.filter(v => v === null).length;
  if (nullCount !== 1) return;

  // 空欄1つを自動計算
  const nullIdx = scores.indexOf(null);
  const sum = scores.reduce((s, v) => v !== null ? s + v : s, 0);
  scores[nullIdx] = 100000 - sum;
  document.getElementById(`score${nullIdx}`).value = scores[nullIdx];

  // ウマ・勝点を表示
  const { points, uma } = calcRound(scores, state.uma1, state.uma2);
  [0, 1, 2, 3].forEach(i => {
    document.getElementById(`uma${i}`).textContent = (uma[i] > 0 ? '+' : '') + uma[i];
    document.getElementById(`pts${i}`).textContent = (points[i] > 0 ? '+' : '') + points[i];
  });
  calcDone = true;
  validateConfirmButton();
}

function validateConfirmButton() {
  const scores = getScores();
  const multiplier = parseInt(document.getElementById('multiplier').value);
  const ok = scores.every(v => v !== null) && calcDone && multiplier > 0;
  document.getElementById('btnConfirm').disabled = !ok;
}

function validateEndGame() {
  document.getElementById('btnEndGame').disabled = state.rounds.length < 1;
}

function renderRoundsTable() {
  const { players, rounds } = state;
  const isScaled = listMode === 'scaled';

  // ヘッダー: 素点モードは倍率列あり、倍率適用後は倍率列なし
  const header = document.getElementById('roundsHeader');
  header.innerHTML = `<th>局</th>${players.map(n => `<th>${n}</th>`).join('')}<th>計</th>${isScaled ? '' : '<th>倍</th>'}`;

  // 行
  const tbody = document.getElementById('roundsBody');
  tbody.innerHTML = '';
  rounds.forEach((r, i) => {
    const vals = isScaled ? r.points.map(p => p * r.multiplier) : r.points;
    const sum  = vals.reduce((a, b) => a + b, 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td>${vals.map(v => `<td>${v > 0 ? '+' : ''}${v}</td>`).join('')}<td>${sum}</td>${isScaled ? '' : `<td>${r.multiplier}</td>`}`;
    tbody.appendChild(tr);
  });

  // 倍率適用後モードのみ合計行
  if (isScaled && rounds.length > 0) {
    const totals = players.map((_, pi) =>
      rounds.reduce((s, r) => s + r.points[pi] * r.multiplier, 0)
    );
    const tr = document.createElement('tr');
    tr.className = 'fw-bold table-light';
    tr.innerHTML = `<td>計</td>${totals.map(v => `<td>${v > 0 ? '+' : ''}${v}</td>`).join('')}<td>${totals.reduce((a, b) => a + b, 0)}</td>`;
    tbody.appendChild(tr);
  }
}

async function handleConfirm() {
  clearError();
  const scores     = getScores();
  const multiplier = parseInt(document.getElementById('multiplier').value);
  if (scores.some(v => v === null) || !multiplier) return;

  const { points } = calcRound(scores, state.uma1, state.uma2);
  state.rounds.push({ points, multiplier });
  saveState();

  // 入力欄クリア(倍率は保持)
  [0, 1, 2, 3].forEach(i => {
    document.getElementById(`score${i}`).value = '';
    document.getElementById(`uma${i}`).textContent = '';
    document.getElementById(`pts${i}`).textContent = '';
  });
  calcDone = false;
  document.getElementById('p2RoundLabel').textContent = `第${state.rounds.length + 1}局の入力`;
  validateConfirmButton();
  validateEndGame();
  renderRoundsTable();

  // GASへ保存(失敗しても続行可能)
  try {
    const res = await gasRequest({ action: 'save', spreadsheetId: state.spreadsheetId, data: state });
    if (!res.ok) throw new Error(res.error);
  } catch {
    showError('保存に失敗しました。同期ボタンで再試行してください');
  }
}

function handleEndGame() {
  showPage(3);
  // renderPage3(); // 3ページ目実装時に追加
}

// --- レジューム ---

function checkResume() {
  const saved = loadSavedState();
  if (!saved) return;
  state = saved;
  showPage(state.currentPage);
  if (state.currentPage === 2) renderPage2();
}

// --- 初期化 ---

document.addEventListener('DOMContentLoaded', () => {
  initPage0();
  initPage1();
  initPage2();
  checkResume();
});
