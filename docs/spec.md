# 麻雀成績入力アプリ 要件定義(全体)

## 1. 概要

iPhone Safariで利用する個人用Webアプリ。1日分の麻雀(4人打ち)の成績を入力し、最終結果をGoogleスプレッドシートにフォーマットして書き出す。

## 2. 利用環境・対象ユーザー

- 利用デバイス: iPhone Safari (縦画面)
- 利用者: 自分のみ
- 利用シーン: 麻雀の対局中〜終了後にリアルタイムで入力
- 1日完結: 過去の履歴を跨ぐ機能は持たない(1回起動=1日分)

## 3. アーキテクチャ

### 構成

- **フロントエンド**: GitHub Pagesで静的ホスティング
- **バックエンド**: Google Apps Script (GAS) のWebアプリ (`doPost`)
- **データストア**: Googleスプレッドシート(ゲーム開始時に毎回新規作成)

### 通信

- フロント → GAS は `fetch` でPOST
- CORS回避のため `Content-Type: text/plain` でJSON文字列を送る
- GAS側はWebアプリとしてデプロイ(「全員」アクセス可、実行権限は自分)

### GAS側を分離する理由

GASだけで完結させるとHTML上部にGoogle警告バーが表示され、iframe化によりiPhoneでビューポートが崩れて横幅が制御できないため。

### リポジトリ構成

フロントとGASを同一リポジトリで管理。GASは [clasp](https://github.com/google/clasp) でローカル管理。

```
mahjong-app/
├── index.html       # 全画面入りのSPA(ルート配置)
├── app.js
├── style.css
├── debug.html       # 開発用デバッグページ(localStorage&スプレッド全削除)
├── gas/             # claspで管理するGAS側
│   ├── .clasp.json
│   ├── appsscript.json
│   └── Code.js
├── docs/
│   ├── spec.md      # 本ファイル
│   ├── page0.md     # 0ページ目(ログイン)詳細
│   ├── page1.md     # 1ページ目(設定)詳細
│   ├── page2.md     # 2ページ目(局入力)詳細
│   └── page3.md     # 3ページ目(精算)詳細
└── README.md
```

claspのセットアップ:

1. `npm install -g @google/clasp`
2. `clasp login` でGoogleアカウント認証
3. `clasp clone <scriptId>` または `clasp create` でプロジェクト初期化
4. `clasp push` で反映、`clasp deploy` でWebアプリ化

### GitHub Pages公開設定

- ルート(`/`)を公開元に指定
- publicリポジトリで運用
- **GASのデプロイURLは `app.js` にハードコード**する
  - publicリポジトリなのでURLは第三者に見られる前提
  - ただしGAS側のソースコードは外部から見られず、パスワード認証で守られているので実害は小さい
- パスワードはユーザーが0ページ目で入力 → localStorageに保存(コードには埋め込まない)
- privateにしたい場合は GitHub Pro 以上が必要

## 4. UIライブラリ

- **Bootstrap 5** をCDN読み込みで使用
- ビルド工程なし

## 5. ページ構成

全4ページのSPA。`index.html` 1ファイル内で `display` を切り替えて表示。

| ページ | 役割 | 詳細 |
|---|---|---|
| 0 | ログイン(パスワード入力、認証) | `docs/page0.md` |
| 1 | 設定(日付/参加者/ウマ) | `docs/page1.md` |
| 2 | 局ごとの素点入力と一覧表示 | `docs/page2.md` |
| 3 | 場代・飲み代の精算 | `docs/page3.md` |

### ページ遷移

```
[0]ログイン
  ↓ 認証OK
[1]設定 ──「ゲーム開始」→ [2]局入力 ──「ゲーム終了」→ [3]精算
                                                          ↓
                                                 場代→飲み代→飲み代…
                                                 (何軒でもループ可能)
```

明示的な「終了」処理は持たない。ユーザーが入力を終えたら画面を閉じるだけ。localStorageは24時間で自動的に消える。

## 6. データ構造(フロント内部 state)

```js
const state = {
  // 0ページ目(認証情報)
  password: '...',

  // 1ページ目(設定)
  date: '2026-05-03',
  players: ['いけだ', 'わたなべ', 'きよし', 'うちだ'],
  uma1: 10,
  uma2: 5,

  // 2ページ目(局ごとの結果)
  rounds: [
    {
      points: [-23, -30, 2, 51],  // ウマ込み勝点(4人分)
      multiplier: 3,               // 倍率
    },
  ],

  // 3ページ目(場代・飲み代)
  venue: {
    total: 9000,
    payerIndex: 1,        // 0-3
    roundUnit: 10,        // 円単位
    base: [-2200, -2200, -2200, -2200],   // C列(自動)
    adjust: [0, 0, 0, 0],                  // D列(手入力)
  },
  drinks: [               // 配列。何軒分でも追加可能
    { /* venue と同じ構造 */ },
  ],

  // 制御フラグ
  currentPage: 2,           // 現在のページ番号 (0/1/2/3)
  phase: 'venue',           // 'venue' | 'drink' (3ページ目内のモード)
  spreadsheetId: '1abc...', // 当日のスプレッドシートID
  sheetUrl: 'https://...',  // 当日のスプレッドシートURL
  expireAt: 1746498000000,  // localStorageの有効期限(create時に算出した24時間後のepoch ms)
  errorMessage: '',         // 共通エラー表示用(空文字なら非表示)
};
```

## 7. GAS API仕様

GASは1エンドポイントで複数アクションを `action` フィールドで分岐。

### 共通

- メソッド: POST
- Content-Type: text/plain (CORS回避)
- ボディ: JSON文字列
- **すべてのリクエストに `password` フィールドを含めること**

### アクション一覧

#### `action: 'auth'` - 認証確認のみ

ログイン画面で使用。パスワードが正しいかだけを確認。

リクエスト:
```json
{ "action": "auth", "password": "..." }
```

レスポンス:
```json
{ "ok": true }
```

#### `action: 'create'` - 新規スプレッドシート作成

ファイル名 `yyyymmdd麻雀` で新規作成しIDを返す。

リクエスト:
```json
{ "action": "create", "password": "...", "date": "2026-05-03" }
```

レスポンス:
```json
{
  "ok": true,
  "spreadsheetId": "1abc...",
  "sheetUrl": "https://docs.google.com/spreadsheets/d/1abc.../"
}
```

#### `action: 'save'` - 状態を書き込み

リクエスト:
```json
{
  "action": "save",
  "password": "...",
  "spreadsheetId": "1abc...",
  "data": { /* state全体(認証情報を除く) */ }
}
```

レスポンス:
```json
{ "ok": true }
```

GAS側のスプレッドへの書き込み形式:

- **上段(勝点行)**: 局番号 / 各プレイヤー勝点 / 横合計 / 倍率
- **下段(倍率適用後)**: 局番号 / 各プレイヤー勝点×倍率 / 横合計(倍率列なし)
- **麻雀合計**: 下段の縦合計
- **場代合計**: 場代総額 / 各人負担額 / 横合計
- **飲み代合計**: 飲み代ごとに1行(複数軒対応)
- **収支合計**: 全項目の合計

スプレッド内の計算関数はそのまま活かす。既存フォーマット参考: `https://docs.google.com/spreadsheets/d/1xVpgJpBNe5u_yKB_3j55DFT99TlgKuhgSzpUNFNkP08/`

#### `action: 'load'` - 状態を読み込み

リクエスト:
```json
{ "action": "load", "password": "...", "spreadsheetId": "1abc..." }
```

レスポンス:
```json
{ "ok": true, "data": { /* state全体 */ } }
```

GAS側はスプレッドの上段(勝点行)から `points` と `multiplier` を読み取ってstateを復元して返す。

#### `action: 'delete'` - スプレッドシートを削除(デバッグ用)

リクエスト:
```json
{ "action": "delete", "password": "...", "spreadsheetId": "1abc..." }
```

レスポンス:
```json
{ "ok": true }
```

`debug.html` から呼び出される。`DriveApp.getFileById(id).setTrashed(true)` でゴミ箱送り。

### エラー時

```json
{ "ok": false, "error": "..." }
```

主なエラー: `unauthorized`(パスワード不一致)、`not_found`(シート不在)など。

### GAS側 認証実装イメージ

```js
const SECRET = 'your-password-here';

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.password !== SECRET) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }
  switch (body.action) {
    case 'auth':   return jsonResponse({ ok: true });
    case 'create': return handleCreate(body);
    case 'save':   return handleSave(body);
    case 'load':   return handleLoad(body);
    default:       return jsonResponse({ ok: false, error: 'unknown_action' });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 8. データ保存とレジューム

### 二重保存戦略

不慮の事故(画面リロード、Safariのタブ落ち、通信失敗)に備え、ローカルとクラウド両方に保存。

#### ローカル保存 (localStorage)

- **保存タイミング**: state変更ごとに自動保存(デバウンス500ms)
- **保存内容**: state全体(認証情報含む、`expireAt` も含む)
- **キー名**: `mahjong-app-state`
- **有効期間**: 24時間
  - 1ページ目「ゲーム開始」(create) のタイミングで `expireAt = Date.now() + 24時間` を算出してstateに保存
  - 以降の保存では `expireAt` は更新しない
  - 読み込み時に `Date.now() > expireAt` なら破棄
- **クリアタイミング**:
  - 読み込み時に有効期限切れを検知した時のみ
  - 明示的なクリア処理は持たない(最終確定の概念なし、飲み代は何度でも入力可能)

```js
const STORAGE_KEY = 'mahjong-app-state';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const state = JSON.parse(raw);
  if (state.expireAt && Date.now() > state.expireAt) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return state;
}

// create時に有効期限をセット
function onGameStart() {
  state.expireAt = Date.now() + ONE_DAY_MS;
  // ...create処理
}
```

#### クラウド保存 (GAS経由でスプレッドシート)

- **保存タイミング**: 確定系ボタン押下時のみ
  - 1ページ目「ゲーム開始」(create + 初回save)
  - 2ページ目「得点確定」(局追加ごとにsave)
  - 3ページ目「金額確定」(場代・飲み代の入力ごとにsave)
- **保存方式**: 毎回シート全体を上書き
- **失敗時**: localStorageは残っているのでリトライ可能

### レジューム機能

- アプリ起動時(リロード含む)に localStorage を確認
- stateが取得できたら `currentPage` の値に応じて該当ページを表示
- localStorageが空 or 24時間期限切れなら 0ページ目(ログイン)から開始
- リロード時に追加の認証チェック(`auth`)は不要(localStorageに `password` があればそれを使う)
- スプレッド側の最新内容を反映したい場合は、各ページの**同期ボタン**を使う

### 同期機能(スプレッドからの読み込み)

スプレッドシート側で直接修正することがあるため、内容をアプリに反映する手段を用意。

- **同期ボタン**を2〜3ページに常時配置
- 押下時の動作:
  1. `action: 'load'` をGASに送信
  2. レスポンスのdataでstateを上書き
  3. localStorageにも保存
  4. 画面を再描画
- 確認ダイアログ「同期しますか?未送信の変更は失われます」を表示

## 9. 共通UI要素

### 全ページ共通

- 画面上部に固定ヘッダー(タイトル、現在ページ表示、同期ボタン)
- ヘッダー直下に**エラーメッセージ表示エリア**を全ページ共通で配置
  - 通常時は非表示
  - state上の `errorMessage` フィールドに値があれば赤字で表示
  - 認証失敗、通信失敗、バリデーションエラーなど全エラーをここに統一して出す
  - 次のユーザー操作(ボタン押下など)でクリアされる
- 同期ボタン: 2〜3ページのみ表示(0・1ページ目は不要)

### 表示形式

- 表は `table-responsive` で横スクロール可能に
- 数値入力欄は `inputmode="numeric"` でテンキー表示
- 通信中はローディング表示
- 通信失敗時はリトライ可能な状態に戻す

## 10. 開発用デバッグ機能

詳細: `docs/debug.md`

開発中の動作確認用に `/debug.html` を配置する。パスワード入力後にクリアボタン1つで「スプレッドシート削除 → localStorageクリア → index.htmlへ遷移」を一括実行する。GAS側には `action: 'delete'` を追加する。

## 11. 未確定事項

- スプレッドシート出力フォーマットの細部(罫線・色・列幅など)
