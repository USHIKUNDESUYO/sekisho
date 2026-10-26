# Cloud Run デプロイ手順

前提: gcloud CLI がインストール済みで、課金が有効なGCPプロジェクトがあること。

```bash
# 0. 認証とプロジェクト設定
gcloud auth login
gcloud config set project <PROJECT_ID>

# 1. 必要なAPIを有効化
gcloud services enable run.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com

# 2. Firestore データベースを作成（初回のみ・Nativeモード）
gcloud firestore databases create --location=asia-northeast1

# 3. ソースからデプロイ（Cloud Buildが Dockerfile を使ってビルドする）
gcloud run deploy sekisho \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=<YOUR_GEMINI_API_KEY>
```

デプロイ完了時に表示される `https://sekisho-....run.app` が公開URL。

## 環境変数

| 変数 | 説明 |
|---|---|
| `GEMINI_API_KEY` | Gemini API キー（AI Studioで発行）。未設定だとサンプル応答のみ |
| `SEKISHO_MODEL` | 既定 `gemini-2.5-flash` |
| `SEKISHO_STORE` | Cloud Run上では自動でfirestore。強制する場合 `firestore` / `file` |

## 注意

- Cloud Run のサービスアカウントに Firestore 権限（`roles/datastore.user`）が必要。
  既定のCompute サービスアカウントは通常プロジェクト編集者権限を持つためそのまま動く。
- Gemini APIの無料枠でも動作する（1リクエストで2回のGemini呼び出し: 番人＋目付）。

## 運用メモ

- 台帳のバックアップ: Firestoreの`sekisho-tegata`コレクションをエクスポートする
- レート制限: /api/refute は 20回/10分/IP
