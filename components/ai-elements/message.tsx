"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo, type ComponentProps } from "react";
import { Streamdown } from "streamdown";

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const plugins = { cjk, code, math, mermaid };

export const MessageResponse = memo(function MessageResponse({ className, ...props }: MessageResponseProps) {
  return (
    <Streamdown
      className={["ai-message-response", className].filter(Boolean).join(" ")}
      plugins={plugins}
      {...props}
    />
  );
});
