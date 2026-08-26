import { Context } from '@deepseek-ai/cordis'
import '../../../../seams/pipeline.ts'
import { byKind, localRoot, outputPath, registerWorkspaceArtifact } from '../shared.ts'

export function buildFlamlSnippet(trainPath: string, modelPath: string, metricsPath: string, target: string, budget: number) {
  return `
import json, joblib
from pathlib import Path
import pandas as pd
from flaml import AutoML
frame = pd.read_csv(Path(${JSON.stringify(trainPath)}))
target = ${JSON.stringify(target)}
if target not in frame.columns: raise SystemExit(f"target {target!r} not found")
X = frame.drop(columns=[target])
y = frame[target]
automl = AutoML()
automl.fit(X, y, task="classification", time_budget=${budget}, eval_method="cv", n_splits=3, verbose=False)
model_path = Path(${JSON.stringify(modelPath)}); metrics_path = Path(${JSON.stringify(metricsPath)})
model_path.parent.mkdir(parents=True, exist_ok=True)
joblib.dump({"model": automl, "features": list(X.columns), "target": target}, model_path)
metrics_path.write_text(json.dumps({"algorithm": str(automl.best_estimator), "train_rows": len(frame), "cv_best_loss": float(automl.best_loss)}), encoding="utf-8")
print("TRAIN_OK")
`.trim()
}

export const inject = ['pipelines']
export const apply = (ctx: Context) => {
  ctx.pipelines.registerStage({
    kind: 'train', name: 'flaml', description: 'FLAML classifier fitted only on train_data; produces a model bundle.',
    async run(context, input) {
      const train = byKind(input, 'train_data')
      if (!train) throw new Error('train:flaml requires train_data')
      const target = String(context.config.target ?? '')
      if (!target) throw new Error('train:flaml requires config.target')
      if (!context.sandbox) throw new Error('train:flaml requires a sandbox provider')
      const budget = Math.min(Math.max(Number(context.config.timeBudgetSec ?? 10), 1), 300)
      const root = localRoot(context)
      const model = outputPath(context, 'model.pkl')
      const metrics = outputPath(context, 'train-metrics.json')
      context.checkCancelled()
      const result = await context.sandbox.run(buildFlamlSnippet(`${root}/${train.path}`, `${root}/${model}`, `${root}/${metrics}`, target, budget), 'python', { signal: context.signal })
      context.checkCancelled()
      if (result.exitCode !== 0 || !result.stdout.includes('TRAIN_OK')) throw new Error(`train:flaml failed: ${(result.stderr || result.stdout).slice(-500)}`)
      await context.progress(1, 'FLAML model trained')
      return [
        await registerWorkspaceArtifact(context, { path: model, kind: 'model', producer: 'train:flaml', mimeType: 'application/octet-stream' }),
        await registerWorkspaceArtifact(context, { path: metrics, kind: 'train_metrics', producer: 'train:flaml', mimeType: 'application/json' }),
      ]
    },
  })
}
