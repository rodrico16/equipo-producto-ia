import type { Metadata } from "next";
import { ConnectionExperience } from "@/components/connection-experience";
import "./globals.css";
import "./provider.css";

export const metadata: Metadata = {
  title: "AI Product Team · Control Room",
  description: "Orquestación visual de agentes de producto e ingeniería con GitHub Copilot o ChatGPT / Codex.",
};

const storageMigration = `
try {
  const oldChatsKey = "epia_control_room_chats_v2";
  const oldActiveKey = "epia_control_room_active_chat_v2";
  const newChatsKey = "epia_control_room_chats_v3";
  const newActiveKey = "epia_control_room_active_chat_v3";
  if (!localStorage.getItem(newChatsKey)) {
    const previousChats = localStorage.getItem(oldChatsKey);
    if (previousChats) localStorage.setItem(newChatsKey, previousChats);
  }
  if (!localStorage.getItem(newActiveKey)) {
    const previousActive = localStorage.getItem(oldActiveKey);
    if (previousActive) localStorage.setItem(newActiveKey, previousActive);
  }
} catch {}
`;

const runRecoveryRegistration = `
try {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/run-recovery-sw.js", { scope: "/" }).catch(() => {});
  }
} catch {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <script dangerouslySetInnerHTML={{ __html: storageMigration }} />
        <script dangerouslySetInnerHTML={{ __html: runRecoveryRegistration }} />
        {children}
        <ConnectionExperience />
      </body>
    </html>
  );
}
