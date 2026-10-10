import {
  Badge,
  Body1,
  Button,
  Caption1,
  Divider,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  OverlayDrawer,
  Spinner,
  Subtitle1,
  Subtitle2,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkCircle16Filled, Circle16Regular, Dismiss24Regular } from "@fluentui/react-icons";
import type { DraftContent } from "@hermes-helfer/core";
import { useState } from "react";
import { commands, projectPath, useDeliverable, useProjectCommand } from "../api/hooks";
import type { ChecklistView, DeliverableDetailView, SkillView } from "../api/types";
import { DecisionForm, type DecisionValues } from "./DecisionForm";
import { DraftEditor } from "./DraftEditor";
import {
  DeliverableBadge,
  ErrorView,
  OverdueBadge,
  RestrictedBadge,
  RichText,
  conditionDueText,
  errorText,
  formatDate,
  useNotify,
} from "./ui";

const useStyles = makeStyles({
  meta: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "center" },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalXXL,
  },
  skill: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  skillHead: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    alignItems: "start",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  doc: {
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalXL },
  check: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
    justifyContent: "space-between",
  },
  checkLabel: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
});

function emptyDraft(skill: SkillView): DraftContent {
  return { summary: "", sections: skill.sections.map((heading) => ({ heading, body: "" })), openPoints: [] };
}

function ChecklistSection({ code, cl }: { code: string; cl: ChecklistView }) {
  const s = useStyles();
  const notify = useNotify();
  const confirm = useProjectCommand(code, (api, itemId: string) =>
    api.post(`${projectPath(code)}/checklist`, { ownerId: cl.ownerId, itemId, note: "" }),
  );
  return (
    <section>
      <Subtitle2 as="h3">{cl.title}</Subtitle2>
      {!cl.available ? (
        <Caption1 block className={s.muted}>
          Die Punkte lassen sich bestätigen, sobald der zugehörige Schritt ein Ergebnis geliefert hat.
        </Caption1>
      ) : null}
      {cl.items.map((it) => (
        <div className={s.check} key={it.id}>
          <span className={s.checkLabel}>
            {it.confirmed ? (
              <CheckmarkCircle16Filled color={tokens.colorPaletteGreenForeground1} />
            ) : (
              <Circle16Regular />
            )}
            <span>
              <Body1 block>{it.label}</Body1>
              <Caption1 className={s.muted}>
                {it.confirmed
                  ? `Bestätigt von ${it.confirmed.by.displayName}, ${formatDate(it.confirmed.at)}`
                  : `Bestätigt durch: ${it.ownerLabel}`}
              </Caption1>
            </span>
          </span>
          {!it.confirmed && it.canConfirm ? (
            <Button
              size="small"
              disabled={confirm.isPending}
              onClick={() =>
                confirm.mutate(it.id, {
                  onSuccess: () => notify("success", "Bestätigt", it.label),
                  onError: (e) => notify("error", "Nicht möglich", errorText(e)),
                })
              }
            >
              Bestätigen
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function SkillSection({ code, skill }: { code: string; skill: SkillView }) {
  const s = useStyles();
  const notify = useNotify();
  const [mode, setMode] = useState<"view" | "edit" | "record">("view");
  const start = useProjectCommand(code, commands.startSkill(code));
  const record = useProjectCommand(code, (api, draft: DraftContent) =>
    api.post(`${projectPath(code)}/skills/${skill.id}/result`, { draft }),
  );
  // Edits and decisions name the version they are based on; the API refuses a
  // newer one (409 "stale"), so nobody overwrites or approves unseen content.
  const edit = useProjectCommand(code, (api, v: { draft: DraftContent; version: number }) =>
    api.put(`${projectPath(code)}/skills/${skill.id}/draft`, v),
  );
  const decide = useProjectCommand(code, (api, v: DecisionValues & { version: number }) =>
    api.post(`${projectPath(code)}/skills/${skill.id}/decisions`, v),
  );
  const out = skill.output;
  const draft = out?.draft;
  const [editBase, setEditBase] = useState<number | undefined>(undefined);
  const [reviewed, setReviewed] = useState<number | undefined>(out?.version);
  if (reviewed === undefined && out) setReviewed(out.version);
  const changedSinceReview = !!out && reviewed !== undefined && out.version !== reviewed;

  return (
    <article className={s.skill} aria-label={`Schritt ${skill.name}`}>
      <div className={s.skillHead}>
        <div>
          <Subtitle2 as="h3">{skill.outputDoc}</Subtitle2>
          <Caption1 block className={s.muted}>
            {skill.agentName
              ? `Agent ${skill.agentName} · Schritt «${skill.name}»`
              : `Erfasst von der zuständigen Person · Schritt «${skill.name}»`}
          </Caption1>
        </div>
        <Badge
          appearance="tint"
          color={skill.status === "done" ? "success" : skill.status === "veto" ? "danger" : "informative"}
        >
          {skill.statusLabel}
        </Badge>
      </div>
      <Caption1>{skill.description}</Caption1>

      {skill.lastRejection ? (
        <MessageBar intent="warning">
          <MessageBarBody>
            Zurückgewiesen durch {skill.lastRejection.by.displayName}: {skill.lastRejection.reason}
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {skill.lastError && skill.status === "ready" ? (
        <MessageBar intent="error">
          <MessageBarBody>Der letzte Entwurf ist fehlgeschlagen: {skill.lastError.reason}</MessageBarBody>
        </MessageBar>
      ) : null}
      {skill.unmetPreconditions.length ? (
        <Caption1 className={s.muted}>
          Startet erst, wenn «{skill.unmetPreconditions.join("», «")}» entschieden ist.
        </Caption1>
      ) : null}

      {skill.status === "running" ? (
        <Spinner size="tiny" label="Entwurf entsteht …" labelPosition="after" />
      ) : null}

      {skill.status === "ready" && mode === "view" ? (
        <div className={s.actions}>
          <Button
            appearance="primary"
            disabled={!skill.canStart.ok || start.isPending}
            onClick={() =>
              skill.mode === "manual"
                ? setMode("record")
                : start.mutate(skill.id, {
                    onSuccess: () => notify("info", "Entwurf angestossen", `${skill.outputDoc} entsteht …`),
                    onError: (e) => notify("error", "Nicht möglich", errorText(e)),
                  })
            }
          >
            {skill.mode === "manual" ? "Ergebnis erfassen" : "Entwurf erstellen"}
          </Button>
          {!skill.canStart.ok ? <Caption1 className={s.muted}>{skill.canStart.reason}</Caption1> : null}
        </div>
      ) : null}

      {mode === "record" ? (
        <DraftEditor
          initial={emptyDraft(skill)}
          submitLabel="Ergebnis speichern"
          submitting={record.isPending}
          {...(record.error ? { error: errorText(record.error) } : {})}
          onCancel={() => setMode("view")}
          onSubmit={(d) =>
            record.mutate(d, { onSuccess: () => (setMode("view"), notify("success", "Ergebnis erfasst")) })
          }
        />
      ) : null}

      {out && mode !== "record" ? (
        <>
          <Caption1 className={s.muted}>
            {out.producer.kind === "ai"
              ? `Entwurf (KI) · Version ${out.version} · Modell ${out.producer.model ?? "unbekannt"} · ${formatDate(out.createdAt)}, angestossen von ${out.requestedBy.displayName}`
              : `Erfasst von ${out.requestedBy.displayName} · Version ${out.version} · ${formatDate(out.createdAt)}`}
            {out.editedBy && out.editedAt
              ? ` · bearbeitet von ${out.editedBy.displayName}, ${formatDate(out.editedAt)}`
              : ""}
          </Caption1>
          {out.findings.length ? (
            <MessageBar intent="warning" layout="multiline">
              <MessageBarBody>
                <MessageBarTitle>Qualitätscheck (Kritiker)</MessageBarTitle>
                <ul className={s.list}>
                  {out.findings.map((f, i) => (
                    <li key={i}>
                      {f.severity === "warnung" ? "Muss behoben werden: " : ""}
                      {f.text}
                    </li>
                  ))}
                </ul>
              </MessageBarBody>
            </MessageBar>
          ) : null}
          {mode === "edit" && draft ? (
            <DraftEditor
              initial={draft}
              submitLabel="Speichern"
              submitting={edit.isPending}
              {...(edit.error ? { error: errorText(edit.error) } : {})}
              onCancel={() => setMode("view")}
              onSubmit={(d) =>
                edit.mutate(
                  { draft: d, version: editBase ?? out.version },
                  {
                    onSuccess: () => (
                      setMode("view"),
                      notify("success", "Gespeichert", "Das Ergebnis muss erneut freigegeben werden.")
                    ),
                  },
                )
              }
            />
          ) : draft ? (
            <div className={s.doc}>
              <Body1>
                <strong>Zusammenfassung:</strong> {draft.summary}
              </Body1>
              {draft.sections.map((sec) => (
                <section key={sec.heading}>
                  <Subtitle2 as="h4">{sec.heading}</Subtitle2>
                  <RichText text={sec.body} />
                </section>
              ))}
              {draft.openPoints.length ? (
                <section>
                  <Subtitle2 as="h4">Offene Punkte</Subtitle2>
                  <ul className={s.list}>
                    {draft.openPoints.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : (
            <MessageBar intent="info">
              <MessageBarBody>
                Der Inhalt ist vertraulich und für deine Rolle nicht sichtbar. Den Status siehst du trotzdem.
              </MessageBarBody>
            </MessageBar>
          )}
          {mode === "view" && skill.canEdit.ok ? (
            <div>
              <Button
                size="small"
                onClick={() => {
                  setEditBase(out.version);
                  setMode("edit");
                }}
              >
                Bearbeiten
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {skill.approvers.length ? (
        <section>
          <Subtitle2 as="h4">Entscheide{skill.veto ? " (mit Vetorecht)" : ""}</Subtitle2>
          {skill.approvers.map((a) => (
            <Body1 block key={a.role}>
              {a.label}:{" "}
              {a.decision
                ? `${a.decision.decision} durch ${a.decision.by.displayName}, ${formatDate(a.decision.at)}${a.decision.reason ? ` (${a.decision.reason})` : ""}`
                : "ausstehend"}
            </Body1>
          ))}
        </section>
      ) : null}

      {skill.checklist ? <ChecklistSection code={code} cl={skill.checklist} /> : null}

      {skill.myDecisionRoles.length ? (
        <section>
          <Divider />
          <Subtitle2 as="h4">Dein Entscheid</Subtitle2>
          {changedSinceReview ? (
            <MessageBar intent="warning">
              <MessageBarBody>
                Der Entwurf wurde inzwischen geändert (jetzt Version {out.version}). Bitte die neue Fassung
                prüfen.{" "}
                <Button size="small" onClick={() => setReviewed(out.version)}>
                  Neue Fassung geprüft
                </Button>
              </MessageBarBody>
            </MessageBar>
          ) : null}
          <DecisionForm
            roles={skill.myDecisionRoles}
            veto={skill.veto}
            rejectLabel="Zurückweisen, der Agent muss nacharbeiten"
            submitting={decide.isPending}
            {...(decide.error ? { error: errorText(decide.error) } : {})}
            onEdit={() => decide.error && decide.reset()}
            onSubmit={(v) =>
              decide.mutate(
                { ...v, version: reviewed ?? out?.version ?? 0 },
                { onSuccess: () => notify("success", "Entscheid erfasst") },
              )
            }
          />
        </section>
      ) : null}
    </article>
  );
}

function DrawerContent({ code, d }: { code: string; d: DeliverableDetailView }) {
  const s = useStyles();
  const notify = useNotify();
  const [naReason, setNaReason] = useState("");
  const [naOpen, setNaOpen] = useState(false);
  const markNa = useProjectCommand(code, (api, reason: string) =>
    api.post(`${projectPath(code)}/deliverables/${d.id}/not-applicable`, { reason }),
  );
  const reactivate = useProjectCommand(code, (api) =>
    api.post(`${projectPath(code)}/deliverables/${d.id}/reactivate`),
  );
  const complete = useProjectCommand(code, (api, id: string) =>
    api.post(`${projectPath(code)}/conditions/${id}/complete`, {}),
  );

  return (
    <div className={s.body}>
      {d.notApplicable ? (
        <MessageBar intent="info">
          <MessageBarBody>
            Nicht zutreffend (erfasst von {d.notApplicable.by.displayName}): {d.notApplicable.reason}
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {d.preExistingBy ? (
        <Body1>Dieses Ergebnis liefert {d.preExistingBy} vor dem Start im HERMES Helfer.</Body1>
      ) : null}
      {d.released ? (
        <Caption1 className={s.muted}>
          Freigegeben von {d.released.by.displayName}, {formatDate(d.released.at)}
        </Caption1>
      ) : null}

      {d.skills.map((sk) => (
        <SkillSection key={sk.id} code={code} skill={sk} />
      ))}

      {d.checklist ? <ChecklistSection code={code} cl={d.checklist} /> : null}

      {d.conditions.length ? (
        <section>
          <Subtitle2 as="h3">Auflagen</Subtitle2>
          {d.conditions.map((c) => (
            <div className={s.check} key={c.id}>
              <span>
                <Body1 block>{c.text}</Body1>
                <Caption1 className={s.muted}>
                  {c.ownerLabel} · {conditionDueText(c)} ·{" "}
                  {c.done ? `erledigt, ${formatDate(c.doneAt!)}` : "offen"}
                </Caption1>
                {c.overdue ? <OverdueBadge /> : null}
              </span>
              {!c.done && c.canComplete ? (
                <Button
                  size="small"
                  onClick={() =>
                    complete.mutate(c.id, { onSuccess: () => notify("success", "Auflage erledigt") })
                  }
                >
                  Erledigt
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {d.canMarkNotApplicable.ok ? (
        <section>
          {naOpen ? (
            <Field label="Begründung, warum das Ergebnis nicht zutrifft (Pflicht)">
              <Textarea value={naReason} onChange={(_, v) => setNaReason(v.value)} rows={2} />
              <div className={s.actions}>
                <Button
                  disabled={markNa.isPending}
                  onClick={() =>
                    markNa.mutate(naReason, {
                      onSuccess: () => (setNaOpen(false), notify("success", "Als nicht zutreffend markiert")),
                      onError: (e) => notify("error", "Nicht möglich", errorText(e)),
                    })
                  }
                >
                  Als nicht zutreffend markieren
                </Button>
                <Button appearance="subtle" onClick={() => setNaOpen(false)}>
                  Abbrechen
                </Button>
              </div>
            </Field>
          ) : (
            <Button appearance="subtle" onClick={() => setNaOpen(true)}>
              Trifft für dieses Vorhaben nicht zu …
            </Button>
          )}
        </section>
      ) : null}
      {d.canReactivate.ok ? (
        <div>
          <Button
            onClick={() =>
              reactivate.mutate(undefined, { onSuccess: () => notify("success", "Reaktiviert") })
            }
          >
            Reaktivieren
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function DeliverableDrawer({
  code,
  deliverableId,
  onClose,
}: {
  code: string;
  deliverableId: string | null;
  onClose(): void;
}) {
  const s = useStyles();
  const notify = useNotify();
  const q = useDeliverable(code, deliverableId);
  const release = useProjectCommand(code, commands.release(code));
  const d = q.data && q.data.id === deliverableId ? q.data : undefined;

  return (
    <OverlayDrawer
      open={!!deliverableId}
      onOpenChange={(_, v) => (!v.open ? onClose() : undefined)}
      position="end"
      size="large"
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label="Schliessen"
              icon={<Dismiss24Regular />}
              onClick={onClose}
            />
          }
        >
          {d?.name ?? "…"}
        </DrawerHeaderTitle>
        {d ? (
          <div className={s.meta}>
            <DeliverableBadge status={d.status} label={d.statusLabel} />
            <Badge appearance="outline" color={d.requirement === "pflicht" ? "brand" : "subtle"}>
              {d.requirement === "pflicht" ? "Pflicht" : "Falls zutreffend"}
            </Badge>
            <Caption1>
              {d.kind} · Phase {d.phaseLabel}
            </Caption1>
            {d.restricted ? <RestrictedBadge /> : null}
          </div>
        ) : null}
      </DrawerHeader>
      <DrawerBody>
        {q.isError ? <ErrorView error={q.error} /> : null}
        {!d && !q.isError ? <Spinner label="Wird geladen …" /> : null}
        {d ? <DrawerContent code={code} d={d} /> : null}
      </DrawerBody>
      {d?.canRelease.ok ? (
        <DrawerFooter>
          <Subtitle1 as="span" className={s.muted}>
            Entwurf geprüft?
          </Subtitle1>
          <Button
            appearance="primary"
            disabled={release.isPending}
            onClick={() =>
              release.mutate(
                { deliverableId: d.id, contentVersion: d.contentVersion },
                {
                  onSuccess: () => notify("success", "Freigegeben", d.name),
                  onError: (e) => notify("error", "Nicht möglich", errorText(e)),
                },
              )
            }
          >
            Freigeben
          </Button>
        </DrawerFooter>
      ) : null}
    </OverlayDrawer>
  );
}
