import {
  Badge,
  Body1,
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Toast,
  ToastBody,
  ToastTitle,
  Toaster,
  makeStyles,
  tokens,
  useId,
  useToastController,
  type BadgeProps,
} from "@fluentui/react-components";
import {
  CheckmarkCircle16Filled,
  Circle16Regular,
  Clock16Regular,
  ErrorCircle16Filled,
  LockClosed16Regular,
  Sparkle16Regular,
  SubtractCircle16Regular,
  Warning16Filled,
} from "@fluentui/react-icons";
import {
  PROJECT_ROLE_LABELS,
  SIGNALS,
  type ConditionView,
  type DeliverableStatus,
  type GateStatus,
  type ProjectListItem,
  type SignalId,
  type SignalLevel,
} from "@hermes-helfer/core";
import { createContext, Fragment, useCallback, useContext, type ReactElement, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { ApiError } from "../api/client";

// ---------- Status badges ----------

const DELIVERABLE_BADGE: Record<DeliverableStatus, { color: BadgeProps["color"]; icon: ReactElement }> = {
  done: { color: "success", icon: <CheckmarkCircle16Filled /> },
  draft: { color: "brand", icon: <Sparkle16Regular /> },
  approval: { color: "warning", icon: <Clock16Regular /> },
  veto: { color: "danger", icon: <ErrorCircle16Filled /> },
  confirm: { color: "warning", icon: <Clock16Regular /> },
  running: { color: "informative", icon: <Spinner size="extra-tiny" /> },
  open: { color: "informative", icon: <Circle16Regular /> },
  planned: { color: "subtle", icon: <Circle16Regular /> },
  na: { color: "subtle", icon: <SubtractCircle16Regular /> },
};

export function DeliverableBadge({ status, label }: { status: DeliverableStatus; label: string }) {
  const b = DELIVERABLE_BADGE[status];
  return (
    <Badge appearance="tint" color={b.color} icon={b.icon} data-status={status}>
      {label}
    </Badge>
  );
}

const GATE_COLOR: Record<GateStatus, BadgeProps["color"]> = {
  passed: "success",
  historic: "success",
  ready: "brand",
  blocked: "danger",
  open: "warning",
  preview: "subtle",
};

export function GateBadge({ status, label }: { status: GateStatus; label: string }) {
  return (
    <Badge appearance="tint" color={GATE_COLOR[status]}>
      {label}
    </Badge>
  );
}

const SIGNAL_COLOR: Record<SignalLevel, BadgeProps["color"]> = {
  hoch: "danger",
  mittel: "warning",
  info: "informative",
};

/** Why a project needs attention; the tooltip names the details. */
export function SignalBadge({ id, item }: { id: SignalId; item?: ProjectListItem }) {
  const sig = SIGNALS[id];
  let detail = sig.description;
  if (item && id === "rollen-fehlen") {
    detail = `Fehlt: ${item.missingRoles.map((r) => PROJECT_ROLE_LABELS[r]).join(", ")}`;
  } else if (item && id === "auflagen-ueberfaellig") {
    detail = `${item.overdueConditions} von ${item.openConditions} offenen Auflagen überfällig`;
  } else if (item && id === "gate-bereit") {
    detail = `Gate «${item.gateName}» wartet auf den Entscheid.`;
  }
  return (
    <Badge appearance="tint" color={SIGNAL_COLOR[sig.level]} title={detail} data-signal={id}>
      {sig.label}
    </Badge>
  );
}

/** When an Auflage is due, in words. */
export function conditionDueText(c: ConditionView): string {
  if (c.dueAt) return `bis ${formatDay(c.dueAt)}`;
  if (c.dueGate) return `bis Gate «${c.dueGate}»`;
  return c.due;
}

const useBadgeStyles = makeStyles({ overdue: { marginLeft: tokens.spacingHorizontalXS } });

export function OverdueBadge() {
  const s = useBadgeStyles();
  return (
    <Badge appearance="filled" color="danger" size="small" className={s.overdue}>
      überfällig
    </Badge>
  );
}

export function RestrictedBadge() {
  return (
    <Badge appearance="outline" color="subtle" icon={<LockClosed16Regular />}>
      vertraulich
    </Badge>
  );
}

export function WarningIcon() {
  return <Warning16Filled color={tokens.colorPaletteDarkOrangeForeground1} />;
}

// ---------- Safe text ----------

const useTextStyles = makeStyles({
  p: { margin: `0 0 ${tokens.spacingVerticalS} 0`, whiteSpace: "pre-wrap" },
  ul: { margin: `0 0 ${tokens.spacingVerticalS} 0`, paddingLeft: tokens.spacingHorizontalXL },
});

function inline(text: string): ReactNode[] {
  // **bold** only. React escapes everything else: model output is never rendered as HTML.
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

export function RichText({ text }: { text: string }) {
  const s = useTextStyles();
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul className={s.ul} key={`l${blocks.length}`}>
        {list.map((l, i) => (
          <li key={i}>{inline(l)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const line of text.split("\n")) {
    if (/^\s*[-•]\s+/.test(line)) list.push(line.replace(/^\s*[-•]\s+/, ""));
    else {
      flush();
      if (line.trim())
        blocks.push(
          <p className={s.p} key={`p${blocks.length}`}>
            {inline(line)}
          </p>,
        );
    }
  }
  flush();
  return <>{blocks}</>;
}

// ---------- Errors ----------

/** Error page for a failed request (todo-later E01, E02, E04, E16). */
export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : undefined;
  let title = "Etwas ist schiefgelaufen";
  let body = error instanceof Error ? error.message : "Unerwarteter Fehler. Bitte später erneut versuchen.";
  let link: ReactNode = null;
  if (e?.code === "no_app_role") title = "Kein Zugriff auf den HERMES Helfer";
  else if (e?.status === 401) title = "Bitte anmelden";
  else if (e?.status === 404) {
    title = "Vorhaben nicht gefunden oder kein Zugriff";
    body =
      "Das Vorhaben gibt es nicht, oder du hast darin keine Rolle. Rollen vergibt die Projektleitung oder das PMO.";
    link = <RouterLink to="/">Zur Übersicht der Vorhaben</RouterLink>;
  } else if (e?.code === "offline") title = "Keine Verbindung";
  return (
    <MessageBar intent="error" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>{title}</MessageBarTitle>
        {body} {link}
        {e?.correlationId ? <Body1 block>Referenz für den Support: {e.correlationId}</Body1> : null}
        {onRetry ? (
          <div>
            <Button size="small" onClick={onRetry}>
              Erneut versuchen
            </Button>
          </div>
        ) : null}
      </MessageBarBody>
    </MessageBar>
  );
}

export const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : "Unerwarteter Fehler. Bitte später erneut versuchen.";

// ---------- Toasts ----------

type Intent = "success" | "error" | "info" | "warning";
const NotifyContext = createContext<(intent: Intent, title: string, body?: string) => void>(() => undefined);

export function NotifyProvider({ children }: { children: ReactNode }) {
  const toasterId = useId("toaster");
  const { dispatchToast } = useToastController(toasterId);
  const notify = useCallback(
    (intent: Intent, title: string, body?: string) =>
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
          {body ? <ToastBody>{body}</ToastBody> : null}
        </Toast>,
        { intent, timeout: intent === "error" ? 8000 : 4000 },
      ),
    [dispatchToast],
  );
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Toaster toasterId={toasterId} position="top-end" />
    </NotifyContext.Provider>
  );
}

export const useNotify = () => useContext(NotifyContext);

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
