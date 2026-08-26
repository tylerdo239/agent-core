import { Context } from '@deepseek-ai/cordis'
import '../../../../seams/pipeline.ts'
import { byKind, outputPath, registerWorkspaceArtifact } from '../shared.ts'

/** Small RFC4180-compatible parser used by the dependency-free baseline. */
export function parseCsv(text: string): { columns: string[]; rows: string[][] } {
  const records: string[][] = []
  let record: string[] = []; let field = ''; let quoted = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++ }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') { record.push(field); field = '' }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++
      record.push(field); field = ''
      if (record.some((value) => value.length)) records.push(record)
      record = []
    } else field += character
  }
  if (quoted) throw new Error('unterminated quoted CSV field')
  if (field.length || record.length) { record.push(field); records.push(record) }
  return { columns: records[0] ?? [], rows: records.slice(1) }
}

export function majorityLabel(rows: string[][], targetIndex: number) {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row[targetIndex] ?? '', (counts.get(row[targetIndex] ?? '') ?? 0) + 1)
  return [...counts].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b))[0]?.[0] ?? ''
}

export const inject = ['pipelines']
export const apply = (ctx: Context) => {
  ctx.pipelines.registerStage({
    kind: 'train', name: 'majority', description: 'Dependency-free majority-class baseline trained on train_data only.',
    async run(context, input) {
      const train = byKind(input, 'train_data')
      if (!train) throw new Error('train:majority requires train_data')
      const target = String(context.config.target ?? '')
      if (!target) throw new Error('train:majority requires config.target')
      const { columns, rows } = parseCsv((await context.workspace.readFile(context.sessionId, train.path)).toString('utf8'))
      const targetIndex = columns.indexOf(target)
      if (targetIndex < 0) throw new Error(`target "${target}" not found in train_data`)
      const label = majorityLabel(rows, targetIndex)
      const accuracy = rows.length ? rows.filter((row) => row[targetIndex] === label).length / rows.length : 0
      const modelPath = outputPath(context, 'model.json')
      const metricsPath = outputPath(context, 'train-metrics.json')
      await context.workspace.writeFile(context.sessionId, modelPath, Buffer.from(JSON.stringify({ strategy: 'majority', target, label }, null, 2)))
      await context.workspace.writeFile(context.sessionId, metricsPath, Buffer.from(JSON.stringify({ algorithm: 'majority', train_rows: rows.length, train_accuracy: accuracy }, null, 2)))
      await context.progress(1, `majority label ${label}`)
      return [
        await registerWorkspaceArtifact(context, { path: modelPath, kind: 'model', producer: 'train:majority', mimeType: 'application/json' }),
        await registerWorkspaceArtifact(context, { path: metricsPath, kind: 'train_metrics', producer: 'train:majority', mimeType: 'application/json' }),
      ]
    },
  })
}
