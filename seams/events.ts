export interface ContractVersions {
  event?: string
  tool?: string
  rlm?: string
  prompt?: string
}

/** Stable metadata around every persisted plugin event. */
export interface EventEnvelope<T = Record<string, unknown>> {
  id: string
  seq: number
  sessionId: string
  runId?: string
  jobId?: string
  timestamp: string
  type: string
  payload: T
  versions?: ContractVersions
}

export interface EventPage<T = Record<string, unknown>> {
  events: EventEnvelope<T>[]
  /** Sequence of the last event in this page; null means there is no next cursor. */
  cursor: number | null
}

export type EventFilter = {
  runId?: string
  jobId?: string
  types?: string[]
}
