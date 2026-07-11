"use client";

import { useState } from "react";

export default function VerifyButton() {
  const [state, setState] = useState<"idle" | "running" | "ok" | "ng">("idle");
  const [detail, setDetail] = useState("");

  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/verify", { cache: "no-store" });
      const data = await res.json();
      setDetail(`${data.detail}（${data.count}件・headHash確認済み）`);
      setState(data.ok ? "ok" : "ng");
    } catch {
      setDetail("検証リクエストに失敗しました");
      setState("ng");
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button className="btn btn-ghost" onClick={run} disabled={state === "running"}>
        {state === "running" ? "全手形の鎖を再計算中…" : "チェーンをいま検証する"}
      </button>
      {state === "ok" && <span className="ok-badge">✓ {detail}</span>}
      {state === "ng" && <span className="ng-badge">✗ {detail}</span>}
    </span>
  );
}
