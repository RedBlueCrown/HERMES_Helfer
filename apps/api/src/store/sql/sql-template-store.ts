// The organisation's Word templates in Azure SQL (documents/template-store.ts):
// one row per version in an append-only ledger table, so no version can be
// changed or removed, and a generated document can name the template it used.

import {
  assertDeliverableId,
  sha256,
  type NewTemplate,
  type StoredTemplate,
  type TemplateInfo,
  type TemplateStore,
} from "../../documents/template-store";
import { StoreUnavailableError } from "../event-store";
import { rollbackQuietly } from "./migrations";
import { sql, type Mssql } from "./mssql";
import { isTransientSqlError } from "./sql-event-store";

interface Row {
  deliverable_id: string;
  version: number;
  file_name: string;
  sha256: string;
  size_bytes: number;
  uploaded_at: Date;
  uploaded_by: string;
  uploaded_by_name: string;
  content?: Buffer;
}

const COLUMNS =
  "deliverable_id, version, file_name, sha256, size_bytes, uploaded_at, uploaded_by, uploaded_by_name";

const toInfo = (r: Row): TemplateInfo => ({
  deliverableId: r.deliverable_id,
  version: r.version,
  fileName: r.file_name,
  sha256: r.sha256,
  sizeBytes: r.size_bytes,
  uploadedAt: r.uploaded_at.toISOString(),
  uploadedBy: { userId: r.uploaded_by, displayName: r.uploaded_by_name },
});

export class SqlTemplateStore implements TemplateStore {
  constructor(private readonly pool: Mssql.ConnectionPool) {}

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (isTransientSqlError(err)) {
        throw new StoreUnavailableError("The SQL template store is unavailable.", { cause: err });
      }
      throw err;
    }
  }

  list(): Promise<TemplateInfo[]> {
    return this.run(async () => {
      const r = await this.pool.request().query<Row>(
        `SELECT ${COLUMNS} FROM hh.templates t
          WHERE version = (SELECT MAX(version) FROM hh.templates WHERE deliverable_id = t.deliverable_id)
          ORDER BY deliverable_id`,
      );
      return r.recordset.map(toInfo);
    });
  }

  latest(deliverableId: string): Promise<StoredTemplate | undefined> {
    return this.run(async () => {
      const r = await this.pool
        .request()
        .input("d", sql.VarChar(64), deliverableId)
        .query<Row>(
          `SELECT TOP 1 ${COLUMNS}, content FROM hh.templates WHERE deliverable_id = @d ORDER BY version DESC`,
        );
      const row = r.recordset[0];
      return row ? { ...toInfo(row), content: new Uint8Array(row.content!) } : undefined;
    });
  }

  add(t: NewTemplate): Promise<TemplateInfo> {
    return this.run(async () => {
      assertDeliverableId(t.deliverableId);
      const tx = new sql.Transaction(this.pool);
      try {
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        // The range lock makes a parallel upload for the same deliverable wait for this one.
        const head = await new sql.Request(tx)
          .input("d", sql.VarChar(64), t.deliverableId)
          .query<{ version: number }>(
            "SELECT ISNULL(MAX(version), 0) AS version FROM hh.templates WITH (UPDLOCK, HOLDLOCK) WHERE deliverable_id = @d",
          );
        const row: Row = {
          deliverable_id: t.deliverableId,
          version: (head.recordset[0]?.version ?? 0) + 1,
          file_name: t.fileName,
          sha256: sha256(t.content),
          size_bytes: t.content.length,
          uploaded_at: new Date(t.uploadedAt),
          uploaded_by: t.uploadedBy.userId,
          // The column's length; Entra ID allows longer display names.
          uploaded_by_name: t.uploadedBy.displayName.slice(0, 200),
        };
        await new sql.Request(tx)
          .input("d", sql.VarChar(64), row.deliverable_id)
          .input("v", sql.Int, row.version)
          .input("name", sql.NVarChar(200), row.file_name)
          .input("hash", sql.Char(64), row.sha256)
          .input("size", sql.Int, row.size_bytes)
          .input("at", sql.DateTime2(3), row.uploaded_at)
          .input("by", sql.NVarChar(128), row.uploaded_by)
          .input("byName", sql.NVarChar(200), row.uploaded_by_name)
          .input("content", sql.VarBinary(sql.MAX), Buffer.from(t.content))
          .query(
            `INSERT INTO hh.templates (${COLUMNS}, content)
              VALUES (@d, @v, @name, @hash, @size, @at, @by, @byName, @content)`,
          );
        await tx.commit();
        return toInfo(row);
      } catch (err) {
        await rollbackQuietly(tx);
        throw err;
      }
    });
  }
}
