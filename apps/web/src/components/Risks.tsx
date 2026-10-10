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
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  OverlayDrawer,
  Radio,
  RadioGroup,
  Spinner,
  Subtitle1,
  Subtitle2,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
  type BadgeProps,
} from "@fluentui/react-components";
import { Dismiss24Regular, Sparkle16Regular } from "@fluentui/react-icons";
import {
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  RISK_LEVELS,
  RISK_STATUSES,
  riskScore,
  scoreLevel,
  titlesSimilar,
  type Level,
  type ProjectRole,
  type RiskStatus,
  type RiskTrend,
} from "@hermes-helfer/core";
import { useEffect, useRef, useState } from "react";
import { projectPath, useApi, useProjectCommand, useRisks } from "../api/hooks";
import type { RiskProposal, RiskRegisterView, RiskReviewResult, RiskView } from "../api/types";
import { ErrorView, RichText, errorText, formatDate, useNotify } from "./ui";

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
  actions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  overview: {
    display: "flex",
    gap: tokens.spacingHorizontalXXL,
    alignItems: "center",
    flexWrap: "wrap",
  },
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
  matrix: { borderCollapse: "separate", borderSpacing: "4px" },
  axis: {
    fontWeight: tokens.fontWeightRegular,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textAlign: "right",
    paddingRight: tokens.spacingHorizontalXS,
  },
  axisTop: { textAlign: "center", paddingRight: 0 },
  cell: {
    width: "56px",
    height: "40px",
    textAlign: "center",
    borderRadius: tokens.borderRadiusMedium,
    fontWeight: tokens.fontWeightSemibold,
  },
  cellHigh: { backgroundColor: tokens.colorPaletteRedBackground2 },
  cellMedium: { backgroundColor: tokens.colorPaletteYellowBackground2 },
  cellLow: { backgroundColor: tokens.colorPaletteGreenBackground2 },
  counts: {
    display: "grid",
    gridTemplateColumns: "auto auto",
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalXS,
    margin: 0,
    "& dd": { margin: 0, fontWeight: tokens.fontWeightSemibold },
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalXXL,
  },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  meta: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "center" },
  pair: { display: "flex", gap: tokens.spacingHorizontalXL, flexWrap: "wrap" },
  doc: {
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  proposal: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  chosen: { outline: `2px solid ${tokens.colorBrandStroke1}`, outlineOffset: "-1px" },
  history: { margin: 0, paddingLeft: tokens.spacingHorizontalL, display: "flex", flexDirection: "column" },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  titleCol: { width: "38%" },
});

const LEVEL_COLOR: Record<Level, BadgeProps["color"]> = {
  hoch: "danger",
  mittel: "warning",
  niedrig: "success",
};
const STATUS_COLOR: Record<RiskStatus, BadgeProps["color"]> = {
  offen: "warning",
  "in Bearbeitung": "informative",
  geschlossen: "subtle",
};
const TREND: Record<RiskTrend, string> = { steigend: "↑ steigend", stabil: "→ stabil", sinkend: "↓ sinkend" };

/** Score and level, e.g. "6 · hoch". */
export function RiskLevelBadge({ score }: { score: number }) {
  const level = scoreLevel(score);
  return (
    <Badge appearance="tint" color={LEVEL_COLOR[level]} title="Eintritt mal Auswirkung">
      {score} · {level}
    </Badge>
  );
}

function RiskStatusBadge({ status }: { status: RiskStatus }) {
  return (
    <Badge appearance="outline" color={STATUS_COLOR[status]}>
      {status}
    </Badge>
  );
}

function AgentBadge({ text }: { text: string }) {
  return (
    <Badge appearance="outline" color="brand" icon={<Sparkle16Regular />}>
      {text}
    </Badge>
  );
}

/** Open risks per cell: probability from top (hoch) to bottom, impact from left (niedrig) to right. */
function RiskMatrix({ matrix }: { matrix: number[][] }) {
  const s = useStyles();
  const cellClass = (p: number, i: number) => {
    const level = scoreLevel((p + 1) * (i + 1));
    return mergeClasses(
      s.cell,
      level === "hoch" ? s.cellHigh : level === "mittel" ? s.cellMedium : s.cellLow,
    );
  };
  return (
    <table className={s.matrix} aria-label="Risikomatrix: offene Risiken nach Eintritt und Auswirkung">
      <thead>
        <tr>
          <th scope="col" className={s.axis}>
            Eintritt ↓ Auswirkung →
          </th>
          {RISK_LEVELS.map((l) => (
            <th key={l} scope="col" className={mergeClasses(s.axis, s.axisTop)}>
              {l}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[2, 1, 0].map((p) => (
          <tr key={p}>
            <th scope="row" className={s.axis}>
              {RISK_LEVELS[p]}
            </th>
            {[0, 1, 2].map((i) => (
              <td
                key={i}
                className={cellClass(p, i)}
                data-cell={`${RISK_LEVELS[p]}-${RISK_LEVELS[i]}`}
                aria-label={`Eintritt ${RISK_LEVELS[p]}, Auswirkung ${RISK_LEVELS[i]}: ${matrix[p]?.[i] ?? 0}`}
              >
                {matrix[p]?.[i] || ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Register (tab) ----------

type Filter = "open" | "closed" | "all";

export function RisksTab({
  code,
  onOpen,
  onNew,
  onReview,
}: {
  code: string;
  onOpen(riskId: string): void;
  onNew(): void;
  onReview(): void;
}) {
  const s = useStyles();
  const q = useRisks(code);
  const [filter, setFilter] = useState<Filter>("open");
  if (q.isError) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Spinner label="Risiken werden geladen …" />;
  const r = q.data;
  const shown = r.items.filter((x) => (filter === "all" ? true : filter === "open" ? x.open : !x.open));
  const filters: [Filter, string, number][] = [
    ["open", "Offen", r.counts.open],
    ["closed", "Geschlossen", r.counts.closed],
    ["all", "Alle", r.items.length],
  ];
  return (
    <section className={s.card} aria-label="Risiken">
      <div className={s.head}>
        <div>
          <Subtitle1 as="h2">Risiken</Subtitle1>
          <Caption1 block className={s.muted}>
            Mögliche Ereignisse, die Termine, Kosten, Qualität oder Sicherheit gefährden. Bewertung: Eintritt
            mal Auswirkung, ab {r.scoreHigh} hoch. Die verantwortliche Rolle setzt die Massnahme um.
          </Caption1>
        </div>
        <div className={s.actions}>
          {r.canReview.ok ? (
            <Button icon={<Sparkle16Regular />} onClick={onReview}>
              Risiken prüfen lassen
            </Button>
          ) : null}
          {r.canRecord.ok ? (
            <Button appearance="primary" onClick={onNew}>
              Risiko erfassen
            </Button>
          ) : (
            <Caption1 className={s.muted}>{r.canRecord.reason}</Caption1>
          )}
        </div>
      </div>
      <div className={s.overview}>
        <RiskMatrix matrix={r.matrix} />
        <dl className={s.counts}>
          <dt>Offene Risiken</dt>
          <dd>{r.counts.open}</dd>
          <dt>davon hoch</dt>
          <dd>{r.counts.high}</dd>
          <dt>Geschlossen</dt>
          <dd>{r.counts.closed}</dd>
        </dl>
      </div>
      <TabList
        size="small"
        aria-label="Risiken filtern"
        selectedValue={filter}
        onTabSelect={(_, d) => setFilter(d.value as Filter)}
      >
        {filters.map(([id, label, n]) => (
          <Tab key={id} value={id}>
            {label} ({n})
          </Tab>
        ))}
      </TabList>
      {shown.length === 0 ? (
        <Body1>{r.items.length ? "Keine Risiken in dieser Ansicht." : "Noch keine Risiken erfasst."}</Body1>
      ) : (
        <Table aria-label="Register der Risiken" size="medium">
          <TableHeader>
            <TableRow>
              <TableHeaderCell className={s.titleCol}>Risiko</TableHeaderCell>
              <TableHeaderCell>Bewertung</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Massnahme</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((x) => (
              <TableRow key={x.id} data-risk={x.label}>
                <TableCell>
                  <Button appearance="transparent" className={s.link} onClick={() => onOpen(x.id)}>
                    {x.label} {x.title}
                  </Button>
                  <Caption1 block className={s.muted}>
                    {x.ownerLabel}
                    {x.trend ? ` · ${TREND[x.trend]}` : ""}
                  </Caption1>
                </TableCell>
                <TableCell>
                  <RiskLevelBadge score={x.score} />
                  <Caption1 block className={s.muted}>
                    Eintritt {x.probability}, Auswirkung {x.impact}
                  </Caption1>
                </TableCell>
                <TableCell>
                  <RiskStatusBadge status={x.status} />
                </TableCell>
                <TableCell>{x.mitigation || <span className={s.muted}>noch keine</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// ---------- Shared fields ----------

function LevelField({ label, value, onChange }: { label: string; value: Level; onChange(l: Level): void }) {
  return (
    <Field label={label}>
      <RadioGroup layout="horizontal" value={value} onChange={(_, d) => onChange(d.value as Level)}>
        {RISK_LEVELS.map((l) => (
          <Radio key={l} value={l} label={l} />
        ))}
      </RadioGroup>
    </Field>
  );
}

function OwnerField({ value, onChange }: { value: ProjectRole; onChange(r: ProjectRole): void }) {
  return (
    <Field label="Verantwortlich" hint="Die Rolle, die die Massnahme umsetzt.">
      <Dropdown
        value={PROJECT_ROLE_LABELS[value]}
        selectedOptions={[value]}
        onOptionSelect={(_, d) => onChange((d.optionValue as ProjectRole) ?? value)}
      >
        {PROJECT_ROLES.map((r) => (
          <Option key={r} value={r}>
            {PROJECT_ROLE_LABELS[r]}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}

function ScoreLine({ probability, impact }: { probability: Level; impact: Level }) {
  const s = useStyles();
  return (
    <div className={s.meta}>
      <Body1>Bewertung:</Body1>
      <RiskLevelBadge score={riskScore(probability, impact)} />
    </div>
  );
}

// ---------- New risk ----------

export function NewRiskDrawer({ code, open, onClose }: { code: string; open: boolean; onClose(): void }) {
  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, v) => (!v.open ? onClose() : undefined)}
      position="end"
      size="medium"
    >
      {open ? <NewRiskForm code={code} onClose={onClose} /> : null}
    </OverlayDrawer>
  );
}

function NewRiskForm({ code, onClose }: { code: string; onClose(): void }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const register = useRisks(code);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [probability, setProbability] = useState<Level>("mittel");
  const [impact, setImpact] = useState<Level>("mittel");
  const [ownerRole, setOwnerRole] = useState<ProjectRole>("PL");
  const [mitigation, setMitigation] = useState("");
  const [error, setError] = useState<string>();
  const save = useProjectCommand(code, () =>
    api.post(`${projectPath(code)}/risks`, {
      title,
      description,
      probability,
      impact,
      ownerRole,
      mitigation,
    }),
  );
  const similar =
    title.trim().length >= 8
      ? register.data?.items.find((x) => x.open && titlesSimilar(x.title, title))
      : undefined;
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
          Risiko erfassen
        </DrawerHeaderTitle>
        <Caption1 className={s.muted}>
          Was könnte eintreten, und was wäre die Folge? Die Projektleitung und die verantwortliche Rolle
          beurteilen das Risiko später neu.
        </Caption1>
      </DrawerHeader>
      <DrawerBody>
        <form
          id="new-risk"
          className={s.body}
          onSubmit={(e) => {
            e.preventDefault();
            setError(undefined);
            save.mutate(undefined, {
              onSuccess: () => {
                notify("success", "Risiko erfasst", title);
                onClose();
              },
              onError: (err) => setError(errorText(err)),
            });
          }}
        >
          <Field label="Risiko" hint="Kurz und konkret, z. B. «Lieferverzug beim Hersteller»" required>
            <Input value={title} onChange={(_, d) => setTitle(d.value)} maxLength={200} />
          </Field>
          {similar ? (
            <MessageBar intent="warning">
              <MessageBarBody>
                Ähnlich wie {similar.label} «{similar.title}»: prüfen, ob es dasselbe Risiko ist.
              </MessageBarBody>
            </MessageBar>
          ) : null}
          <Field label="Beschreibung" hint="Ursache und mögliche Folge">
            <Textarea
              value={description}
              onChange={(_, d) => setDescription(d.value)}
              rows={3}
              resize="vertical"
            />
          </Field>
          <div className={s.pair}>
            <LevelField label="Eintritt" value={probability} onChange={setProbability} />
            <LevelField label="Auswirkung" value={impact} onChange={setImpact} />
          </div>
          <ScoreLine probability={probability} impact={impact} />
          <OwnerField value={ownerRole} onChange={setOwnerRole} />
          <Field
            label="Massnahme"
            hint="Wer macht was, damit das Risiko nicht eintritt oder weniger schadet."
          >
            <Textarea
              value={mitigation}
              onChange={(_, d) => setMitigation(d.value)}
              rows={2}
              resize="vertical"
            />
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
          form="new-risk"
          disabled={save.isPending || title.trim().length < 4}
        >
          Erfassen
        </Button>
        <Button onClick={onClose}>Abbrechen</Button>
      </DrawerFooter>
    </>
  );
}

// ---------- Review by the Risiko agent ----------

export function RiskReviewDrawer({ code, open, onClose }: { code: string; open: boolean; onClose(): void }) {
  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, v) => (!v.open ? onClose() : undefined)}
      position="end"
      size="large"
    >
      {open ? <RiskReviewPanel code={code} onClose={onClose} /> : null}
    </OverlayDrawer>
  );
}

interface NewChoice extends RiskProposal {
  selected: boolean;
  done: boolean;
}

interface ReChoice {
  selected: boolean;
  done: boolean;
  probability: Level;
  impact: Level;
  mitigation: string;
}

function RiskReviewPanel({ code, onClose }: { code: string; onClose(): void }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const [result, setResult] = useState<RiskReviewResult>();
  const [error, setError] = useState<string>();
  const [newRisks, setNewRisks] = useState<NewChoice[]>([]);
  const [re, setRe] = useState<ReChoice[]>([]);
  const started = useRef(false);

  // One model call per opening; the ref survives React's double effect in development.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .post<RiskReviewResult>(`${projectPath(code)}/risks/review`)
      .then((r) => {
        setResult(r);
        setNewRisks(r.newRisks.map((p) => ({ ...p, selected: false, done: false })));
        setRe(
          r.reassessments.map((p) => ({
            selected: false,
            done: false,
            probability: p.probability,
            impact: p.impact,
            mitigation: p.mitigation || p.current.mitigation,
          })),
        );
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [api, code]);

  const accept = useProjectCommand(code, async () => {
    if (!result) return;
    for (const [i, p] of newRisks.entries()) {
      if (!p.selected || p.done) continue;
      await api.post(`${projectPath(code)}/risks`, {
        title: p.title,
        description: p.description,
        probability: p.probability,
        impact: p.impact,
        ownerRole: p.ownerRole,
        mitigation: p.mitigation,
        aiAssisted: true,
      });
      setNewRisks((list) => list.map((x, j) => (j === i ? { ...x, done: true } : x)));
    }
    for (const [i, c] of re.entries()) {
      const p = result.reassessments[i]!;
      if (!c.selected || c.done) continue;
      await api.post(`${projectPath(code)}/risks/${p.riskId}/assessment`, {
        probability: c.probability,
        impact: c.impact,
        status: p.current.status,
        ownerRole: p.current.ownerRole,
        mitigation: c.mitigation,
        note: `Vorschlag des Risiko-Agenten: ${p.reason}`.slice(0, 2000),
        aiAssisted: true,
      });
      setRe((list) => list.map((x, j) => (j === i ? { ...x, done: true } : x)));
    }
  });

  const chosen =
    newRisks.filter((x) => x.selected && !x.done).length + re.filter((x) => x.selected && !x.done).length;
  const editNew = (i: number, patch: Partial<NewChoice>) =>
    setNewRisks((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const editRe = (i: number, patch: Partial<ReChoice>) =>
    setRe((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));

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
          Risikoprüfung durch den Agenten
        </DrawerHeaderTitle>
        <Caption1 className={s.muted}>
          Der Risiko-Agent prüft das Register anhand des Projektstands und schlägt vor. Übernommen wird nur,
          was du auswählst; gespeichert wird es mit dem Vermerk «vom Risiko-Agenten vorgeschlagen».
        </Caption1>
      </DrawerHeader>
      <DrawerBody>
        <div className={s.body}>
          {error ? (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          ) : null}
          {!result && !error ? <Spinner label="Der Risiko-Agent prüft das Register …" /> : null}
          {result ? (
            <>
              <section className={s.section} aria-label="Geprüfte Hinweise">
                <Subtitle2 as="h3">Geprüfte Hinweise aus dem Vorhaben</Subtitle2>
                {result.triggers.length ? (
                  <ul className={s.list}>
                    {result.triggers.map((t) => (
                      <li key={t.id}>
                        <Caption1>{t.text}</Caption1>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Caption1 className={s.muted}>
                    Keine besonderen Hinweise; geprüft wurden Profil und Ergebnisse.
                  </Caption1>
                )}
              </section>

              <section className={s.section} aria-label="Neue Risiken">
                <Subtitle2 as="h3">Neue Risiken</Subtitle2>
                {newRisks.length === 0 ? (
                  <Caption1 className={s.muted}>Keine neuen Risiken vorgeschlagen.</Caption1>
                ) : null}
                {newRisks.map((p, i) => (
                  <div
                    key={i}
                    className={mergeClasses(s.proposal, p.selected && s.chosen)}
                    data-proposal={p.title}
                  >
                    <div className={s.meta}>
                      <Checkbox
                        label={`Übernehmen: ${p.title}`}
                        checked={p.selected}
                        disabled={p.done}
                        onChange={(_, d) => editNew(i, { selected: !!d.checked })}
                      />
                      {p.done ? <Badge color="success">Übernommen</Badge> : null}
                    </div>
                    <Caption1 className={s.muted}>Agent: {p.reason}</Caption1>
                    {p.findings.map((f, k) => (
                      <MessageBar key={k} intent="warning">
                        <MessageBarBody>{f.text}</MessageBarBody>
                      </MessageBar>
                    ))}
                    {p.selected && !p.done ? (
                      <>
                        <Field label="Risiko">
                          <Input value={p.title} onChange={(_, d) => editNew(i, { title: d.value })} />
                        </Field>
                        {p.description ? <Caption1>{p.description}</Caption1> : null}
                        <div className={s.pair}>
                          <LevelField
                            label="Eintritt"
                            value={p.probability}
                            onChange={(l) => editNew(i, { probability: l })}
                          />
                          <LevelField
                            label="Auswirkung"
                            value={p.impact}
                            onChange={(l) => editNew(i, { impact: l })}
                          />
                        </div>
                        <OwnerField value={p.ownerRole} onChange={(r) => editNew(i, { ownerRole: r })} />
                        <Field label="Massnahme">
                          <Textarea
                            value={p.mitigation}
                            onChange={(_, d) => editNew(i, { mitigation: d.value })}
                            rows={2}
                            resize="vertical"
                          />
                        </Field>
                      </>
                    ) : (
                      <div className={s.meta}>
                        <RiskLevelBadge score={riskScore(p.probability, p.impact)} />
                        <Caption1>
                          Eintritt {p.probability}, Auswirkung {p.impact} · {PROJECT_ROLE_LABELS[p.ownerRole]}
                          {p.mitigation ? ` · Massnahme: ${p.mitigation}` : ""}
                        </Caption1>
                      </div>
                    )}
                  </div>
                ))}
              </section>

              <section className={s.section} aria-label="Neu beurteilen">
                <Subtitle2 as="h3">Bestehende Risiken neu beurteilen</Subtitle2>
                {result.reassessments.length === 0 ? (
                  <Caption1 className={s.muted}>Keine neuen Beurteilungen vorgeschlagen.</Caption1>
                ) : null}
                {result.reassessments.map((p, i) => {
                  const c = re[i]!;
                  return (
                    <div key={p.riskId} className={mergeClasses(s.proposal, c.selected && s.chosen)}>
                      <div className={s.meta}>
                        <Checkbox
                          label={`Übernehmen: ${p.risk} ${p.title}`}
                          checked={c.selected}
                          disabled={c.done}
                          onChange={(_, d) => editRe(i, { selected: !!d.checked })}
                        />
                        {c.done ? <Badge color="success">Übernommen</Badge> : null}
                      </div>
                      <Caption1>
                        Bisher Eintritt {p.current.probability}, Auswirkung {p.current.impact}; neu Eintritt{" "}
                        {p.probability}, Auswirkung {p.impact}.
                      </Caption1>
                      <Caption1 className={s.muted}>Agent: {p.reason}</Caption1>
                      {c.selected && !c.done ? (
                        <>
                          <div className={s.pair}>
                            <LevelField
                              label="Eintritt"
                              value={c.probability}
                              onChange={(l) => editRe(i, { probability: l })}
                            />
                            <LevelField
                              label="Auswirkung"
                              value={c.impact}
                              onChange={(l) => editRe(i, { impact: l })}
                            />
                          </div>
                          <Field label="Massnahme">
                            <Textarea
                              value={c.mitigation}
                              onChange={(_, d) => editRe(i, { mitigation: d.value })}
                              rows={2}
                              resize="vertical"
                            />
                          </Field>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </section>
              {accept.error ? (
                <MessageBar intent="error">
                  <MessageBarBody>{errorText(accept.error)}</MessageBarBody>
                </MessageBar>
              ) : null}
            </>
          ) : null}
        </div>
      </DrawerBody>
      <DrawerFooter>
        <Button
          appearance="primary"
          disabled={!chosen || accept.isPending}
          onClick={() =>
            accept.mutate(undefined, {
              onSuccess: () => notify("success", "Vorschläge übernommen", `${chosen} übernommen`),
            })
          }
        >
          {chosen ? `Ausgewählte übernehmen (${chosen})` : "Ausgewählte übernehmen"}
        </Button>
        <Button onClick={onClose}>Schliessen</Button>
      </DrawerFooter>
    </>
  );
}

// ---------- One risk: details, history, new assessment ----------

export function RiskDrawer({
  code,
  riskId,
  onClose,
}: {
  code: string;
  riskId: string | null;
  onClose(): void;
}) {
  const s = useStyles();
  const q = useRisks(code);
  const r = q.data?.items.find((x) => x.id === riskId);
  return (
    <OverlayDrawer
      open={!!riskId}
      onOpenChange={(_, v) => (!v.open ? onClose() : undefined)}
      position="end"
      size="medium"
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
          {r ? `${r.label} ${r.title}` : "…"}
        </DrawerHeaderTitle>
        {r ? (
          <div className={s.meta}>
            <RiskLevelBadge score={r.score} />
            <RiskStatusBadge status={r.status} />
            {r.trend ? <Caption1>{TREND[r.trend]}</Caption1> : null}
            {r.producer.kind === "ai" ? <AgentBadge text="vom Risiko-Agenten vorgeschlagen" /> : null}
          </div>
        ) : null}
      </DrawerHeader>
      <DrawerBody>
        {q.isError ? <ErrorView error={q.error} /> : null}
        {!r && !q.isError ? <Spinner label="Wird geladen …" /> : null}
        {/* A fresh form for each risk and each new assessment. */}
        {r && q.data ? (
          <RiskDetail key={`${r.id}-${r.history.length}`} code={code} risk={r} register={q.data} />
        ) : null}
      </DrawerBody>
    </OverlayDrawer>
  );
}

function RiskDetail({ code, risk, register }: { code: string; risk: RiskView; register: RiskRegisterView }) {
  const s = useStyles();
  return (
    <div className={s.body}>
      <Caption1 className={s.muted}>
        Erfasst von {risk.recordedBy.displayName}, {formatDate(risk.recordedAt)} (Phase {risk.phaseLabel})
      </Caption1>
      <section className={s.doc} aria-label="Beschreibung">
        {risk.description ? (
          <RichText text={risk.description} />
        ) : (
          <Caption1 className={s.muted}>Keine Beschreibung.</Caption1>
        )}
        <Body1>
          Eintritt {risk.probability}, Auswirkung {risk.impact} · verantwortlich: {risk.ownerLabel}
        </Body1>
        <Body1>Massnahme: {risk.mitigation || "noch keine"}</Body1>
      </section>
      {risk.canAssess.ok ? (
        <AssessmentForm code={code} risk={risk} scoreHigh={register.scoreHigh} />
      ) : (
        <Caption1 className={s.muted}>{risk.canAssess.reason}</Caption1>
      )}
      <section className={s.section} aria-label="Verlauf des Risikos">
        <Subtitle2 as="h3">Verlauf</Subtitle2>
        <ol className={s.history} reversed>
          {[...risk.history].reverse().map((h, i) => (
            <li key={i}>
              <Caption1 block>
                {formatDate(h.at)} · {h.by.displayName}: Eintritt {h.probability}, Auswirkung {h.impact} (
                {h.score}), {h.status}, {h.ownerLabel}
                {h.producer.kind === "ai" ? " · Vorschlag des Risiko-Agenten" : ""}
              </Caption1>
              {h.note ? (
                <Caption1 block className={s.muted}>
                  {h.note}
                </Caption1>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function AssessmentForm({ code, risk, scoreHigh }: { code: string; risk: RiskView; scoreHigh: number }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const [probability, setProbability] = useState<Level>(risk.probability);
  const [impact, setImpact] = useState<Level>(risk.impact);
  const [status, setStatus] = useState<RiskStatus>(risk.status);
  const [ownerRole, setOwnerRole] = useState<ProjectRole>(risk.ownerRole);
  const [mitigation, setMitigation] = useState(risk.mitigation);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const save = useProjectCommand(code, () =>
    api.post(`${projectPath(code)}/risks/${risk.id}/assessment`, {
      probability,
      impact,
      status,
      ownerRole,
      mitigation,
      note,
    }),
  );
  const closing = status === "geschlossen" && risk.status !== "geschlossen";
  const reopening = status !== "geschlossen" && risk.status === "geschlossen";
  return (
    <form
      className={s.section}
      aria-label="Neu beurteilen"
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        save.mutate(undefined, {
          onSuccess: () => notify("success", "Beurteilung gespeichert", risk.label),
          onError: (err) => setError(errorText(err)),
        });
      }}
    >
      <Subtitle2 as="h3">Neu beurteilen</Subtitle2>
      <div className={s.pair}>
        <LevelField label="Eintritt" value={probability} onChange={setProbability} />
        <LevelField label="Auswirkung" value={impact} onChange={setImpact} />
      </div>
      <ScoreLine probability={probability} impact={impact} />
      <Field label="Status">
        <RadioGroup layout="horizontal" value={status} onChange={(_, d) => setStatus(d.value as RiskStatus)}>
          {RISK_STATUSES.map((x) => (
            <Radio key={x} value={x} label={x} />
          ))}
        </RadioGroup>
      </Field>
      <OwnerField value={ownerRole} onChange={setOwnerRole} />
      <Field
        label="Massnahme"
        hint={
          riskScore(probability, impact) >= scoreHigh
            ? "Hohes Risiko: Die verantwortliche Rolle legt eine Massnahme fest und setzt sie um."
            : undefined
        }
        required={status === "in Bearbeitung"}
      >
        <Textarea value={mitigation} onChange={(_, d) => setMitigation(d.value)} rows={2} resize="vertical" />
      </Field>
      <Field
        label={closing || reopening ? "Begründung (Pflicht)" : "Notiz"}
        hint={
          closing
            ? "Warum ist das Risiko erledigt?"
            : reopening
              ? "Warum ist das Risiko wieder offen?"
              : undefined
        }
      >
        <Textarea value={note} onChange={(_, d) => setNote(d.value)} rows={2} resize="vertical" />
      </Field>
      {error ? (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>
            <MessageBarTitle>Nicht gespeichert</MessageBarTitle>
            {error}
          </MessageBarBody>
        </MessageBar>
      ) : null}
      <div>
        <Button type="submit" appearance="primary" disabled={save.isPending}>
          Beurteilung speichern
        </Button>
      </div>
    </form>
  );
}
