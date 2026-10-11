// The organisation's Word templates, one per deliverable, every version kept.
// The PMO uploads them in the app; the repository never holds them (they are
// the organisation's, and the repository may be public, question F1).
// Implementations: MemoryTemplateStore (tests and local development, optionally
// in files) and SqlTemplateStore (Azure SQL, append-only ledger table).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TemplateInfo {
  deliverableId: string;
  /** 1, 2 … per deliverable; the highest is in use. */
  version: number;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: { userId: string; displayName: string };
}

export interface StoredTemplate extends TemplateInfo {
  content: Uint8Array;
}

export interface NewTemplate {
  deliverableId: string;
  fileName: string;
  content: Uint8Array;
  uploadedBy: { userId: string; displayName: string };
  uploadedAt: string;
}

export interface TemplateStore {
  /** The version in use of every deliverable that has a template, without content. */
  list(): Promise<TemplateInfo[]>;
  /** The version in use of a deliverable's template. */
  latest(deliverableId: string): Promise<StoredTemplate | undefined>;
  /** Keeps a new version; the earlier ones stay. */
  add(t: NewTemplate): Promise<TemplateInfo>;
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const info = ({ content: _content, ...rest }: StoredTemplate): TemplateInfo => rest;

/** A deliverable id of the model, never a path: it becomes a folder name or a key. */
export function assertDeliverableId(id: string): void {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error(`Invalid deliverable id: ${id}`);
}

/** In memory; with `dataDir`, also as files (`templates/<deliverable>/<version>.docx` and `.json`). */
export class MemoryTemplateStore implements TemplateStore {
  private readonly versions = new Map<string, StoredTemplate[]>();

  constructor(private readonly opts: { dataDir?: string } = {}) {
    const dir = this.dir();
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const deliverableId = entry.name;
      const stored = readdirSync(join(dir, deliverableId))
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const meta = JSON.parse(readFileSync(join(dir, deliverableId, f), "utf8")) as TemplateInfo;
          if (!Number.isInteger(meta.version)) throw new Error(`Invalid template version in ${f}`);
          return { ...meta, content: readFileSync(join(dir, deliverableId, `${meta.version}.docx`)) };
        })
        .sort((a, b) => a.version - b.version);
      this.versions.set(deliverableId, stored);
    }
  }

  private dir(): string | undefined {
    return this.opts.dataDir ? join(this.opts.dataDir, "templates") : undefined;
  }

  list(): Promise<TemplateInfo[]> {
    return Promise.resolve([...this.versions.values()].map((v) => info(v.at(-1)!)));
  }

  latest(deliverableId: string): Promise<StoredTemplate | undefined> {
    return Promise.resolve(this.versions.get(deliverableId)?.at(-1));
  }

  add(t: NewTemplate): Promise<TemplateInfo> {
    // In a promise, so a refused id is a rejection as with the SQL store.
    return new Promise((resolve) => resolve(this.keep(t)));
  }

  private keep(t: NewTemplate): TemplateInfo {
    assertDeliverableId(t.deliverableId);
    const list = this.versions.get(t.deliverableId) ?? [];
    const stored: StoredTemplate = {
      deliverableId: t.deliverableId,
      version: list.length + 1,
      fileName: t.fileName,
      sha256: sha256(t.content),
      sizeBytes: t.content.length,
      uploadedAt: t.uploadedAt,
      uploadedBy: t.uploadedBy,
      content: t.content,
    };
    const dir = this.dir();
    if (dir) {
      const folder = join(dir, t.deliverableId);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, `${stored.version}.docx`), t.content);
      writeFileSync(join(folder, `${stored.version}.json`), JSON.stringify(info(stored)));
    }
    this.versions.set(t.deliverableId, [...list, stored]);
    return info(stored);
  }
}
