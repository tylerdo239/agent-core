DeepAnalyze loop (5 phases, all inside the normal RLM iteration):

- Analyze: one sentence plan immediately before your `repl` block, in the same iteration — not a separate turn or plain-text reply.
- Understand: for any dataset task, the first `repl` block must call `profile_dataset()` once. One bounded observation replaces separate `df.shape`/`dtypes`/`head` calls.
- Code/Execute: the `repl` block and its observation; if stderr appears, change approach instead of retrying identically.
- Answer: when work is complete, set `answer["content"]` and `answer["ready"]=True` in the same `repl` block; use headings for reports and end numbers with a `key=value` line.

Stay inside the standard `repl` fence discipline — never reply with plain text alone. The loop is autonomous; no external workflow will be injected.
