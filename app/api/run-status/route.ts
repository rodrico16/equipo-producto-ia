import { requireGitHubSession } from "@/lib/server-auth";

export const runtime = "nodejs";

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const branchPattern = /^ai\/control-room-[A-Za-z0-9._-]+$/;

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function GET(request: Request) {
  let github;
  try {
    github = await requireGitHubSession();
  } catch {
    return Response.json({ error: "GitHub connection required" }, { status: 401 });
  }

  const url = new URL(request.url);
  const repo = url.searchParams.get("repo")?.trim() || "";
  const branch = url.searchParams.get("branch")?.trim() || "";

  if (!repoPattern.test(repo) || !branchPattern.test(branch)) {
    return Response.json({ error: "Invalid run reference" }, { status: 400 });
  }

  const [owner] = repo.split("/");
  const pulls = new URL(`https://api.github.com/repos/${repo}/pulls`);
  pulls.searchParams.set("state", "all");
  pulls.searchParams.set("head", `${owner}:${branch}`);
  pulls.searchParams.set("per_page", "5");

  const response = await fetch(pulls, {
    headers: githubHeaders(github.token),
    cache: "no-store",
  });

  if (!response.ok) {
    return Response.json(
      { error: `Could not recover GitHub run (${response.status})` },
      { status: 502 },
    );
  }

  const rows = (await response.json()) as Array<{
    html_url?: string;
    number?: number;
    state?: string;
    merged_at?: string | null;
    head?: { ref?: string };
  }>;
  const pr = rows.find((item) => item.head?.ref === branch && item.html_url);

  if (pr?.html_url) {
    return Response.json({
      state: "completed",
      branch,
      prUrl: pr.html_url,
      prNumber: pr.number,
      prState: pr.merged_at ? "merged" : pr.state || "open",
    });
  }

  return Response.json({ state: "running", branch });
}
