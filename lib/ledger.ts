// 台帳 — 通行手形の追記専用ストア（SHA-256ハッシュチェーン）
// 改竄すればチェーンが壊れる。壊れたことは誰でも /api/verify で検証できる。
//
// ストアは二層:
//   - Cloud Run 上（またはSEKISHO_STORE=firestore指定時）: Firestore（永続・実運用向け）
//   - ローカル: data/ledger.jsonl（ファイル・開発/デモ向け）

import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { Tegata, Challenge, Disposition, NotExamined } from "./types";

export const GENESIS = "GENESIS";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** キー順を固定した正規化JSON（ハッシュの再現性のため） */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

// ---------- store 抽象 ----------

interface LedgerStore {
  readAll(): Promise<Tegata[]>;
  append(t: Tegata): Promise<void>;
}

class FileStore implements LedgerStore {
  private dir = process.env.SEKISHO_DATA_DIR || path.join(process.cwd(), "data");
  private file = path.join(this.dir, "ledger.jsonl");
  async readAll(): Promise<Tegata[]> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      return raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Tegata);
    } catch {
      return [];
    }
  }
  async append(t: Tegata): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.appendFile(this.file, JSON.stringify(t) + "\n", "utf8");
  }
}

class FirestoreStore implements LedgerStore {
  // 動的importでローカル開発時のGCP認証要求を避ける
  private async col() {
    const { Firestore } = await import("@google-cloud/firestore");
    const db = new Firestore();
    return db.collection(process.env.SEKISHO_COLLECTION || "sekisho-tegata");
  }
  async readAll(): Promise<Tegata[]> {
    const col = await this.col();
    const snap = await col.orderBy("issuedAt", "asc").get();
    return snap.docs.map((d) => d.data() as Tegata);
  }
  async append(t: Tegata): Promise<void> {
    const col = await this.col();
    await col.doc(t.id).set(t);
  }
}

function getStore(): LedgerStore {
  const mode = process.env.SEKISHO_STORE || (process.env.K_SERVICE ? "firestore" : "file");
  return mode === "firestore" ? new FirestoreStore() : new FileStore();
}

export async function readLedger(): Promise<Tegata[]> {
  return getStore().readAll();
}

// ---------- 発行・検証 ----------

export interface IssueInput {
  context: Tegata["context"];
  diffSha256: string;
  challenges: Challenge[];
  notExamined: NotExamined;
  dispositions: Disposition[];
  source: Tegata["source"];
}

/** 全反証が裁かれていることを検証してから手形を発行する。未裁きが残れば発行不可 */
export async function issueTegata(input: IssueInput): Promise<Tegata> {
  if (input.challenges.length === 0) {
    throw new Error("反証ゼロの手形は発行できません。まず関所に掛けて反証を受けてください。");
  }
  const undecided = input.challenges.filter(
    (c) => !input.dispositions.some((d) => d.challengeId === c.id && d.reason.trim().length > 0),
  );
  if (undecided.length > 0) {
    throw new Error(
      `未裁きの反証が${undecided.length}件あります。全ての反証に人間の裁き（理由つき）が必要です。`,
    );
  }
  for (const d of input.dispositions) {
    if (!d.decidedBy.trim()) throw new Error("裁き手の名前が空の裁きがあります。");
  }

  const store = getStore();
  const ledger = await store.readAll();
  const prevHash = ledger.length ? ledger[ledger.length - 1].recordHash : GENESIS;

  const body = {
    id: randomUUID(),
    issuedAt: new Date().toISOString(),
    context: input.context,
    diffSha256: input.diffSha256,
    challenges: input.challenges,
    notExamined: input.notExamined,
    dispositions: input.dispositions,
    source: input.source,
    prevHash,
  };
  const recordHash = sha256(canonicalize(body));
  const tegata: Tegata = { ...body, recordHash };
  await store.append(tegata);
  return tegata;
}

export interface VerifyResult {
  ok: boolean;
  count: number;
  brokenAt: number | null; // 0-indexed
  detail: string;
}

/** 台帳全体のチェーン検証。1件でも書き換われば以降が全て崩れる */
export async function verifyLedger(): Promise<VerifyResult> {
  const ledger = await readLedger();
  let prev = GENESIS;
  for (let i = 0; i < ledger.length; i++) {
    const { recordHash, ...body } = ledger[i];
    if (body.prevHash !== prev) {
      return { ok: false, count: ledger.length, brokenAt: i, detail: `${i + 1}件目のprevHashが直前の手形と一致しません` };
    }
    const recomputed = sha256(canonicalize(body));
    if (recomputed !== recordHash) {
      return { ok: false, count: ledger.length, brokenAt: i, detail: `${i + 1}件目の内容がrecordHashと一致しません（改竄の可能性）` };
    }
    prev = recordHash;
  }
  return { ok: true, count: ledger.length, brokenAt: null, detail: "チェーンは無傷です" };
}

/** CI用ゲート: このdiffハッシュに対する手形が存在するか */
export async function findTegataByDiff(diffSha256: string): Promise<Tegata | null> {
  const ledger = await readLedger();
  return ledger.find((t) => t.diffSha256 === diffSha256) ?? null;
}
