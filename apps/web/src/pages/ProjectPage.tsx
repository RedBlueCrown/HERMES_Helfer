import {
  Badge,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Chat20Regular } from "@fluentui/react-icons";
import { PROJECT_ROLE_LABELS } from "@hermes-helfer/core";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useProject } from "../api/hooks";
import { ActivityTab } from "../components/ActivityTab";
import { ChangeRequestDrawer, ChangeRequestsTab, NewChangeRequestDrawer } from "../components/ChangeRequests";
import { ChatPanel } from "../components/ChatPanel";
import { DeliverableDrawer } from "../components/DeliverableDrawer";
import { ParticipationTab } from "../components/ParticipationTab";
import { DeliverableList, GatePanel, PhaseTimeline } from "../components/PhaseOverview";
import { ConditionsCard, MyTasksCard, NextStepCard, type Navigate } from "../components/SidePanels";
import { ErrorView } from "../components/ui";

type TabId = "ergebnisse" | "beteiligung" | "aenderungen" | "verlauf";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  head: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalL,
    alignItems: "start",
    flexWrap: "wrap",
  },
  title: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  roles: { display: "flex", gap: tokens.spacingHorizontalXS, flexWrap: "wrap", alignItems: "center" },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 340px",
    gap: tokens.spacingHorizontalL,
    alignItems: "start",
    "@media (max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  column: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  muted: { color: tokens.colorNeutralForeground3 },
  back: { color: tokens.colorBrandForegroundLink },
  tabBadge: { marginLeft: tokens.spacingHorizontalXS },
});

/** Back to the list the person came from (filters included), else to all projects. */
function useBackLink(): { to: string; label: string } {
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  // Only paths within the app (not "//host" or "/\host").
  if (typeof from === "string" && /^\/(?![/\\])/.test(from)) {
    return { to: from, label: from.startsWith("/portfolio") ? "Portfolio" : "Alle Vorhaben" };
  }
  return { to: "/", label: "Alle Vorhaben" };
}

export function ProjectPage() {
  const s = useStyles();
  const back = useBackLink();
  const { code = "" } = useParams();
  const project = useProject(code);
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("ergebnisse");
  const [deliverable, setDeliverable] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [changeRequest, setChangeRequest] = useState<string | null>(null);
  const [newChangeRequest, setNewChangeRequest] = useState(false);

  if (project.isPending) return <Spinner label="Vorhaben wird geladen …" />;
  if (project.isError) return <ErrorView error={project.error} onRetry={() => void project.refetch()} />;
  const v = project.data;
  const selected =
    v.phases.find((p) => p.id === (phaseId ?? v.phase)) ?? v.phases.find((p) => p.current) ?? v.phases[0]!;
  const nav: Navigate = {
    openDeliverable: (id) => setDeliverable(id),
    openGate: () => {
      setPhaseId(v.phase);
      setTab("ergebnisse");
      setGateOpen(true);
    },
    showTab: (t) => {
      setPhaseId(v.phase);
      setTab(t);
    },
    openChangeRequest: (id) => {
      setTab("aenderungen");
      setChangeRequest(id);
    },
  };
  const crPending = v.changeRequests.open + v.changeRequests.openRechecks;

  return (
    <div className={s.page}>
      <Caption1>
        <Link className={s.back} to={back.to}>
          ← {back.label}
        </Link>
      </Caption1>
      <div className={s.head}>
        <div className={s.title}>
          <Title2 as="h1">{v.name}</Title2>
          <div className={s.roles}>
            <Badge appearance="outline">{v.code}</Badge>
            <Caption1>Phase {v.phaseLabel}</Caption1>
            {v.finished ? <Badge color="success">Abgeschlossen</Badge> : null}
            {v.myRoles.map((r) => (
              <Badge key={r} appearance="tint" color="brand">
                {PROJECT_ROLE_LABELS[r]}
              </Badge>
            ))}
          </div>
          {v.description ? <Caption1 className={s.muted}>{v.description}</Caption1> : null}
        </div>
        <Button appearance="primary" icon={<Chat20Regular />} onClick={() => setChatOpen(true)}>
          Assistent fragen
        </Button>
      </div>

      {v.myRoles.length === 0 ? (
        <MessageBar intent="info">
          <MessageBarBody>
            Du siehst dieses Vorhaben über deine übergreifende Rolle, ohne Rolle im Vorhaben selbst.
          </MessageBarBody>
        </MessageBar>
      ) : null}

      <PhaseTimeline phases={v.phases} selected={selected.id} onSelect={(id) => setPhaseId(id)} />

      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as TabId)}>
        <Tab value="ergebnisse">Lieferergebnisse</Tab>
        <Tab value="beteiligung">Beteiligte und Rollen</Tab>
        <Tab value="aenderungen">
          Change Requests
          {crPending ? (
            <Badge
              appearance="filled"
              color="warning"
              size="small"
              aria-label={`${crPending} offen`}
              className={s.tabBadge}
            >
              {crPending}
            </Badge>
          ) : null}
        </Tab>
        <Tab value="verlauf">Verlauf</Tab>
      </TabList>

      <div className={s.grid}>
        <div className={s.column}>
          {!selected.current && !selected.closed ? (
            <MessageBar intent="info">
              <MessageBarBody>
                Vorschau: Das Vorhaben steht in «{v.phaseLabel}». Ergebnisse dieser Phase lassen sich erst
                erstellen, wenn sie erreicht ist.
              </MessageBarBody>
            </MessageBar>
          ) : null}
          {tab === "ergebnisse" ? (
            <>
              <GatePanel
                code={code}
                phase={selected}
                open={gateOpen && selected.current}
                onOpenChange={setGateOpen}
              />
              <DeliverableList code={code} phase={selected} onOpen={(id) => setDeliverable(id)} />
            </>
          ) : null}
          {tab === "beteiligung" ? <ParticipationTab code={code} view={v} phase={selected} /> : null}
          {tab === "aenderungen" ? (
            <ChangeRequestsTab
              code={code}
              onOpen={(id) => setChangeRequest(id)}
              onNew={() => setNewChangeRequest(true)}
            />
          ) : null}
          {tab === "verlauf" ? <ActivityTab code={code} view={v} /> : null}
        </div>
        <aside className={s.column} aria-label="Hinweise">
          <NextStepCard code={code} view={v} nav={nav} />
          <MyTasksCard view={v} nav={nav} />
          <ConditionsCard code={code} view={v} />
        </aside>
      </div>

      <DeliverableDrawer code={code} deliverableId={deliverable} onClose={() => setDeliverable(null)} />
      <ChangeRequestDrawer code={code} crId={changeRequest} onClose={() => setChangeRequest(null)} />
      <NewChangeRequestDrawer
        code={code}
        view={v}
        open={newChangeRequest}
        onClose={() => setNewChangeRequest(false)}
      />
      <ChatPanel
        // A new project starts a new conversation.
        key={code}
        code={code}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onOpenDeliverable={(id) => setDeliverable(id)}
      />
    </div>
  );
}
