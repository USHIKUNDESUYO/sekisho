import { NextRequest, NextResponse } from "next/server";
import { issueTegata } from "@/lib/ledger";
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.diffSha256 || !Array.isArray(body.challenges) || !Array.isArray(body.dispositions)) {
    return NextResponse.json({ error: "diffSha256 / challenges / dispositions は必須です" }, { status: 400 });
  }
  try {
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
        decidedAt: d.decidedAt || new Date().toISOString(),
      })),
      source: body.source === "live" ? "live" : "sample",
    });
    return NextResponse.json({ tegata });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "発行に失敗しました" }, { status: 422 });
  }
}
