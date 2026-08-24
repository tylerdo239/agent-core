# Tool catalog (DSH-style)

| Tool package | Model-visible names | Requires | Writes / affects | Shipped notes |
|---|---|---|---|---|
| `tool-web-search` | `web_search(query, limit=5)` | `ctx.tools`, `ctx.permission` (`web-search:search`), `ctx.systemPrompt` | `tool/call`, `tool/result` + `tool:web_search` prompt section | DuckDuckGo HTML scrape, `limit` capped 10, timeout 10s, returns `title/url/snippet` |
| `tool-database-query` | `query_database(sql)` | `ctx.tools`, `ctx.storage` | `tool/call`, `tool/result` | DuckDB over workspace CSVs |
| `python/rlm_agent` REPL helpers (not `ctx.tools`) | `list_datasets()`, `load_dataset(file_id?)`, `profile_dataset(file_id?, sample_rows?, max_columns?)` | `workspace index` | `observation` via `print` | `profile_dataset` is `<Understand>` one-call: shape, dtypes, missing, dup, head, numeric describe (bounded ~6k chars) — ablation -7.1 if dropped |
| `python/rlm_agent` REPL helpers | `list_workspace_files()`, `read_workspace_file(path, start?, length?)`, `save_artifact(path, content)` | `workspace` | `generated/` | `save_artifact` writes below `generated/` |
| `python/rlm_agent` REPL helpers | `run_job(code, job_id?)`, `job_output(job_id, offset?, length?)`, `job_list()` | `workspace/generated/jobs/` | `generated/jobs/<id>.log` | Background thread for FLAML/long fits that exceed `cell_timeout=300`; poll via `job_output` |
| `python/rlm_agent` REPL helpers | `SHOW_VARS()`, `skill_resource(path)` | `REPL namespace`, `skill` | — | `skill_resource` only when `selected_skill` active |

**Guarded pipeline (H1):** `ctx.tools.invoke` → `tools/pre-execute` waterfall (monotonic deny) → `tools/execute` → handler → `tools/post-execute`. `loop-rlm` (`source=rlm`) goes through same pipeline as `loop-default` via `sandbox-ipython:completeToolCall`.

**Prompt invariant (H2):** `loop-rlm/protocol.ts` + `python/rlm_agent/harness_adapter.py` emit `prompt_assembled` (`promptHash` 12-char sha256, `promptVersion`, `toolsHash`) as `session/event` — `model-visible = logged` (DSH).

**Jobs (H3):** `run_job` pattern mirrors DSH `ctx.jobs` + `job_*` tools.

**Evolution (H4):** `benchmarks/rlm/pack.yaml` declares task claims + cases + grader; `recipe.lock` pins exact prompt/tool/skill versions; `scripts/build_scorecard.py` builds `Scorecard` (`quality/cost/latency`).
