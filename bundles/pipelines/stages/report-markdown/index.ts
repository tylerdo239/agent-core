import { Context } from '@deepseek-ai/cordis'
import '../../../../seams/pipeline.ts'
import { byKind, outputPath, registerWorkspaceArtifact } from '../shared.ts'

export const inject = ['pipelines']
export const apply = (ctx: Context) => {
  ctx.pipelines.registerStage({
    kind: 'report', name: 'markdown', description: 'Create a provenance and metrics report from registered artifacts.',
    async run(context, input) {
      const lines = [`# Pipeline report — ${context.pipelineName}`, '', `- Session: \`${context.sessionId}\``, `- Job: \`${context.jobId}\``, '', '## Artifacts', '', '| Kind | Path | Bytes | Producer | sha256 |', '|---|---|---:|---|---|']
      for (const reference of input) {
        const record = await context.artifacts.get(reference.id)
        lines.push(`| ${reference.kind} | \`${reference.path}\` | ${record?.size ?? '?'} | ${record?.producer ?? '?'} | \`${reference.sha256.slice(0, 12)}\` |`)
      }
      for (const kind of ['train_metrics', 'validation_metrics']) {
        const reference = byKind(input, kind)
        if (!reference) continue
        const value = JSON.parse((await context.workspace.readFile(context.sessionId, reference.path)).toString('utf8'))
        lines.push('', `## ${kind === 'train_metrics' ? 'Training' : 'Validation'} metrics`, '', '```json', JSON.stringify(value, null, 2), '```')
      }
      const output = outputPath(context, 'report.md')
      await context.workspace.writeFile(context.sessionId, output, Buffer.from(`${lines.join('\n')}\n`))
      await context.progress(1, 'report written')
      return [await registerWorkspaceArtifact(context, { path: output, kind: 'report', producer: 'report:markdown', mimeType: 'text/markdown' })]
    },
  })
}
