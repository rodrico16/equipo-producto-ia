# Specialist thread UX fix

This branch makes delegated specialist work visible and easier to read on mobile.

- Captures the concrete `spawn_agent` / `spawn_agents` instruction from Codex rollout JSONL.
- Normalizes it into the existing `tool.started` / `task` event contract so the specialist thread renders `Supervisor → <instruction>`.
- Applies the same behavior in chat/draft and PR runs.
- Improves mobile specialist list/thread spacing, touch targets, copy and iOS composer sizing.
- Humanizes common specialist names such as QA, UX, Ejecución and Regresión.
- Adds a CI contract check for the Codex assignment bridge.
