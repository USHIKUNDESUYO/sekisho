// 反証エンジン（二段エージェント構成）
//
//   番人（Gemini）: diffを読み、署名者への反証を生成する
//   目付（Gemini）: 番人の反証を敵対的に検証し、diffから導けない反証を自律的に棄却する
//   照合方（機械）: 証拠アンカーの引用がdiff本文に実在するかを突き合わせ、捏造を落とす
//
// どの段も「承認」を出す権限を持たない。返せるのは反証と、見ていないものの申告だけ。
// これは会計監査の「判断の証跡」の規律を移植した反証専従の設計である。

import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "crypto";
import type { AgentStep, Challenge, DroppedChallenge, RefuteResult } from "./types";
import { SAMPLE_DIFF } from "./sample";

export { SAMPLE_DIFF };

const MODEL = process.env.SEKISHO_MODEL || "gemini-2.5-flash";
const MAX_DIFF_CHARS = 60_000;

const BANNIN_PROMPT = `あなたはデプロイ関所の「番人」AIです。役割は厳格に限定されています。

## あなたがやること
与えられたdiffとデプロイ文脈に対し、「署名者（人間）が見落としているかもしれない点」への反証を3〜5件返す。
各反証には、diff内に実在する行を証拠アンカーとして必ず一字一句そのまま引用する。

## あなたが絶対にやらないこと（構造的禁止）
- 承認・合格・LGTM・「問題ありません」等の結論を出すこと
- リスクのスコア・点数・確率を付けること
- 「網羅的に確認した」と主張すること
- diffに存在しない行を引用すること

## 出力形式（このJSONのみ。前置き・後書き禁止）
{
  "challenges": [
    {
      "claim": "〜が不整合 / 〜の証拠がdiffに見当たらない、の形の反証",
      "anchor": { "file": "diff内のファイルパス", "line": 行番号または null, "quote": "diffから一字一句そのまま引用した1行" },
      "whyItMatters": "署名前に見るべき理由（判定ではなくリスクの説明）",
      "category": "regression|security|config|data|ops|consistency のいずれか"
    }
  ],
  "notExamined": ["このdiffからは見えないため確認していないものを正直に3〜6件列挙"]
}`;

const METSUKE_PROMPT = `あなたはデプロイ関所の「目付」AIです。番人が出した反証を敵対的に検証します。

## あなたがやること
各反証について「その主張はdiffの記述から本当に導けるか」だけを判定する。
- diffに書かれていることの誤読・飛躍・一般論の水増しは keep=false
- diffの記述から素直に導ける懸念は keep=true
判定に迷う場合は keep=true（見落としを握り潰すより、人間に裁かせる）。

## あなたが絶対にやらないこと
- diff自体の承認・不承認を出すこと（あなたの対象は反証の質だけ）
- 新しい反証を追加すること

## 出力形式（このJSONのみ）
{ "verdicts": [ { "index": 0, "keep": true, "reason": "簡潔な理由" } ] }`;

function now() {
  return Date.now();
}

/** 照合方: アンカーの実在照合 — quoteがdiff本文に含まれない反証は落とす（捏造防止） */
function verifyAnchors(
  challenges: Challenge[],
  diff: string,
): { kept: Challenge[]; dropped: DroppedChallenge[] } {
  const kept: Challenge[] = [];
  const dropped: DroppedChallenge[] = [];
  for (const c of challenges) {
    const q = c.anchor?.quote?.trim();
    const hit = q && (diff.includes(q) || diff.includes(q.replace(/^[+-]\s?/, "")));
    if (hit) kept.push(c);
    else dropped.push({ claim: c.claim, droppedBy: "照合方", reason: "引用アンカーがdiff本文と照合できない（捏造の疑い）" });
  }
  return { kept, dropped };
}

function parseModelJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("モデル出力にJSONが見つかりません");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

async function callGemini(ai: GoogleGenAI, system: string, user: string): Promise<string> {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: user,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });
  return res.text ?? "";
}

export async function refute(diff: string, context: { service: string; target: string }): Promise<RefuteResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return sampleRefute(diff);

  const ai = new GoogleGenAI({ apiKey });
  const trimmed = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + "\n...(truncated)" : diff;
  const trace: AgentStep[] = [];
  const userMsg = `## デプロイ文脈\nサービス: ${context.service}\nデプロイ先: ${context.target}\n\n## diff\n\`\`\`diff\n${trimmed}\n\`\`\``;

  // --- 段1: 番人 ---
  let t = now();
  const banninRaw = await callGemini(ai, BANNIN_PROMPT, userMsg);
  const banninOut = parseModelJson<{ challenges: Omit<Challenge, "id">[]; notExamined: string[] }>(banninRaw);
  const generated: Challenge[] = (banninOut.challenges || []).map((c) => ({ ...c, id: randomUUID() }));
  trace.push({
    agent: "番人",
    action: "反証を生成",
    detail: `diff ${trimmed.length.toLocaleString()}字を読み、反証${generated.length}件と灰${(banninOut.notExamined || []).length}件を申告`,
    ms: now() - t,
  });

  // --- 段2: 目付（敵対的検証・自律棄却） ---
  t = now();
  let metsukeKept: Challenge[] = generated;
  const dropped: DroppedChallenge[] = [];
  try {
    const metsukeRaw = await callGemini(
      ai,
      METSUKE_PROMPT,
      `${userMsg}\n\n## 番人の反証\n${JSON.stringify(generated.map((c, i) => ({ index: i, claim: c.claim, anchor: c.anchor })), null, 2)}`,
    );
    const verdicts = parseModelJson<{ verdicts: { index: number; keep: boolean; reason: string }[] }>(metsukeRaw).verdicts || [];
    metsukeKept = [];
    generated.forEach((c, i) => {
      const v = verdicts.find((x) => x.index === i);
      if (!v || v.keep) metsukeKept.push(c);
      else dropped.push({ claim: c.claim, droppedBy: "目付", reason: v.reason || "diffから導けない" });
    });
  } catch {
    // 目付が壊れても番人の反証は人間に届ける（fail open for humans, fail closed for AI approval）
  }
  trace.push({
    agent: "目付",
    action: "反証を敵対的に検証",
    detail: `${generated.length}件中${metsukeKept.length}件を維持、${generated.length - metsukeKept.length}件を自律棄却`,
    ms: now() - t,
  });

  // --- 段3: 照合方（機械） ---
  t = now();
  const { kept, dropped: forged } = verifyAnchors(metsukeKept, diff);
  dropped.push(...forged);
  trace.push({
    agent: "照合方",
    action: "証拠アンカーをdiff本文と突合",
    detail: forged.length ? `${forged.length}件の引用が照合できず棄却` : "全アンカーの実在を確認",
    ms: now() - t,
  });

  return {
    challenges: kept,
    notExamined: banninOut.notExamined || [],
    dropped,
    trace,
    source: "live",
    model: MODEL,
  };
}

// ---- デモ用サンプル（AI未接続でも全フローが体験できる） ----

export function sampleRefute(diff: string): RefuteResult {
  const isSample = diff.trim() === SAMPLE_DIFF.trim();
  const challenges: Challenge[] = isSample
    ? [
        {
          id: randomUUID(),
          claim: "リトライ処理から isRetryable 判定が削除され、非リトライ対象のエラー（例: カード拒否）でも再課金を試みる経路になっている。二重課金の可能性への手当てがdiffに見当たらない",
          anchor: { file: "src/billing/retry.ts", line: 15, quote: "-      if (!isRetryable(e)) throw e;" },
          whyItMatters: "課金APIの再試行は冪等キーがなければ多重決済になり得る。署名者は冪等性の担保箇所を確認してから通すべき",
          category: "regression",
        },
        {
          id: randomUUID(),
          claim: "DB_POOL_SIZE が 10→50 に増えているが、DB側の max_connections を引き上げた形跡がこのdiffに存在しない",
          anchor: { file: "config/production.env", line: 2, quote: "+DB_POOL_SIZE=50" },
          whyItMatters: "アプリ複数台×50接続でDBの接続上限を食い潰すと、この変更と無関係なサービスまで巻き添えで落ちる",
          category: "config",
        },
        {
          id: randomUUID(),
          claim: "ordersテーブルへの UPDATE が全行を対象にしており、実行時間・ロックの見積りや件数の根拠がdiffに見当たらない",
          anchor: { file: "migrations/20260711_add_coupon.sql", line: 2, quote: "+UPDATE orders SET coupon_code = '' WHERE coupon_code IS NULL;" },
          whyItMatters: "大テーブルの全行UPDATEはデプロイ時にロックを取り、決済導線を止め得る。行数と実行計画を見てから通すべき",
          category: "data",
        },
        {
          id: randomUUID(),
          claim: "PAYMENT_TIMEOUT_MS=1500 が新設されたが、決済APIのp99レイテンシがこれを下回る根拠がdiffに存在しない",
          anchor: { file: "config/production.env", line: 4, quote: "+PAYMENT_TIMEOUT_MS=1500" },
          whyItMatters: "タイムアウトが実レイテンシより短いと、成功していた決済を失敗扱いにし、リトライ（反証1）と組み合わさって最悪の経路を作る",
          category: "ops",
        },
      ]
    : [
        {
          id: randomUUID(),
          claim: "（サンプル応答）この変更のロールバック手順がdiffに見当たらない",
          anchor: { file: "(diff全体)", line: null, quote: diff.split("\n").find((l) => l.trim()) || "" },
          whyItMatters: "戻せない変更は、正しさの検証を「祈り」に変える",
          category: "ops",
        },
      ];
  return {
    challenges,
    notExamined: [
      "実行時の挙動（このdiffは静的にしか読んでいない）",
      "paymentClient.charge の冪等性実装（diff外のコード）",
      "ordersテーブルの実行数・インデックス状況",
      "この変更に対応するテストの実在と内容",
      "依存パッケージの変更有無（lockfileがdiffに含まれていない）",
    ],
    dropped: isSample
      ? [
          {
            claim: "LOG_LEVEL=warn では障害調査に必要な情報が不足する可能性がある",
            droppedBy: "目付",
            reason: "LOG_LEVELはこのdiffで変更されておらず、既存設定への一般論のため棄却",
          },
        ]
      : [],
    trace: [
      { agent: "番人", action: "反証を生成", detail: `反証${challenges.length + (isSample ? 1 : 0)}件と灰5件を申告（サンプル）`, ms: 0 },
      { agent: "目付", action: "反証を敵対的に検証", detail: isSample ? "5件中4件を維持、1件を自律棄却（サンプル）" : "検証（サンプル）", ms: 0 },
      { agent: "照合方", action: "証拠アンカーをdiff本文と突合", detail: "全アンカーの実在を確認（サンプル）", ms: 0 },
    ],
    source: "sample",
    model: null,
  };
}
