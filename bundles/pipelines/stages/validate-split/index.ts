import { Context } from '@deepseek-ai/cordis'
import '../../../../seams/pipeline.ts'
import { byKind, localRoot, outputPath, registerWorkspaceArtifact } from '../shared.ts'
import { parseCsv } from '../train-majority/index.ts'

export const inject = ['pipelines']
export const apply = (ctx: Context) => {
  ctx.pipelines.registerStage({
    kind: 'validate', name: 'holdout', description: 'Evaluate the trained model on untouched validation_data.',
    async run(context, input) {
      const validation = byKind(input, 'validation_data')
      const model = byKind(input, 'model')
      if (!validation || !model) throw new Error('validate:holdout requires validation_data and model')
      const target = String(context.config.target ?? '')
      if (!target) throw new Error('validate:holdout requires config.target')
      let accuracy: number
      let method: string
      if (model.path.endsWith('.json')) {
        method = 'majority-holdout'
        const { columns, rows } = parseCsv((await context.workspace.readFile(context.sessionId, validation.path)).toString('utf8'))
        const targetIndex = columns.indexOf(target)
        if (targetIndex < 0) throw new Error(`target "${target}" not found in validation_data`)
        const rule = JSON.parse((await context.workspace.readFile(context.sessionId, model.path)).toString('utf8')) as { label?: string }
        accuracy = rows.length ? rows.filter((row) => row[targetIndex] === rule.label).length / rows.length : 0
      } else {
        method = 'flaml-holdout'
        if (!context.sandbox) throw new Error('validate:holdout requires a sandbox for binary models')
        const root = localRoot(context)
        const code = `
import json, joblib
import pandas as pd
bundle = joblib.load(${JSON.stringify(`${root}/${model.path}`)})
frame = pd.read_csv(${JSON.stringify(`${root}/${validation.path}`)})
pred = bundle["model"].predict(frame[bundle["features"]])
accuracy = float((pred == frame[${JSON.stringify(target)}].to_numpy()).mean())
print("VALIDATE_OK:" + json.dumps({"accuracy": accuracy}))
`.trim()
        context.checkCancelled()
        const result = await context.sandbox.run(code, 'python', { signal: context.signal })
        context.checkCancelled()
        const match = result.stdout.match(/VALIDATE_OK:(.*)/)
        if (result.exitCode !== 0 || !match) throw new Error(`validate:holdout failed: ${(result.stderr || result.stdout).slice(-500)}`)
        accuracy = Number(JSON.parse(match[1]!).accuracy)
      }
      const output = outputPath(context, 'validation-metrics.json')
      const validationRows = parseCsv((await context.workspace.readFile(context.sessionId, validation.path)).toString('utf8')).rows.length
      await context.workspace.writeFile(context.sessionId, output, Buffer.from(JSON.stringify({ method, target, validation_rows: validationRows, holdout_accuracy: accuracy }, null, 2)))
      await context.progress(1, `holdout accuracy ${accuracy.toFixed(3)}`)
      return [await registerWorkspaceArtifact(context, { path: output, kind: 'validation_metrics', producer: 'validate:holdout', mimeType: 'application/json' })]
    },
  })
}
