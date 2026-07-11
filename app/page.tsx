"use client";

import { useMemo, useState } from "react";
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
  warning?: string;
  error?: string;
};

const VERDICT_LABEL: Record<Disposition["verdict"], string> = {
  addressed: "対応した",
  accepted: "リスク受容",
  refuted: "反証が誤り",
};

export default function Home() {
  const [diff, setDiff] = useState("");
  const [service, setService] = useState("");
  const [target, setTarget] = useState("production");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RefuteResponse | null>(null);
  const [judgments, setJudgments] = useState<Record<string, { verdict?: Disposition["verdict"]; reason: string }>>({});
  const [tegata, setTegata] = useState<Tegata | null>(null);

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
    try {
      const res = await fetch("/api/refute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff, service, target }),
      });
      const data: RefuteResponse = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "反証の取得に失敗しました");
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
      <section className="hero">
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
          会計監査の現場で磨かれた「判断の証跡」の規律の、DevOpsへの移植です。
        </p>
        <div className="kata">
          <span>承認しない（LGTMを構造的に持たない）</span>
          <span>網羅を名乗らない（見ていないものを申告する）</span>
          <span>判断を残す（誰が・いつ・何を根拠に）</span>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">
          <span className="step">1</span>差し出す — デプロイするdiffを関所に掛ける
        </h2>
        <div className="card">
          <label className="fld" htmlFor="diff">
            unified diff（git diff / PRのdiff）
          </label>
          <textarea
            id="diff"
            value={diff}
            onChange={(e) => setDiff(e.target.value)}
            placeholder={"diff --git a/... b/...\n（右のボタンで架空サービスのサンプルdiffを読み込めます）"}
          />
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
            <button className="btn btn-primary" onClick={runRefute} disabled={loading || !diff.trim()}>
              {loading ? "番人が読んでいます…" : "関所に掛ける"}
            </button>
            <button className="btn btn-ghost" onClick={() => setDiff(SAMPLE_DIFF)} disabled={loading}>
              サンプルdiffを読み込む（架空の決済サービス）
            </button>
          </div>
          {error && <p className="err">{error}</p>}
        </div>
      </section>

      {result && (
        <>
          <section className="section">
            <h2 className="section-title">
              <span className="step">2</span>裁く — 番人の反証 {result.challenges.length}件（全件に理由が必要）
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
              <span className="step">3</span>通す — 通行手形の発行
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
    </main>
  );
}
