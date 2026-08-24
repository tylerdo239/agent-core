import { Context } from '@deepseek-ai/cordis'
import '../../../../seams/pipeline.ts'
import { byKind, localRoot, outputPath, registerWorkspaceArtifact } from '../shared.ts'

export function buildFeatureSnippet(input: string, trainOutput: string, validationOutput: string, metadataOutput: string, target: string, validationFraction: number) {
  return `
import json
from pathlib import Path
import pandas as pd
from sklearn.model_selection import train_test_split

frame = pd.read_csv(Path(${JSON.stringify(input)}))
target = ${JSON.stringify(target)}
if target not in frame.columns:
    raise SystemExit(f"target column {target!r} not found")
feature_columns = [c for c in frame.select_dtypes(include=["number"]).columns if c != target]
if not feature_columns:
    raise SystemExit("no numeric features after excluding target")
y = frame[target]
stratify = y if y.nunique(dropna=False) > 1 and y.value_counts(dropna=False).min() >= 2 else None
train, valid = train_test_split(frame, test_size=${validationFraction}, random_state=42, stratify=stratify)
medians = train[feature_columns].median(numeric_only=True)
train_x = train[feature_columns].fillna(medians)
valid_x = valid[feature_columns].fillna(medians)
means = train_x.mean()
stds = train_x.std(ddof=0).replace(0, 1.0)
train_out = (train_x - means) / stds
valid_out = (valid_x - means) / stds
train_out[target] = train[target].to_numpy()
valid_out[target] = valid[target].to_numpy()
paths = [Path(${JSON.stringify(trainOutput)}), Path(${JSON.stringify(validationOutput)}), Path(${JSON.stringify(metadataOutput)})]
for p in paths: p.parent.mkdir(parents=True, exist_ok=True)
train_out.to_csv(paths[0], index=False)
valid_out.to_csv(paths[1], index=False)
paths[2].write_text(json.dumps({"target": target, "features": feature_columns, "train_rows": len(train_out), "validation_rows": len(valid_out)}), encoding="utf-8")
print("FEATURE_OK")
`.trim()
}

export const inject = ['pipelines']
export const apply = (ctx: Context) => {
  ctx.pipelines.registerStage({
    kind: 'feature', name: 'basic', description: 'Leak-free train/validation split and numeric scaling fitted on train only.',
    async run(context, input) {
      const dataset = byKind(input, 'dataset')
      if (!dataset) throw new Error('feature:basic requires a dataset artifact')
      const target = String(context.config.target ?? '')
      if (!target) throw new Error('feature:basic requires config.target')
      const fraction = Number(context.config.validationFraction ?? 0.2)
      if (!(fraction > 0 && fraction < 0.5)) throw new Error('validationFraction must be between 0 and 0.5')
      if (!context.sandbox) throw new Error('feature:basic requires a sandbox provider')
      const root = localRoot(context)
      const train = outputPath(context, 'train.csv')
      const validation = outputPath(context, 'validation.csv')
      const metadata = outputPath(context, 'feature-metadata.json')
      context.checkCancelled()
      const result = await context.sandbox.run(buildFeatureSnippet(
        `${root}/${dataset.path}`, `${root}/${train}`, `${root}/${validation}`, `${root}/${metadata}`, target, fraction,
      ), 'python', { signal: context.signal })
      context.checkCancelled()
      if (result.exitCode !== 0 || !result.stdout.includes('FEATURE_OK')) throw new Error(`feature:basic failed: ${(result.stderr || result.stdout).slice(-500)}`)
      await context.progress(1, 'train/validation features written')
      return [
        await registerWorkspaceArtifact(context, { path: train, kind: 'train_data', producer: 'feature:basic', mimeType: 'text/csv' }),
        await registerWorkspaceArtifact(context, { path: validation, kind: 'validation_data', producer: 'feature:basic', mimeType: 'text/csv' }),
        await registerWorkspaceArtifact(context, { path: metadata, kind: 'feature_metadata', producer: 'feature:basic', mimeType: 'application/json' }),
      ]
    },
  })
}
