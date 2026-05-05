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
  return respond({ ok: true, data: JSON.parse(raw) });
}

function handleDelete(body) {
  DriveApp.getFileById(body.spreadsheetId).setTrashed(true);
  return respond({ ok: true });
}

function writeSheet(ss, data) {
  const sheet = ss.getSheets()[0];
  sheet.clearContents();

  const { players, rounds = [], venue, drinks = [] } = data;
  const rows = [];

  // ヘッダー
  rows.push(['局', ...players, '横合計', '倍率']);

  // 上段: 各局の勝点
  rounds.forEach((r, i) => {
    const sum = r.points.reduce((a, b) => a + b, 0);
    rows.push([i + 1, ...r.points, sum, r.multiplier]);
  });

  // 中段: 勝点 × 倍率
  rows.push(['--- 倍率適用後 ---', '', '', '', '', '', '']);
  rounds.forEach((r, i) => {
    const scaled = r.points.map(p => p * r.multiplier);
    const sum = scaled.reduce((a, b) => a + b, 0);
    rows.push([i + 1, ...scaled, sum, r.multiplier]);
  });

  // 麻雀合計
  const mahjong = players.map((_, pi) =>
    rounds.reduce((sum, r) => sum + r.points[pi] * r.multiplier, 0)
  );
  rows.push(['麻雀合計', ...mahjong, mahjong.reduce((a, b) => a + b, 0), '']);

  // 場代
  const vAmounts = venue && venue.amounts ? venue.amounts : players.map(() => 0);
  if (venue && venue.amounts) {
    rows.push(['場代', ...vAmounts, vAmounts.reduce((a, b) => a + b, 0), '']);
  }

  // 飲み代(複数軒対応)
  const drinkTotals = players.map(() => 0);
  drinks.forEach((d, i) => {
    if (d && d.amounts) {
      rows.push([`飲み代${drinks.length > 1 ? i + 1 : ''}`, ...d.amounts, d.amounts.reduce((a, b) => a + b, 0), '']);
      d.amounts.forEach((amt, pi) => { drinkTotals[pi] += amt; });
    }
  });

  // 収支合計
  const total = players.map((_, pi) => mahjong[pi] + vAmounts[pi] + drinkTotals[pi]);
  rows.push(['収支合計', ...total, total.reduce((a, b) => a + b, 0), '']);

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
