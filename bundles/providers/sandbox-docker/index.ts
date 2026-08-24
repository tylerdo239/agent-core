import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SandboxRunResult } from '../../../seams/sandbox.ts'
import { SandboxIpython } from '../sandbox-ipython/index.ts'

export namespace SandboxDocker {
  export interface Config {
    image?: string
    dockerBin?: string
    agentConfig?: Record<string, unknown>
    networkDisabled?: boolean
    memory?: string
    cpus?: number
    pidsLimit?: number
    removeWorkspaceVolumeOnClose?: boolean
    /** Canonical JSON passed by the composition root. */
    extraBody?: string
  }
}

const DEFAULT_IMAGE = 'agent-core:latest'

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_.-]/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 40) || 'default'
}

export interface DockerWorkerArgs {
  image: string
  containerName: string
  workspaceRoot: string
  sessionId: string
  agentConfig: Record<string, unknown>
  networkDisabled?: boolean
  memory?: string
  cpus?: number
  pidsLimit?: number
  extraBody?: string
}

function volumeFromLocator(value: string): string | undefined {
  return value.startsWith('docker-volume://') ? value.slice('docker-volume://'.length) : undefined
}

function pythonSafeSessionId(value: string) {
  const safe = String(value || 'default').replace(/[^a-zA-Z0-9._-]/g, '').replace(/^[.-]+|[.-]+$/g, '')
  return safe || 'default'
}

/** Pure function để command Docker có thể test mà không cần daemon. */
export function buildDockerWorkerArgs(options: DockerWorkerArgs): string[] {
  // WorkspaceLocal và Python ContextBuilder cùng sanitize session id rồi tạo
  // đúng thư mục này. Dùng basename thật thay vì sanitize lần hai (dễ lệch
  // case/ký tự) để mount path trong container trùng tuyệt đối.
  const dockerVolume = volumeFromLocator(options.workspaceRoot)
  const workspaceName = dockerVolume
    ? pythonSafeSessionId(options.sessionId)
    : path.basename(path.resolve(options.workspaceRoot))
  const containerWorkspace = `/workspaces/${workspaceName}`
  const args = [
    'run', '--rm', '-i', '--init',
    '--name', options.containerName,
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--workdir', containerWorkspace,
    '--volume', `${dockerVolume ?? path.resolve(options.workspaceRoot)}:${containerWorkspace}`,
    '--tmpfs', '/tmp:rw,nosuid,nodev,exec,size=2g',
    '--env', 'HOME=/tmp',
    '--env', 'PYTHONPATH=/app/python/vendor/rlm:/app/python',
    '--env', 'RLM_RUNTIME_ROOT=/app/python',
    '--env', `RLM_WORKSPACE_ROOT=${containerWorkspace}`,
    '--env', `RLM_AGENT_CONFIG_JSON=${JSON.stringify(options.agentConfig)}`,
  ]
  if (options.networkDisabled ?? true) args.push('--network', 'none')
  if (options.memory) args.push('--memory', options.memory)
  if (options.cpus !== undefined) args.push('--cpus', String(options.cpus))
  if (options.pidsLimit !== undefined) args.push('--pids-limit', String(options.pidsLimit))
  if (options.extraBody) args.push('--env', `OPENAI_EXTRA_BODY=${options.extraBody}`)
  // Bind mount host: chạy cùng UID/GID để file không thành root-owned.
  // Named volume: để root đã drop toàn bộ Linux capabilities sở hữu volume;
  // không có filesystem host nào được expose vào workspace.
  if (!dockerVolume) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
    const gid = typeof process.getgid === 'function' ? process.getgid() : undefined
    if (uid !== undefined && gid !== undefined) args.push('--user', `${uid}:${gid}`)
  }
  args.push(options.image, 'python', '-u', '/app/bundles/loop-drivers/loop-rlm/python/worker.py')
  return args
}

function execDocker(
  dockerBin: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; signal?: AbortSignal } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(dockerBin, args, options, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stdout, stderr }))
      resolve({ stdout, stderr })
    })
  })
}

export class SandboxDocker extends SandboxIpython {
  private containerNames = new Map<string, string>()
  private dockerBin: string
  private dockerConfig: SandboxDocker.Config

  constructor(ctx: Context, config: SandboxDocker.Config) {
    const dockerBin = config.dockerBin ?? 'docker'
    const image = config.image ?? DEFAULT_IMAGE
    const containerNames = new Map<string, string>()
    const workspaceVolumes = new Map<string, string>()
    const launch = ({ sessionId, cwd }: SandboxIpython.LaunchOptions): ChildProcessWithoutNullStreams => {
      const containerName = `agent-core-rlm-${safeName(sessionId)}-${randomUUID().slice(0, 8)}`
      containerNames.set(sessionId, containerName)
      const workspaceVolume = volumeFromLocator(cwd)
      if (workspaceVolume) workspaceVolumes.set(sessionId, workspaceVolume)
      const child = spawn(dockerBin, buildDockerWorkerArgs({
        image,
        containerName,
        workspaceRoot: cwd,
        sessionId,
        agentConfig: config.agentConfig ?? {},
        networkDisabled: config.networkDisabled,
        memory: config.memory,
        cpus: config.cpus,
        pidsLimit: config.pidsLimit,
        extraBody: config.extraBody,
      }), { stdio: ['pipe', 'pipe', 'pipe'] })
      child.once('exit', () => {
        if (containerNames.get(sessionId) === containerName) containerNames.delete(sessionId)
      })
      return child
    }
    const closeProcess = async (sessionId: string, child: ChildProcessWithoutNullStreams) => {
      const containerName = containerNames.get(sessionId)
      const workspaceVolume = workspaceVolumes.get(sessionId)
      containerNames.delete(sessionId)
      workspaceVolumes.delete(sessionId)
      if (containerName) {
        try {
          await execDocker(dockerBin, ['rm', '-f', containerName], { timeout: 10_000 })
        } catch (error) {
          const stderr = String((error as { stderr?: string }).stderr ?? '')
          if (!stderr.includes('No such container')) throw error
        }
      }
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            child.kill('SIGKILL')
            resolve()
          }, 2_000)
          child.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      }
      if (workspaceVolume && (config.removeWorkspaceVolumeOnClose ?? true)) {
        try {
          await execDocker(dockerBin, ['volume', 'rm', workspaceVolume], { timeout: 10_000 })
        } catch (error) {
          const stderr = String((error as { stderr?: string }).stderr ?? '')
          if (!stderr.includes('No such volume')) throw error
        }
      }
    }
    super(ctx, {
      workerPath: '/app/bundles/loop-drivers/loop-rlm/python/worker.py',
      runtimeRoot: '/app/python',
      agentConfig: config.agentConfig,
      launch,
      closeProcess,
      loggerName: 'sandbox-docker',
    })
    this.containerNames = containerNames
    this.dockerBin = dockerBin
    this.dockerConfig = config
  }

  async run(code: string, language: string, options: { signal?: AbortSignal } = {}): Promise<SandboxRunResult> {
    if (language !== 'python' && language !== 'python3') {
      throw new Error(`sandbox-docker only supports python, received "${language}"`)
    }
    const args = ['run', '--rm', '-i', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']
    if (this.dockerConfig.memory) args.push('--memory', this.dockerConfig.memory)
    if (this.dockerConfig.cpus !== undefined) args.push('--cpus', String(this.dockerConfig.cpus))
    args.push(this.dockerConfig.image ?? DEFAULT_IMAGE, 'python', '-c', code)
    try {
      const result = await execDocker(this.dockerBin, args, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024, signal: options.signal })
      return { ...result, exitCode: 0 }
    } catch (error) {
      const value = error as { stdout?: string; stderr?: string; code?: number }
      return { stdout: value.stdout ?? '', stderr: value.stderr ?? String(error), exitCode: typeof value.code === 'number' ? value.code : 1 }
    }
  }
}

export const inject = ['sessions', 'llm', 'tools', 'skills']

export const apply = async (ctx: Context, config: SandboxDocker.Config) => {
  await ctx.plugin(SandboxDocker, config)
}
