import { readLedger, verifyLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const VERDICT_LABEL: Record<string, string> = {
  addressed: "対応した",
  accepted: "リスク受容",
  refuted: "反証が誤り",
};

export default async function LedgerPage() {
  const [ledger, chain] = await Promise.all([readLedger(), verifyLedger()]);
  const items = [...ledger].reverse();

  return (
    <main className="wrap">
      <section className="page-head">
        <h1>通行台帳</h1>
        <p className="lead">
          発行された全ての通行手形。各手形は直前の手形のハッシュを抱いて鎖になっており、
          1件でも書き換えれば以降の全てが崩れます。検証は誰でも <code>/api/verify</code> で実行できます。
        </p>
        <p style={{ marginTop: 10 }}>
          チェーン検証:{" "}
          {chain.ok ? (
            <span className="ok-badge">✓ {chain.detail}（{chain.count}件）</span>
          ) : (
            <span className="ng-badge">✗ {chain.detail}</span>
          )}
        </p>
      </section>

      <section className="section">
        {items.length === 0 && (
          <div className="card">
            <p>まだ手形はありません。関所でdiffを裁くと、ここに証跡が刻まれます。</p>
          </div>
        )}
        {items.map((t) => (
          <details key={t.id} className="card ledger-item">
            <summary>
              <b>{t.context.service}</b> → {t.context.target} ／ {new Date(t.issuedAt).toLocaleString("ja-JP")} ／{" "}
              <code>{t.recordHash.slice(0, 16)}…</code>
              {t.source === "sample" ? "（サンプル応答）" : ""}
            </summary>
            <div className="ledger-detail">
              <p>裁き手: {[...new Set(t.dispositions.map((d) => d.decidedBy))].join(", ")}</p>
              <p>diff SHA-256: <code>{t.diffSha256}</code></p>
              <ul style={{ marginLeft: 20, marginTop: 8 }}>
                {t.challenges.map((c) => {
                  const d = t.dispositions.find((x) => x.challengeId === c.id);
                  return (
                    <li key={c.id} style={{ marginBottom: 6 }}>
                      {c.claim}
                      <br />
                      <b>{d ? VERDICT_LABEL[d.verdict] : "?"}</b>
                      {d ? ` — ${d.reason}` : ""}
                    </li>
                  );
                })}
              </ul>
              <pre>{JSON.stringify({ prevHash: t.prevHash, recordHash: t.recordHash }, null, 2)}</pre>
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}
