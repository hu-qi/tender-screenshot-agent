import { EventEmitter } from 'node:events';
import type { AgentEventRecord } from './domain.js';
import { TenderStore } from './store.js';

export class RunEvents {
  private readonly emitter = new EventEmitter();

  constructor(private readonly store: TenderStore) {}

  emit(runId: string, type: string, level: AgentEventRecord['level'], payload: Record<string, unknown>): AgentEventRecord {
    const event = this.store.appendEvent(runId, type, level, payload);
    this.emitter.emit(runId, event);
    return event;
  }

  subscribe(runId: string, listener: (event: AgentEventRecord) => void): () => void {
    this.emitter.on(runId, listener);
    return () => this.emitter.off(runId, listener);
  }
}
