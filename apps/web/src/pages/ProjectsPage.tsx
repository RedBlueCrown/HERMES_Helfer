import {
  Caption1,
  Dropdown,
  Option,
  SearchBox,
  Spinner,
  Tab,
  TabList,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useDeferredValue, useState } from "react";
import { useMe, useProjects, useReference } from "../api/hooks";
import { Pager, ProjectTable, type ProjectColumn } from "../components/ProjectTable";
import { ErrorView } from "../components/ui";

const PAGE = 25;
const COLUMNS: readonly ProjectColumn[] = [
  "phase",
  "gate",
  "mandatory",
  "decisions",
  "signals",
  "leads",
  "myRoles",
];

const useStyles = makeStyles({
  head: { display: "flex", alignItems: "baseline", gap: tokens.spacingHorizontalL, flexWrap: "wrap" },
  filters: {
    display: "flex",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
    flexWrap: "wrap",
    margin: `${tokens.spacingVerticalM} 0`,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function ProjectsPage() {
  const s = useStyles();
  const me = useMe();
  const ref = useReference();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState("");
  const [offset, setOffset] = useState(0);
  const deferredQ = useDeferredValue(q);
  const projects = useProjects({ q: deferredQ, phase, scope, limit: PAGE, offset });
  const phaseLabel = ref.data?.phases.find((p) => p.id === phase)?.label ?? "Alle Phasen";

  return (
    <section>
      <div className={s.head}>
        <Title2 as="h1">Vorhaben</Title2>
        {projects.data ? <Caption1 className={s.muted}>{projects.data.total} Vorhaben</Caption1> : null}
      </div>
      {me.data?.can.seeAllProjects ? (
        <TabList
          selectedValue={scope}
          onTabSelect={(_, d) => {
            setScope(d.value as "mine" | "all");
            setOffset(0);
          }}
        >
          <Tab value="mine">Meine Vorhaben</Tab>
          <Tab value="all">Alle Vorhaben</Tab>
        </TabList>
      ) : null}
      <div className={s.filters}>
        <SearchBox
          placeholder="Name oder Kürzel"
          value={q}
          onChange={(_, d) => {
            setQ(d.value);
            setOffset(0);
          }}
          aria-label="Vorhaben suchen"
        />
        <Dropdown
          aria-label="Phase"
          value={phaseLabel}
          selectedOptions={[phase]}
          onOptionSelect={(_, d) => {
            setPhase(d.optionValue ?? "");
            setOffset(0);
          }}
        >
          <Option value="">Alle Phasen</Option>
          {(ref.data?.phases ?? []).map((p) => (
            <Option key={p.id} value={p.id}>
              {p.label}
            </Option>
          ))}
        </Dropdown>
      </div>

      {projects.isError ? <ErrorView error={projects.error} onRetry={() => void projects.refetch()} /> : null}
      {projects.isPending ? <Spinner label="Vorhaben werden geladen …" /> : null}
      {projects.data ? (
        <ProjectTable
          label="Vorhaben"
          items={projects.data.items}
          columns={COLUMNS}
          empty={scope === "mine" ? "Du hast in keinem Vorhaben eine Rolle." : "Keine Vorhaben gefunden."}
        >
          <Pager
            offset={offset}
            size={PAGE}
            total={projects.data.total}
            busy={projects.isFetching}
            onChange={setOffset}
          />
        </ProjectTable>
      ) : null}
    </section>
  );
}
