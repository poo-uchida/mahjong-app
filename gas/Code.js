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
      case 'ocr':    return handleOcr(body);
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
  const rowInfo = writeSheet(ss, body.data);
  writeStateSheet(ss, body.data, rowInfo);
  return respond({ ok: true });
}

function handleLoad(body) {
  const ss = SpreadsheetApp.openById(body.spreadsheetId);

  const stateSheet = ss.getSheetByName('_state');
  const lastRow = stateSheet.getLastRow();
  if (!lastRow) return respond({ ok: false, error: 'not_found' });

  const rows = stateSheet.getRange(1, 1, lastRow, 6).getValues();

  const state = { rounds: [], drinks: [] };
  let venue = null;

  for (const row of rows) {
    const key = String(row[0]);
    switch (key) {
      case 'date':        state.date        = row[1]; break;
      case 'uma1':        state.uma1        = Number(row[1]); break;
      case 'uma2':        state.uma2        = Number(row[1]); break;
      case 'expireAt':    state.expireAt    = Number(row[1]); break;
      case 'currentPage': state.currentPage = Number(row[1]); break;
      case 'phase':       state.phase       = String(row[1]); break;
      case 'players':
        state.players = [row[1], row[2], row[3], row[4]].map(String);
        break;
      case 'round': {
        const points = [row[1], row[2], row[3], row[4]].map(Number);
        const multiplier = Number(row[5]);
        state.rounds.push({ points, multiplier });
        break;
      }
      case 'venue':
        venue = { total: Number(row[1]), payerIndex: Number(row[2]), roundUnit: Number(row[3]) };
        break;
      case 'venue.amt':
        venue.amounts = [row[1], row[2], row[3], row[4]].map(Number);
        break;
      case 'venue.pay':
        venue.payment = [row[1], row[2], row[3], row[4]].map(Number);
        break;
      case 'drink':
        state.drinks.push({ total: Number(row[1]), payerIndex: Number(row[2]), roundUnit: Number(row[3]) });
        break;
      case 'drink.amt':
        state.drinks[state.drinks.length - 1].amounts = [row[1], row[2], row[3], row[4]].map(Number);
        break;
      case 'drink.pay':
        state.drinks[state.drinks.length - 1].payment = [row[1], row[2], row[3], row[4]].map(Number);
        break;
    }
  }

  if (venue) state.venue = venue;
  state.spreadsheetId = body.spreadsheetId;
  state.sheetUrl = ss.getUrl();

  return respond({ ok: true, data: state });
}

function handleDelete(body) {
  DriveApp.getFileById(body.spreadsheetId).setTrashed(true);
  return respond({ ok: true });
}

function handleOcr(body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
  if (!apiKey) return respond({ ok: false, error: 'VISION_API_KEY not set' });

  const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
  const payload = JSON.stringify({
    requests: [{
      image: { content: body.image },
      features: [{ type: 'TEXT_DETECTION' }],
    }],
  });

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload,
  });

  const json = JSON.parse(res.getContentText());
  const annotations = (json.responses[0].textAnnotations || []).slice(1); // 先頭は全文なのでスキップ

  const imgW = Number(body.imageWidth)  || 1;
  const imgH = Number(body.imageHeight) || 1;

  // 4桁前後の数字だけを抽出(7セグ卓の点数: 例 "0250" → 25000)
  const results = [];
  for (const ann of annotations) {
    const raw = ann.description.replace(/[^0-9]/g, '');
    if (raw.length < 3 || raw.length > 5) continue;

    const score = Number(raw) * 100;
    const verts = ann.boundingPoly.vertices;
    const xs = verts.map(v => v.x || 0);
    const ys = verts.map(v => v.y || 0);

    results.push({
      score,
      raw: ann.description,
      box: {
        x: ((Math.min(...xs) + Math.max(...xs)) / 2) / imgW,
        y: ((Math.min(...ys) + Math.max(...ys)) / 2) / imgH,
      },
    });

    if (results.length === 4) break;
  }

  if (body.debug && body.spreadsheetId) {
    writeOcrDebug(body.spreadsheetId, body.image, imgW, imgH, annotations, results);
  }

  return respond({ ok: true, results });
}

function writeOcrDebug(spreadsheetId, imageBase64, imgW, imgH, annotations, results) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName('_debug');
  if (!sheet) sheet = ss.insertSheet('_debug');
  sheet.clearContents();

  // 送信サイズ
  sheet.getRange(1, 1, 1, 2).setValues([['imageWidth', 'imageHeight']]);
  sheet.getRange(2, 1, 1, 2).setValues([[imgW, imgH]]);

  // 全検出(フィルタ前)
  sheet.getRange(4, 1, 1, 13).setValues([[
    'description', 'v0x', 'v0y', 'v1x', 'v1y', 'v2x', 'v2y', 'v3x', 'v3y',
    'center_px_x', 'center_px_y', 'box.x', 'box.y',
  ]]);
  const allRows = annotations.slice(0, 30).map(ann => {
    const v = ann.boundingPoly.vertices;
    const xs = v.map(p => p.x || 0);
    const ys = v.map(p => p.y || 0);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return [
      ann.description,
      v[0]?.x||0, v[0]?.y||0, v[1]?.x||0, v[1]?.y||0,
      v[2]?.x||0, v[2]?.y||0, v[3]?.x||0, v[3]?.y||0,
      cx, cy, cx/imgW, cy/imgH,
    ];
  });
  if (allRows.length > 0) sheet.getRange(5, 1, allRows.length, 13).setValues(allRows);

  // フィルタ後の results
  const r2 = allRows.length + 7;
  sheet.getRange(r2, 1, 1, 4).setValues([['[filtered] raw', 'score', 'box.x', 'box.y']]);
  if (results.length > 0) {
    sheet.getRange(r2 + 1, 1, results.length, 4).setValues(
      results.map(r => [r.raw, r.score, r.box.x, r.box.y])
    );
  }

  // 画像を挿入
  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(imageBase64), 'image/jpeg', 'debug.jpg');
    sheet.insertImage(blob, 1, r2 + results.length + 3);
  } catch (e) {
    sheet.getRange(r2 + results.length + 3, 1).setValue('画像挿入失敗: ' + e.message);
  }
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
  let venueAmountsRow = null;
  let venuePaymentRow = null;
  if (venue && venue.amounts) {
    venueAmountsRow = rowNum;
    pushRow(['場代', ...venue.amounts, '', ''], true);
    venuePaymentRow = rowNum;
    pushRow(['店舗支払い', ...venue.payment, '', ''], true);
  }

  // 飲み代 + 店舗支払い(複数軒対応)
  const drinkRows = [];
  drinks.forEach((d, i) => {
    if (d && d.amounts) {
      const amountsRow = rowNum;
      pushRow([`飲み代${drinks.length > 1 ? i + 1 : ''}`, ...d.amounts, '', ''], true);
      const paymentRow = rowNum;
      pushRow([`店舗支払い${drinks.length > 1 ? i + 1 : ''}`, ...d.payment, '', ''], true);
      drinkRows.push({ amountsRow, paymentRow });
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

  return { upperRowNums, venueAmountsRow, venuePaymentRow, drinkRows };
}

function writeStateSheet(ss, data, rowInfo) {
  const stateSheet = ss.getSheetByName('_state');
  stateSheet.clearContents();

  const sheetName = ss.getSheets()[0].getName();
  const { date, uma1, uma2, expireAt, currentPage, phase, players, rounds = [], venue, drinks = [] } = data;
  const { upperRowNums, venueAmountsRow, venuePaymentRow, drinkRows } = rowInfo;

  const rows     = [];
  const formulas = []; // { row, col, formula }
  let rowNum = 1;

  function pad(row) {
    while (row.length < 6) row.push('');
    return row;
  }

  function pushScalar(key, ...vals) {
    rows.push(pad([key, ...vals]));
    rowNum++;
  }

  function pushFormulas(key, colLetters) {
    rows.push(pad([key, ...Array(colLetters.length).fill('')]));
    colLetters.forEach((ref, i) => {
      formulas.push({ row: rowNum, col: i + 2, formula: `='${sheetName}'!${ref}` });
    });
    rowNum++;
  }

  // スカラー値
  pushScalar('date', date);
  pushScalar('uma1', uma1);
  pushScalar('uma2', uma2);
  pushScalar('expireAt', expireAt);
  pushScalar('currentPage', currentPage);
  pushScalar('phase', phase);

  // players: ヘッダー行への参照
  pushFormulas('players', players.map((_, i) => `${String.fromCharCode('B'.charCodeAt(0) + i)}1`));

  // round: 勝点(B〜E)と倍率(G)への参照
  rounds.forEach((_, i) => {
    const mainRow = upperRowNums[i];
    const refs = ['B', 'C', 'D', 'E'].map(c => `${c}${mainRow}`);
    refs.push(`G${mainRow}`);
    pushFormulas('round', refs);
  });

  // venue
  if (venue && venue.amounts) {
    pushScalar('venue', venue.total, venue.payerIndex, venue.roundUnit);
    pushFormulas('venue.amt', ['B', 'C', 'D', 'E'].map(c => `${c}${venueAmountsRow}`));
    pushFormulas('venue.pay', ['B', 'C', 'D', 'E'].map(c => `${c}${venuePaymentRow}`));
  }

  // drinks
  drinks.forEach((d, i) => {
    if (d && d.amounts) {
      const { amountsRow, paymentRow } = drinkRows[i];
      pushScalar('drink', d.total, d.payerIndex, d.roundUnit);
      pushFormulas('drink.amt', ['B', 'C', 'D', 'E'].map(c => `${c}${amountsRow}`));
      pushFormulas('drink.pay', ['B', 'C', 'D', 'E'].map(c => `${c}${paymentRow}`));
    }
  });

  stateSheet.getRange(1, 1, rows.length, 6).setValues(rows);
  formulas.forEach(({ row, col, formula }) => {
    stateSheet.getRange(row, col).setFormula(formula);
  });
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 初回認証用のテストリクエスト関数
function testPermission() {
  const url = 'https://vision.googleapis.com/v1/images:annotate?key=' 
    + PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
  // 空リクエストでも権限承認には十分
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ requests: [] }),
    muteHttpExceptions: true
  });
}