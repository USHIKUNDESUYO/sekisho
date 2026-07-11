import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEKISHO（関所） — AIは承認しない。反証だけを返すデプロイ関所",
  description:
    "監査の規律をDevOpsへ。番人と目付の二段Geminiエージェントが証拠アンカー付きの反証だけを返し、人間が全反証を裁いて初めて通行手形（ハッシュチェーン証跡）が発行され、CI/CDゲートが開く。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="wrap">
          <header className="site-header">
            <div className="seal-mark">関</div>
            <div className="site-title">
              SEKISHO
              <small>反証専従デプロイ関所</small>
            </div>
            <nav className="header-nav">
              <Link href="/">関所</Link>
              <Link href="/ledger">通行台帳</Link>
              <a href="https://github.com/USHIKUNDESUYO/sekisho" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </nav>
          </header>
          {children}
          <footer className="site-footer">
            <span>SEKISHO — DevOps × AI Agent Hackathon 2026 応募作品（星野宇潮）</span>
            <span>AIは結論を書かない。判断と署名は、人に残す。</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
