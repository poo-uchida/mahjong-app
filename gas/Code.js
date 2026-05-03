function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { action } = body;

    if (action === 'create') return handleCreate(body);
    if (action === 'save')   return handleSave(body);
    if (action === 'load')   return handleLoad(body);

    return respond({ ok: false, error: 'unknown action: ' + action });
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
  if (!raw) return respond({ ok: false, error: 'no data' });
  return respond({ ok: true, data: JSON.parse(raw) });
}

// スプレッドシートに成績表を書き込む
function writeSheet(ss, data) {
  const sheet = ss.getSheets()[0];
  sheet.clearContents();

  const { players, rounds = [], venue, drink } = data;
  const rows = [];

  // ヘッダー
  rows.push(['局', ...players, '横合計', '倍率']);

  // 上段: 各局の勝点(素点ベース)
  rounds.forEach((r, i) => {
    const sum = r.points.reduce((a, b) => a + b, 0);
    rows.push([i + 1, ...r.points, sum, r.multiplier]);
  });

  // 区切り
  rows.push(['--- 倍率適用後 ---', '', '', '', '', '', '']);

  // 中段: 勝点 × 倍率
  rounds.forEach((r, i) => {
    const scaled = r.points.map(p => p * r.multiplier);
    const sum = scaled.reduce((a, b) => a + b, 0);
    rows.push([i + 1, ...scaled, sum, r.multiplier]);
  });

  // 麻雀合計行(中段の縦合計)
  const mahjong = players.map((_, pi) =>
    rounds.reduce((sum, r) => sum + r.points[pi] * r.multiplier, 0)
  );
  rows.push(['麻雀合計', ...mahjong, mahjong.reduce((a, b) => a + b, 0), '']);

  // 場代合計行
  if (venue && venue.amounts) {
    rows.push(['場代', ...venue.amounts, venue.amounts.reduce((a, b) => a + b, 0), '']);
  }

  // 飲み代合計行
  if (drink && drink.amounts) {
    rows.push(['飲み代', ...drink.amounts, drink.amounts.reduce((a, b) => a + b, 0), '']);
  }

  // 収支合計行
  const vAmounts = venue && venue.amounts ? venue.amounts : players.map(() => 0);
  const dAmounts = drink && drink.amounts ? drink.amounts : players.map(() => 0);
  const total = players.map((_, pi) => mahjong[pi] + vAmounts[pi] + dAmounts[pi]);
  rows.push(['収支合計', ...total, total.reduce((a, b) => a + b, 0), '']);

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
