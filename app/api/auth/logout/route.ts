import { NextResponse } from "next/server";
import { sessionCookie } from "@/lib/session";
import { clearGitHubDeviceRequest, clearGitHubDeviceSession } from "@/lib/github-device-auth";

export async function POST(request: Request) {
  await clearGitHubDeviceRequest();
  await clearGitHubDeviceSession();
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return response;
}
