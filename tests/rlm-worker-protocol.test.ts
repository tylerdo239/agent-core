import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workerPython = path.resolve('bundles/loop-drivers/loop-rlm/python')

describe('RLM worker protocol', () => {
  it('keeps transport requestId and human-control request_id without keyword collision', () => {
    const worker = readFileSync(path.join(workerPython, 'worker.py'), 'utf8')
    expect(worker).toContain('"requestId": protocol_request_id')
    expect(worker).toContain('def emit(protocol_request_id: str, event_type: str, **payload: Any)')
  })
})
