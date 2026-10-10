import {
  Body1,
  Button,
  Caption1,
  Dropdown,
  Option,
  SearchBox,
  Spinner,
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
  tokens,
} from "@fluentui/react-components";
import { PROJECT_ROLE_LABELS } from "@hermes-helfer/core";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { useMe, useProjects, useReference } from "../api/hooks";
import { ErrorView, GateBadge } from "../components/ui";

const PAGE = 25;

const useStyles = makeStyles({
  head: { display: "flex", alignItems: "baseline", gap: tokens.spacingHorizontalL, flexWrap: "wrap" },
  filters: {
    display: "flex",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
    flexWrap: "wrap",
    margin: `${tokens.spacingVerticalM} 0`,
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    overflowX: "auto",
  },
  link: {
    color: tokens.colorBrandForegroundLink,
    fontWeight: tokens.fontWeightSemibold,
    textDecoration: "none",
  },
  more: {
    display: "flex",
    justifyContent: "center",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalM,
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
        <div className={s.card}>
          <Table aria-label="Vorhaben" size="medium">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Vorhaben</TableHeaderCell>
                <TableHeaderCell>Phase</TableHeaderCell>
                <TableHeaderCell>Gate</TableHeaderCell>
                <TableHeaderCell>Pflichtergebnisse</TableHeaderCell>
                <TableHeaderCell>Offene Entscheide</TableHeaderCell>
                <TableHeaderCell>Projektleitung</TableHeaderCell>
                <TableHeaderCell>Meine Rollen</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.data.items.map((p) => (
                <TableRow key={p.projectId}>
                  <TableCell>
                    <Link className={s.link} to={`/vorhaben/${encodeURIComponent(p.code)}`}>
                      {p.name}
                    </Link>
                    <Caption1 block className={s.muted}>
                      {p.code}
                    </Caption1>
                  </TableCell>
                  <TableCell>{p.phaseLabel}</TableCell>
                  <TableCell>
                    <GateBadge
                      status={p.gateStatus}
                      label={p.finished ? "Abgeschlossen" : p.gateStatusLabel}
                    />
                  </TableCell>
                  <TableCell>
                    {p.mandatoryDone} / {p.mandatoryTotal}
                  </TableCell>
                  <TableCell>{p.openDecisions || "–"}</TableCell>
                  <TableCell>{p.projectLeads.join(", ") || "–"}</TableCell>
                  <TableCell>{p.myRoles.map((r) => PROJECT_ROLE_LABELS[r]).join(", ") || "–"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {projects.data.items.length === 0 ? (
            <Body1 block className={s.more}>
              {scope === "mine" ? "Du hast in keinem Vorhaben eine Rolle." : "Keine Vorhaben gefunden."}
            </Body1>
          ) : null}
          {projects.data.total > PAGE ? (
            <div className={s.more}>
              <Button
                disabled={offset === 0 || projects.isFetching}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
              >
                Zurück
              </Button>
              <Caption1 className={s.muted}>
                {offset + 1}–{Math.min(offset + PAGE, projects.data.total)} von {projects.data.total}
              </Caption1>
              <Button
                disabled={offset + PAGE >= projects.data.total || projects.isFetching}
                onClick={() => setOffset((o) => o + PAGE)}
              >
                Weiter
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
