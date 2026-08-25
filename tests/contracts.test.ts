import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createContractValidator, ContractValidationError } from '../src/contracts.ts'

function schema(path: string) { return JSON.parse(readFileSync(new URL(`../contracts/${path}`, import.meta.url), 'utf8')) }

describe('versioned contracts', () => {
  it('validates an event envelope and rejects missing correlation fields', () => {
    const validate = createContractValidator('events/v1', schema('events/v1.schema.json'))
    expect(validate({ id: 's:1', seq: 1, sessionId: 's', timestamp: new Date().toISOString(), type: 'message', payload: {} })).toBeTruthy()
    expect(() => validate({ type: 'message', payload: {} })).toThrow(ContractValidationError)
  })

  it('keeps the RLM v2 schema aligned with the prepared-turn bridge', () => {
    const validate = createContractValidator('rlm/v2', schema('rlm/v2.schema.json'))
    expect(validate({
      contractVersion: 2, sessionId: 's', projectId: 'p', workspaceId: 'project:p', request: 'analyze', contextIndex: 0,
      historyIndex: 0, availableTools: [], prompt: 'rules', promptVersion: 'v1', context: {},
    })).toBeTruthy()
    expect(() => validate({ contractVersion: 3 })).toThrow(ContractValidationError)
  })
})
