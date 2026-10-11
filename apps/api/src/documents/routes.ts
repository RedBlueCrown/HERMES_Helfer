// HTTP routes for the organisation's Word templates (the PMO's) and for a
// project's result as a Word document. Both leave an audit entry in the log
// (stream 2, architecture §9): who, what, which template; never the content.

import { canManageTemplates, canViewDeliverableContent, type HermesModel } from "@hermes-helfer/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError, notFound, parse } from "../errors";
import type { ProjectService, RequestContext } from "../projects/service";
import { DOCX_LIMITS, DOCX_MIME } from "./docx";
import type { DocumentService } from "./service";

export interface DocumentRouteDeps {
  model: HermesModel;
  projects: ProjectService;
  documents: DocumentService;
  now: () => Date;
  ctx: (req: FastifyRequest) => RequestContext;
}

const DOTX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.template";
const Code = z.string().regex(/^[A-Za-z0-9-]{2,20}$/, "Ungültiges Kürzel");
const DeliverableId = z.string().regex(/^[a-z0-9-]{1,64}$/, "Ungültige Kennung");

/** A download's file name; non-ASCII names in the RFC 6266 form, with an ASCII fallback. */
export function attachment(fileName: string): string {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^ -~]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** The file name the browser sends along (URL-encoded, it may contain umlauts). */
function uploadedName(req: FastifyRequest): string {
  const raw = req.headers["x-file-name"];
  if (typeof raw !== "string") return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function registerDocumentRoutes(app: FastifyInstance, deps: DocumentRouteDeps): void {
  const { model, documents } = deps;

  const pmo = (req: FastifyRequest) => {
    const c = deps.ctx(req);
    if (!canManageTemplates(c.viewer))
      throw new HttpError(403, "forbidden", "Die Vorlagen verwaltet das PMO.");
    return c;
  };
  const deliverable = (id: string) => {
    const d = model.findDeliverable(id);
    if (!d) throw notFound("Dieses Ergebnis gibt es nicht.");
    return d;
  };

  // Templates arrive as the file itself, not as JSON; only in this scope.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      [DOCX_MIME, DOTX_MIME, "application/octet-stream"],
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body),
    );

    scope.put("/api/templates/:deliverableId", { bodyLimit: DOCX_LIMITS.fileBytes }, async (req, reply) => {
      const c = pmo(req);
      const { deliverableId } = parse(z.object({ deliverableId: DeliverableId }), req.params);
      const d = deliverable(deliverableId);
      const body = req.body;
      if (!Buffer.isBuffer(body) || !body.length) {
        throw new HttpError(400, "invalid_template", "Bitte eine Word-Datei (.docx) hochladen.");
      }
      const added = await documents.add(
        d.id,
        uploadedName(req),
        new Uint8Array(body),
        { userId: c.viewer.userId, displayName: c.viewer.displayName },
        deps.now().toISOString(),
      );
      req.log.info(
        {
          type: "template_uploaded",
          deliverableId: d.id,
          version: added.version,
          sha256: added.sha256,
          sizeBytes: added.sizeBytes,
          fields: added.fields.length,
          userId: c.viewer.userId,
          correlationId: req.id,
        },
        "template_uploaded",
      );
      return reply.code(201).send(added);
    });
  });

  app.get("/api/templates", async (req) => {
    pmo(req);
    return { items: await documents.overview() };
  });

  app.get("/api/templates/:deliverableId/file", async (req, reply) => {
    pmo(req);
    const { deliverableId } = parse(z.object({ deliverableId: DeliverableId }), req.params);
    const d = deliverable(deliverableId);
    const t = await documents.file(d.id);
    if (!t) throw notFound(`Für «${d.name}» gibt es keine Vorlage.`);
    return reply
      .header("content-type", t.fileName.toLowerCase().endsWith(".dotx") ? DOTX_MIME : DOCX_MIME)
      .header("content-disposition", attachment(t.fileName))
      .header("cache-control", "no-store")
      .send(Buffer.from(t.content));
  });

  // A project's result in the organisation's template, for whoever may read the result.
  app.get(
    "/api/projects/:code/deliverables/:deliverableId/document",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { code, deliverableId } = parse(
        z.object({ code: Code, deliverableId: DeliverableId }),
        req.params,
      );
      const c = deps.ctx(req);
      const s = await deps.projects.requireProject(code, c.viewer);
      const d = deliverable(deliverableId);
      if (!canViewDeliverableContent(s, model, c.viewer, d)) {
        throw new HttpError(
          403,
          "forbidden",
          `«${d.name}» ist vertraulich: Das Dokument erhalten nur die Rollen, die den Inhalt lesen dürfen.`,
        );
      }
      const doc = await documents.document(s, d, c.viewer, deps.now());
      if (!doc) throw notFound(`Für «${d.name}» hat das PMO noch keine Vorlage hinterlegt.`);
      req.log.info(
        {
          type: "document_export",
          projectId: s.projectId,
          deliverableId: d.id,
          restricted: d.restricted,
          templateVersion: doc.template.version,
          templateSha256: doc.template.sha256,
          contentVersion: doc.contentVersion,
          userId: c.viewer.userId,
          correlationId: req.id,
        },
        "document_export",
      );
      return reply
        .header("content-type", DOCX_MIME)
        .header("content-disposition", attachment(doc.fileName))
        .header("cache-control", "no-store")
        .send(Buffer.from(doc.bytes));
    },
  );
}
