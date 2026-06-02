# ストック検索アシスト

日本語で書くだけで、**Adobe Stock の最適化された検索リンク**を狙い別に複数パターン生成する Web アプリ。
APIキー不要・バックエンド不要・完全クライアントサイド。同僚には **URL を共有するだけ** で配れる。

---

## これは何をする？

1. 入力した日本語を、英語キーワード＋フィルタ（種別 / 向き / 余白 / 被写体）に変換
2. 狙い別に検索リンクを生成：**直球 / 雰囲気重視 / 実用（種別×向き） / デザイン向け（余白） / 日本語キーワード版**
3. クリックで `stock.adobe.com` が開く（チーム版にログインしていれば、そのまま閲覧・ライセンス）
4. 被写体は **「日本人」がデフォルト**（国内案件 100% 想定）

## なぜ公式 API を使わない？

Adobe Stock 公式 Search API は **2024年11月以降「Stock for Enterprise」契約限定**。
当社の **グループ版（チーム版）契約では使えない**ため、"検索 URL を賢く生成する" 方式を採用した。
→ 契約形態・ToS・API キーに一切依存せず、ごく普通の検索リンクとして機能する。

## 変換エンジン（2 段構え・どちらも無料）

1. **Chrome / Edge 内蔵 Translator API**（ja→en、オリジントライアル不要、端末内処理）
2. 非対応／無応答時は **内蔵辞書**（`src/dictionary.js`）へ自動フォールバック

入力テキストは**サーバーに送信されない**（全処理が端末内）。内蔵 AI が「在るのに応答しない」環境（Electron 等）でも、タイムアウトで辞書モードに切り替わるので固まらない。

---

## ローカルで動かす

静的サイトなので任意の静的サーバーで動く。**ES Modules を使うため `file://` 直開きは不可**（必ず http で配信）。

```bash
cd stock-search-assist
npx serve .            # もしくは: python3 -m http.server 8000
# → http://localhost:8000 を開く
```

## 公開（同僚へ配布）

無料の静的ホスティングに置いて **URL を共有するだけ**。ビルド工程は不要（出力＝このフォルダそのまま）。

| サービス | 設定 |
|---|---|
| **Cloudflare Pages** | フレームワーク preset = None、ビルドコマンド空、出力ディレクトリ = `/` |
| **Vercel** | Framework = Other、Build Command 空、Output Directory = `.` |
| **GitHub Pages** | リポジトリの `/`(root) を Pages 公開 |

機密データを扱わないため公開 URL で問題なし（入力は端末内処理）。社内限定にしたい場合は Cloudflare Access 等で前段にログインを挟める。

---

## カスタマイズ

| やりたいこと | 触る場所 |
|---|---|
| 語彙を増やす | `src/dictionary.js` のカテゴリ別オブジェクトに `日本語: 'english'` を追記 |
| デフォルト被写体・種別を変える | `src/queryBuilder.js`（既定 `subject='jp'` / `contentType='photo'`） |
| バリアントの増減・文言 | `src/queryBuilder.js` の `buildVariants()` |
| 対応フィルタ | `src/urlBuilder.js`（`CONTENT_TYPE_FILTER` 等） |
| 配色・余白・フォント | `styles/tokens.css`（差し色は `--color-accent` の 1 色のみ） |

## 構成

```
stock-search-assist/
├── index.html            エントリ
├── styles/
│   ├── tokens.css        デザイントークン（配色・タイポ・余白）
│   └── app.css           レイアウト・コンポーネント・レスポンシブ
└── src/
    ├── app.js            UI 配線（送信→描画→履歴）
    ├── queryBuilder.js   統合：入力＋トグル→検索バリアント
    ├── dictionary.js     日本語→英語 語彙辞書（フォールバック翻訳）
    ├── rules.js          フィルタ推定・キーワード抽出・国籍付与
    ├── translator.js     Chrome 内蔵 Translator API ラッパー（タイムアウト付き）
    ├── urlBuilder.js     Adobe Stock 検索 URL 生成
    └── history.js        直近検索（localStorage）
```

## 既知の制約

- **Route A（検索リンク生成）**。結果サムネのアプリ内一覧表示はしない（それは公式 API が要る別案件）。
- 内蔵 AI 翻訳は **Chrome / Edge 138+ デスクトップ**のみ。それ以外は辞書モードで動作。
- フィルタ URL のエンコードは Adobe 側仕様に依存。万一効かない場合も `k=`（キーワード）は確実に効き、結果ページの UI でワンクリック調整できる。

## 今後の拡張余地

- 同じエンジンを載せ替えて **Chrome 拡張版**（Adobe Stock 画面に直接組み込み）
- 公式 API アクセスが取れたら、**サムネ一覧＋LLM 再ランク＋Eagle 連携**
