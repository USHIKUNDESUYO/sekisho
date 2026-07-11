import { NextRequest, NextResponse } from "next/server";
import { findTegataByDiff, verifyLedger } from "@/lib/ledger";

export const runtime = "nodejs";

/**
 * CI/CDゲート。GitHub Actions等から呼ぶ:
 *   GET /api/gate?diffSha256=<hash>
 * 手形があり、かつ台帳チェーンが無傷なら 200（通行可）。なければ 403（止まる）。
 * SEKISHOが「良い」と言ったから通るのではない。人間が全反証を裁いた記録があるから通る。
 */
export async function GET(req: NextRequest) {
  const diffSha256 = req.nextUrl.searchParams.get("diffSha256");
  if (!diffSha256) return NextResponse.json({ error: "diffSha256 required" }, { status: 400 });

  const chain = await verifyLedger();
  if (!chain.ok) {
    return NextResponse.json({ pass: false, reason: `台帳チェーンが壊れています: ${chain.detail}` }, { status: 409 });
  }
  const tegata = await findTegataByDiff(diffSha256);
  if (!tegata) {
    return NextResponse.json(
      { pass: false, reason: "このdiffに対する通行手形がありません。関所で反証を裁いてください。" },
      { status: 403 },
    );
  }
  // サンプル応答（AI未接続）で裁いた手形は、既定では本番の関を開けない
  if (tegata.source === "sample" && process.env.SEKISHO_GATE_ALLOW_SAMPLE !== "1") {
    return NextResponse.json(
      { pass: false, reason: "この手形はサンプル応答（AI未接続）に対するものです。本番ゲートはライブ反証の手形のみ通します。" },
      { status: 403 },
    );
  }
  return NextResponse.json({
    pass: true,
    tegataId: tegata.id,
    issuedAt: tegata.issuedAt,
    decidedBy: [...new Set(tegata.dispositions.map((d) => d.decidedBy))],
    recordHash: tegata.recordHash,
  });
}
