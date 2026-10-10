import {
  Body1,
  Button,
  Caption1,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { PROJECT_ROLE_LABELS } from "@hermes-helfer/core";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { ProjectListItem } from "../api/types";
import { GateBadge, SignalBadge, formatDay } from "./ui";

const useStyles = makeStyles({
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
    ":hover": { textDecoration: "underline" },
  },
  name: { width: "22%" },
  signals: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS },
  footer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalM,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

export type ProjectColumn =
  "phase" | "gate" | "mandatory" | "decisions" | "signals" | "leads" | "myRoles" | "updated";

const HEADERS: Record<ProjectColumn, string> = {
  phase: "Phase",
  gate: "Gate",
  mandatory: "Pflichtergebnisse",
  decisions: "Offene Entscheide",
  signals: "Handlungsbedarf",
  leads: "Projektleitung",
  myRoles: "Meine Rollen",
  updated: "Letzte Änderung",
};

/**
 * Projects as a table; each name opens the project. The project page links
 * back to the list it came from, filters included (drill-down).
 */
export function ProjectTable({
  label,
  items,
  columns,
  empty,
  children,
}: {
  label: string;
  items: ProjectListItem[];
  columns: readonly ProjectColumn[];
  empty: string;
  /** Below the table, e.g. the pager. */
  children?: ReactNode;
}) {
  const s = useStyles();
  const location = useLocation();
  const from = location.pathname + location.search;
  const cell = (p: ProjectListItem, c: ProjectColumn): ReactNode => {
    switch (c) {
      case "phase":
        return p.phaseLabel;
      case "gate":
        return <GateBadge status={p.gateStatus} label={p.gateStatusLabel} />;
      case "mandatory":
        return `${p.mandatoryDone} / ${p.mandatoryTotal}`;
      case "decisions":
        return p.openDecisions || "–";
      case "signals":
        return p.signals.length ? (
          <span className={s.signals}>
            {p.signals.map((id) => (
              <SignalBadge key={id} id={id} item={p} />
            ))}
          </span>
        ) : (
          "–"
        );
      case "leads":
        return p.projectLeads.join(", ") || "–";
      case "myRoles":
        return p.myRoles.map((r) => PROJECT_ROLE_LABELS[r]).join(", ") || "–";
      case "updated":
        return formatDay(p.updatedAt);
    }
  };
  return (
    <div className={s.card}>
      <Table aria-label={label} size="medium">
        <TableHeader>
          <TableRow>
            <TableHeaderCell className={s.name}>Vorhaben</TableHeaderCell>
            {columns.map((c) => (
              <TableHeaderCell key={c}>{HEADERS[c]}</TableHeaderCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((p) => (
            <TableRow key={p.projectId} data-project={p.code}>
              <TableCell>
                <Link className={s.link} to={`/vorhaben/${encodeURIComponent(p.code)}`} state={{ from }}>
                  {p.name}
                </Link>
                <Caption1 block className={s.muted}>
                  {p.code}
                </Caption1>
              </TableCell>
              {columns.map((c) => (
                <TableCell key={c}>{cell(p, c)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {items.length === 0 ? (
        <Body1 block className={s.footer}>
          {empty}
        </Body1>
      ) : null}
      {children}
    </div>
  );
}

export function Pager({
  offset,
  size,
  total,
  busy,
  onChange,
}: {
  offset: number;
  size: number;
  total: number;
  busy: boolean;
  onChange: (offset: number) => void;
}) {
  const s = useStyles();
  if (total <= size) return null;
  return (
    <div className={s.footer}>
      <Button disabled={offset === 0 || busy} onClick={() => onChange(Math.max(0, offset - size))}>
        Zurück
      </Button>
      <Caption1 className={s.muted}>
        {offset + 1}–{Math.min(offset + size, total)} von {total}
      </Caption1>
      <Button disabled={offset + size >= total || busy} onClick={() => onChange(offset + size)}>
        Weiter
      </Button>
    </div>
  );
}
