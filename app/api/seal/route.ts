import { NextRequest, NextResponse } from "next/server";
import { issueTegata } from "@/lib/ledger";
import { verifyRefutation } from "@/lib/attest";
import { resolveReviewer } from "@/lib/reviewer";
import type { Challenge, Disposition, NotExamined } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: {
    context?: { service?: string; target?: string; requestedBy?: string };
    diffSha256?: string;
    challenges?: Challenge[];
    notExamined?: NotExamined;
    dispositions?: Disposition[];
    source?: "live" | "sample";
    attest?: string;
    reviewerToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.diffSha256 || !Array.isArray(body.challenges) || !Array.isArray(body.dispositions)) {
    return NextResponse.json({ error: "diffSha256 / challenges / dispositions は必須です" }, { status: 400 });
  }

  // 反証セッションの署名検証 — /api/refute が発行した本物の反証一式でなければ手形は作れない。
  // 偽の反証・改変した反証・空の反証をcurlで送り込む偽造経路をここで塞ぐ。
  const source = body.source === "live" ? "live" : "sample";
  const authentic = verifyRefutation(
    {
      diffSha256: body.diffSha256,
      challenges: body.challenges,
      notExamined: body.notExamined || [],
      source,
    },
    body.attest || "",
  );
  if (!authentic) {
    return NextResponse.json(
      { error: "反証セッションの署名が検証できません。関所（/api/refute）が発行した反証一式のみ手形にできます。" },
      { status: 403 },
    );
  }

  // レビュアー認証: 本番ゲートを開ける資格を持つ人間の署名か
  const reviewer = resolveReviewer(req.headers.get("authorization") || body.reviewerToken);

  try {
    const now = new Date().toISOString();
    const tegata = await issueTegata({
      context: {
        service: (body.context?.service || "unnamed-service").slice(0, 100),
        target: (body.context?.target || "production").slice(0, 100),
        requestedBy: (body.context?.requestedBy || "").slice(0, 100),
      },
      diffSha256: body.diffSha256,
      challenges: body.challenges,
      notExamined: body.notExamined || [],
      dispositions: body.dispositions.map((d) => ({
        ...d,
        // 裁き手の身元は認証済みレビュアー名に束ねる（トークン保持者でも他人名義は詐称できない）。
        // 未認証の裁きは自称のまま記録されるが、ゲートは別途403で止める。
        decidedBy: reviewer.attested ? reviewer.name! : d.decidedBy,
        // decidedAt はサーバー刻印（クライアントの自称時刻は信じない）
        decidedAt: now,
      })),
      source,
      reviewerAttested: reviewer.attested,
      reviewerName: reviewer.name,
    });
    return NextResponse.json({ tegata });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "発行に失敗しました" }, { status: 422 });
  }
}
