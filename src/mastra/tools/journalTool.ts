/**
 * Roam - Nature journal.
 *
 * Stores observations the user chooses to record. No GPS or media is fabricated:
 * a location or media reference is stored only if the caller supplied one. Entries
 * are returned newest-first and can be listed or cleared.
 */

import fs from "fs";
import path from "path";

export interface JournalEntry {
  id: string;
  text: string;
  createdAt: string;
  /** Optional, user-supplied only. Never guessed. */
  locationLabel?: string;
  mediaRef?: string;
  sessionId?: string;
}

interface JournalShape {
  entries: JournalEntry[];
}

export class Journal {
  private entries: JournalEntry[] = [];
  private dirty = false;

  constructor(private filePath: string = path.resolve(process.cwd(), "data", "journal.json")) {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as JournalShape;
        this.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      }
    } catch (err: any) {
      console.warn(`[Journal] could not read (${err?.message}); starting empty.`);
      this.entries = [];
    }
  }

  private persist(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ entries: this.entries } as JournalShape, null, 2));
      fs.renameSync(tmp, this.filePath);
      this.dirty = false;
    } catch (err: any) {
      console.warn(`[Journal] persist failed (${err?.message}); kept in memory only.`);
    }
  }

  add(input: { text: string; locationLabel?: string; mediaRef?: string; sessionId?: string }): JournalEntry {
    const entry: JournalEntry = {
      id: `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      text: String(input.text).slice(0, 1000),
      createdAt: new Date().toISOString(),
      ...(input.locationLabel ? { locationLabel: String(input.locationLabel).slice(0, 120) } : {}),
      ...(input.mediaRef ? { mediaRef: String(input.mediaRef).slice(0, 300) } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    };
    this.entries.push(entry);
    this.dirty = true;
    this.persist();
    return entry;
  }

  list(limit = 50): JournalEntry[] {
    return [...this.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.dirty = true;
      this.persist();
      return true;
    }
    return false;
  }

  clear(): number {
    const n = this.entries.length;
    this.entries = [];
    this.dirty = true;
    this.persist();
    return n;
  }
}
