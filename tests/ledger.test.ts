// 台帳のハッシュチェーンが「改竄を必ず検知する」ことのテスト
// 実行: npm test（Node 24+ / 型ストリップで直接実行）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SEKISHO_DATA_DIR = mkdtempSync(path.join(tmpdir(), "sekisho-test-"));
process.env.SEKISHO_STORE = "file";

const { canonicalize, sha256, issueTegata, verifyLedger, GENESIS } = await import("../lib/ledger.ts");

const challenge = (id: string) => ({
  id,
  claim: "テスト反証",
  anchor: { file: "a.ts", line: 1, quote: "+test" },
  whyItMatters: "テスト",
  category: "ops" as const,
});
const disposition = (challengeId: string) => ({
  challengeId,
  verdict: "addressed" as const,
  reason: "テストで対応確認",
  decidedBy: "テスト裁き手",
  decidedAt: new Date().toISOString(),
});
const input = (diffSha: string, cid: string) => ({
  context: { service: "test", target: "test", requestedBy: "test" },
  diffSha256: diffSha,
  challenges: [challenge(cid)],
  notExamined: ["テストの灰"],
  dispositions: [disposition(cid)],
  source: "sample" as const,
});

test("canonicalize はキー順に依存しない", () => {
  assert.equal(canonicalize({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalize({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test("未裁きの反証が残っていると手形は発行できない", async () => {
  const bad = input(sha256("diff-x"), "c1");
  bad.dispositions = [];
  await assert.rejects(() => issueTegata(bad), /未裁き/);
});

test("手形はチェーンになり、検証を通る", async () => {
  const t1 = await issueTegata(input(sha256("diff-1"), "c1"));
  const t2 = await issueTegata(input(sha256("diff-2"), "c2"));
  assert.equal(t1.prevHash, GENESIS);
  assert.equal(t2.prevHash, t1.recordHash);
  const v = await verifyLedger();
  assert.equal(v.ok, true);
  assert.equal(v.count, 2);
});

test("台帳を1文字でも書き換えるとチェーンが壊れたと検知される", async () => {
  const file = path.join(process.env.SEKISHO_DATA_DIR!, "ledger.jsonl");
  const tampered = readFileSync(file, "utf8").replace("テストで対応確認", "テストで対応確認済");
  writeFileSync(file, tampered, "utf8");
  const v = await verifyLedger();
  assert.equal(v.ok, false);
  assert.notEqual(v.brokenAt, null);
});
