# debug.html: 開発用デバッグページ

## 役割

開発中の動作確認用に、localStorageのクリアとスプレッドシートの削除を一括で行うページ。ルートに配置。

## 配置

- パス: `/debug.html`
- 同じオリジン配下なので `index.html` と同じlocalStorageにアクセス可能

## 画面要素

- **パスワード入力欄**: 本番のSECRETと同じパスワードを入力
- **クリアボタン**: 1つだけ。押すと以下を一括実行:
  1. localStorageから `spreadsheetId` を取得
  2. `spreadsheetId` があればGASに `action: 'delete'` でリクエスト
  3. localStorageを `removeItem` で全削除
  4. 成功したら `location.href = '/'` でindex.htmlに自動遷移
- **エラーメッセージ表示エリア**: 失敗時にメッセージを表示

## 処理フロー

1. パスワード入力
2. クリアボタン押下(パスワード未入力なら無効)
3. localStorageから `spreadsheetId` を確認
   - **ある場合**: GASに `action: 'delete'` をリクエスト → OK なら次へ
   - **ない場合**: GASへのリクエストをスキップして次へ
4. localStorageを全削除
5. `location.href = '/'` でindex.htmlへ遷移
6. エラー時はメッセージ表示、localStorageはそのまま残す

## GAS側の対応アクション

#### `action: 'delete'` - スプレッドシートをゴミ箱に送る

リクエスト:
```json
{ "action": "delete", "password": "...", "spreadsheetId": "1abc..." }
```

レスポンス:
```json
{ "ok": true }
```

実装イメージ:
```js
case 'delete':
  DriveApp.getFileById(body.spreadsheetId).setTrashed(true);
  return jsonResponse({ ok: true });
```

## レイアウトイメージ

```
┌────────────────────────────┐
│  DEBUG                     │
├────────────────────────────┤
│ [エラーメッセージ表示エリア] │
├────────────────────────────┤
│                            │
│  パスワード                  │
│  ┌──────────────────────┐  │
│  │                      │  │
│  └──────────────────────┘  │
│                            │
│  [localStorage & スプレッド │
│         全削除してリセット]  │
│                            │
└────────────────────────────┘
```

## 公開について

- publicリポジトリのため第三者からもアクセス可能
- ただし `action: 'delete'` はGAS側でパスワード認証があるため実害なし
- 開発完了後はGitHubから削除して `.gitignore` に追加すればOK
