import {
  Body1,
  Button,
  Caption1,
  Dropdown,
  Option,
  SearchBox,
  Spinner,
  Subtitle2,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Title2,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Dismiss12Regular } from "@fluentui/react-icons";
import {
  INACTIVE_AFTER_DAYS,
  PHASE_IDS,
  SIGNALS,
  SIGNAL_IDS,
  type PhaseFigures,
  type PhaseId,
  type SignalFigures,
} from "@hermes-helfer/core";
import { useDeferredValue } from "react";
import { useSearchParams } from "react-router-dom";
import { useMe, usePortfolio, useProjects } from "../api/hooks";
import type { Portfolio, Scope } from "../api/types";
import { Pager, ProjectTable, type ProjectColumn } from "../components/ProjectTable";
import { ErrorView, formatDate } from "../components/ui";

const PAGE = 25;
const COLUMNS: readonly ProjectColumn[] = [
  "phase",
  "gate",
  "mandatory",
  "decisions",
  "signals",
  "leads",
  "updated",
];
const GATES = [
  { id: "open", label: "Offen" },
  { id: "blocked", label: "Blockiert" },
  { id: "ready", label: "Bereit zum Entscheid" },
  { id: "passed", label: "Abgeschlossen" },
] as const;
type GateFilter = (typeof GATES)[number]["id"];
const GATE_IDS = GATES.map((g) => g.id);
const SORTS = [
  { id: "attention", label: "Dringendste zuerst" },
  { id: "updated", label: "Zuletzt geändert" },
  { id: "name", label: "Name" },
] as const;
const SORT_IDS = SORTS.map((x) => x.id);

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  head: { display: "flex", alignItems: "baseline", gap: tokens.spacingHorizontalL, flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
    gap: tokens.spacingHorizontalM,
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: tokens.spacingVerticalXXS,
    padding: tokens.spacingHorizontalL,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderTopWidth: "4px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    color: tokens.colorNeutralForeground1,
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    ":focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: "2px" },
  },
  hoch: { borderTopColor: tokens.colorPaletteRedBorder2 },
  mittel: { borderTopColor: tokens.colorPaletteMarigoldBorder2 },
  info: { borderTopColor: tokens.colorBrandStroke1 },
  pressed: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    outline: `2px solid ${tokens.colorBrandStroke1}`,
  },
  value: { fontSize: tokens.fontSizeHero700, fontWeight: tokens.fontWeightSemibold, lineHeight: 1.1 },
  label: { fontWeight: tokens.fontWeightSemibold },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)",
    gap: tokens.spacingHorizontalL,
    alignItems: "start",
    "@media (max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    overflowX: "auto",
  },
  // An SVG, so the widths need no inline styles (a strict CSP blocks those, todo-later H08).
  bar: {
    display: "block",
    width: "100%",
    height: "6px",
    marginTop: tokens.spacingVerticalXXS,
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  barOpen: { fill: tokens.colorPaletteMarigoldBackground3 },
  barBlocked: { fill: tokens.colorPaletteRedBackground3 },
  barReady: { fill: tokens.colorBrandBackground },
  count: { minWidth: "auto", fontVariantNumeric: "tabular-nums" },
  facts: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalS,
    margin: 0,
    "& dd": { margin: 0, textAlign: "right", fontWeight: tokens.fontWeightSemibold },
  },
  filters: { display: "flex", gap: tokens.spacingHorizontalM, alignItems: "center", flexWrap: "wrap" },
});

// ---------- Filters in the URL ----------

type FilterKey = "scope" | "phase" | "gate" | "signal" | "sort" | "q" | "offset";

/** Filters live in the address, so links can be shared and "back" from a project restores them. */
function useFilters(canSeeAll: boolean) {
  const [params, setParams] = useSearchParams();
  const get = (key: string) => params.get(key) ?? "";
  const one = <T extends string>(allowed: readonly T[], key: string): T | "" =>
    allowed.find((x) => x === get(key)) ?? "";
  const scope: Scope = canSeeAll && get("scope") !== "mine" ? "all" : "mine";
  const filters = {
    scope,
    phase: one(PHASE_IDS, "phase"),
    gate: one(GATE_IDS, "gate"),
    signal: one(SIGNAL_IDS, "signal"),
    sort: one(SORT_IDS, "sort") || "attention",
    q: get("q"),
    offset: Math.max(0, Number.parseInt(get("offset"), 10) || 0),
  };
  /** Changes some filters; any change except paging starts on the first page. */
  const update = (patch: Partial<Record<FilterKey, string>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("offset" in patch)) next.delete("offset");
    setParams(next, { replace: true });
  };
  return { ...filters, update };
}

// ---------- Page ----------

export function PortfolioPage() {
  const s = useStyles();
  const me = useMe();
  const canSeeAll = !!me.data?.can.seeAllProjects;
  const f = useFilters(canSeeAll);
  const portfolio = usePortfolio(f.scope);
  const q = useDeferredValue(f.q);
  const projects = useProjects({
    scope: f.scope,
    q,
    phase: f.phase,
    gate: f.gate,
    signal: f.signal,
    sort: f.sort,
    limit: PAGE,
    offset: f.offset,
  });
  const data = portfolio.data;

  return (
    <div className={s.page}>
      <div className={s.head}>
        <Title2 as="h1">Portfolio</Title2>
        {data ? (
          <Caption1 className={s.muted}>
            Stand {formatDate(data.asOf)} · {data.active} aktiv · {data.finished} abgeschlossen
          </Caption1>
        ) : null}
      </div>
      {canSeeAll ? (
        <TabList selectedValue={f.scope} onTabSelect={(_, d) => f.update({ scope: String(d.value) })}>
          <Tab value="all">Alle Vorhaben</Tab>
          <Tab value="mine">Meine Vorhaben</Tab>
        </TabList>
      ) : (
        <Body1 className={s.muted}>Du siehst die Vorhaben, in denen du eine Rolle hast.</Body1>
      )}

      {portfolio.isError ? (
        <ErrorView error={portfolio.error} onRetry={() => void portfolio.refetch()} />
      ) : null}
      {portfolio.isPending ? <Spinner label="Kennzahlen werden berechnet …" /> : null}
      {data ? (
        <>
          <section className={s.section} aria-labelledby="hh-attention">
            <Subtitle2 as="h2" id="hh-attention">
              Handlungsbedarf
            </Subtitle2>
            <div className={s.tiles}>
              {data.signals.map((sig) => (
                <SignalTile
                  key={sig.id}
                  sig={sig}
                  detail={tileDetail(sig, data)}
                  pressed={f.signal === sig.id}
                  // The list then shows exactly the projects counted on the tile.
                  onToggle={() =>
                    f.update({ signal: f.signal === sig.id ? "" : sig.id, phase: "", gate: "" })
                  }
                />
              ))}
            </div>
          </section>

          <div className={s.grid}>
            <PhaseTable
              phases={data.phases}
              selected={{ phase: f.phase, gate: f.gate }}
              onSelect={(phase, gate) => f.update({ phase, gate, signal: "" })}
            />
            <section className={s.card} aria-labelledby="hh-facts">
              <Subtitle2 as="h2" id="hh-facts">
                Entscheide und Auflagen
              </Subtitle2>
              <dl className={s.facts}>
                <dt>Offene Entscheide zu Ergebnissen</dt>
                <dd>{data.openDecisions}</dd>
                <dt>Gates bereit, Entscheid beim Portfolio-Gremium</dt>
                <dd>{data.portfolioGatesReady}</dd>
                <dt>Offene Auflagen</dt>
                <dd>{data.openConditions}</dd>
                <dt>davon überfällig</dt>
                <dd>{data.overdueConditions}</dd>
              </dl>
              <div>
                <Button
                  size="small"
                  disabled={data.finished === 0}
                  onClick={() => f.update({ gate: "passed", phase: "", signal: "" })}
                >
                  Abgeschlossene Vorhaben ({data.finished})
                </Button>
              </div>
            </section>
          </div>
        </>
      ) : null}

      <section className={s.section} aria-labelledby="hh-list">
        <div className={s.head}>
          <Subtitle2 as="h2" id="hh-list">
            Vorhaben
          </Subtitle2>
          {projects.data ? <Caption1 className={s.muted}>{projects.data.total} gefunden</Caption1> : null}
        </div>
        <div className={s.filters}>
          <SearchBox
            placeholder="Name oder Kürzel"
            value={f.q}
            onChange={(_, d) => f.update({ q: d.value })}
            aria-label="Vorhaben im Portfolio suchen"
          />
          <Dropdown
            aria-label="Sortierung"
            value={SORTS.find((x) => x.id === f.sort)?.label ?? ""}
            selectedOptions={[f.sort]}
            onOptionSelect={(_, d) => f.update({ sort: d.optionValue ?? "" })}
          >
            {SORTS.map((x) => (
              <Option key={x.id} value={x.id}>
                {x.label}
              </Option>
            ))}
          </Dropdown>
          <ActiveFilters
            phase={data?.phases.find((p) => p.id === f.phase)?.label}
            gate={GATES.find((g) => g.id === f.gate)?.label}
            signal={f.signal ? SIGNALS[f.signal].label : undefined}
            onClear={(key) => f.update({ [key]: "" })}
          />
        </div>
        {projects.isError ? (
          <ErrorView error={projects.error} onRetry={() => void projects.refetch()} />
        ) : null}
        {projects.data ? (
          <ProjectTable
            label="Vorhaben im Portfolio"
            items={projects.data.items}
            columns={COLUMNS}
            empty="Keine Vorhaben für diese Filter."
          >
            <Pager
              offset={f.offset}
              size={PAGE}
              total={projects.data.total}
              busy={projects.isFetching}
              onChange={(offset) => f.update({ offset: offset ? String(offset) : "" })}
            />
          </ProjectTable>
        ) : null}
      </section>
    </div>
  );
}

function tileDetail(sig: SignalFigures, data: Portfolio): string {
  switch (sig.id) {
    case "veto":
      return "Gate blockiert";
    case "auflagen-ueberfaellig":
      return `${data.overdueConditions} von ${data.openConditions} offenen Auflagen`;
    case "gate-zurueckgewiesen":
      return "Nacharbeit vor dem nächsten Entscheid";
    case "rollen-fehlen":
      return "Entscheid so nicht möglich";
    case "ohne-aktivitaet":
      return `Seit ${INACTIVE_AFTER_DAYS} Tagen oder länger`;
    case "gate-bereit":
      return `davon ${data.portfolioGatesReady} beim Portfolio-Gremium`;
  }
}

function SignalTile({
  sig,
  detail,
  pressed,
  onToggle,
}: {
  sig: SignalFigures;
  detail: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  const s = useStyles();
  return (
    <button
      type="button"
      className={mergeClasses(s.tile, s[sig.level], pressed && s.pressed)}
      aria-pressed={pressed}
      title={sig.description}
      onClick={onToggle}
    >
      <span className={s.value}>{sig.projects}</span>
      <span className={s.label}>{sig.label}</span>
      <Caption1 className={s.muted}>{detail}</Caption1>
    </button>
  );
}

const GATE_COLUMNS = [
  { id: "open", label: "Offen", name: "Gate offen" },
  { id: "blocked", label: "Blockiert", name: "Gate blockiert" },
  { id: "ready", label: "Bereit zum Entscheid", name: "Gate bereit zum Entscheid" },
] as const;

/** Active projects by phase and gate state; each number filters the list below. */
function PhaseTable({
  phases,
  selected,
  onSelect,
}: {
  phases: PhaseFigures[];
  selected: { phase: string; gate: string };
  onSelect: (phase: PhaseId, gate: GateFilter | "") => void;
}) {
  const s = useStyles();
  const max = Math.max(1, ...phases.map((p) => p.total));
  const count = (p: PhaseFigures, gate: GateFilter | "", value: number, what: string) =>
    value ? (
      <Button
        appearance="transparent"
        size="small"
        className={s.count}
        aria-label={`${p.label}${what}: ${value} Vorhaben anzeigen`}
        aria-pressed={selected.phase === p.id && selected.gate === gate}
        onClick={() => onSelect(p.id, gate)}
      >
        {value}
      </Button>
    ) : (
      <span className={s.muted}>–</span>
    );
  return (
    <section className={s.card} aria-labelledby="hh-phases">
      <Subtitle2 as="h2" id="hh-phases">
        Aktive Vorhaben nach Phase und Gate
      </Subtitle2>
      <Table aria-labelledby="hh-phases" size="small">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Phase</TableHeaderCell>
            {GATE_COLUMNS.map((g) => (
              <TableHeaderCell key={g.id}>{g.label}</TableHeaderCell>
            ))}
            <TableHeaderCell>Total</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {phases.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                {p.label}
                <svg
                  className={s.bar}
                  viewBox={`0 0 ${max} 1`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <rect className={s.barBlocked} x={0} width={p.blocked} height={1} />
                  <rect className={s.barOpen} x={p.blocked} width={p.open} height={1} />
                  <rect className={s.barReady} x={p.blocked + p.open} width={p.ready} height={1} />
                </svg>
              </TableCell>
              {GATE_COLUMNS.map((g) => (
                <TableCell key={g.id}>{count(p, g.id, p[g.id], `, ${g.name}`)}</TableCell>
              ))}
              <TableCell>{count(p, "", p.total, "")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function ActiveFilters({
  phase,
  gate,
  signal,
  onClear,
}: {
  phase: string | undefined;
  gate: string | undefined;
  signal: string | undefined;
  onClear: (key: "phase" | "gate" | "signal") => void;
}) {
  const active = [
    { key: "phase" as const, label: phase && `Phase: ${phase}` },
    { key: "gate" as const, label: gate && `Gate: ${gate}` },
    { key: "signal" as const, label: signal },
  ].filter((x): x is { key: "phase" | "gate" | "signal"; label: string } => !!x.label);
  return active.map((x) => (
    <Button
      key={x.key}
      size="small"
      shape="circular"
      icon={<Dismiss12Regular />}
      iconPosition="after"
      aria-label={`Filter «${x.label}» entfernen`}
      onClick={() => onClear(x.key)}
    >
      {x.label}
    </Button>
  ));
}
