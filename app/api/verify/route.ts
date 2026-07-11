import { NextResponse } from "next/server";
import { verifyLedger } from "@/lib/ledger";

export const runtime = "nodejs";

export async function GET() {
  const result = await verifyLedger();
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
