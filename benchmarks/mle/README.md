# MLE-bench smoke (no Kaggle)

Mimics real MLE-bench interface but uses local fixtures, no download.

- `description.md` in session workspace
- dataset `train.csv`/`test.csv` via `index.json`
- agent must produce `generated/submission.csv` (aliased to `/home/submission/submission.csv`)
- grader: MSE (lower is better) vs private holdout

Run:
```
python3 benchmarks/mle/run_mle.py --base-url http://127.0.0.1:8791 --competition smoke-tabular
```
