#!/usr/bin/env python3
"""Build Scorecard from Pack + benchmark reports (H4 evolution).

Usage:
  python3 scripts/build_scorecard.py \
    --pack benchmarks/rlm/pack.yaml \
    --reports reports/rlm-benchmark/ab-*.json \
    --out reports/rlm-benchmark/scorecard.json
"""

import argparse, json, hashlib
from pathlib import Path
import glob

def sha12(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12] if p.exists() else "missing"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", type=Path, default=Path("benchmarks/rlm/pack.yaml"))
    ap.add_argument("--reports", nargs="*", default=[])
    ap.add_argument("--out", type=Path, default=Path("reports/rlm-benchmark/scorecard.json"))
    ap.add_argument("--reports-glob", type=str, default="reports/rlm-benchmark/ab-*.json")
    args = ap.parse_args()

    report_files = []
    if args.reports:
        report_files = [Path(p) for p in args.reports]
    else:
        report_files = [Path(p) for p in glob.glob(args.reports_glob)]

    merged = {"pack": str(args.pack), "reports": [], "summary": {}}
    total_pass = total = 0
    weighted_s = weighted_iter = 0
    all_fmt = {}
    for rf in sorted(report_files):
        if not rf.exists():
            continue
        d = json.loads(rf.read_text())
        s = d.get("summary", {})
        merged["reports"].append({"file": str(rf), "suite": d.get("suite"), "summary": s})
        total_pass += int(s.get("passed", 0))
        total += int(s.get("total", 0))
        weighted_s += float(s.get("avg_s_interaction", 0)) * int(s.get("total", 0))
        weighted_iter += float(s.get("avg_iterations", 0)) * int(s.get("total", 0))
        for k, v in (s.get("format_gate_dist") or {}).items():
            all_fmt[k] = all_fmt.get(k, 0) + int(v)

    # recipe fingerprint (prompt + tools versions)
    prompt_files = sorted(Path("bundles/prompts/prompt-rlm-data-agent/sections").glob("*.md"))
    recipe = {
        "prompt_sections": {p.name: sha12(p) for p in prompt_files},
        "tools": sha12(Path("python/rlm_agent/tools.py")),
        "worker": sha12(Path("bundles/loop-drivers/loop-rlm/python/worker.py")),
        "tool_registry": sha12(Path("bundles/providers/tool-registry/index.ts")),
    }
    recipe_hash = hashlib.sha256(json.dumps(recipe, sort_keys=True).encode()).hexdigest()[:12]

    merged["recipe"] = recipe
    merged["recipe_hash"] = recipe_hash
    merged["summary"] = {
        "passed": total_pass,
        "total": total,
        "score": (total_pass/total) if total else 0,
        "avg_s_interaction": round(weighted_s/total, 3) if total else 0,
        "avg_iterations": round(weighted_iter/total, 2) if total else 0,
        "format_gate_dist": all_fmt,
    }
    # quality / cost / latency (cost ~ context tokens not yet in reports, latency ~ duration not in summary)
    merged["metrics"] = {
        "quality": merged["summary"]["avg_s_interaction"],
        "cost_proxy": "context_peak_tokens not aggregated yet",
        "latency_proxy": "duration_seconds not aggregated yet",
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(merged, indent=2, ensure_ascii=False))
    print(f"Scorecard {total_pass}/{total} score={merged['summary']['score']:.3f} recipe={recipe_hash}")
    print(f"Wrote {args.out}")

if __name__ == "__main__":
    main()
