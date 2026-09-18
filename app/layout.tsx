import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Product Team · Control Room",
  description: "Orquestación visual de agentes de producto e ingeniería con GitHub Copilot.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
