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
              expireAt: Date.now() + ONE_DAY_MS, rounds: [], currentPage: 2 };
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
  const order = [0, 1, 2, 3].sort((a, b) => raw[b] - raw[a]);
  const umaList = [uma1, uma2, -uma2, -uma1];

  const uma = new Array(4);
  order.forEach((pi, rank) => { uma[pi] = umaList[rank]; });

  const rounded = raw.map(s => gosharokunyu(s / 1000));

  const base = new Array(4);
  order.slice(1).forEach(pi => { base[pi] = rounded[pi] - 30; });

  const firstIdx = order[0];
  base[firstIdx] = -order.slice(1).reduce((sum, pi) => sum + base[pi], 0);

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
  document.getElementById('btnOcr').addEventListener('click', () => document.getElementById('ocrFileInput').click());
  document.getElementById('ocrFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleOcrFile(file);
    e.target.value = '';
  });
}

function renderPage2() {
  calcDone = false;
  document.getElementById('p2RoundLabel').textContent = `第${state.rounds.length + 1}局の入力`;

  const tbody = document.getElementById('p2InputBody');
  tbody.innerHTML = '';
  state.players.forEach((name, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="align-middle">${name}</td>
      <td class="score-col"><input type="number" id="score${i}" class="form-control form-control-sm" inputmode="numeric"></td>
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

  const nullIdx = scores.indexOf(null);
  const sum = scores.reduce((s, v) => v !== null ? s + v : s, 0);
  scores[nullIdx] = 100000 - sum;
  document.getElementById(`score${nullIdx}`).value = scores[nullIdx];

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

  const btn = document.getElementById('btnToggle');
  btn.className = isScaled
    ? 'btn btn-sm btn-primary'
    : 'btn btn-sm btn-outline-secondary';

  const header = document.getElementById('roundsHeader');
  header.innerHTML = `<th>局</th>${players.map(n => `<th>${n}</th>`).join('')}${isScaled ? '' : '<th>倍</th>'}`;

  const tbody = document.getElementById('roundsBody');
  tbody.innerHTML = '';
  rounds.forEach((r, i) => {
    const vals = isScaled ? r.points.map(p => p * r.multiplier) : r.points;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td>${vals.map(v => `<td>${v > 0 ? '+' : ''}${v}</td>`).join('')}${isScaled ? '' : `<td>${r.multiplier}</td>`}`;
    tbody.appendChild(tr);
  });

  if (isScaled && rounds.length > 0) {
    const totals = players.map((_, pi) =>
      rounds.reduce((s, r) => s + r.points[pi] * r.multiplier, 0)
    );
    const tr = document.createElement('tr');
    tr.className = 'fw-bold table-light';
    tr.innerHTML = `<td>計</td>${totals.map(v => `<td>${v > 0 ? '+' : ''}${v}</td>`).join('')}`;
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

  try {
    const res = await gasRequest({ action: 'save', spreadsheetId: state.spreadsheetId, data: state });
    if (!res.ok) throw new Error(res.error);
  } catch {
    showError('保存に失敗しました。同期ボタンで再試行してください');
  }
}

async function handleEndGame() {
  if (!confirm('ゲームを終了して精算に進みますか？')) return;
  state.currentPage = 3;
  state.phase = 'venue';
  saveState();
  showPage(3);
  renderPage3();
  try {
    const res = await gasRequest({ action: 'save', spreadsheetId: state.spreadsheetId, data: state });
    if (!res.ok) throw new Error(res.error);
  } catch {
    showError('保存に失敗しました。同期ボタンで再試行してください');
  }
}

// --- Page 3: 精算 ---

let p3ListMode = 'scaled';
let p3RoundUnit = 1;

function initPage3() {
  document.getElementById('btnToggle3').addEventListener('click', () => {
    p3ListMode = p3ListMode === 'scaled' ? 'raw' : 'scaled';
    renderP3RoundsTable();
  });

  document.getElementById('p3TotalInput').addEventListener('input', () => {
    updateP3Table();
    validateP3();
  });

  document.querySelectorAll('.round-unit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      p3RoundUnit = parseInt(e.currentTarget.dataset.unit);
      updateRoundUnitBtns();
      updateP3Table();
      validateP3();
    });
  });

  document.getElementById('btnConfirmPage3').addEventListener('click', handleConfirmPage3);
}

function renderPage3() {
  p3ListMode = 'scaled';
  renderP3RoundsTable();
  renderP3ConfirmedList();
  renderP3Summary();
  document.getElementById('p3PhaseLabel').textContent =
    state.phase === 'venue' ? '場代の精算' : '飲み代の精算';
  resetP3Input();
}

function renderP3ConfirmedList() {
  const el = document.getElementById('p3ConfirmedList');
  const items = [];
  if (state.venue) {
    items.push(`場代: ${state.venue.total.toLocaleString()}円`);
  }
  state.drinks.forEach((d, i) => {
    const label = state.drinks.length > 1 ? `飲み代${i + 1}` : '飲み代';
    items.push(`${label}: ${d.total.toLocaleString()}円`);
  });
  el.innerHTML = items.length
    ? `<p class="small text-muted mb-2">確定済み: ${items.join(' / ')}</p>`
    : '';
}

function renderP3Summary() {
  const { players, rounds, venue, drinks } = state;

  document.getElementById('p3SummaryHeader').innerHTML =
    `<th></th>${players.map(n => `<th class="text-end">${n}</th>`).join('')}`;

  const tbody = document.getElementById('p3SummaryBody');
  tbody.innerHTML = '';
  if (rounds.length === 0) return;

  function fmt(v) { return v === 0 ? '' : v.toLocaleString(); }

  function addRow(label, values, cls) {
    const tr = document.createElement('tr');
    if (cls) tr.className = cls;
    tr.innerHTML = `<td>${label}</td>${values.map(v => `<td class="text-end">${fmt(v)}</td>`).join('')}`;
    tbody.appendChild(tr);
  }

  const mahjongSettle = players.map((_, pi) =>
    rounds.reduce((s, r) => s + r.points[pi] * r.multiplier, 0) * 10
  );
  addRow('麻雀精算', mahjongSettle);

  if (!venue || !venue.amounts) return;

  addRow('場代', venue.amounts);
  addRow('店舗支払い', venue.payment);

  const validDrinks = drinks.filter(d => d && d.amounts);
  validDrinks.forEach((d, i) => {
    const label = validDrinks.length > 1 ? `飲み代${i + 1}` : '飲み代';
    addRow(label, d.amounts);
    addRow('店舗支払い', d.payment);
  });

  const balance = players.map((_, pi) => {
    let s = mahjongSettle[pi] + venue.amounts[pi] + venue.payment[pi];
    validDrinks.forEach(d => { s += d.amounts[pi] + d.payment[pi]; });
    return s;
  });
  addRow('収支合計', balance, 'fw-bold table-light');
}

function renderP3RoundsTable() {
  const { players, rounds } = state;
  const isScaled = p3ListMode === 'scaled';

  const btn = document.getElementById('btnToggle3');
  btn.className = isScaled ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline-secondary';

  document.getElementById('p3RoundsHeader').innerHTML =
    `<th>局</th>${players.map(n => `<th>${n}</th>`).join('')}${isScaled ? '' : '<th>倍</th>'}`;

  const tbody = document.getElementById('p3RoundsBody');
  tbody.innerHTML = '';
  rounds.forEach((r, i) => {
    const vals = isScaled ? r.points.map(p => p * r.multiplier) : r.points;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td>${vals.map(v => `<td>${v > 0 ? '+' : ''}${v}</td>`).join('')}${isScaled ? '' : `<td>${r.multiplier}</td>`}`;
    tbody.appendChild(tr);
  });

  if (isScaled && rounds.length > 0) {
    const totals = players.map((_, pi) =>
      rounds.reduce((s, r) => s + r.points[pi] * r.multiplier, 0)
    );
    const tr = document.createElement('tr');
    tr.className = 'fw-bold table-light';
    tr.innerHTML = `<td>計</td>${totals.map(v => `<td>${v > 0 ? '+' : ''}${v}</td>`).join('')}`;
    tbody.appendChild(tr);
  }
}

function resetP3Input() {
  p3RoundUnit = 1;
  document.getElementById('p3TotalInput').value = '';
  updateRoundUnitBtns();
  renderP3SettleTable();
  validateP3();
}

function updateRoundUnitBtns() {
  document.querySelectorAll('.round-unit-btn').forEach(btn => {
    const unit = parseInt(btn.dataset.unit);
    btn.className = `btn btn-sm round-unit-btn ${unit === p3RoundUnit ? 'btn-secondary' : 'btn-outline-secondary'}`;
  });
}

function calcP3Base() {
  const total = parseInt(document.getElementById('p3TotalInput').value) || 0;
  if (total <= 0) return [0, 0, 0, 0];
  const base = Math.floor(total / 4 / p3RoundUnit) * p3RoundUnit;
  return [-base, -base, -base, -base];
}

function renderP3SettleTable() {
  const { players } = state;
  const base = calcP3Base();
  const tbody = document.getElementById('p3SettleBody');
  tbody.innerHTML = '';

  players.forEach((name, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="align-middle">${name}</td>
      <td class="text-end align-middle" id="p3Base${i}">${base[i] || ''}</td>
      <td><input type="number" id="p3Adj${i}" class="form-control form-control-sm" value="0"></td>
      <td class="text-end align-middle" id="p3RowTotal${i}">${base[i] || ''}</td>
      <td class="text-center align-middle"><input type="radio" name="p3Payer" value="${i}" class="form-check-input"></td>
    `;
    tbody.appendChild(tr);
    document.getElementById(`p3Adj${i}`).addEventListener('input', () => {
      updateP3Table();
      validateP3();
    });
  });

  document.querySelectorAll('input[name="p3Payer"]').forEach(r => {
    r.addEventListener('change', validateP3);
  });

  updateP3Totals(base);
}

function updateP3Table() {
  const base = calcP3Base();
  [0, 1, 2, 3].forEach(i => {
    const baseEl = document.getElementById(`p3Base${i}`);
    if (!baseEl) return;
    baseEl.textContent = base[i] || '';
    const adj = parseInt(document.getElementById(`p3Adj${i}`)?.value) || 0;
    document.getElementById(`p3RowTotal${i}`).textContent = base[i] + adj;
  });
  updateP3Totals(base);
}

function updateP3Totals(base) {
  const total = parseInt(document.getElementById('p3TotalInput').value) || 0;
  const adjSum = [0, 1, 2, 3].reduce((s, i) =>
    s + (parseInt(document.getElementById(`p3Adj${i}`)?.value) || 0), 0);
  const grandTotal = base.reduce((a, b) => a + b, 0) + adjSum;
  const shortfall  = total + grandTotal;

  document.getElementById('p3Shortfall').textContent =
    total > 0 ? (shortfall !== 0 ? `不足: ${shortfall}` : '✓') : '';
  document.getElementById('p3GrandTotal').textContent = total > 0 ? grandTotal : '';
}

function validateP3() {
  const total      = parseInt(document.getElementById('p3TotalInput').value) || 0;
  const base       = calcP3Base();
  const adjSum     = [0, 1, 2, 3].reduce((s, i) =>
    s + (parseInt(document.getElementById(`p3Adj${i}`)?.value) || 0), 0);
  const grandTotal = base.reduce((a, b) => a + b, 0) + adjSum;
  const payerOk    = !!document.querySelector('input[name="p3Payer"]:checked');
  document.getElementById('btnConfirmPage3').disabled =
    !(total > 0 && grandTotal === -total && payerOk);
}

async function handleConfirmPage3() {
  clearError();
  const total      = parseInt(document.getElementById('p3TotalInput').value) || 0;
  const base       = calcP3Base();
  const adjust     = [0, 1, 2, 3].map(i => parseInt(document.getElementById(`p3Adj${i}`)?.value) || 0);
  const amounts    = base.map((b, i) => b + adjust[i]);
  const payerIndex = parseInt(document.querySelector('input[name="p3Payer"]:checked').value);
  const payment    = state.players.map((_, i) => i === payerIndex ? total : 0);
  const entry      = { total, payerIndex, roundUnit: p3RoundUnit, base, adjust, amounts, payment };

  const btn = document.getElementById('btnConfirmPage3');
  btn.disabled = true;
  btn.textContent = '送信中...';

  const prevVenue  = state.venue;
  const prevDrinks = [...state.drinks];
  const prevPhase  = state.phase;

  if (state.phase === 'venue') {
    state.venue = entry;
    state.phase = 'drink';
  } else {
    state.drinks = [...state.drinks, entry];
  }

  try {
    const res = await gasRequest({ action: 'save', spreadsheetId: state.spreadsheetId, data: state });
    if (!res.ok) throw new Error(res.error);
    saveState();
    renderP3ConfirmedList();
    renderP3Summary();
    document.getElementById('p3PhaseLabel').textContent = '飲み代の精算';
    resetP3Input();
  } catch (err) {
    state.venue  = prevVenue;
    state.drinks = prevDrinks;
    state.phase  = prevPhase;
    showError('保存に失敗しました: ' + err.message);
  } finally {
    btn.textContent = '金額確定';
    validateP3();
  }
}
