import {
  Badge,
  Body1,
  Button,
  Caption1,
  Checkbox,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  OverlayDrawer,
  Spinner,
  Subtitle1,
  Subtitle2,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Textarea,
  makeStyles,
  tokens,
  type BadgeProps,
} from "@fluentui/react-components";
import { Dismiss24Regular, Sparkle16Regular } from "@fluentui/react-icons";
import {
  CR_FLAGS,
  MODEL,
  NO_FLAGS,
  changeImpact,
  formatChf,
  type ChangeRequestStatus,
  type CrFlag,
  type CrFlags,
  type DraftContent,
  type Finding,
  type ImpactLevel,
  type ImpactRow,
} from "@hermes-helfer/core";
import { useMemo, useState } from "react";
import { projectPath, useApi, useChangeRequests, useProjectCommand, useReference } from "../api/hooks";
import type {
  ChangeRequestProposal,
  ChangeRequestRegisterView,
  ChangeRequestView,
  ProjectView,
} from "../api/types";
import { DecisionForm, type DecisionValues } from "./DecisionForm";
import { ErrorView, OverdueBadge, RichText, conditionDueText, errorText, formatDate, useNotify } from "./ui";

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    overflowX: "auto",
  },
  head: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  row: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "end", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  link: {
    padding: 0,
    minWidth: 0,
    height: "auto",
    justifyContent: "flex-start",
    textAlign: "left",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorBrandForegroundLink,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalXXL,
  },
  meta: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "center" },
  doc: {
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  flags: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  reason: { marginLeft: "32px", color: tokens.colorNeutralForeground3 },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalXL },
  findings: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  grow: { flexGrow: 1 },
  titleCol: { width: "34%" },
});

const STATUS_COLOR: Record<ChangeRequestStatus, BadgeProps["color"]> = {
  offen: "warning",
  angenommen: "success",
  abgelehnt: "danger",
  zurueckgezogen: "subtle",
};
const LEVEL: Record<ImpactLevel, { color: BadgeProps["color"]; label: string }> = {
  hoch: { color: "danger", label: "hoch" },
  mittel: { color: "warning", label: "mittel" },
  niedrig: { color: "success", label: "niedrig" },
};

export function CrStatusBadge({ cr }: { cr: Pick<ChangeRequestView, "status" | "statusLabel"> }) {
  return (
    <Badge appearance="tint" color={STATUS_COLOR[cr.status]}>
      {cr.statusLabel}
    </Badge>
  );
}

/** The eight dimensions of the impact estimate (engine/change-requests.ts). */
export function ImpactTable({ rows }: { rows: ImpactRow[] }) {
  return (
    <Table size="small" aria-label="Auswirkungen">
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Bereich</TableHeaderCell>
          <TableHeaderCell>Auswirkung</TableHeaderCell>
          <TableHeaderCell>Stufe</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} data-impact={r.id}>
            <TableCell>{r.label}</TableCell>
            <TableCell>{r.text}</TableCell>
            <TableCell>
              <Badge appearance="tint" color={LEVEL[r.level].color}>
                {LEVEL[r.level].label}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Findings({ findings }: { findings: Finding[] }) {
  const s = useStyles();
  if (!findings.length) return null;
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>Hinweise des Kritikers</MessageBarTitle>
        <ul className={s.findings}>
          {findings.map((f, i) => (
            <li key={i}>
              {f.severity === "warnung" ? "Warnung: " : ""}
              {f.text}
            </li>
          ))}
        </ul>
      </MessageBarBody>
    </MessageBar>
  );
}

// ---------- Register (tab) ----------

export function ChangeRequestsTab({
  code,
  onOpen,
  onNew,
}: {
  code: string;
  onOpen(crId: string): void;
  onNew(): void;
}) {
  const s = useStyles();
  const q = useChangeRequests(code);
  if (q.isError) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Spinner label="Change Requests werden geladen …" />;
  const r = q.data;
  return (
    <section className={s.card} aria-label="Change Requests">
      <div className={s.head}>
        <div>
          <Subtitle1 as="h2">Change Requests</Subtitle1>
          <Caption1 block className={s.muted}>
            Änderungen am vereinbarten Umfang. Der Projektausschuss entscheidet mit Konsent. Betrifft eine
            Änderung Personendaten, prüfen ISM und Datenschutz SchuBAn, ISDS-Konzept und DSFA neu.
          </Caption1>
        </div>
        {r.canSubmit.ok ? (
          <Button appearance="primary" onClick={onNew}>
            Neuer Change Request
          </Button>
        ) : (
          <Caption1 className={s.muted}>{r.canSubmit.reason}</Caption1>
        )}
      </div>
      <ReserveLine code={code} register={r} />
      {r.items.length === 0 ? (
        <Body1>Noch keine Change Requests.</Body1>
      ) : (
        <Table aria-label="Register der Change Requests" size="medium">
          <TableHeader>
            <TableRow>
              <TableHeaderCell className={s.titleCol}>Change Request</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Aufwand</TableHeaderCell>
              <TableHeaderCell>Auswirkung</TableHeaderCell>
              <TableHeaderCell>Neuprüfung</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.items.map((c) => (
              <TableRow key={c.id} data-cr={c.label}>
                <TableCell>
                  <Button appearance="transparent" className={s.link} onClick={() => onOpen(c.id)}>
                    {c.label} {c.title}
                  </Button>
                  <Caption1 block className={s.muted}>
                    {c.requestedBy}
                  </Caption1>
                </TableCell>
                <TableCell>
                  <CrStatusBadge cr={c} />
                </TableCell>
                <TableCell>
                  {c.effortDays} PT · {formatChf(c.costChf)}
                </TableCell>
                <TableCell>{c.impactSummary}</TableCell>
                <TableCell>{c.recheck ? (c.recheck.done ? "abgeschlossen" : "offen") : "–"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function ReserveLine({ code, register }: { code: string; register: ChangeRequestRegisterView }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const [amount, setAmount] = useState("");
  const save = useProjectCommand(code, (_, chf: number) =>
    api.put(`${projectPath(code)}/change-reserve`, { amountChf: chf }),
  );
  const r = register.reserve;
  return (
    <div className={s.row}>
      <Body1>
        {r.reserveChf === undefined
          ? "Reserve für Änderungen: nicht erfasst."
          : `Reserve für Änderungen: ${formatChf(r.reserveChf)} · verbraucht ${formatChf(r.usedChf)} · verbleibend ${formatChf(r.remainingChf ?? 0)}`}{" "}
        <Caption1 className={s.muted}>(Ansatz {formatChf(register.dayRateChf)} pro Personentag)</Caption1>
      </Body1>
      {r.canSet.ok ? (
        <form
          className={s.row}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(Number(amount), {
              onSuccess: () => {
                setAmount("");
                notify("success", "Reserve gespeichert");
              },
              onError: (err) => notify("error", "Nicht möglich", errorText(err)),
            });
          }}
        >
          <Field label="Reserve gemäss Projektauftrag (CHF)">
            <Input type="number" min={0} step={1000} value={amount} onChange={(_, d) => setAmount(d.value)} />
          </Field>
          <Button type="submit" disabled={!amount || save.isPending}>
            Reserve speichern
          </Button>
        </form>
      ) : null}
    </div>
  );
}

// ---------- New request (with the Change-Request agent) ----------

const emptyContent = (sections: readonly string[]): DraftContent => ({
  summary: "",
  sections: sections.map((heading) => ({ heading, body: "" })),
  openPoints: [],
});

export function NewChangeRequestDrawer({
  code,
  view,
  open,
  onClose,
}: {
  code: string;
  view: ProjectView;
  open: boolean;
  onClose(): void;
}) {
  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, v) => (!v.open ? onClose() : undefined)}
      position="end"
      size="large"
    >
      {/* A fresh form each time the drawer opens. */}
      {open ? <NewChangeRequestForm code={code} view={view} onClose={onClose} /> : null}
    </OverlayDrawer>
  );
}

function NewChangeRequestForm({ code, view, onClose }: { code: string; view: ProjectView; onClose(): void }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const ref = useReference();
  const register = useChangeRequests(code);
  const sections = ref.data?.changeRequests.sections ?? [];
  const flagDefs = ref.data?.changeRequests.flags ?? [];

  const [title, setTitle] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [content, setContent] = useState<DraftContent>(() => emptyContent(sections));
  const [flags, setFlags] = useState<CrFlags>(NO_FLAGS);
  const [reasons, setReasons] = useState<Partial<Record<CrFlag, string>>>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [effort, setEffort] = useState("");
  const [aiAssisted, setAiAssisted] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string>();

  // Sections arrive with the reference data; start from them once they are there.
  const current = content.sections.length ? content : emptyContent(sections);
  const effortDays = Number(effort);
  const impact = useMemo(
    () =>
      register.data && effortDays > 0
        ? changeImpact({ effortDays, flags }, { phase: view.phase, reserve: register.data.reserve }, MODEL)
        : null,
    [register.data, effortDays, flags, view.phase],
  );
  const submit = useProjectCommand(code, () =>
    api.post(`${projectPath(code)}/change-requests`, {
      title,
      requestedBy,
      effortDays,
      flags,
      content: current,
      aiAssisted,
    }),
  );

  const draft = async () => {
    setError(undefined);
    setDrafting(true);
    try {
      const p = await api.post<ChangeRequestProposal>(`${projectPath(code)}/change-requests/draft`, {
        title,
        description: current.summary,
        requestedBy,
      });
      setContent(p.content);
      setFlags(Object.fromEntries(CR_FLAGS.map((f) => [f, p.flags[f].value])) as CrFlags);
      setReasons(Object.fromEntries(CR_FLAGS.map((f) => [f, p.flags[f].reason])));
      setFindings(p.findings);
      setAiAssisted(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setDrafting(false);
    }
  };

  const setSection = (i: number, body: string) =>
    setContent({ ...current, sections: current.sections.map((x, j) => (j === i ? { ...x, body } : x)) });
  const canDraft = title.trim().length >= 4 && current.summary.trim().length >= 10 && !drafting;

  return (
    <>
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
          Neuer Change Request
        </DrawerHeaderTitle>
        <Caption1 className={s.muted}>
          Beschreibe den Wunsch in eigenen Worten. Der Change-Request-Agent arbeitet ihn aus und schätzt ein,
          welche Bereiche betroffen sind; den Aufwand schätzt ihr im Team. Gespeichert wird erst, wenn du den
          Change Request einreichst.
        </Caption1>
      </DrawerHeader>
      <DrawerBody>
        <form
          id="new-cr"
          className={s.body}
          onSubmit={(e) => {
            e.preventDefault();
            setError(undefined);
            submit.mutate(undefined, {
              onSuccess: () => {
                notify("success", "Change Request eingereicht", title);
                onClose();
              },
              onError: (err) => setError(errorText(err)),
            });
          }}
        >
          <Field label="Titel" required>
            <Input value={title} onChange={(_, d) => setTitle(d.value)} maxLength={200} />
          </Field>
          <Field label="Beantragt von" hint="Stelle oder Rolle, z. B. Fachstelle Finanzen" required>
            <Input value={requestedBy} onChange={(_, d) => setRequestedBy(d.value)} maxLength={120} />
          </Field>
          <Field label="Wunsch (Kurzbeschreibung)" required>
            <Textarea
              value={current.summary}
              onChange={(_, d) => setContent({ ...current, summary: d.value })}
              rows={3}
              resize="vertical"
            />
          </Field>
          <div className={s.row}>
            <Button icon={<Sparkle16Regular />} disabled={!canDraft} onClick={() => void draft()}>
              Mit dem Agenten ausarbeiten
            </Button>
            {drafting ? (
              <Spinner size="tiny" label="Der Change-Request-Agent arbeitet den Wunsch aus …" />
            ) : null}
            {aiAssisted && !drafting ? (
              <Badge appearance="tint" color="brand" icon={<Sparkle16Regular />}>
                Vom Agenten ausgearbeitet, bitte prüfen
              </Badge>
            ) : null}
          </div>
          <Findings findings={findings} />

          <section className={s.section} aria-label="Ausführliche Beschreibung">
            <Subtitle2 as="h3">Ausführliche Beschreibung</Subtitle2>
            {current.sections.map((x, i) => (
              <Field key={x.heading} label={x.heading}>
                <Textarea
                  value={x.body}
                  onChange={(_, d) => setSection(i, d.value)}
                  rows={3}
                  resize="vertical"
                />
              </Field>
            ))}
          </section>

          <section className={s.section} aria-label="Betroffene Bereiche">
            <Subtitle2 as="h3">Betroffene Bereiche</Subtitle2>
            <div className={s.flags}>
              {flagDefs.map((f) => (
                <div key={f.id}>
                  <Checkbox
                    label={`${f.label}: ${f.hint}`}
                    checked={flags[f.id]}
                    onChange={(_, d) => setFlags({ ...flags, [f.id]: !!d.checked })}
                  />
                  {reasons[f.id] ? (
                    <Caption1 block className={s.reason}>
                      Agent: {reasons[f.id]}
                    </Caption1>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <Field
            label="Aufwand in Personentagen"
            hint="Schätzung des Teams; daraus rechnet der HERMES Helfer Kosten und Termine."
            required
          >
            <Input
              type="number"
              min={0.5}
              step={0.5}
              value={effort}
              onChange={(_, d) => setEffort(d.value)}
            />
          </Field>

          {impact ? (
            <section className={s.section} aria-label="Auswirkungen (Vorschau)">
              <Subtitle2 as="h3">Auswirkungen (Vorschau)</Subtitle2>
              <ImpactTable rows={impact} />
            </section>
          ) : null}
          {error ? (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          ) : null}
        </form>
      </DrawerBody>
      <DrawerFooter>
        <Button
          appearance="primary"
          type="submit"
          form="new-cr"
          disabled={
            submit.isPending ||
            drafting ||
            title.trim().length < 4 ||
            requestedBy.trim().length < 2 ||
            current.summary.trim().length < 10 ||
            !(effortDays > 0)
          }
        >
          Einreichen
        </Button>
        <Button onClick={onClose}>Abbrechen</Button>
      </DrawerFooter>
    </>
  );
}

// ---------- One request: decision, recheck, withdrawal ----------

export function ChangeRequestDrawer({
  code,
  crId,
  onClose,
}: {
  code: string;
  crId: string | null;
  onClose(): void;
}) {
  const s = useStyles();
  const q = useChangeRequests(code);
  const cr = q.data?.items.find((c) => c.id === crId);
  return (
    <OverlayDrawer
      open={!!crId}
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
          {cr ? `${cr.label} ${cr.title}` : "…"}
        </DrawerHeaderTitle>
        {cr ? (
          <div className={s.meta}>
            <CrStatusBadge cr={cr} />
            <Caption1>
              {cr.effortDays} Personentage · {formatChf(cr.costChf)} · beantragt von {cr.requestedBy}
            </Caption1>
            {cr.producer.kind === "ai" ? (
              <Badge appearance="outline" color="brand" icon={<Sparkle16Regular />}>
                mit dem Agenten ausgearbeitet
              </Badge>
            ) : null}
          </div>
        ) : null}
      </DrawerHeader>
      <DrawerBody>
        {q.isError ? <ErrorView error={q.error} /> : null}
        {!cr && !q.isError ? <Spinner label="Wird geladen …" /> : null}
        {cr ? <ChangeRequestDetail code={code} cr={cr} /> : null}
      </DrawerBody>
    </OverlayDrawer>
  );
}

function ChangeRequestDetail({ code, cr }: { code: string; cr: ChangeRequestView }) {
  const s = useStyles();
  const ref = useReference();
  const flagDefs = ref.data?.changeRequests.flags ?? [];
  const touched = flagDefs.filter((f) => cr.flags[f.id]);
  return (
    <div className={s.body}>
      <Caption1 className={s.muted}>
        Erfasst von {cr.submittedBy.displayName}, {formatDate(cr.submittedAt)}
      </Caption1>
      <section className={s.doc} aria-label="Beschreibung">
        <RichText text={cr.content.summary} />
        {cr.content.sections.map((x) => (
          <div key={x.heading}>
            <Subtitle2 as="h3">{x.heading}</Subtitle2>
            <RichText text={x.body || "–"} />
          </div>
        ))}
        {cr.content.openPoints.length ? (
          <>
            <Subtitle2 as="h3">Offene Punkte</Subtitle2>
            <ul className={s.list}>
              {cr.content.openPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      <Findings findings={cr.findings} />
      <section className={s.section} aria-label="Betroffene Bereiche">
        <Subtitle2 as="h3">Betroffene Bereiche</Subtitle2>
        <Body1>
          {touched.length ? touched.map((f) => f.label).join(", ") : "Keine besonderen Bereiche."}
        </Body1>
      </section>
      <section className={s.section} aria-label="Auswirkungen">
        <Subtitle2 as="h3">Auswirkungen</Subtitle2>
        <ImpactTable rows={cr.impact} />
      </section>
      <DecisionSection code={code} cr={cr} />
      {cr.recheck ? <RecheckSection code={code} cr={cr} /> : null}
      {cr.canWithdraw.ok ? <WithdrawSection code={code} cr={cr} /> : null}
      {cr.withdrawn ? (
        <MessageBar intent="info">
          <MessageBarBody>
            Zurückgezogen von {cr.withdrawn.by.displayName}, {formatDate(cr.withdrawn.at)}:{" "}
            {cr.withdrawn.reason}
          </MessageBarBody>
        </MessageBar>
      ) : null}
    </div>
  );
}

const DECISION_LABEL: Record<string, string> = {
  freigegeben: "Freigegeben",
  "mit Auflagen": "Mit Auflagen freigegeben",
  zurückgewiesen: "Abgelehnt",
};

function DecisionSection({ code, cr }: { code: string; cr: ChangeRequestView }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const [error, setError] = useState<string>();
  const decide = useProjectCommand(code, (_, v: DecisionValues) =>
    api.post(`${projectPath(code)}/change-requests/${cr.id}/decision`, {
      decision: v.decision,
      reason: v.reason,
      konsent: v.konsent,
      conditions: v.conditions,
    }),
  );
  const decideCheck = cr.canDecide;
  return (
    <section className={s.section} aria-label="Entscheid">
      <Subtitle2 as="h3">Entscheid des Projektausschusses</Subtitle2>
      {cr.decision ? (
        <Body1>
          {DECISION_LABEL[cr.decision.decision]} durch {cr.decision.by.displayName},{" "}
          {formatDate(cr.decision.at)}
          {cr.decision.konsent ? " (Konsent festgestellt)" : ""}: {cr.decision.reason}
        </Body1>
      ) : decideCheck.ok ? (
        <DecisionForm
          gateKonsent
          reasonRequired
          rejectLabel="Ablehnen"
          submitting={decide.isPending}
          {...(error ? { error } : {})}
          onEdit={() => setError(undefined)}
          onSubmit={(v) =>
            decide.mutate(v, {
              onSuccess: () => notify("success", "Entscheid erfasst", cr.label),
              onError: (err) => setError(errorText(err)),
            })
          }
        />
      ) : cr.status === "offen" ? (
        <Caption1 className={s.muted}>Wartet auf den Projektausschuss. {decideCheck.reason}</Caption1>
      ) : null}
      {cr.conditions.map((c) => (
        <Caption1 key={c.id} block>
          Auflage: {c.text} ({c.ownerLabel} · {conditionDueText(c)}){c.done ? " · erledigt" : ""}
          {c.overdue ? <OverdueBadge /> : null}
        </Caption1>
      ))}
    </section>
  );
}

function RecheckSection({ code, cr }: { code: string; cr: ChangeRequestView }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const [note, setNote] = useState("");
  const confirm = useProjectCommand(code, (_, v: { role: string; outcome: string }) =>
    api.post(`${projectPath(code)}/change-requests/${cr.id}/recheck`, { ...v, note }),
  );
  const rc = cr.recheck!;
  const send = (role: string, outcome: string) =>
    confirm.mutate(
      { role, outcome },
      {
        onSuccess: () => {
          setNote("");
          notify("success", "Neuprüfung bestätigt", cr.label);
        },
        onError: (err) => notify("error", "Nicht möglich", errorText(err)),
      },
    );
  return (
    <section className={s.section} aria-label="Neuprüfung">
      <Subtitle2 as="h3">Neuprüfung {rc.done ? "abgeschlossen" : "offen"}</Subtitle2>
      <Caption1 className={s.muted}>
        Die Änderung betrifft Personendaten. Diese Ergebnisse werden neu beurteilt; bis dahin bleibt das Gate
        zu: {rc.deliverables.map((d) => d.name).join(", ")}.
      </Caption1>
      {rc.roles.map((r) => (
        <div key={r.role} className={s.section}>
          <Body1>
            {r.label}:{" "}
            {r.confirmed
              ? `${r.confirmed.outcome}${r.confirmed.note ? ` (${r.confirmed.note})` : ""}, ${r.confirmed.by.displayName}, ${formatDate(r.confirmed.at)}`
              : "ausstehend"}
          </Body1>
          {r.canConfirm ? (
            <div className={s.row}>
              <Field label="Massnahme oder Notiz" className={s.grow}>
                <Input value={note} onChange={(_, d) => setNote(d.value)} />
              </Field>
              <Button disabled={confirm.isPending} onClick={() => send(r.role, "keine Anpassung")}>
                Keine Anpassung nötig
              </Button>
              <Button
                appearance="primary"
                disabled={confirm.isPending}
                onClick={() => send(r.role, "Massnahme ergänzt")}
              >
                Massnahme ergänzt
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function WithdrawSection({ code, cr }: { code: string; cr: ChangeRequestView }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const [reason, setReason] = useState("");
  const withdraw = useProjectCommand(code, () =>
    api.post(`${projectPath(code)}/change-requests/${cr.id}/withdraw`, { reason }),
  );
  return (
    <section className={s.section} aria-label="Zurückziehen">
      <Subtitle2 as="h3">Zurückziehen</Subtitle2>
      <div className={s.row}>
        <Field label="Begründung" className={s.grow}>
          <Input value={reason} onChange={(_, d) => setReason(d.value)} />
        </Field>
        <Button
          disabled={reason.trim().length < 5 || withdraw.isPending}
          onClick={() =>
            withdraw.mutate(undefined, {
              onSuccess: () => notify("success", "Change Request zurückgezogen", cr.label),
              onError: (err) => notify("error", "Nicht möglich", errorText(err)),
            })
          }
        >
          Zurückziehen
        </Button>
      </div>
    </section>
  );
}
