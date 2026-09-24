import { GitHubPublicationAuthError, apiAuthFailure } from "./github-publication-error.ts";

export type ExistingPullRequest = {
  number: number;
  url: string;
  branch: string;
  baseBranch: string;
};

export async function findReusablePullRequest(
  repo: string,
  number: number | undefined,
  token: string | undefined,
  request: typeof fetch = fetch,
): Promise<ExistingPullRequest | null> {
  if (!number || !token) return null;
  const response = await request(`https://api.github.com/repos/${repo}/pulls/${number}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const reason = apiAuthFailure(response.status);
    if (reason) throw new GitHubPublicationAuthError("pull_request", reason);
    throw new Error(`Could not verify existing Pull Request (${response.status})`);
  }
  const pr = await response.json() as {
    state?: string;
    draft?: boolean;
    number?: number;
    html_url?: string;
    head?: { ref?: string; repo?: { full_name?: string } };
    base?: { ref?: string; repo?: { full_name?: string } };
  };
  if (pr.state !== "open" || pr.number !== number || pr.head?.repo?.full_name?.toLowerCase() !== repo.toLowerCase() ||
      pr.base?.repo?.full_name?.toLowerCase() !== repo.toLowerCase() || !pr.head?.ref || !pr.base?.ref || !pr.html_url) return null;
  return { number, url: pr.html_url, branch: pr.head.ref, baseBranch: pr.base.ref };
}
