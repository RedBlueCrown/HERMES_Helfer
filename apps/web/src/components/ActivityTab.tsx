import {
  Body1,
  Button,
  Caption1,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
  Subtitle1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ShieldCheckmark20Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { commands, useEvents, useProjectCommand } from "../api/hooks";
import type { ProjectView, VerifyResult } from "../api/types";
import { ErrorView, errorText, formatDate } from "./ui";

const CATEGORIES: [string, string][] = [
  ["", "Alle Ereignisse"],
  ["entscheid", "Entscheide"],
  ["entwurf", "Entwürfe"],
  ["freigabe", "Freigaben und Bestätigungen"],
  ["beteiligung", "Beteiligung"],
  ["rollen", "Rollen"],
  ["vorhaben", "Vorhaben"],
  ["aenderung", "Change Requests"],
];
const CHANNEL: Record<string, string> = { web: "Web", chat: "Assistent", agent: "Agent", system: "System" };

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  head: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
    alignItems: "end",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  item: {
    display: "grid",
    gridTemplateColumns: "150px minmax(0, 1fr)",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  tools: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
});

export function ActivityTab({ code, view }: { code: string; view: ProjectView }) {
  const s = useStyles();
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(50);
  const events = useEvents(code, category, limit);
  const verify = useProjectCommand(code, commands.verify(code));
  const result = verify.data as VerifyResult | undefined;

  return (
    <section className={s.card} aria-label="Verlauf">
      <div className={s.head}>
        <div>
          <Subtitle1 as="h2">Verlauf</Subtitle1>
          <Caption1 block className={s.muted}>
            Die Projektakte: jede Änderung als unveränderbares Ereignis, mit Person, Rolle und Kanal.
          </Caption1>
        </div>
        <div className={s.tools}>
          <Dropdown
            aria-label="Art der Ereignisse"
            value={CATEGORIES.find(([k]) => k === category)?.[1] ?? ""}
            selectedOptions={[category]}
            onOptionSelect={(_, d) => {
              setCategory(d.optionValue ?? "");
              setLimit(50);
            }}
          >
            {CATEGORIES.map(([k, l]) => (
              <Option key={k} value={k}>
                {l}
              </Option>
            ))}
          </Dropdown>
          {view.can.verifyAudit ? (
            <Button
              icon={<ShieldCheckmark20Regular />}
              disabled={verify.isPending}
              onClick={() => verify.mutate(undefined)}
            >
              Integrität prüfen
            </Button>
          ) : null}
        </div>
      </div>
      {verify.isError ? (
        <MessageBar intent="error">
          <MessageBarBody>{errorText(verify.error)}</MessageBarBody>
        </MessageBar>
      ) : null}
      {result ? (
        <MessageBar intent={result.ok ? "success" : "error"}>
          <MessageBarBody>
            <MessageBarTitle>{result.ok ? "Projektakte unverändert" : "Integrität verletzt"}</MessageBarTitle>
            {result.ok
              ? `${result.checked} Ereignisse geprüft: Die Hash-Kette ist vollständig.`
              : `Beim Ereignis ${result.brokenAtSeq}: ${result.reason}. Bitte Informationssicherheit informieren.`}
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {events.isError ? <ErrorView error={events.error} /> : null}
      {events.isPending ? <Spinner label="Verlauf wird geladen …" /> : null}
      <ul className={s.list}>
        {(events.data?.items ?? []).map((e) => (
          <li key={e.seq} className={s.item}>
            <Caption1 className={s.muted}>
              {formatDate(e.at)}
              <br />#{e.seq}
            </Caption1>
            <div>
              <Body1 block>{e.text}</Body1>
              <Caption1 className={s.muted}>
                {e.actor.displayName}
                {e.actor.roles.length ? ` (${e.actor.roles.join(", ")})` : ""} ·{" "}
                {CHANNEL[e.actor.channel] ?? e.actor.channel}
              </Caption1>
            </div>
          </li>
        ))}
      </ul>
      {events.data?.hasMore ? (
        <div>
          <Button disabled={events.isFetching} onClick={() => setLimit((l) => Math.min(200, l + 50))}>
            Ältere Ereignisse laden
          </Button>
        </div>
      ) : null}
    </section>
  );
}
