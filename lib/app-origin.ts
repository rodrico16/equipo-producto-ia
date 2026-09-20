export function resolveAppOrigin(request?: Request): string {
  const envCandidates = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.PUBLIC_URL,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of envCandidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {}
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    try {
      const productionUrl = new URL(
        process.env.VERCEL_PROJECT_PRODUCTION_URL.startsWith("http")
          ? process.env.VERCEL_PROJECT_PRODUCTION_URL
          : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
      );
      return productionUrl.origin;
    } catch {}
  }

  if (process.env.VERCEL_URL) {
    try {
      return new URL(`https://${process.env.VERCEL_URL}`).origin;
    } catch {}
  }

  if (request) {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const forwardedProto = request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "");

    if (forwardedHost && forwardedProto) {
      try {
        const forwardedUrl = new URL(`${forwardedProto}://${forwardedHost}`);
        const allowedHost =
          forwardedUrl.hostname === requestUrl.hostname ||
          requestUrl.hostname === "localhost" ||
          forwardedUrl.hostname.endsWith(".vercel.app");
        if (allowedHost) {
          return forwardedUrl.origin;
        }
      } catch {}
    }

    return requestUrl.origin;
  }

  return "http://localhost:3000";
}
