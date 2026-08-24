import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import '../../../../seams/pipeline.ts'
import { registerWorkspaceArtifact } from '../shared.ts'

export const inject = ['pipelines']
export const apply = (ctx: Context) => {
  ctx.pipelines.registerStage({
    kind: 'data', name: 'load', description: 'Select an uploaded CSV and register it as the pipeline input.',
    async run(context) {
      const datasets = context.workspace.listDatasets(context.sessionId)
      const wanted = typeof context.config.filename === 'string' ? context.config.filename : undefined
      const dataset = wanted
        ? datasets.find((item) => item.id === wanted || item.filename === wanted)
        : datasets.find((item) => item.active) ?? datasets[0]
      if (!dataset) throw new Error('data:load requires an uploaded dataset')
      if (path.extname(dataset.path).toLowerCase() !== '.csv') throw new Error('data:load v1 supports CSV only')
      await context.progress(1, `selected ${dataset.filename}`)
      return [await registerWorkspaceArtifact(context, {
        path: dataset.path, kind: 'dataset', producer: 'data:load', mimeType: 'text/csv',
      })]
    },
  })
}
