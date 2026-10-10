import {
  Badge,
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  Subtitle1,
  Subtitle2,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircle16Filled,
  DismissCircle16Filled,
  Info16Regular,
  Warning16Filled,
} from "@fluentui/react-icons";
import { commands, projectPath, useProjectCommand } from "../api/hooks";
import type { DeliverableRowView, PhaseView } from "../api/types";
import { DecisionForm, type DecisionValues } from "./DecisionForm";
import {
  DeliverableBadge,
  GateBadge,
  RestrictedBadge,
  WarningIcon,
  errorText,
  formatDate,
  useNotify,
} from "./ui";

const useStyles = makeStyles({
  inlineLink: { padding: 0, minWidth: 0, height: "auto", color: tokens.colorBrandForegroundLink },
  timeline: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: tokens.spacingHorizontalS,
  },
  step: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
  },
  current: { borderTop: `4px solid ${tokens.colorBrandStroke1}` },
  selected: { outline: `2px solid ${tokens.colorBrandStroke1}`, outlineOffset: "1px" },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  gateHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  criteria: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  criterion: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center" },
  muted: { color: tokens.colorNeutralForeground3 },
  group: { display: "flex", flexDirection: "column" },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  rowMain: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  nameBtn: {
    justifyContent: "flex-start",
    textAlign: "left",
    padding: 0,
    minWidth: 0,
    fontWeight: tokens.fontWeightSemibold,
    height: "auto",
  },
  flags: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  rowActions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center" },
});

export function PhaseTimeline({
  phases,
  selected,
  onSelect,
}: {
  phases: PhaseView[];
  selected: string;
  onSelect(id: string): void;
}) {
  const s = useStyles();
  return (
    <nav className={s.timeline} aria-label="Phasen und Gates">
      {phases.map((p) => (
        <button
          key={p.id}
          type="button"
          className={mergeClasses(s.step, p.current && s.current, p.id === selected && s.selected)}
          aria-current={p.current ? "step" : undefined}
          aria-pressed={p.id === selected}
          onClick={() => onSelect(p.id)}
        >
          <Text weight="semibold">
            {p.label}
            {p.extension ? " (Ergänzung)" : ""}
          </Text>
          <Caption1 className={s.muted}>Gate: {p.gate.name}</Caption1>
          <GateBadge status={p.gate.status} label={p.gate.statusLabel} />
          {!p.future ? (
            <Caption1 className={s.muted}>
              Pflicht: {p.mandatory.done}/{p.mandatory.total}
            </Caption1>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export function GatePanel({
  code,
  phase,
  highRisks = 0,
  onShowRisks,
  open,
  onOpenChange,
}: {
  code: string;
  phase: PhaseView;
  /** Open high risks of the project; the decider should know them (no gate criterion). */
  highRisks?: number;
  onShowRisks?(): void;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const s = useStyles();
  const notify = useNotify();
  const g = phase.gate;
  const decide = useProjectCommand(code, (api, v: DecisionValues) =>
    api.post(`${projectPath(code)}/gates/${phase.id}/decisions`, v),
  );
  return (
    <section className={s.card} aria-label={`Gate ${g.name}`}>
      <div className={s.gateHead}>
        <div>
          <Caption1 className={s.muted}>Gate</Caption1>
          <Subtitle1 as="h2" block>
            {g.name}
          </Subtitle1>
          <Caption1 className={s.muted}>Entscheid: {g.deciderLabel}</Caption1>
        </div>
        <div className={s.rowActions}>
          <GateBadge status={g.status} label={g.statusLabel} />
          {g.canDecide.ok ? (
            <Button appearance="primary" onClick={() => onOpenChange(true)}>
              Gate entscheiden
            </Button>
          ) : null}
        </div>
      </div>
      {g.note ? <Caption1>{g.note}</Caption1> : null}
      {phase.current ? (
        <ul className={s.criteria}>
          {g.criteria.map((c) => (
            <li key={c.id} className={s.criterion}>
              {c.ok ? (
                <CheckmarkCircle16Filled color={tokens.colorPaletteGreenForeground1} />
              ) : c.blocking ? (
                <DismissCircle16Filled color={tokens.colorPaletteRedForeground1} />
              ) : (
                <Warning16Filled color={tokens.colorPaletteDarkOrangeForeground1} />
              )}
              <Body1>
                {c.label}: <span className={s.muted}>{c.detail}</span>
              </Body1>
            </li>
          ))}
        </ul>
      ) : null}
      {highRisks ? (
        <Caption1 block>
          <Warning16Filled color={tokens.colorPaletteDarkOrangeForeground1} />{" "}
          {highRisks === 1 ? "1 hohes Risiko ist" : `${highRisks} hohe Risiken sind`} offen; kein Kriterium,
          aber für den Entscheid wichtig.{" "}
          {onShowRisks ? (
            <Button appearance="transparent" size="small" className={s.inlineLink} onClick={onShowRisks}>
              Zu den Risiken
            </Button>
          ) : null}
        </Caption1>
      ) : null}
      {g.decisions.map((d, i) => (
        <Caption1 key={i} block>
          <Info16Regular />{" "}
          {d.decision === "zurückgewiesen"
            ? "Nicht freigegeben"
            : d.decision === "mit Auflagen"
              ? "Mit Auflagen freigegeben"
              : "Freigegeben"}{" "}
          durch {d.by.displayName}, {formatDate(d.at)}
          {d.konsent ? " (Konsent festgestellt)" : ""}
          {d.reason ? `: ${d.reason}` : ""}
        </Caption1>
      ))}
      <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
        <DialogSurface aria-label={`Gate ${g.name} entscheiden`}>
          <DialogBody>
            <DialogTitle>Gate «{g.name}» entscheiden</DialogTitle>
            <DialogContent>
              <Body1 block>
                Alle Kriterien sind erfüllt.{" "}
                {g.requiresKonsent
                  ? "Für den Entscheid des Projektausschusses muss der Konsent festgestellt sein."
                  : ""}
              </Body1>
              {highRisks ? (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    {highRisks === 1 ? "1 hohes Risiko ist" : `${highRisks} hohe Risiken sind`} offen. Prüfe
                    sie vor dem Entscheid und halte nötige Massnahmen als Auflagen fest.
                  </MessageBarBody>
                </MessageBar>
              ) : null}
              <DecisionForm
                gateKonsent={g.requiresKonsent}
                rejectLabel="Nicht freigeben"
                submitting={decide.isPending}
                {...(decide.error ? { error: errorText(decide.error) } : {})}
                onEdit={() => decide.error && decide.reset()}
                onCancel={() => onOpenChange(false)}
                onSubmit={(v) =>
                  decide.mutate(v, {
                    onSuccess: () => {
                      onOpenChange(false);
                      notify(
                        "success",
                        "Gate entschieden",
                        v.decision === "zurückgewiesen"
                          ? "Nicht freigegeben"
                          : "Die nächste Phase ist offen.",
                      );
                    },
                  })
                }
              />
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}

function DeliverableRow({
  code,
  d,
  onOpen,
}: {
  code: string;
  d: DeliverableRowView;
  onOpen(id: string): void;
}) {
  const s = useStyles();
  const notify = useNotify();
  const start = useProjectCommand(code, commands.startSkill(code));
  const release = useProjectCommand(code, commands.release(code));
  const a = d.action;
  const act = () => {
    if (!a) return;
    if (a.kind === "start" && a.skillId) {
      if (a.label === "Ergebnis erfassen") return onOpen(d.id);
      start.mutate(a.skillId, {
        onSuccess: () => notify("info", "Entwurf angestossen", `${d.name} entsteht …`),
        onError: (e) => notify("error", "Nicht möglich", errorText(e)),
      });
    } else if (a.kind === "release") {
      release.mutate(
        { deliverableId: d.id, contentVersion: d.contentVersion },
        {
          onSuccess: () => notify("success", "Freigegeben", d.name),
          onError: (e) => notify("error", "Nicht möglich", errorText(e)),
        },
      );
    } else onOpen(d.id);
  };
  return (
    <li className={s.row} data-deliverable={d.id}>
      <div className={s.rowMain}>
        <Button appearance="transparent" className={s.nameBtn} onClick={() => onOpen(d.id)}>
          {d.name}
        </Button>
        <div className={s.flags}>
          <DeliverableBadge status={d.status} label={d.statusLabel} />
          {d.findings ? (
            <Caption1>
              <WarningIcon /> {d.findings} {d.findings === 1 ? "Hinweis" : "Hinweise"} vom Qualitätscheck
            </Caption1>
          ) : null}
          {d.waitingFor.length ? (
            <Caption1 className={s.muted}>wartet auf {d.waitingFor.join(", ")}</Caption1>
          ) : null}
          {d.restricted ? <RestrictedBadge /> : null}
          {d.origin !== "hermes" ? (
            <Badge
              appearance="outline"
              color="subtle"
              title={
                d.origin === "interviews" ? "Ergänzung aus Interviews" : "Ergänzung, nicht Teil von HERMES"
              }
            >
              Ergänzung
            </Badge>
          ) : null}
        </div>
      </div>
      <div className={s.rowActions}>
        {a ? (
          <Button
            size="small"
            appearance={a.kind === "start" || a.kind === "release" ? "primary" : "secondary"}
            disabled={!a.enabled || start.isPending || release.isPending}
            title={a.reason}
            onClick={act}
          >
            {a.label}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function DeliverableList({
  code,
  phase,
  onOpen,
}: {
  code: string;
  phase: PhaseView;
  onOpen(id: string): void;
}) {
  const s = useStyles();
  const groups: [string, string, DeliverableRowView[]][] = [
    ["Pflicht", "Muss für das Gate vorliegen", phase.deliverables.filter((d) => d.requirement === "pflicht")],
    [
      "Falls zutreffend",
      "Situative Ergebnisse, z. B. Beschaffung oder agile Entwicklung",
      phase.deliverables.filter((d) => d.requirement === "situativ"),
    ],
  ];
  return (
    <section className={s.card} aria-label={`Lieferergebnisse ${phase.label}`}>
      <div>
        <Subtitle1 as="h2">Lieferergebnisse: {phase.label}</Subtitle1>
        <Caption1 block className={s.muted}>
          {phase.description}
        </Caption1>
      </div>
      {groups.map(([title, sub, list]) =>
        list.length ? (
          <div key={title} className={s.group}>
            <Subtitle2 as="h3">
              {title}{" "}
              <Caption1 className={s.muted}>
                · {sub} · {list.filter((d) => d.status === "done").length} von{" "}
                {list.filter((d) => d.status !== "na").length} freigegeben
              </Caption1>
            </Subtitle2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {list.map((d) => (
                <DeliverableRow key={d.id} code={code} d={d} onOpen={onOpen} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </section>
  );
}
