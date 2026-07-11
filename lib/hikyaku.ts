// 飛脚 — diffの調達役。公開GitHub PRのURLからdiffを自分で取りに行く。
// 飛脚も他の段と同じく、承認の権限は持たない。運ぶだけ。

export interface FetchedDiff {
  diff: string;
  /** owner/repo#number */
  source: string;
}

const PR_URL_RE = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

export function isPrUrl(text: string): boolean {
  return PR_URL_RE.test(text.trim());
}

export async function fetchPrDiff(prUrl: string): Promise<FetchedDiff> {
  const m = prUrl.trim().match(PR_URL_RE);
  if (!m) throw new Error("対応しているのは github.com/<owner>/<repo>/pull/<番号> 形式のURLです");
  const [, owner, repo, num] = m;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
    headers: {
      Accept: "application/vnd.github.diff",
      "User-Agent": "sekisho-gate",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    // 公開PRのみ。認証は付けない（プライベートリポジトリのdiffを扱わないことが仕様）
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `PRのdiff取得に失敗しました（HTTP ${res.status}）。公開リポジトリのPRのみ対応しています。`,
    );
  }
  const diff = await res.text();
  if (!diff.trim()) throw new Error("PRのdiffが空でした");
  return { diff, source: `${owner}/${repo}#${num}` };
}
