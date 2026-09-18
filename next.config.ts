import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Copilot SDK includes native runtime dependencies (koffi). Route
  // handlers use it only on the Node.js server, so let Node resolve it at
  // runtime instead of asking Turbopack to bundle its native assets.
  serverExternalPackages: ["@github/copilot-sdk", "koffi", "@koromix/koffi-linux-x64"],
};

export default nextConfig;
