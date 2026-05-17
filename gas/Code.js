const SECRET = PropertiesService.getScriptProperties().getProperty('SECRET');

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.password !== SECRET) {
      return respond({ ok: false, error: 'unauthorized' });
    }

    switch (body.action) {
      case 'auth':   return respond({ ok: true });
      case 'create': return handleCreate(body);
      case 'save':   return handleSave(body);
      case 'load':   return handleLoad(body);
      case 'delete': return handleDelete(body);
      default:       return respond({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

function handleCreate(body) {
  const date = body.date; // '2026-05-03'
  const name = date.replace(/-/g, '') + '麻雀'; // '20260503麻雀'
  const ss = SpreadsheetApp.create(name);
  ss.getSheets()[0].setName(date);
  ss.insertSheet('_state');

  return respond({
    ok: true,
    spreadsheetId: ss.getId(),
    sheetUrl: ss.getUrl(),
  });
}

function handleSave(body) {
  const ss = SpreadsheetApp.openById(body.spreadsheetId);
  ss.getSheetByName('_state').getRange('A1').setValue(JSON.stringify(body.data));
  writeSheet(ss, body.data);
  return respond({ ok: true });
}

function handleLoad(body) {
  const ss = SpreadsheetApp.openById(body.spreadsheetId);

  const raw = ss.getSheetByName('_state').getRange('A1').getValue();
  if (!raw) return respond({ ok: false, error: 'not_found' });
  const savedState = JSON.parse(raw);

  // スプレッドのヘッダー行・勝点行から players と rounds を再構築
  const values = ss.getSheets()[0].getDataRange().getValues();
  const players = values[0].slice(1, 5).map(String); // B〜E列のヘッダー
  const rounds = [];
  for (let r = 1; r < values.length; r++) { // r=0 はヘッダー
    const row = values[r];
    if (typeof row[0] !== 'number') break; // セパレータ行に到達したら終了
    const points = [row[1], row[2], row[3], row[4]].map(Number);
    const multiplier = Number(row[6]); // G列
    rounds.push({ points, multiplier });
  }

  // 精算セクションから venue・drinks を再構築
  const settleIdx = values.findIndex(row => row[0] === '--- 精算 ---');
  if (settleIdx !== -1) {
    let r = settleIdx + 1;
    if (r < values.length && String(values[r][0]) === '麻雀精算') r++; // 麻雀精算をスキップ

    // 店舗支払い行をパース: 複数人分散に対応
    function parsePayment(row) {
      const payment = row.slice(1, 5).map(Number);
      const payerIndex = payment.findIndex(v => v > 0); // 後方互換用(最初の支払者)
      const total = payment.reduce((s, v) => s + v, 0);
      return { payment, payerIndex: Math.max(payerIndex, 0), total };
    }

    // 場代
    if (r < values.length && values[r][0] === '場代') {
      const amounts = values[r].slice(1, 5).map(Number);
      r++;
      let parsed = { payment: [0,0,0,0], payerIndex: 0, total: 0 };
      if (r < values.length && String(values[r][0]) === '店舗支払い') {
        parsed = parsePayment(values[r]);
        r++;
      }
      savedState.venue = { ...(savedState.venue || {}), amounts, ...parsed };
    }

    // 飲み代(複数軒対応)
    const drinks = [];
    while (r < values.length && String(values[r][0]).startsWith('飲み代')) {
      const amounts = values[r].slice(1, 5).map(Number);
      r++;
      let parsed = { payment: [0,0,0,0], payerIndex: 0, total: 0 };
      if (r < values.length && String(values[r][0]).startsWith('店舗支払い')) {
        parsed = parsePayment(values[r]);
        r++;
      }
      const existing = savedState.drinks && savedState.drinks[drinks.length];
      drinks.push({ ...(existing || {}), amounts, ...parsed });
    }
    if (drinks.length > 0) savedState.drinks = drinks;
  }

  return respond({ ok: true, data: { ...savedState, players, rounds } });
}

function handleDelete(body) {
  DriveApp.getFileById(body.spreadsheetId).setTrashed(true);
  return respond({ ok: true });
}

function writeSheet(ss, data) {
  const sheet = ss.getSheets()[0];
  sheet.clearContents();

  const { players, rounds = [], venue, drinks = [] } = data;
  const numCols      = players.length + 3;
  const sumCol       = players.length + 2; // 横合計の列(1-indexed)
  const mulColLetter = String.fromCharCode('A'.charCodeAt(0) + players.length + 2); // 倍率列(G)
  const endColLetter = String.fromCharCode('A'.charCodeAt(0) + players.length);     // E
  const playerCols   = players.map((_, i) => String.fromCharCode('B'.charCodeAt(0) + i)); // B~E

  const rows     = [];
  const formulas = []; // { row, col, formula }
  let rowNum = 1;

  function pushRow(rowData, needsSum) {
    rows.push(rowData);
    if (needsSum) {
      formulas.push({ row: rowNum, col: sumCol,
                      formula: `=SUM(B${rowNum}:${endColLetter}${rowNum})` });
    }
    rowNum++;
  }

  // ヘッダー
  pushRow(['局', ...players, '横合計', '倍率'], false);

  // 上段: 各局の勝点(値)
  const upperRowNums = [];
  rounds.forEach((r, i) => {
    upperRowNums.push(rowNum);
    pushRow([i + 1, ...r.points, '', r.multiplier], true);
  });

  // 区切り
  pushRow(['--- 倍率適用後 ---', ...Array(numCols - 1).fill('')], false);

  // 中段: 勝点×倍率(スプレッド計算式)
  let firstLowerRow = null;
  let lastLowerRow  = null;
  rounds.forEach((r, i) => {
    if (firstLowerRow === null) firstLowerRow = rowNum;
    lastLowerRow = rowNum;
    const upRow = upperRowNums[i];
    playerCols.forEach((col, pi) => {
      formulas.push({ row: rowNum, col: pi + 2,
                      formula: `=${col}${upRow}*${mulColLetter}${upRow}` });
    });
    formulas.push({ row: rowNum, col: sumCol,
                    formula: `=SUM(B${rowNum}:${endColLetter}${rowNum})` });
    pushRow([i + 1, ...Array(players.length).fill(''), '', ''], false);
  });

  // 麻雀合計: 中段の縦SUM
  const mahjongTotalRow = rowNum;
  playerCols.forEach((col, pi) => {
    formulas.push({ row: rowNum, col: pi + 2,
                    formula: `=SUM(${col}${firstLowerRow}:${col}${lastLowerRow})` });
  });
  pushRow(['麻雀合計', ...Array(players.length).fill(''), '', ''], true);

  pushRow(['--- 精算 ---', ...Array(numCols - 1).fill('')], false);

  // 麻雀精算: 麻雀合計 × 10
  const mahjongSettleRow = rowNum;
  playerCols.forEach((col, pi) => {
    formulas.push({ row: rowNum, col: pi + 2,
                    formula: `=${col}${mahjongTotalRow}*10` });
  });
  pushRow(['麻雀精算', ...Array(players.length).fill(''), '', ''], true);

  // 場代 + 店舗支払い
  if (venue && venue.amounts) {
    pushRow(['場代', ...venue.amounts, '', ''], true);
    pushRow(['店舗支払い', ...venue.payment, '', ''], true);
  }

  // 飲み代 + 店舗支払い(複数軒対応)
  drinks.forEach((d, i) => {
    if (d && d.amounts) {
      pushRow([`飲み代${drinks.length > 1 ? i + 1 : ''}`, ...d.amounts, '', ''], true);
      pushRow([`店舗支払い${drinks.length > 1 ? i + 1 : ''}`, ...d.payment, '', ''], true);
    }
  });

  // 収支合計: 麻雀精算〜直前行のSUM
  if (venue && venue.amounts) {
    const settleEndRow = rowNum - 1;
    playerCols.forEach((col, pi) => {
      formulas.push({ row: rowNum, col: pi + 2,
                      formula: `=SUM(${col}${mahjongSettleRow}:${col}${settleEndRow})` });
    });
    pushRow(['収支合計', ...Array(players.length).fill(''), '', ''], true);
  }

  // 値を一括書き込み
  sheet.getRange(1, 1, rows.length, numCols).setValues(rows);

  // 計算式を書き込み
  formulas.forEach(({ row, col, formula }) => {
    sheet.getRange(row, col).setFormula(formula);
  });
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
