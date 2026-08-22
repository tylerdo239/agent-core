import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/skill.ts'
import { SkillResource, SkillResourceKind } from '../../../seams/skill.ts'

export namespace SkillFilesystem {
  export interface Config {
    root: string
  }
}

const RESOURCE_DIRS = new Map<string, SkillResourceKind>([
  ['assets', 'asset'],
  ['references', 'reference'],
  ['checklists', 'checklist'],
  ['scripts', 'script'],
  ['templates', 'template'],
])
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.py', '.sql', '.json', '.yaml', '.yml', '.html', '.css', '.js', '.ts', '.csv'])

function frontmatter(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const metadata: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break
    const separator = line.indexOf(':')
    if (separator < 0) continue
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return metadata
}

function descendants(directory: string): string[] {
  if (!existsSync(directory)) return []
  const files: string[] = []
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === '__pycache__') continue
      const full = path.join(current, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) visit(full)
      else if (stat.isFile() && path.extname(entry) !== '.pyc') files.push(full)
    }
  }
  visit(directory)
  return files.sort()
}

export const inject = ['skills']

export const apply = (ctx: Context, config: SkillFilesystem.Config) => {
  const root = path.resolve(config.root)
  if (!existsSync(root)) {
    ctx.logger('skill-filesystem').warn('skill root does not exist: %s', root)
    return
  }

  for (const directory of readdirSync(root).sort()) {
    const skillRoot = path.join(root, directory)
    const entrypoint = path.join(skillRoot, 'SKILL.md')
    if (!existsSync(entrypoint) || !statSync(entrypoint).isFile()) continue

    const instructions = readFileSync(entrypoint, 'utf8')
    const metadata = frontmatter(instructions)
    const name = metadata.name || directory
    const resources: SkillResource[] = [...RESOURCE_DIRS.entries()]
      .flatMap(([resourceDirectory, kind]) =>
        descendants(path.join(skillRoot, resourceDirectory)).map((file) => ({
          path: path.relative(skillRoot, file).split(path.sep).join('/'),
          kind,
        })),
      )

    ctx.skills.register({
      name,
      description: metadata.description || '',
      instructions,
      triggers: (metadata.triggers || '').split(',').map((item) => item.trim()).filter(Boolean),
      userInvocable: (metadata['user-invocable'] || 'true').toLowerCase() !== 'false',
      resources,
    }, async (resourcePath) => {
      const file = path.resolve(skillRoot, resourcePath)
      if (file === skillRoot || !file.startsWith(skillRoot + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
        throw new Error(`invalid resource path "${resourcePath}" for skill "${name}"`)
      }
      const raw = readFileSync(file)
      const text = TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
      return {
        path: resourcePath,
        kind: resources.find((item) => item.path === resourcePath)!.kind,
        content: text ? raw.toString('utf8') : raw.toString('base64'),
        encoding: text ? 'utf8' : 'base64',
      }
    })
  }
}
