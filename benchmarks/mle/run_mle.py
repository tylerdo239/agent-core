#!/usr/bin/env python3
"""MLE-bench smoke — single tabular regression, no Kaggle.

Usage:
  python3 benchmarks/mle/run_mle.py --base-url http://127.0.0.1:8791 --competition smoke-tabular
  python3 benchmarks/mle/run_mle.py --smoke11   # run 11 times with different seeds
"""
from __future__ import annotations
import argparse, json, time, urllib.request, urllib.error
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "benchmarks/rlm/fixtures/dabench/my_test_01.csv"

def load_env(p: Path):
    vals={}
    for l in p.read_text().splitlines():
        l=l.strip()
        if not l or l.startswith("#") or "=" not in l: continue
        k,v=l.split("=",1)
        vals[k.strip()]=v.strip().strip('"').strip("'")
    return vals

def request_json(base, key, method, path, payload=None, timeout=120):
    body=None if payload is None else json.dumps(payload).encode()
    req=urllib.request.Request(f"{base.rstrip('/')}{path}", data=body, method=method, headers={"Authorization": f"Bearer {key}", "Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail=e.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} {e.code}: {detail}") from e

def prepare_smoke_competition(tmp_root: Path, seed=42):
    df=pd.read_csv(FIXTURE)
    # 80/20 split, test without label
    from sklearn.model_selection import train_test_split
    train, test = train_test_split(df, test_size=0.2, random_state=seed)
    test_nolabel=test.drop(columns=["MedianHouseValue"]).copy()
    # holdout truth for grading
    truth=test[["MedianHouseValue"]].copy()
    # write to tmp for debugging, but also will be injected into workspace
    tmp_root.mkdir(parents=True, exist_ok=True)
    train.to_csv(tmp_root/"train.csv", index=False)
    test_nolabel.to_csv(tmp_root/"test.csv", index=False)
    truth.to_csv(tmp_root/"truth.csv", index=False)
    desc="""# Smoke Tabular Regression (MLE-bench style)
Task: predict `MedianHouseValue` from 8 features (MedInc, HouseAge, AveRooms, AveBedrms, Population, AveOccup, Latitude, Longitude).
Files: `train.csv` has label, `test.csv` has same features without label.
You must:
1. Call `profile_dataset()` then `load_dataset()` as needed.
2. Train a model (try LinearRegression baseline then better if time).
3. Predict test.csv and save to `generated/submission.csv` with header `MedianHouseValue` (one column, same row order as test.csv).
4. Also save a short report to `generated/report.md`.
Validate: `list_workspace_files()` should show your submission.
"""
    (tmp_root/"description.md").write_text(desc)
    (tmp_root/"sample_submission.csv").write_text("MedianHouseValue\n1.0\n")
    return train, test_nolabel, truth, desc

def workspace_candidates(session_id: str):
    return [
        ROOT / "data" / "rlm-workspaces" / session_id,
        ROOT / "data" / "rlm-volumes" / f"agent-core-rlm-workspace-{session_id}",
        ROOT / "data" / "rlm-volumes" / session_id,
    ]

def inject_competition(session_id: str, train, test_nolabel, desc: str):
    # inject train.csv, test.csv, description.md + index.json into every candidate layout
    cands=[p for p in workspace_candidates(session_id) if p.is_dir()]
    if not cands:
        for p in workspace_candidates(session_id):
            p.mkdir(parents=True, exist_ok=True)
            cands.append(p)
    stamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for ws in cands:
        train.to_csv(ws/"train.csv", index=False)
        test_nolabel.to_csv(ws/"test.csv", index=False)
        (ws/"description.md").write_text(desc)
        idx_path=ws/"index.json"
        try:
            idx=json.loads(idx_path.read_text())
            if not isinstance(idx, dict): idx={}
        except: idx={}
        # register train and test for load_dataset
        idx["train"]={"filename":"train.csv","path":"train.csv","created_at":stamp}
        idx["test"]={"filename":"test.csv","path":"test.csv","created_at":stamp}
        idx_path.write_text(json.dumps(idx, indent=2))

def grade_submission(sub_path: Path, truth: pd.DataFrame):
    try:
        sub=pd.read_csv(sub_path)
    except Exception as e:
        return {"valid": False, "error": f"cannot read submission: {e}", "mse": None}
    if "MedianHouseValue" not in sub.columns:
        return {"valid": False, "error": f"missing column MedianHouseValue, got {list(sub.columns)}", "mse": None}
    if len(sub)!=len(truth):
        return {"valid": False, "error": f"row count {len(sub)} != {len(truth)}", "mse": None}
    # simple MSE
    mse=float(((sub["MedianHouseValue"].values - truth["MedianHouseValue"].values)**2).mean())
    return {"valid": True, "mse": mse, "rows": len(sub)}

def run_once(base_url, api_key, seed):
    tmp_root=Path(f"/tmp/mle_smoke_{seed}")
    train, test_nolabel, truth, desc = prepare_smoke_competition(tmp_root, seed=seed)
    # create session
    sess=request_json(base_url, api_key, "POST", "/sessions", {"driver":"rlm","maxSteps":8})
    sid=sess["id"]
    inject_competition(sid, train, test_nolabel, desc)
    # task message mimics MLE-bench /home/instructions.txt
    msg = f"""You are in MLE-bench smoke-tabular (seed {seed}).
Read `description.md` via `read_workspace_file('description.md')` and inspect data with `profile_dataset()` / `load_dataset()`.
Dataset: train.csv (with label MedianHouseValue), test.csv (without label) in workspace root.
Goal: train model and produce submission at `generated/submission.csv` with header MedianHouseValue, same order as test.csv.
Use `save_artifact('submission.csv', content)` where content is CSV string. After saving, call `list_workspace_files()` to confirm.
Also call `job_output` if you used `run_job` for long training (not needed here).
End with `answer[\"content\"]` summarizing MSE estimate and submission path, then `answer[\"ready\"]=True`."""
    t0=time.perf_counter()
    result=request_json(base_url, api_key, "POST", f"/sessions/{sid}/messages", {"message": msg}, timeout=300)
    dt=time.perf_counter()-t0
    # fetch events
    ev=request_json(base_url, api_key, "GET", f"/sessions/{sid}/events", timeout=30)["events"]
    iters=sum(1 for e in ev if e.get("type")=="iteration_completed")
    # try to read submission from host workspace
    sub_path=None
    for cand in workspace_candidates(sid):
        p=cand/"generated"/"submission.csv"
        if p.exists():
            sub_path=p
            break
        # also check direct
        p2=cand/"submission.csv"
        if p2.exists():
            sub_path=p2
            break
    grade={"valid": False, "mse": None}
    if sub_path and sub_path.exists():
        grade=grade_submission(sub_path, truth)
    else:
        # try via list_workspace_files from host
        grade={"valid": False, "error": "submission.csv not found in generated/", "mse": None}
    return {
        "seed": seed,
        "session_id": sid,
        "status": result.get("status"),
        "answer": str(result.get("content",""))[:600],
        "iterations": iters,
        "duration": round(dt,1),
        "grade": grade,
        "sub_path": str(sub_path) if sub_path else None,
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8791")
    ap.add_argument("--competition", default="smoke-tabular")
    ap.add_argument("--smoke11", action="store_true", help="run 11 seeds")
    args=ap.parse_args()
    env=load_env(ROOT/".env")
    keys=[k.strip() for k in env.get("API_KEYS","").split(",") if k.strip()]
    if not keys: raise RuntimeError("API_KEYS missing")
    seeds = list(range(42,53)) if args.smoke11 else [42]
    results=[]
    for s in seeds:
        print(f"RUN smoke seed {s}", flush=True)
        try:
            r=run_once(args.base_url, keys[0], s)
            results.append(r)
            ok="PASS" if r["grade"].get("valid") and r["grade"].get("mse") is not None else "FAIL"
            print(f"{ok} seed {s} mse={r['grade'].get('mse')} iter={r['iterations']} dur={r['duration']}s", flush=True)
            if not r["grade"].get("valid"):
                print(" ", r["grade"].get("error"), flush=True)
        except Exception as e:
            print(f"ERROR seed {s}: {e}", flush=True)
            results.append({"seed": s, "error": str(e)})
    # summary
    valid_mse=[r["grade"]["mse"] for r in results if r.get("grade",{}).get("mse") is not None]
    print(f"SUMMARY {len([r for r in results if r.get('grade',{}).get('valid')])}/{len(seeds)} valid, median_mse={float(np.median(valid_mse)) if valid_mse else None}")
    out= Path("reports/mle-smoke.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"results": results, "summary": {"valid": len([r for r in results if r.get('grade',{}).get('valid')]), "total": len(seeds), "median_mse": float(np.median(valid_mse)) if valid_mse else None}}, indent=2))
    print(f"REPORT {out}")

if __name__=="__main__":
    main()
