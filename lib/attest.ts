// 反証セッションの署名 — 「反証はAIが出した本物であり、人間が注入できるのは裁きだけ」を暗号学的に閉じる。
//
// /api/refute が反証一式に対する HMAC-SHA256 トークンを発行し、
// /api/seal はトークンが検証できない手形の発行を拒否する。
// これにより curl で偽の反証（や空の反証）を送り込んで手形を偽造する経路が塞がれる。

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Challenge, NotExamined } from "./types";

// 正規化JSON（キー順固定）。署名の自己整合にのみ使うため、このモジュール内で完結させる
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

// 秘密鍵: 環境変数が無ければプロセス毎のランダム鍵にフォールバック。
// Nextはルートごとに別バンドルとしてモジュールを実体化するため、
// フォールバックは globalThis に載せてプロセス内で必ず1つに揃える。
// （複数インスタンス運用では SEKISHO_SIGNING_SECRET を必ず設定）
const g = globalThis as typeof globalThis & { __sekishoSigningSecret?: string };
const SECRET =
  process.env.SEKISHO_SIGNING_SECRET || (g.__sekishoSigningSecret ??= randomBytes(32).toString("hex"));

export interface AttestedPayload {
  diffSha256: string;
  challenges: Challenge[];
  notExamined: NotExamined;
  source: "live" | "sample";
}

export function signRefutation(payload: AttestedPayload): string {
  return createHmac("sha256", SECRET).update(canonicalize(payload), "utf8").digest("hex");
}

export function verifyRefutation(payload: AttestedPayload, token: string): boolean {
  if (!token || typeof token !== "string") return false;
  const expected = signRefutation(payload);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
