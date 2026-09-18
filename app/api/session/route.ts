import { NextResponse } from "next/server";
import { getGitHubSession } from "@/lib/server-auth";

export async function GET() {
  const session = await getGitHubSession();
  if (!session) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    user: { login: session.login, avatarUrl: session.avatarUrl ?? null },
  });
}
