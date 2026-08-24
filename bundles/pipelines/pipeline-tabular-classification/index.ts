import { Context } from '@deepseek-ai/cordis'
import '../../../seams/pipeline.ts'

export const inject = ['pipelines']
export const apply = (ctx: Context) => {
  ctx.pipelines.registerPipeline({
    name: 'tabular-classification',
    stages: [
      { role: 'data', stage: 'data:load' },
      { role: 'feature', stage: 'feature:basic' },
      { role: 'train', stage: 'train:majority' },
      { role: 'validate', stage: 'validate:holdout' },
      { role: 'report', stage: 'report:markdown' },
    ],
  })
}
