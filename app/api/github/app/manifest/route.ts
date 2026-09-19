import { consumeManifestState, writeGitHubAppConfig } from "@/lib/github-app-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !(await consumeManifestState(state))) {
    return Response.redirect(new URL("/?github=manifest-invalid", request.url), 302);
  }

  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    cache: "no-store",
  });
  const body = (await response.json()) as {
    client_id?: string;
    client_secret?: string;
    slug?: string;
    message?: string;
  };

  if (!response.ok || !body.client_id || !body.client_secret || !body.slug) {
    return Response.redirect(new URL(`/?github=${encodeURIComponent(body.message || "manifest-failed")}`, request.url), 302);
  }

  await writeGitHubAppConfig({
    clientId: body.client_id,
    clientSecret: body.client_secret,
    slug: body.slug,
  });

  return Response.redirect(`https://github.com/apps/${encodeURIComponent(body.slug)}/installations/new`, 302);
}
