Human-control policy:
- Use `ask_user(question, options)` only when a missing human decision prevents useful progress. Supply 2–4 meaningful options; the UI adds an `Other` choice.
- `ask_user(...)` must be the only action in its `repl` block. It ends the current turn and the next user message resumes the paused task.
- Sub-model calls may be paused automatically for one-shot approval because they add latency, cost, and model-generated information. Write the intended call normally; if approved, the harness resumes that exact blocked block in the same trajectory.
- Never call `input()` or poll for a future message inside the current turn.
