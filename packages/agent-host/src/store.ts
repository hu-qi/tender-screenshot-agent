import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentEventRecord, ArtifactRecord, RunSummary, TenderRun, TenderTask, TenderTaskInput, WeComSettingsStatus } from './domain.js';

const timestamp = () => new Date().toISOString();

export class TenderStore {
  readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        queries_json TEXT NOT NULL,
        platform_ids_json TEXT NOT NULL,
        privacy_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        summary_json TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        level TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        platform_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  createTask(input: TenderTaskInput): TenderTask {
    const now = timestamp();
    const task: TenderTask = { ...input, id: randomUUID(), status: 'queued', createdAt: now, updatedAt: now };
    this.db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(task.id, task.name, JSON.stringify(task.queries), JSON.stringify(task.platformIds), task.privacyMode, task.status, task.createdAt, task.updatedAt);
    return task;
  }

  listTasks(): TenderTask[] {
    const rows = this.db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all() as Array<Record<string, string>>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      queries: JSON.parse(row.queries_json),
      platformIds: JSON.parse(row.platform_ids_json),
      privacyMode: row.privacy_mode as TenderTask['privacyMode'],
      status: row.status as TenderTask['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getTask(taskId: string): TenderTask | undefined {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as Record<string, string> | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      queries: JSON.parse(row.queries_json),
      platformIds: JSON.parse(row.platform_ids_json),
      privacyMode: row.privacy_mode as TenderTask['privacyMode'],
      status: row.status as TenderTask['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  setTaskStatus(taskId: string, status: TenderTask['status']): void {
    this.db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`).run(status, timestamp(), taskId);
  }

  createRun(taskId: string): TenderRun {
    const run: TenderRun = { id: randomUUID(), taskId, status: 'running', correlationId: randomUUID(), startedAt: timestamp() };
    this.db.prepare(`INSERT INTO runs(id, task_id, status, correlation_id, started_at) VALUES (?, ?, ?, ?, ?)`)
      .run(run.id, run.taskId, run.status, run.correlationId, run.startedAt);
    return run;
  }

  finishRun(runId: string, status: TenderRun['status'], summary: RunSummary): void {
    this.db.prepare(`UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE id = ?`)
      .run(status, timestamp(), JSON.stringify(summary), runId);
  }

  appendEvent(runId: string, type: string, level: AgentEventRecord['level'], payload: Record<string, unknown>): AgentEventRecord {
    const next = this.db.prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM events WHERE run_id = ?`).get(runId) as { sequence: number };
    const record = { runId, sequence: next.sequence, timestamp: timestamp(), type, level, payload };
    const result = this.db.prepare(`INSERT INTO events(run_id, sequence, timestamp, type, level, payload_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(record.runId, record.sequence, record.timestamp, record.type, record.level, JSON.stringify(record.payload));
    return { id: Number(result.lastInsertRowid), ...record };
  }

  listEvents(runId: string, after = 0): AgentEventRecord[] {
    const rows = this.db.prepare(`SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id`).all(runId, after) as Array<Record<string, string | number>>;
    return rows.map((row) => ({
      id: Number(row.id),
      runId: String(row.run_id),
      sequence: Number(row.sequence),
      timestamp: String(row.timestamp),
      type: String(row.type),
      level: String(row.level) as AgentEventRecord['level'],
      payload: JSON.parse(String(row.payload_json)),
    }));
  }

  addArtifact(artifact: Omit<ArtifactRecord, 'id' | 'createdAt'>): ArtifactRecord {
    const record: ArtifactRecord = { id: randomUUID(), createdAt: timestamp(), ...artifact };
    this.db.prepare(`INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(record.id, record.runId, record.platformId, record.kind, record.relativePath, record.sha256, record.createdAt);
    return record;
  }

  listArtifacts(runId: string): ArtifactRecord[] {
    const rows = this.db.prepare(`SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at`).all(runId) as Array<Record<string, string>>;
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      platformId: row.platform_id as ArtifactRecord['platformId'],
      kind: row.kind as ArtifactRecord['kind'],
      relativePath: row.relative_path,
      sha256: row.sha256,
      createdAt: row.created_at,
    }));
  }

  setPublicSetting(key: string, value: unknown): void {
    this.db.prepare(`INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
      .run(key, JSON.stringify(value), timestamp());
  }

  getPublicSetting<T>(key: string): { value: T; updatedAt: string } | undefined {
    const row = this.db.prepare(`SELECT value_json, updated_at FROM settings WHERE key = ?`).get(key) as { value_json: string; updated_at: string } | undefined;
    return row ? { value: JSON.parse(row.value_json) as T, updatedAt: row.updated_at } : undefined;
  }

  getWeComStatus(configured: boolean): WeComSettingsStatus {
    const setting = this.getPublicSetting<{ enabled: boolean; targetIds: string[]; websocketUrl?: string }>('wecom');
    return {
      configured,
      enabled: setting?.value.enabled ?? false,
      targetCount: setting?.value.targetIds.length ?? 0,
      websocketUrl: setting?.value.websocketUrl,
      updatedAt: setting?.updatedAt,
    };
  }
}
