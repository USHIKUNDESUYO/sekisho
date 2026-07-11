// SEKISHO（関所）型定義 — 「AIは承認しない。反証だけを返す」

/** AIが返す反証1件。結論・承認・スコアは構造的に存在しない */
export interface Challenge {
  id: string;
  /** 反証の主張（〜が不整合/〜の証拠が見当たらない、の形） */
  claim: string;
  /** 証拠アンカー: diff内の実在の位置 */
  anchor: {
    file: string;
    line: number | null;
    /** diffから引用した実在の行（捏造防止のため照合される） */
    quote: string;
  };
  /** なぜ署名前に見るべきか（リスクの説明であって判定ではない） */
  whyItMatters: string;
  category: "regression" | "security" | "config" | "data" | "ops" | "consistency";
}

/** 人間の裁き。理由必須 */
export interface Disposition {
  challengeId: string;
  /** addressed=対応した / accepted=リスク受容 / refuted=反証が誤り */
  verdict: "addressed" | "accepted" | "refuted";
  reason: string;
  decidedBy: string;
  decidedAt: string; // ISO8601
}

/** AIの正直な自己申告: 見ていないもの（灰） */
export type NotExamined = string[];

/** エージェントの実行トレース1歩 */
export interface AgentStep {
  /** 飛脚=diff調達 / 番人=反証生成 / 目付=敵対的検証 / 照合方=機械照合 */
  agent: "飛脚" | "番人" | "目付" | "照合方";
  action: string;
  detail: string;
  ms: number;
}

/** 目付・照合方に棄却された反証（透明性のため保持・表示する） */
export interface DroppedChallenge {
  claim: string;
  droppedBy: "目付" | "照合方";
  reason: string;
}

export interface RefuteResult {
  challenges: Challenge[];
  notExamined: NotExamined;
  dropped: DroppedChallenge[];
  trace: AgentStep[];
  /** live=Gemini実応答 / sample=デモ用サンプル応答 */
  source: "live" | "sample";
  model: string | null;
}

/** 通行手形 = 人間の判断の検査証跡。ハッシュチェーンで改竄検知 */
export interface Tegata {
  id: string;
  issuedAt: string;
  context: {
    service: string;
    target: string;
    requestedBy: string;
  };
  diffSha256: string;
  challenges: Challenge[];
  notExamined: NotExamined;
  dispositions: Disposition[];
  source: "live" | "sample";
  /** 本番ゲートを開ける資格: 登録レビュアーの署名で裁かれたか */
  reviewerAttested: boolean;
  /** 認証されたレビュアー名（未認証はnull） */
  reviewerName: string | null;
  /** 職務分掌: 変更者(requestedBy)と裁き手(decidedBy)が同一なら自己承認 */
  selfApproved: boolean;
  /** チェーン: 直前の手形のrecordHash（初回はGENESIS） */
  prevHash: string;
  /** この手形全体（prevHashまで含む正規化JSON）のSHA-256 */
  recordHash: string;
}
