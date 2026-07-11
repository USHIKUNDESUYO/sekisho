"use client";

import { useEffect, useMemo, useState } from "react";
import { SAMPLE_DIFF } from "@/lib/sample";
import type { AgentStep, Challenge, Disposition, DroppedChallenge, Tegata } from "@/lib/types";

type RefuteResponse = {
  challenges: Challenge[];
  notExamined: string[];
  dropped: DroppedChallenge[];
  trace: AgentStep[];
  source: "live" | "sample";
  model: string | null;
  diffSha256: string;
  attest: string;
  warning?: string;
  error?: string;
};

const THEATER_STAGES = [
  { agent: "番人", text: "番人が diff を読み、反証を生成しています…", at: 0 },
  { agent: "目付", text: "目付が反証を敵対的に検証しています（弱い反証は棄却されます）…", at: 12000 },
  { agent: "照合方", text: "照合方が証拠アンカーを diff 本文と突合しています…", at: 19000 },
];

const VERDICT_LABEL: Record<Disposition["verdict"], string> = {
  addressed: "対応した",
  accepted: "リスク受容",
  refuted: "反証が誤り",
};

export default function Home() {
  const [diff, setDiff] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [service, setService] = useState("");
  const [target, setTarget] = useState("production");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RefuteResponse | null>(null);
  const [judgments, setJudgments] = useState<Record<string, { verdict?: Disposition["verdict"]; reason: string }>>({});
  const [tegata, setTegata] = useState<Tegata | null>(null);
  const [theaterStep, setTheaterStep] = useState(0);
  const [usedPr, setUsedPr] = useState(false);

  // ?demo=1 でも30秒デモを自動再生（撮影・審査員のクイックビュー用）
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("demo")) return;
    startDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decidedCount = useMemo(() => {
    if (!result) return 0;
    return result.challenges.filter((c) => {
      const j = judgments[c.id];
      return j?.verdict && j.reason.trim().length > 0;
    }).length;
  }, [result, judgments]);

  const allDecided = result ? decidedCount === result.challenges.length && result.challenges.length > 0 : false;

  async function runRefute() {
    setLoading(true);
    setError(null);
    setResult(null);
    setTegata(null);
    setJudgments({});
    setUsedPr(!diff.trim() && !!prUrl.trim());
    // 進行劇場: 待ち時間に二段エージェントの働きを見せる（実測msは完了後のトレースが正）
    setTheaterStep(0);
    const timers = THEATER_STAGES.slice(1).map((s, i) => setTimeout(() => setTheaterStep(i + 1), s.at));
    try {
      const res = await fetch("/api/refute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff, prUrl: prUrl.trim() || undefined, service, target }),
      });
      const data: RefuteResponse & { diff?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.diff && !diff.trim()) setDiff(data.diff); // 飛脚が運んできたdiffを表示
      setResult(data);
      setTimeout(() => document.getElementById("judge-section")?.scrollIntoView({ behavior: "smooth" }), 150);
    } catch (e) {
      setError(e instanceof Error ? e.message : "反証の取得に失敗しました");
    } finally {
      timers.forEach(clearTimeout);
      setLoading(false);
    }
  }

  // 30秒デモ: サンプルdiff＋裁き済み状態を即座に表示（応答は「サンプル」と明示される）
  async function startDemo() {
    setDiff(SAMPLE_DIFF);
    setService("billing-api");
    setName("星野宇潮");
    setPrUrl("");
    setError(null);
    setTegata(null);
    setLoading(true);
    try {
      const res = await fetch("/api/refute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff: SAMPLE_DIFF, service: "billing-api", target: "production", forceSample: true }),
      });
      const data: RefuteResponse = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      const demoReasons = [
        "冪等キーをcharge呼び出しに付与するPR #124を先行マージ済み。二重課金は発生しない",
        "DB側max_connections=200・アプリ2台構成で余裕あり。接続数70%の監視アラート設定済みのため受容",
        "ordersは12万行・ステージング実測3.2秒。メンテナンスウィンドウ内で実行するよう手順に追記済み",
        "決済APIのp99は820ms（直近30日）。1500msは十分な余裕だが月末ピークは監視する前提で受容",
      ];
      const verdicts: Disposition["verdict"][] = ["addressed", "accepted", "addressed", "accepted"];
      const pre: Record<string, { verdict?: Disposition["verdict"]; reason: string }> = {};
      (data.challenges || []).forEach((c: Challenge, i: number) => {
        pre[c.id] = { verdict: verdicts[i % verdicts.length], reason: demoReasons[i % demoReasons.length] };
      });
      setJudgments(pre);
      setTimeout(() => document.getElementById("judge-section")?.scrollIntoView({ behavior: "smooth" }), 200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "デモの開始に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function issueSeal() {
    if (!result) return;
    setSealing(true);
    setError(null);
    try {
      const dispositions: Disposition[] = result.challenges.map((c) => ({
        challengeId: c.id,
        verdict: judgments[c.id].verdict!,
        reason: judgments[c.id].reason.trim(),
        decidedBy: name.trim() || "anonymous",
        decidedAt: new Date().toISOString(),
      }));
      const res = await fetch("/api/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { service: service || "unnamed-service", target, requestedBy: name.trim() || "anonymous" },
          diffSha256: result.diffSha256,
          challenges: result.challenges,
          notExamined: result.notExamined,
          dispositions,
          source: result.source,
          attest: result.attest,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTegata(data.tegata);
    } catch (e) {
      setError(e instanceof Error ? e.message : "手形の発行に失敗しました");
    } finally {
      setSealing(false);
    }
  }

  function downloadTegata() {
    if (!tegata) return;
    const blob = new Blob([JSON.stringify(tegata, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tegata-${tegata.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <section className="hero-band">
        <div className="hero-watermark" aria-hidden>
          関
        </div>
        <div className="hero-vertical" aria-hidden>
          反証専従・通行手形
        </div>
        <div className="wrap hero">
          <p className="hero-eyebrow">DEPLOYMENT CHECKPOINT — 監査の規律を、DevOpsの門へ</p>
          <h1>
            AIは、<span className="shu">承認しない。</span>
            <br />
            反証だけを返すデプロイ関所。
          </h1>
          <p className="lead">
            AIがコードを書き、AIがコードをLGTMする時代——「考えたのは誰か」に答えられますか。
            関所の<b>番人</b>と<b>目付</b>（二段のGeminiエージェント）は合格も点数も出しません。
            diffへの<b>反証（証拠アンカー付き）</b>だけを返し、人間が全件を裁いて初めて
            <b>通行手形</b>（改竄検知つき証跡）が発行され、CI/CDの関が開きます。
          </p>
          <div className="kata">
            <span>承認しない — LGTMを構造的に持たない</span>
            <span>網羅を名乗らない — 見ていないものを申告する</span>
            <span>判断を残す — 誰が・いつ・何を根拠に</span>
          </div>
          <p className="hero-motto">見たものには証拠を。見ていないものには、灰を。</p>
          <div className="btn-row hero-actions">
            <button className="btn btn-shu" onClick={startDemo} disabled={loading}>
              ▶ 30秒でデモを見る
            </button>
            <a
              className="hero-proof"
              href="https://github.com/USHIKUNDESUYO/sekisho/pull/1"
              target="_blank"
              rel="noreferrer"
            >
              この関所は、作者自身も通しません — 本作のデプロイも PR #1 で「手形なし ❌ → 裁き → ✅」を経ています ↗
            </a>
          </div>
        </div>
        <div className="hero-wave" aria-hidden />
      </section>

      <div className="wrap">
      <section className="section">
        <h2 className="section-title">
          <span className="step">壱</span>差し出す<span className="section-sub">デプロイするdiffを関所に掛ける</span>
        </h2>
        <div className="card">
          <label className="fld" htmlFor="diff">
            unified diff（git diff / PRのdiff）
          </label>
          <textarea
            id="diff"
            value={diff}
            onChange={(e) => setDiff(e.target.value)}
            placeholder={"diff --git a/... b/...\n（下のボタンで架空サービスのサンプルdiffを読み込めます）"}
          />
          <div style={{ marginTop: 12 }}>
            <label className="fld" htmlFor="prurl">
              または、公開PRのURL（飛脚がdiffを取り寄せます・diff欄が空のときに使われます）
            </label>
            <input
              id="prurl"
              type="text"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
            />
          </div>
          <div className="grid3">
            <div>
              <label className="fld" htmlFor="svc">サービス名</label>
              <input id="svc" type="text" value={service} onChange={(e) => setService(e.target.value)} placeholder="billing-api" />
            </div>
            <div>
              <label className="fld" htmlFor="tgt">デプロイ先</label>
              <input id="tgt" type="text" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="production" />
            </div>
            <div>
              <label className="fld" htmlFor="nm">裁き手（あなたの名前）</label>
              <input id="nm" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="署名者として記録されます" />
            </div>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={runRefute} disabled={loading || (!diff.trim() && !prUrl.trim())}>
              {loading ? "番人が読んでいます…" : "関所に掛ける"}
            </button>
            <button className="btn btn-ghost" onClick={() => setDiff(SAMPLE_DIFF)} disabled={loading}>
              サンプルdiffを読み込む（架空の決済サービス）
            </button>
          </div>
          {error && <p className="err">{error}</p>}

          {loading && (
            <div className="theater" role="status">
              {(usedPr
                ? [{ agent: "飛脚", text: "飛脚がPRからdiffを取り寄せています…" }, ...THEATER_STAGES]
                : THEATER_STAGES
              ).map((s, i, rows) => {
                const current = rows.length - THEATER_STAGES.length + theaterStep; // 飛脚行があれば+1ずれる
                const done = i < current;
                const active = i === current;
                return (
                  <div key={s.agent} className={`theater-row${done ? " done" : ""}${active ? " active" : ""}`}>
                    <span className="theater-mark">{done ? "✓" : active ? "◉" : "○"}</span>
                    <b className="theater-agent">{s.agent}</b>
                    <span className="theater-text">{s.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {result && (
        <>
          <section className="section" id="judge-section">
            <h2 className="section-title">
              <span className="step">弐</span>裁く<span className="section-sub">番人の反証 {result.challenges.length}件・全件に理由が必要</span>
            </h2>
            <p className="src-note" style={{ marginBottom: 12 }}>
              {result.source === "live"
                ? `応答: Gemini（${result.model}・ライブ）`
                : "応答: サンプル（デモ用・AI未接続）"}
              {result.warning ? ` ／ ${result.warning}` : ""}
            </p>

            <div className="trace-box">
              <h3>エージェントの働き（実行トレース）</h3>
              <ol>
                {result.trace.map((s, i) => (
                  <li key={i}>
                    <b className={`agent-name agent-${i}`}>{s.agent}</b> {s.action} — {s.detail}
                    {s.ms > 0 ? <span className="trace-ms">{(s.ms / 1000).toFixed(1)}s</span> : null}
                  </li>
                ))}
              </ol>
              {result.dropped.length > 0 && (
                <div className="dropped">
                  <p className="dropped-title">自律棄却された反証（透明性のため表示）</p>
                  <ul>
                    {result.dropped.map((d, i) => (
                      <li key={i}>
                        「{d.claim}」 — <b>{d.droppedBy}</b>が棄却: {d.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {result.challenges.map((c, i) => {
              const j = judgments[c.id] || { reason: "" };
              const decided = !!j.verdict && j.reason.trim().length > 0;
              return (
                <div key={c.id} className={`card challenge${decided ? " decided" : ""}`}>
                  <span className="chip">反証 {i + 1} ・ {c.category}</span>
                  <p className="claim">{c.claim}</p>
                  <div className="anchor">
                    <span className="loc">{c.anchor.file}{c.anchor.line ? `:${c.anchor.line}` : ""}</span>
                    {"\n"}
                    {c.anchor.quote}
                  </div>
                  <p className="why">{c.whyItMatters}</p>
                  <div className="judge">
                    <div className="judge-options">
                      {(Object.keys(VERDICT_LABEL) as Disposition["verdict"][]).map((v) => (
                        <button
                          key={v}
                          className={j.verdict === v ? `sel-${v}` : ""}
                          onClick={() => setJudgments((p) => ({ ...p, [c.id]: { ...p[c.id], verdict: v, reason: p[c.id]?.reason || "" } }))}
                        >
                          {VERDICT_LABEL[v]}
                        </button>
                      ))}
                    </div>
                    <textarea
                      placeholder="裁きの理由（必須）— この記録が、後からそのまま説明できるあなたの証跡になります"
                      value={j.reason}
                      onChange={(e) => setJudgments((p) => ({ ...p, [c.id]: { ...p[c.id], verdict: p[c.id]?.verdict, reason: e.target.value } }))}
                    />
                  </div>
                </div>
              );
            })}

            <div className="grey-box">
              <h3>番人が見ていないもの（灰）</h3>
              <ul>
                {result.notExamined.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <p className="grey-note">
                SEKISHOは網羅を名乗りません。見ていない場所を「見た」と偽らないことが、この関所の信用の根拠です。
              </p>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">
              <span className="step">参</span>通す<span className="section-sub">通行手形の発行</span>
            </h2>
            <div className="card">
              <p className="progress">
                裁き済み <b>{decidedCount}</b> / {result.challenges.length} 件
                {!allDecided && " — 全ての反証に裁きと理由が揃うまで、関は開きません。"}
              </p>
              <div className="btn-row">
                <button className="btn btn-shu" onClick={issueSeal} disabled={!allDecided || sealing || !!tegata}>
                  {sealing ? "発行中…" : tegata ? "発行済み" : "通行手形を発行する"}
                </button>
              </div>

              {tegata && (
                <div className="tegata" style={{ marginTop: 18 }}>
                  <div className="hanko">通</div>
                  <h3>通行手形</h3>
                  <dl>
                    <dt>手形ID</dt>
                    <dd>{tegata.id}</dd>
                    <dt>発行時刻</dt>
                    <dd>{tegata.issuedAt}</dd>
                    <dt>diff SHA-256</dt>
                    <dd>{tegata.diffSha256}</dd>
                    <dt>記録ハッシュ</dt>
                    <dd>{tegata.recordHash}</dd>
                    <dt>直前手形との鎖</dt>
                    <dd>{tegata.prevHash}</dd>
                    <dt>裁き手</dt>
                    <dd>{[...new Set(tegata.dispositions.map((d) => d.decidedBy))].join(", ")}</dd>
                  </dl>
                  <div className="btn-row">
                    <button className="btn btn-ghost" onClick={downloadTegata}>証跡JSONをダウンロード</button>
                  </div>
                  <p className="src-note" style={{ marginTop: 12 }}>
                    CIからは <code>GET /api/gate?diffSha256={tegata.diffSha256.slice(0, 12)}…</code> で照会できます。
                    手形が無ければデプロイは403で止まります。
                  </p>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      <section className="philosophy">
        <div>
          <h4>監査の作法をDevOpsへ</h4>
          <p>
            会計監査では「誰が・いつ・何を根拠に判断したか」を残せない記録は証拠になりません。
            開発者は公認会計士。監査調書の規律——AIは結論を書かず、判断と署名は人に残す——を、
            デプロイの門に立てたのがこの関所です。
          </p>
        </div>
        <div>
          <h4>なぜAIに承認させないのか</h4>
          <p>
            AIのLGTMは高速ですが、事故のあと「なぜ通したのか」に誰も答えられません。
            責任の空白は、速度で埋め合わせできません。SEKISHOは判断を人間に返すことで、説明可能性を仕組みにします。
          </p>
        </div>
        <div>
          <h4>反証は、承認より情報量が多い</h4>
          <p>
            「問題ありません」は0ビットの情報です。「この行のリトライは二重課金し得る」は、
            署名者の視線を具体的な場所へ導きます。番人の仕事は結論ではなく、視線の誘導です。
          </p>
        </div>
        <div>
          <h4>灰を残す</h4>
          <p>
            どんなレビューにも見ていない場所があります。SEKISHOはそれを隠さず申告します。
            網羅率100%の演出より、「どこを見ていないか」の正直さが、監査に耐える証跡を作ります。
          </p>
        </div>
      </section>
      </div>
    </main>
  );
}
