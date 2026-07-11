import { NextRequest, NextResponse } from "next/server";
import { refute, sampleRefute } from "@/lib/refute";
import { fetchPrDiff } from "@/lib/hikyaku";
import { sha256 } from "@/lib/ledger";
import { signRefutation } from "@/lib/attest";

export const runtime = "nodejs";

// 素朴なIPレート制限（単一プロセス前提・審査デモ用）
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 20;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) return true;
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "レート制限中です。少し待ってからお試しください。" }, { status: 429 });
  }
  let body: { diff?: string; prUrl?: string; service?: string; target?: string; forceSample?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // 飛脚: PR URLが渡されたら、diffを自分で取りに行く
  let diff = (body.diff || "").trim();
  const hikyakuTrace = [];
  if (!diff && body.prUrl) {
    const t = Date.now();
    try {
      const fetched = await fetchPrDiff(body.prUrl);
      diff = fetched.diff.trim();
      hikyakuTrace.push({
        agent: "飛脚" as const,
        action: "PRからdiffを取得",
        detail: `${fetched.source} から ${diff.length.toLocaleString()}字のdiffを運んだ`,
        ms: Date.now() - t,
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "PR取得に失敗しました" }, { status: 422 });
    }
  }
  if (!diff) return NextResponse.json({ error: "diffが空です（diff本文かPRのURLを入れてください）" }, { status: 400 });
  if (diff.length > 200_000) return NextResponse.json({ error: "diffが大きすぎます(200KB上限)" }, { status: 413 });

  const context = {
    service: (body.service || "unnamed-service").slice(0, 100),
    target: (body.target || "production").slice(0, 100),
  };
  const diffSha256 = sha256(diff);
  try {
    const result = body.forceSample ? sampleRefute(diff) : await refute(diff, context);
    const attest = signRefutation({ diffSha256, challenges: result.challenges, notExamined: result.notExamined, source: result.source });
    return NextResponse.json({ ...result, trace: [...hikyakuTrace, ...result.trace], diff, diffSha256, attest });
  } catch (e) {
    // ライブ呼び出しが失敗してもデモは止めない（正直にsourceで申告する）
    const fallback = sampleRefute(diff);
    const attest = signRefutation({ diffSha256, challenges: fallback.challenges, notExamined: fallback.notExamined, source: fallback.source });
    return NextResponse.json({
      ...fallback,
      trace: [...hikyakuTrace, ...fallback.trace],
      diff,
      diffSha256,
      attest,
      warning: `AI呼び出しに失敗したためサンプル応答を返しました: ${e instanceof Error ? e.message : "unknown"}`,
    });
  }
}
