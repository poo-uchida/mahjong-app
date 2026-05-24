# _state シートのリファクタ計画

## 概要

`_state` シートをJSONblobから構造化データに変更する。  
メインシートへの参照式を持たせることで、メインシートを直接編集しても同期ボタンで即反映できる。

## 現状の問題

- `handleSave`: `JSON.stringify(state)` をA1セル1つに保存
- `handleLoad`: そのJSONを読んで返すだけ
- メインシートを直接編集 → `_state` JSONは古いまま → 同期しても反映されない
  - 現在は主に `rounds` と `players` をメインシートから再構築する処理を追加済みだが、やり方が複雑

## 変更後の _state シート構造

| A列(キー) | B列 | C列 | D列 | E列 | F列 |
|---|---|---|---|---|---|
| date | 2026-05-17 | | | | |
| uma1 | 10 | | | | |
| uma2 | 5 | | | | |
| expireAt | 1747584000000 | | | | |
| currentPage | 3 | | | | |
| phase | drink | | | | |
| players | ='シート名'!B1 | ='シート名'!C1 | ='シート名'!D1 | ='シート名'!E1 | |
| round | ='シート名'!B2 | ='シート名'!C2 | ='シート名'!D2 | ='シート名'!E2 | ='シート名'!G2 |
| round | ='シート名'!B3 | ... | | | |
| venue | 9000 | 1 | 100 | | |
| venue.amt | ='シート名'!B{r} | ... | | | |
| venue.pay | ='シート名'!B{r} | ... | | | |
| drink | 10000 | 0 | 10 | | |
| drink.amt | ='シート名'!B{r} | ... | | | |
| drink.pay | ='シート名'!B{r} | ... | | | |

- `players` 行: メインシートのヘッダー行(B〜E)への参照
- `round` 行: メインシートの上段(勝点行)への参照。B〜E=各プレイヤー勝点, F=倍率(G列参照)
  - 注意: メインシートの F列=横合計、G列=倍率。`_state` の round 行 F列は **G列(倍率)** を参照する。横合計は参照しない
- `venue` 行: total / payerIndex / roundUnit をスカラーで保存
- `venue.amt` 行: メインシートの場代行への参照
- `venue.pay` 行: メインシートの店舗支払い行への参照
- `drink` / `drink.amt` / `drink.pay`: 飲み代も同様。複数軒は同じキーを繰り返す

メインシートのセルを直接編集 → 参照式が自動更新 → `handleLoad` で即反映

## GAS の変更

### `writeSheet(ss, data)` の変更

- 変更前: 戻り値なし
- 変更後: 行番号情報を返す

```js
return {
  upperRowNums,       // 各局の上段行番号 [2, 3, 4, ...]
  venueAmountsRow,    // 場代行の行番号
  venuePaymentRow,    // 店舗支払い行の行番号
  drinkRows,          // [{amountsRow, paymentRow}, ...]
};
```

- 精算セクションの行番号を追跡するローカル変数を追加

### `writeStateSheet(ss, data, rowInfo)` を新規追加

1. `_state` シートをクリア
2. スカラー値を書き込み（date, uma1, uma2, expireAt, currentPage, phase）
3. players 行: ヘッダー行(row=1)への参照式
4. round 行: `rowInfo.upperRowNums` の各行番号への参照式（B〜E=勝点, F=G列=倍率）
5. venue 行: スカラー値 + `venue.amt` / `venue.pay` の参照式
6. drink 行: 飲み代ごとに同様

値の書き込みと数式の書き込みを分離（`setValues` → `setFormula`）して一括処理。

### `handleSave(body)` の変更

```js
function handleSave(body) {
  const ss = SpreadsheetApp.openById(body.spreadsheetId);
  const rowInfo = writeSheet(ss, body.data);   // 戻り値を受け取る
  writeStateSheet(ss, body.data, rowInfo);     // 追加
  return respond({ ok: true });
}
```

### `handleLoad(body)` の全書き直し

- 変更前: `_state` の A1 セルの JSON を `JSON.parse` して返す
- 変更後: `_state` シートの全行を読んでキーで分岐し state を組み立てる

```
各行のA列(キー)に応じた処理:
  'date'        → state.date
  'uma1'        → state.uma1
  'uma2'        → state.uma2
  'expireAt'    → state.expireAt
  'currentPage' → state.currentPage
  'phase'       → state.phase
  'players'     → state.players (B〜E)
  'round'       → state.rounds に push (B〜E=points, F=multiplier)
  'venue'       → state.venue 初期化 (B=total, C=payerIndex, D=roundUnit)
  'venue.amt'   → state.venue.amounts
  'venue.pay'   → state.venue.payment
  'drink'       → state.drinks に新エントリ push
  'drink.amt'   → 最新 drink の amounts
  'drink.pay'   → 最新 drink の payment
```

`base` / `adjust` は確定前の入力途中の値のため復元しない（ラウンド入力途中を復元しないのと同じ）。

`spreadsheetId` と `sheetUrl` はリクエストと `ss.getUrl()` から補完。  
`password` はフロント側で上書きするため含めない。

### 削除する処理

- `handleLoad` 内の「精算セクションから venue・drinks を再構築」ブロック（現在のメインシートパース処理）→ 不要になる

## フロントエンドの変更

### `handleSync` の変更

`expireAt` が `res.data` に含まれるようになるため、現在の

```js
state = { ...res.data, password: state.password };
```

で `expireAt` も正しく引き継がれる。追加変更不要。

## 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `gas/Code.js` | `handleSave` / `handleLoad` / `writeSheet` 修正、`writeStateSheet` 追加 |
| `app.js` | 変更なし |
| `index.html` | 変更なし |

## 注意事項

- `firstLowerRow === null`（ラウンドが0件）の場合の麻雀合計行は既存の課題として残す
- `_state` シートのシート名は `'_state'` のまま
- メインシート名は日付形式（例: `'2026-05-17'`）のため参照式は `='2026-05-17'!B1` 形式
