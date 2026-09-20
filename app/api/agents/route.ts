import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function field(source: string, key: string) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match?.[1]?.trim() ?? "";
}

function displayName(name: string) {
  const replacements: Record<string, string> = {
    qa: "QA",
    ux: "UX",
    ui: "UI",
    api: "API",
    devops: "DevOps",
    ejecucion: "Ejecución",
    regresion: "Regresión",
  };
  return name
    .replaceAll("_", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => replacements[word.toLowerCase()] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export async function GET() {
  const directory = path.join(process.cwd(), ".codex", "agents");
  try {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".toml")).sort();
    const agents = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(path.join(directory, file), "utf8");
        const name = field(source, "name") || file.replace(/\.toml$/, "");
        return {
          name,
          displayName: displayName(name),
          description: field(source, "description") || name,
          supervisor: name === "supervisor",
        };
      }),
    );
    return NextResponse.json({ agents });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), agents: [] },
      { status: 500 },
    );
  }
}
