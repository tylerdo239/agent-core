# Benchmark Memory Summary (updated 2026-08-21)

## Result

```text
Core suite: 9/9 passed - 100% (latest.json)
DS suite:   7/7 passed - InfiAgent-DABench derived (ds-baseline.json)
```

## DS benchmark (cases-ds.json + fixtures/dabench/)

- Source: InfiAgent-DABench validation split (ICML 2024, Apache-2.0). 7
  questions: mean-stats, missing-%, normality, correlation (HH:MM:SS->s),
  feature engineering, IQR outliers, linear-regression MSE. Ground truths
  verified independently (corr=0.639 n=96; MSE 0.653 rs=42 / 0.814 rs=0).
- run.py registers case["datasets"] into ALL workspace layouts
  (rlm-workspaces/<sid>, rlm-volumes/agent-core-rlm-workspace-<sid>,
  rlm-volumes/<sid>): the runtime resolves different paths in different
  places, so fixtures must exist wherever the worker looks.
- New scoring checks: numeric_answers{value,tolerance}, answer_regex,
  answer_not, max_context_tokens (32k-context guard).
- Observed per-case peaks: 2.4k-4.6k tokens - far under the 30k budget.
- Run: `python3 agent-core/benchmarks/rlm/run.py --cases agent-core/benchmarks/rlm/cases-ds.json --report agent-core/reports/rlm-benchmark/ds-latest.json`

## Run command

```bash
python3 agent-core/benchmarks/rlm/run.py                      # core suite, 8787
```

## CRITICAL: where the system prompt really lives

- The REST server renders the RLM system prompt from:
  `agent-core/bundles/prompts/prompt-rlm-data-agent/sections/*.md`
  (identity, repl-protocol, turn-policy, evidence-policy, human-control, completion).
- `data-agent/triadic_dgm/rlm_agent/prompt.py` is NOT used by this harness.
  Do not waste loops editing it.
- Sections pass through Python `str.format()`: ONE literal `{` or `}` in the
  markdown raises KeyError inside the worker and fails every turn
  (symptom: error event `"analysis"`, status failed, 0 iterations).
- Sections are read once at server startup -> restart the server after edits.

## Fixes applied this session

1. Ported `_RLM_CAPTURE_ANSWER` patch into
   `data-agent/vendor/rlm/rlm/environments/ipython_repl.py`
   (captures `answer = {...}` rebinding in subprocess kernel mode).
2. STALE-ANSWER FIX (caused duplicated answers in real UI use): after a
   successful broker push, `_RLM_CAPTURE_ANSWER` now RESETS
   `answer = _RLMAnswerDict()` (consume semantics). Without it, the previous
   turn's ready=True was re-captured at the first cell of the next turn,
   returning the old answer in 1 iteration. Regression test:
   `test_submitted_answer_is_consumed_not_recaptured` (both repl test dirs).
3. SESSION MEMORY IN SYSTEM PROMPT: `harness_adapter.stream_prepared_turn`
   now appends `<session_memory_summary>` to the system prompt. Before, the
   summary lived only in the REPL prompt tail and the model "couldn't find"
   prior-turn facts (memory_two_turn only passed by accident via bug #2).
4. Prompt sections (`agent-core/bundles/prompts/prompt-rlm-data-agent/sections/`):
   - completion.md: never reply plain text; even greetings go through a repl block.
   - evidence-policy.md: current-event questions MUST call `web_search` first,
     one hop per iteration, answer only from observations.
   - turn-policy.md: direct path explicitly excludes real-world facts.
   - repl-protocol.md: never emit JSON-only responses; strict fence format.
5. The runtime is now built from agent-core's own
   `bundles/loop-drivers/loop-rlm/python/requirements.txt`; it includes
   scikit-learn/scipy/statsmodels for the iris pipeline.

## Environment recovery

Do not repair a running container manually. Rebuild the self-contained image:

```bash
docker compose up -d --build
```

Python source lives in `bundles/loop-drivers/loop-rlm/python/`; dependencies
live in `bundles/loop-drivers/loop-rlm/python/requirements.txt`; prompt
sections are copied into the image.

## Debugging

- Launch server with `LOG_LEVEL=3` to see worker stderr.
- `RLM_DEBUG_LM_DUMP=1` logs every LLM request/response (grep `lm-dump`);
  this hook was added to `worker.py` (off by default).
- Trace a case manually: POST /sessions -> POST /messages -> GET /events
  (Authorization: Bearer <key> required on ALL routes except /health).

## Failure signature cheatsheet

| Symptom | Cause |
|---|---|
| iterations > expected, no code events | model replied plain text / empty (no fence) |
| repeated identical NameError `repl` | model wrote `repl` as line inside fence |
| error event `"analysis"` | single braces in a prompt .md section (str.format KeyError) |
| tools: [] but answer present | model answered current-event question from memory |
| turn N returns turn N-1's answer in 1 iter | stale ready=True re-captured (fixed; keep consume semantics) |
| model "can't find" prior-turn facts | session memory not visible enough -> check system prompt injection |
