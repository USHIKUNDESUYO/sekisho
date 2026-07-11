// レビュアー認証 — 「本番の関を開けるのは、登録された人間の署名だけ」
//
// 通行手形は誰でも（curlでも）台帳に記録できる。透明性のためそれは拒まない。
// だが「本番デプロイのゲートを開ける」権限は、登録レビュアーの署名付き裁きに限る。
// これにより /api/refute の署名を得たbotが dispositions を捏造して自動承認する経路
// （＝AIやスクリプトが人間を騙る）を、ゲートの手前で無効化する。
//
// 実運用ではこのトークン照合を企業のSSO/OAuth/mTLSに差し替える。
// PoCデモでは公開のデモトークン(SEKISHO_DEMO_REVIEWER_TOKEN)を1つ開けており、
// 審査員も本番相当の手形を体験できる。これは「意図的に開けた鍵」であって、
// 認証機構の不在ではない（トークンを外せば無認証の裁きは全てゲートを通らない）。

const REGISTRY = (() => {
  // 形式: "token1:名前1,token2:名前2"
  const raw = process.env.SEKISHO_REVIEWER_TOKENS || "";
  const map = new Map<string, string>();
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf(":");
    if (idx > 0) map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  const demo = process.env.SEKISHO_DEMO_REVIEWER_TOKEN;
  if (demo) map.set(demo.trim(), "デモ審査レビュアー（公開デモ用・非実在）");
  return map;
})();

export interface ReviewerAuth {
  /** 登録レビュアーの署名が確認できたか（＝本番ゲートを開ける資格） */
  attested: boolean;
  /** 認証できた場合のレビュアー名（トークンに紐づく登録名） */
  name: string | null;
}

/** Authorizationヘッダ or bodyのreviewerToken からレビュアーを解決する */
export function resolveReviewer(token: string | null | undefined): ReviewerAuth {
  if (!token) return { attested: false, name: null };
  const t = token.replace(/^Bearer\s+/i, "").trim();
  const name = REGISTRY.get(t);
  return name ? { attested: true, name } : { attested: false, name: null };
}
