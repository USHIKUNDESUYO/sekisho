import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sekisho-98982533733.asia-northeast1.run.app"),
  title: "SEKISHO（関所） — AIは承認しない。反証だけを返すデプロイ関所",
  description:
    "監査の規律をDevOpsへ。番人と目付の二段Geminiエージェントが証拠アンカー付きの反証だけを返し、人間が全反証を裁いて初めて通行手形（ハッシュチェーン証跡）が発行され、CI/CDゲートが開く。",
  openGraph: {
    title: "SEKISHO（関所） — AIは、承認しない。",
    description: "反証だけを返すデプロイ関所。人間が全反証を裁いて、はじめてCI/CDの関が開く。",
    images: ["/ogp.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;600;700;800&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="site-header">
          <div className="header-inner">
            <Link href="/" className="brand">
              <span className="seal-mark">関</span>
              <span className="site-title">
                SEKISHO
                <small>反証専従デプロイ関所</small>
              </span>
            </Link>
            <nav className="header-nav">
              <Link href="/">関所</Link>
              <Link href="/ledger">通行台帳</Link>
              <a href="https://github.com/USHIKUNDESUYO/sekisho" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="footer-inner">
            <span>SEKISHO — DevOps × AI Agent Hackathon 2026 応募作品（星野宇潮）</span>
            <span className="footer-motto">AIは結論を書かない。判断と署名は、人に残す。</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
