import { Body1, Button, Caption1, Subtitle2, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowRight16Regular } from "@fluentui/react-icons";
import { commands, projectPath, useProjectCommand } from "../api/hooks";
import type { ProjectView, TaskView } from "../api/types";
import { OverdueBadge, conditionDueText, errorText, useNotify } from "./ui";

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  next: { borderLeft: `4px solid ${tokens.colorBrandStroke1}` },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  task: {
    justifyContent: "flex-start",
    textAlign: "left",
    height: "auto",
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
  },
  taskText: { display: "flex", flexDirection: "column", alignItems: "flex-start" },
  muted: { color: tokens.colorNeutralForeground3 },
  condition: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
});

export interface Navigate {
  openDeliverable(id: string): void;
  openGate(): void;
  showTab(tab: "ergebnisse" | "beteiligung" | "verlauf"): void;
}

export function NextStepCard({ code, view, nav }: { code: string; view: ProjectView; nav: Navigate }) {
  const s = useStyles();
  const notify = useNotify();
  const start = useProjectCommand(code, commands.startSkill(code));
  const n = view.nextStep;
  const act = () => {
    if (n.kind === "run" && n.skillId) {
      start.mutate(n.skillId, {
        onSuccess: () => notify("info", "Entwurf angestossen"),
        onError: (e) => notify("error", "Nicht möglich", errorText(e)),
      });
    } else if (n.kind === "gate") nav.openGate();
    else if (n.kind === "involve") nav.showTab("beteiligung");
    else if (n.deliverableId) nav.openDeliverable(n.deliverableId);
  };
  return (
    <section className={`${s.card} ${s.next}`} aria-label="Als Nächstes">
      <Caption1 className={s.muted}>Als Nächstes</Caption1>
      <Subtitle2 as="h2">{n.title}</Subtitle2>
      <Caption1>{n.detail}</Caption1>
      {n.actionLabel && n.canAct ? (
        <div>
          <Button
            appearance="primary"
            icon={<ArrowRight16Regular />}
            iconPosition="after"
            disabled={start.isPending}
            onClick={act}
          >
            {n.actionLabel}
          </Button>
        </div>
      ) : n.actionLabel ? (
        <Caption1 className={s.muted}>Diesen Schritt führt eine andere Rolle aus.</Caption1>
      ) : null}
    </section>
  );
}

function taskAction(t: TaskView, nav: Navigate): (() => void) | undefined {
  switch (t.kind) {
    case "decide-skill":
    case "release":
    case "checklist":
      return t.deliverableId ? () => nav.openDeliverable(t.deliverableId!) : undefined;
    case "decide-gate":
      return () => nav.openGate();
    case "involve":
    case "assign-role":
      return () => nav.showTab("beteiligung");
    case "condition":
      return undefined;
  }
}

export function MyTasksCard({ view, nav }: { view: ProjectView; nav: Navigate }) {
  const s = useStyles();
  return (
    <section className={s.card} aria-label="Meine Aufgaben">
      <Subtitle2 as="h2">Meine Aufgaben</Subtitle2>
      {view.myTasks.length === 0 ? (
        <Caption1 className={s.muted}>Für dich ist gerade nichts offen.</Caption1>
      ) : (
        <ul className={s.list}>
          {view.myTasks.map((t, i) => {
            const act = taskAction(t, nav);
            const content = (
              <span className={s.taskText}>
                <Body1>{t.title}</Body1>
                <Caption1 className={s.muted}>{t.detail}</Caption1>
              </span>
            );
            return (
              <li key={i}>
                {act ? (
                  <Button appearance="subtle" className={s.task} onClick={act}>
                    {content}
                  </Button>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ConditionsCard({ code, view }: { code: string; view: ProjectView }) {
  const s = useStyles();
  const notify = useNotify();
  const complete = useProjectCommand(code, (api, id: string) =>
    api.post(`${projectPath(code)}/conditions/${id}/complete`, {}),
  );
  const open = view.conditions.filter((c) => !c.done);
  if (!open.length) return null;
  return (
    <section className={s.card} aria-label="Offene Auflagen">
      <Subtitle2 as="h2">Offene Auflagen</Subtitle2>
      {open.map((c) => (
        <div key={c.id} className={s.condition}>
          <span>
            <Body1 block>{c.text}</Body1>
            <Caption1 className={s.muted}>
              {c.ownerLabel} · {conditionDueText(c)} · {c.sourceLabel}
            </Caption1>
            {c.overdue ? <OverdueBadge /> : null}
          </span>
          {c.canComplete ? (
            <Button
              size="small"
              disabled={complete.isPending}
              onClick={() =>
                complete.mutate(c.id, {
                  onSuccess: () => notify("success", "Auflage erledigt"),
                  onError: (e) => notify("error", "Nicht möglich", errorText(e)),
                })
              }
            >
              Erledigt
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
