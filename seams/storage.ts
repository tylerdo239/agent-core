// seams/storage.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/state-sqlite (Phase 2).
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    storage: StorageService
  }
}

export interface StoredEvent {
  type: string
  [key: string]: unknown
}

export abstract class StorageService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'storage')
  }

  abstract appendEvent(sessionId: string, event: StoredEvent): Promise<void>
  abstract readEvents(sessionId: string): Promise<StoredEvent[]>
}
