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
const { signRefutation, verifyRefutation } = await import("../lib/attest.ts");

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
  context: { service: "test", target: "test", requestedBy: "変更者テスト" },
  diffSha256: diffSha,
  challenges: [challenge(cid)],
  notExamined: ["テストの灰"],
  dispositions: [disposition(cid)],
  source: "sample" as const,
  reviewerAttested: true,
  reviewerName: "テストレビュアー",
});

test("canonicalize はキー順に依存しない", () => {
  assert.equal(canonicalize({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalize({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test("未裁きの反証が残っていると手形は発行できない", async () => {
  const bad = input(sha256("diff-x"), "c1");
  bad.dispositions = [];
  await assert.rejects(() => issueTegata(bad), /未裁き/);
});

test("職務分掌: 変更者と裁き手が同一なら selfApproved フラグが立つ", async () => {
  const selfIn = input(sha256("diff-self"), "cs");
  selfIn.context = { service: "t", target: "t", requestedBy: "同一人物" };
  selfIn.dispositions = [{ ...disposition("cs"), decidedBy: "同一人物" }];
  const t = await issueTegata(selfIn);
  assert.equal(t.selfApproved, true);
});

test("手形はチェーンになり、検証を通る", async () => {
  const t1 = await issueTegata(input(sha256("diff-1"), "c1"));
  const t2 = await issueTegata(input(sha256("diff-2"), "c2"));
  // 各手形は直前の手形のrecordHashを抱く（鎖の連結）
  assert.equal(t2.prevHash, t1.recordHash);
  const v = await verifyLedger();
  assert.equal(v.ok, true);
  assert.ok(v.count >= 2);
});

test("最初の手形のprevHashはGENESIS", async () => {
  // 独立したデータディレクトリで初番を確認
  const prev = process.env.SEKISHO_DATA_DIR;
  process.env.SEKISHO_DATA_DIR = mkdtempSync(path.join(tmpdir(), "sekisho-genesis-"));
  const first = await issueTegata(input(sha256("diff-genesis"), "cg"));
  assert.equal(first.prevHash, GENESIS);
  process.env.SEKISHO_DATA_DIR = prev;
});

test("反証ゼロの手形は発行できない（偽造封鎖）", async () => {
  const bad = input(sha256("diff-empty"), "cx");
  bad.challenges = [];
  bad.dispositions = [];
  await assert.rejects(() => issueTegata(bad), /反証ゼロ/);
});

test("反証セッション署名: 本物は通り、改変は落ちる", () => {
  const payload = {
    diffSha256: sha256("diff-a"),
    challenges: [challenge("c9")],
    notExamined: ["灰1"],
    source: "live" as const,
  };
  const token = signRefutation(payload);
  assert.equal(verifyRefutation(payload, token), true);
  // 反証を1件でも改変・差し替えすれば署名は合わない
  const forged = { ...payload, challenges: [{ ...challenge("c9"), claim: "無害な反証にすり替え" }] };
  assert.equal(verifyRefutation(forged, token), false);
  // 空の反証への署名転用も不可
  const emptied = { ...payload, challenges: [] };
  assert.equal(verifyRefutation(emptied, token), false);
  assert.equal(verifyRefutation(payload, "deadbeef"), false);
});

test("台帳を1文字でも書き換えるとチェーンが壊れたと検知される", async () => {
  const file = path.join(process.env.SEKISHO_DATA_DIR!, "ledger.jsonl");
  const tampered = readFileSync(file, "utf8").replace("テストで対応確認", "テストで対応確認済");
  writeFileSync(file, tampered, "utf8");
  const v = await verifyLedger();
  assert.equal(v.ok, false);
  assert.notEqual(v.brokenAt, null);
});
