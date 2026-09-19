import { requireGitHubSession } from "@/lib/server-auth";

export const runtime = "nodejs";

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  updated_at: string;
  owner: { login: string; avatar_url?: string };
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; pull?: boolean };
};

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function normalize(repo: GitHubRepo) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch || "main",
    htmlUrl: repo.html_url,
    updatedAt: repo.updated_at,
    owner: repo.owner.login,
    ownerAvatar: repo.owner.avatar_url || null,
    canPush: Boolean(repo.permissions?.push || repo.permissions?.maintain || repo.permissions?.admin),
  };
}

export async function GET(request: Request) {
  let session;
  try {
    session = await requireGitHubSession();
  } catch {
    return Response.json({ connected: false, repos: [] }, { status: 401 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page") || "100")));
  const response = await fetch(
    `https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
    { headers: headers(session.token), cache: "no-store" },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return Response.json({ error: `GitHub repo sync failed (${response.status})`, detail: detail.slice(0, 500) }, { status: response.status });
  }

  const repos = (await response.json()) as GitHubRepo[];
  return Response.json({
    connected: true,
    account: session.login,
    repos: repos.map(normalize),
    page,
    hasMore: repos.length === perPage,
  });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireGitHubSession();
  } catch {
    return Response.json({ error: "Connect GitHub before creating a repository" }, { status: 401 });
  }

  const body = (await request.json()) as {
    name?: string;
    description?: string;
    private?: boolean;
  };
  const name = body.name?.trim();
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
    return Response.json({ error: "Repository name is invalid" }, { status: 400 });
  }

  const response = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { ...headers(session.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description: body.description?.trim() || "Created from AI Product Team Control Room",
      private: body.private !== false,
      auto_init: true,
    }),
  });

  const payload = (await response.json()) as GitHubRepo & { message?: string };
  if (!response.ok) {
    return Response.json({ error: payload.message || `GitHub repository creation failed (${response.status})` }, { status: response.status });
  }

  return Response.json({ repo: normalize(payload) }, { status: 201 });
}
