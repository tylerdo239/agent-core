# RLM harness benchmark

This is a small, auditable prompt/runtime regression suite. It adapts selected
ideas and questions from the Apache-2.0 licensed
[Berkeley Function Calling Leaderboard V4](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard),
then adds harness-specific cases for REPL formatting and session memory.

It is intentionally not an official BFCL score. The installed harness exposes a
different tool set and the suite runs only a small subset through the complete
agent-core → Python worker → RLM path.

Run while agent-core is serving:

```bash
python3 benchmarks/rlm/run.py
```

Run selected cases:

```bash
python3 benchmarks/rlm/run.py --only direct_greeting --only tool_typo_recovery
```

## Data-science suite (InfiAgent-DABench derived)

`cases-ds.json` adapts 7 closed-form questions from the InfiAgent-DABench
validation split (ICML 2024, Apache-2.0) across easy/medium/hard levels:
summary stats, missing-value profiling, normality, correlation with time
parsing, feature engineering, IQR outlier detection, and linear-regression MSE.
CSV fixtures live in `fixtures/dabench/`; `run.py` copies them into every
candidate session-workspace layout and registers them in `index.json` so
`list_datasets()`/`load_dataset()` see them from turn one.

```bash
python3 benchmarks/rlm/run.py --cases benchmarks/rlm/cases-ds.json \
    --report reports/rlm-benchmark/ds-latest.json
```

Extra check types supported by `run.py` scoring:
- `numeric_answers`: `[{value, tolerance}]` - each expected number must appear
  among the numbers extracted from the answer within tolerance.
- `answer_regex` / `answer_not`: regex must match / substrings must not appear.
- `max_context_tokens`: fail if `context_usage.estimated_tokens` peaks higher
  (guards the ~30k-token model context).

The report records answers, iteration counts, tool calls, failures, and session
IDs so every score can be audited against the stored event stream and RLM trace.

## Runtime

Start the backend with the repository's Docker Compose configuration before
running the suite. The `agent-core` image already contains the Python runtime
copied from `data-agent-backend:latest`; do not install Python or patch the
container manually. See `docs/frontend-backend-handoff.md` for the exact build
and environment contract.

## Where the system prompt actually lives

The REST server renders the RLM system prompt from markdown sections in
`agent-core/bundles/prompts/prompt-rlm-data-agent/sections/*.md` (identity,
repl-protocol, turn-policy, evidence-policy, human-control, completion).
`data-agent/triadic_dgm/rlm_agent/prompt.py` is NOT used by this stack.

Two hard-won constraints when editing those sections:

- The prompt passes through Python `str.format()`. A single literal `{` or `}`
  raises `KeyError` inside the worker and fails every turn. Never write bare
  braces; double them or reword.
- The server reads the sections once at startup. Restart the server (or use a
  second instance on another port) after editing them.

## Debugging tips

- Set `LOG_LEVEL=3` when launching the server to see worker stderr.
- Set `RLM_DEBUG_LM_DUMP=1` to log every root/sub LLM request+response pair
  (grep for `lm-dump` in the server log).
- `GET /sessions/:id/events` shows the full event stream per benchmark turn.
