import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Badge,
  Body1,
  Button,
  Caption1,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  OverlayDrawer,
  Radio,
  RadioGroup,
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
} from "@fluentui/react-components";
import { Dismiss24Regular, Sparkle16Regular } from "@fluentui/react-icons";
import {
  AMPEL_LABELS,
  AMPEL_VALUES,
  MIN_SUMMARY,
  STATUS_CRITERIA,
  formatChf,
  overallAmpel,
  type Ampel,
  type Finding,
  type StatusCriterion,
  type StatusFigures,
} from "@hermes-helfer/core";
import { Fragment, useState } from "react";
import { projectPath, useApi, useProjectCommand, useStatusReports } from "../api/hooks";
import type { StatusReportProposal, StatusReportRegisterView, StatusReportView } from "../api/types";
import {
  AmpelBadge,
  ErrorView,
  FindingsBox,
  RichText,
  errorText,
  formatDate,
  formatDay,
  useNotify,
} from "./ui";

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
  row: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalXXL,
  },
  doc: {
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  facts: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalXS,
    margin: 0,
    "& dd": { margin: 0, fontWeight: tokens.fontWeightSemibold },
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: tokens.spacingHorizontalL,
  },
  criterion: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  reasons: { margin: 0, paddingLeft: tokens.spacingHorizontalL, color: tokens.colorNeutralForeground3 },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  pair: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: tokens.spacingHorizontalM,
  },
});

const ampelLabel = (a: Ampel) => AMPEL_LABELS[a].label;

// ---------- Tab ----------

export function StatusReportTab({ code, onNew }: { code: string; onNew(): void }) {
  const s = useStyles();
  const q = useStatusReports(code);
  if (q.isError) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Spinner label="Statusberichte werden geladen …" />;
  const r = q.data;
  const [latest, ...older] = r.items;
  return (
    <section className={s.card} aria-label="Statusbericht">
      <div className={s.head}>
        <div>
          <Subtitle1 as="h2">Statusbericht</Subtitle1>
          <Caption1 block className={s.muted}>
            HERMES-Projektstatusbericht an den Projektausschuss, alle {r.intervalDays} Tage. Grün: auf Kurs.
            Gelb: Massnahmen nötig. Rot: zusätzlich Eskalation an die nächsthöhere Stufe.
          </Caption1>
        </div>
        <div className={s.row}>
          <Caption1 className={r.due ? undefined : s.muted}>
            {r.due ? "Der nächste Bericht ist fällig." : `Nächster Bericht fällig am ${formatDay(r.dueAt)}.`}
          </Caption1>
          {r.canPublish.ok ? (
            <Button appearance="primary" onClick={onNew}>
              Neuer Statusbericht
            </Button>
          ) : null}
        </div>
      </div>
      {latest ? (
        <ReportDetail code={code} report={latest} />
      ) : (
        <>
          <Body1>Noch kein Statusbericht.</Body1>
          <SuggestionTable register={r} />
        </>
      )}
      {older.length ? (
        <section className={s.section} aria-label="Frühere Statusberichte">
          <Subtitle2 as="h3">Frühere Statusberichte</Subtitle2>
          <Accordion collapsible multiple>
            {older.map((x) => (
              <AccordionItem key={x.id} value={x.id}>
                <AccordionHeader>
                  {x.title} · {formatDay(x.publishedAt)} · Gesamtstatus {x.overallLabel}
                </AccordionHeader>
                <AccordionPanel>
                  <ReportDetail code={code} report={x} />
                </AccordionPanel>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      ) : null}
    </section>
  );
}

/** What the HERMES Helfer suggests for the next report, with its reasons. */
function SuggestionTable({ register }: { register: StatusReportRegisterView }) {
  const s = useStyles();
  return (
    <section className={s.section} aria-label="Vorschlag für den nächsten Bericht">
      <Subtitle2 as="h3">Vorschlag für den nächsten Bericht</Subtitle2>
      <Table size="small" aria-label="Vorgeschlagene Ampel">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Bereich</TableHeaderCell>
            <TableHeaderCell>Vorschlag</TableHeaderCell>
            <TableHeaderCell>Gründe</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {register.suggestion.map((x) => (
            <TableRow key={x.id}>
              <TableCell>
                {x.code} {x.label}
              </TableCell>
              <TableCell>
                <AmpelBadge ampel={x.ampel} />
              </TableCell>
              <TableCell>{x.reasons.join(" ")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function Figures({ figures }: { figures: StatusFigures }) {
  const s = useStyles();
  const rows: [string, string][] = [];
  if (figures.budgetChf !== undefined) rows.push(["Budget", formatChf(figures.budgetChf)]);
  if (figures.spentChf !== undefined) {
    const pct = figures.budgetChf ? ` (${Math.round((figures.spentChf / figures.budgetChf) * 100)} %)` : "";
    rows.push(["Verbraucht", `${formatChf(figures.spentChf)}${pct}`]);
  }
  if (figures.progressPct !== undefined) rows.push(["Fortschritt", `${figures.progressPct} %`]);
  if (figures.plannedEnd) rows.push(["Ende geplant", formatDay(figures.plannedEnd)]);
  if (figures.forecastEnd) rows.push(["Ende Prognose", formatDay(figures.forecastEnd)]);
  if (!rows.length) return <Caption1 className={s.muted}>Keine Angaben.</Caption1>;
  return (
    <dl className={s.facts}>
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function ReportDetail({ code, report }: { code: string; report: StatusReportView }) {
  const s = useStyles();
  return (
    <article className={s.section} aria-label={report.title}>
      <div className={s.row}>
        <Subtitle2 as="h3">{report.title}</Subtitle2>
        <AmpelBadge ampel={report.overall} prefix="Gesamtstatus " />
        <Caption1 className={s.muted}>
          {formatDate(report.publishedAt)} · {report.publishedBy.displayName} · Phase {report.phaseLabel}
        </Caption1>
        {report.producer.kind === "ai" ? (
          <Badge appearance="outline" color="brand" icon={<Sparkle16Regular />}>
            Texte mit dem Agenten entworfen
          </Badge>
        ) : null}
      </div>
      <Table size="small" aria-label={`Ampel ${report.title}`}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Bereich</TableHeaderCell>
            <TableHeaderCell>Ampel</TableHeaderCell>
            <TableHeaderCell>Problem</TableHeaderCell>
            <TableHeaderCell>Massnahme</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.criteria.map((c) => (
            <TableRow key={c.id} data-criterion={c.id}>
              <TableCell>
                {c.code} {c.label}
              </TableCell>
              <TableCell>
                <AmpelBadge ampel={c.ampel} />
                {c.deviates ? (
                  <Caption1 block className={s.muted}>
                    Vorschlag: {ampelLabel(c.suggested)}
                    {c.reasons.length ? `. ${c.reasons.join(" ")}` : ""}
                  </Caption1>
                ) : null}
                {c.deviationReason ? (
                  <Caption1 block>Begründung der Projektleitung: {c.deviationReason}</Caption1>
                ) : null}
              </TableCell>
              <TableCell>{c.problem || "–"}</TableCell>
              <TableCell>{c.measure || "–"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className={s.grid}>
        <section className={s.doc} aria-label="Übersicht und Prognose">
          <Subtitle2 as="h4">Übersicht und Prognose</Subtitle2>
          <RichText text={report.overview} />
          {report.outlook ? (
            <>
              <Subtitle2 as="h4">Ausblick</Subtitle2>
              <RichText text={report.outlook} />
            </>
          ) : null}
        </section>
        <section className={s.section} aria-label="Soll/Ist und Risiken">
          <Subtitle2 as="h4">Soll/Ist</Subtitle2>
          <Figures figures={report.figures} />
          <Caption1>
            Pflichtergebnisse der Phase: {report.mandatory.done} von {report.mandatory.total} freigegeben
          </Caption1>
          <Subtitle2 as="h4">Risiken</Subtitle2>
          {report.risks.length ? (
            <ul className={s.list}>
              {report.risks.map((r) => (
                <li key={r.label}>
                  <Caption1>
                    {r.label} {r.title} ({r.score})
                  </Caption1>
                </li>
              ))}
            </ul>
          ) : (
            <Caption1 className={s.muted}>Keine offenen Risiken.</Caption1>
          )}
        </section>
      </div>
      {report.acknowledgements.map((a, i) => (
        <Caption1 key={i} block>
          Zur Kenntnis genommen von {a.by.displayName}, {formatDate(a.at)}
          {a.note ? `: ${a.note}` : ""}
        </Caption1>
      ))}
      {report.canAcknowledge.ok ? <AcknowledgeForm code={code} report={report} /> : null}
    </article>
  );
}

function AcknowledgeForm({ code, report }: { code: string; report: StatusReportView }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const [note, setNote] = useState("");
  const ack = useProjectCommand(code, () =>
    api.post(`${projectPath(code)}/status-reports/${report.id}/acknowledge`, { note }),
  );
  return (
    <form
      className={s.row}
      aria-label="Zur Kenntnis nehmen"
      onSubmit={(e) => {
        e.preventDefault();
        ack.mutate(undefined, {
          onSuccess: () => notify("success", "Zur Kenntnis genommen", report.title),
          onError: (err) => notify("error", "Nicht möglich", errorText(err)),
        });
      }}
    >
      <Field label="Bemerkung des Projektausschusses (optional)">
        <Input value={note} onChange={(_, d) => setNote(d.value)} />
      </Field>
      <Button type="submit" appearance="primary" disabled={ack.isPending}>
        Zur Kenntnis genommen
      </Button>
    </form>
  );
}

// ---------- New report ----------

export function NewStatusReportDrawer({
  code,
  open,
  onClose,
}: {
  code: string;
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
      {open ? <NewStatusReport code={code} onClose={onClose} /> : null}
    </OverlayDrawer>
  );
}

interface Entry {
  ampel: Ampel;
  problem: string;
  measure: string;
  /** The project lead's own reason for a colour better than suggested; the agent never fills it. */
  deviationReason: string;
}

const RANK: Record<Ampel, number> = { gruen: 0, gelb: 1, rot: 2 };

function NewStatusReport({ code, onClose }: { code: string; onClose(): void }) {
  const q = useStatusReports(code);
  if (q.isError) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Spinner label="Wird geladen …" />;
  return <NewStatusReportForm code={code} register={q.data} onClose={onClose} />;
}

const toNumber = (v: string) => (v.trim() === "" ? undefined : Number(v));

function NewStatusReportForm({
  code,
  register,
  onClose,
}: {
  code: string;
  register: StatusReportRegisterView;
  onClose(): void;
}) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const suggested = Object.fromEntries(register.suggestion.map((x) => [x.id, x])) as Record<
    StatusCriterion,
    StatusReportRegisterView["suggestion"][number]
  >;
  const [entries, setEntries] = useState<Record<StatusCriterion, Entry>>(
    () =>
      Object.fromEntries(
        register.suggestion.map((x) => [
          x.id,
          { ampel: x.ampel, problem: "", measure: "", deviationReason: "" },
        ]),
      ) as Record<StatusCriterion, Entry>,
  );
  const last = register.lastFigures;
  const [budget, setBudget] = useState(last.budgetChf?.toString() ?? "");
  const [spent, setSpent] = useState(last.spentChf?.toString() ?? "");
  const [progress, setProgress] = useState(last.progressPct?.toString() ?? "");
  const [plannedEnd, setPlannedEnd] = useState(last.plannedEnd ?? "");
  const [forecastEnd, setForecastEnd] = useState(last.forecastEnd ?? "");
  const [overview, setOverview] = useState("");
  const [outlook, setOutlook] = useState("");
  const [findings, setFindings] = useState<Finding[]>([]);
  /** The agent's texts on the server; publishing with them records the agent as author. */
  const [proposalId, setProposalId] = useState<string>();
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string>();

  const figures = (): StatusFigures => {
    const f: StatusFigures = {};
    const b = toNumber(budget);
    const sp = toNumber(spent);
    const pr = toNumber(progress);
    if (b !== undefined) f.budgetChf = b;
    if (sp !== undefined) f.spentChf = sp;
    if (pr !== undefined) f.progressPct = pr;
    if (plannedEnd) f.plannedEnd = plannedEnd;
    if (forecastEnd) f.forecastEnd = forecastEnd;
    return f;
  };
  const overall = overallAmpel(Object.values(entries).map((e) => e.ampel));
  const set = (id: StatusCriterion, patch: Partial<Entry>) =>
    setEntries((all) => ({ ...all, [id]: { ...all[id], ...patch } }));

  const publish = useProjectCommand(code, () =>
    api.post(`${projectPath(code)}/status-reports`, {
      criteria: entries,
      overview,
      outlook,
      figures: figures(),
      // The suggestion this form showed; the server refuses when it changed meanwhile.
      basedOn: register.suggestionVersion,
      ...(proposalId ? { proposalId } : {}),
    }),
  );

  const draft = async () => {
    setError(undefined);
    setDrafting(true);
    try {
      const p = await api.post<StatusReportProposal>(`${projectPath(code)}/status-reports/draft`, {
        criteria: entries,
        figures: figures(),
      });
      setOverview(p.overview);
      setOutlook(p.outlook);
      // What the agent left empty keeps the project lead's own text.
      setEntries((all) => {
        const next = { ...all };
        for (const c of STATUS_CRITERIA) {
          const t = p.criteria[c.id];
          if (t) {
            next[c.id] = {
              ...next[c.id],
              problem: t.problem || next[c.id].problem,
              measure: t.measure || next[c.id].measure,
            };
          }
        }
        return next;
      });
      setFindings(p.findings);
      setProposalId(p.proposalId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setDrafting(false);
    }
  };

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
          Neuer Statusbericht
        </DrawerHeaderTitle>
        <Caption1 className={s.muted}>
          Der HERMES Helfer schlägt die Ampel aus den Daten des Vorhabens vor; du entscheidest. Bei Gelb und
          Rot gehören Problem und Massnahme dazu, und wer die Lage besser einschätzt als vorgeschlagen,
          begründet es. Der Agent entwirft die Texte; gespeichert wird erst beim Veröffentlichen.
        </Caption1>
      </DrawerHeader>
      <DrawerBody>
        <form
          id="new-status-report"
          className={s.body}
          onSubmit={(e) => {
            e.preventDefault();
            setError(undefined);
            publish.mutate(undefined, {
              onSuccess: () => {
                notify("success", "Statusbericht veröffentlicht", `Gesamtstatus ${ampelLabel(overall)}`);
                onClose();
              },
              onError: (err) => setError(errorText(err)),
            });
          }}
        >
          <div className={s.row}>
            <Body1>Gesamtstatus:</Body1>
            <AmpelBadge ampel={overall} />
            <Caption1 className={s.muted}>{AMPEL_LABELS[overall].meaning}</Caption1>
          </div>
          {STATUS_CRITERIA.map((c) => {
            const e = entries[c.id];
            const sug = suggested[c.id];
            const better = RANK[e.ampel] < RANK[sug.ampel];
            return (
              <section key={c.id} className={s.criterion} aria-label={c.label} data-criterion={c.id}>
                <div className={s.row}>
                  <Subtitle2 as="h3">
                    {c.code} {c.label}
                  </Subtitle2>
                  <Caption1 className={s.muted}>Vorschlag:</Caption1>
                  <AmpelBadge ampel={sug.ampel} />
                </div>
                <ul className={s.reasons}>
                  {sug.reasons.map((r, i) => (
                    <li key={i}>
                      <Caption1>{r}</Caption1>
                    </li>
                  ))}
                </ul>
                <RadioGroup
                  layout="horizontal"
                  aria-label={`Ampel ${c.label}`}
                  value={e.ampel}
                  onChange={(_, d) => set(c.id, { ampel: d.value as Ampel })}
                >
                  {AMPEL_VALUES.map((a) => (
                    <Radio key={a} value={a} label={ampelLabel(a)} />
                  ))}
                </RadioGroup>
                {better ? (
                  <Field
                    label="Begründung (besser als vorgeschlagen)"
                    hint="Deine eigene Einschätzung; der Agent schreibt sie nie."
                    required
                  >
                    <Textarea
                      value={e.deviationReason}
                      onChange={(_, d) => set(c.id, { deviationReason: d.value })}
                      rows={2}
                    />
                  </Field>
                ) : null}
                {e.ampel !== "gruen" ? (
                  <div className={s.pair}>
                    <Field label="Problem" required>
                      <Textarea
                        value={e.problem}
                        onChange={(_, d) => set(c.id, { problem: d.value })}
                        rows={2}
                      />
                    </Field>
                    <Field label="Massnahme" required hint={e.ampel === "rot" ? "Mit Eskalation" : undefined}>
                      <Textarea
                        value={e.measure}
                        onChange={(_, d) => set(c.id, { measure: d.value })}
                        rows={2}
                      />
                    </Field>
                  </div>
                ) : null}
              </section>
            );
          })}

          <section className={s.section} aria-label="Soll/Ist">
            <Subtitle2 as="h3">Soll/Ist (optional)</Subtitle2>
            <div className={s.pair}>
              <Field label="Budget (CHF)">
                <Input type="number" min={0} value={budget} onChange={(_, d) => setBudget(d.value)} />
              </Field>
              <Field label="Verbraucht (CHF)">
                <Input type="number" min={0} value={spent} onChange={(_, d) => setSpent(d.value)} />
              </Field>
              <Field label="Fortschritt (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={progress}
                  onChange={(_, d) => setProgress(d.value)}
                />
              </Field>
              <Field label="Ende geplant">
                <Input type="date" value={plannedEnd} onChange={(_, d) => setPlannedEnd(d.value)} />
              </Field>
              <Field label="Ende Prognose">
                <Input type="date" value={forecastEnd} onChange={(_, d) => setForecastEnd(d.value)} />
              </Field>
            </div>
            <Caption1 className={s.muted}>
              Mit dem Bericht festgehalten: Phase {register.current.phaseLabel},{" "}
              {register.current.mandatory.done} von {register.current.mandatory.total} Pflichtergebnissen,{" "}
              {register.current.risks.length} offene Risiken.
            </Caption1>
          </section>

          <div className={s.row}>
            <Button icon={<Sparkle16Regular />} disabled={drafting} onClick={() => void draft()}>
              Texte mit dem Agenten entwerfen
            </Button>
            {drafting ? <Spinner size="tiny" label="Der Agent entwirft die Texte …" /> : null}
            {proposalId && !drafting ? (
              <Badge appearance="tint" color="brand" icon={<Sparkle16Regular />}>
                Vom Agenten entworfen, bitte prüfen
              </Badge>
            ) : null}
          </div>
          <FindingsBox findings={findings} />
          <Field label="Übersicht und Prognose" required>
            <Textarea value={overview} onChange={(_, d) => setOverview(d.value)} rows={4} resize="vertical" />
          </Field>
          <Field label="Ausblick">
            <Textarea value={outlook} onChange={(_, d) => setOutlook(d.value)} rows={3} resize="vertical" />
          </Field>
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
          form="new-status-report"
          disabled={publish.isPending || drafting || overview.trim().length < MIN_SUMMARY}
        >
          Veröffentlichen
        </Button>
        <Button onClick={onClose}>Abbrechen</Button>
      </DrawerFooter>
    </>
  );
}
