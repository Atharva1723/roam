/**
 * Roam - User memory store (preferences, saved trails, saved plans).
 *
 * Local-first: a JSON file on the server's filesystem behind a repository interface,
 * so a hosted database can replace it later without touching callers. The store only
 * persists records the user explicitly saved, and every method is user-controlled
 * (save, recall, list, delete, clear). It never stores raw audio or transcripts.
 */

import fs from "fs";
import path from "path";

export type MemoryKind = "preference" | "saved_trail" | "saved_plan" | "observation";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  /** Free-text preference, or a short label for saved items. */
  text: string;
  /** Optional structured payload (a trail id, a plan id, an observation). */
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryStore {
  list(kind?: MemoryKind): MemoryRecord[];
  save(kind: MemoryKind, text: string, data?: Record<string, unknown>): MemoryRecord;
  recall(query: string, kind?: MemoryKind): MemoryRecord[];
  remove(id: string): boolean;
  clear(): number;
  readonly backing: "file" | "memory";
}

interface PersistShape {
  records: MemoryRecord[];
}

function makeId(): string {
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class FileMemoryStore implements MemoryStore {
  readonly backing = "file" as const;
  private records: MemoryRecord[] = [];
  private dirty = false;

  constructor(private filePath: string = path.resolve(process.cwd(), "data", "memory.json")) {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as PersistShape;
        this.records = Array.isArray(parsed.records) ? parsed.records : [];
      }
    } catch (err: any) {
      console.warn(`[Memory] could not read store (${err?.message}); starting empty.`);
      this.records = [];
    }
  }

  private persist(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ records: this.records } as PersistShape, null, 2));
      fs.renameSync(tmp, this.filePath); // atomic replace
      this.dirty = false;
    } catch (err: any) {
      console.warn(`[Memory] persist failed (${err?.message}); changes kept in memory only.`);
    }
  }

  list(kind?: MemoryKind): MemoryRecord[] {
    const all = [...this.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return kind ? all.filter((r) => r.kind === kind) : all;
  }

  save(kind: MemoryKind, text: string, data?: Record<string, unknown>): MemoryRecord {
    const record: MemoryRecord = {
      id: makeId(),
      kind,
      text: String(text).slice(0, 500),
      data,
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    this.dirty = true;
    this.persist();
    return record;
  }

  recall(query: string, kind?: MemoryKind): MemoryRecord[] {
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const pool = kind ? this.records.filter((r) => r.kind === kind) : this.records;
    if (terms.length === 0) return pool.slice(-5).reverse();
    const scored = pool
      .map((r) => {
        const hay = `${r.text} ${JSON.stringify(r.data ?? "")}`.toLowerCase();
        const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.r);
    return scored;
  }

  remove(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.records.length !== before) {
      this.dirty = true;
      this.persist();
      return true;
    }
    return false;
  }

  clear(): number {
    const n = this.records.length;
    this.records = [];
    this.dirty = true;
    this.persist();
    return n;
  }
}

/** In-memory store, used by tests and when the filesystem is not writable. */
export class InMemoryStore implements MemoryStore {
  readonly backing = "memory" as const;
  private records: MemoryRecord[] = [];
  list(kind?: MemoryKind): MemoryRecord[] {
    const all = [...this.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return kind ? all.filter((r) => r.kind === kind) : all;
  }
  save(kind: MemoryKind, text: string, data?: Record<string, unknown>): MemoryRecord {
    const record: MemoryRecord = { id: makeId(), kind, text: String(text).slice(0, 500), data, createdAt: new Date().toISOString() };
    this.records.push(record);
    return record;
  }
  recall(query: string, kind?: MemoryKind): MemoryRecord[] {
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const pool = kind ? this.records.filter((r) => r.kind === kind) : this.records;
    if (terms.length === 0) return pool.slice(-5).reverse();
    return pool
      .map((r) => ({ r, score: terms.reduce((n, t) => n + (`${r.text} ${JSON.stringify(r.data ?? "")}`.toLowerCase().includes(t) ? 1 : 0), 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.r);
  }
  remove(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    return this.records.length !== before;
  }
  clear(): number {
    const n = this.records.length;
    this.records = [];
    return n;
  }
}

export function createMemoryStore(): MemoryStore {
  try {
    return new FileMemoryStore();
  } catch {
    return new InMemoryStore();
  }
}
