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
  Option,
  OverlayDrawer,
  Spinner,
  Subtitle1,
  Subtitle2,
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
} from "@fluentui/react-components";
import { Add16Regular, Delete16Regular, Dismiss24Regular, Sparkle16Regular } from "@fluentui/react-icons";
import {
  MINUTES_ITEM_MAX,
  MINUTES_TEXT_MAX,
  MIN_TITLE,
  formatDay,
  type MinutesProposal,
  type MinutesView,
  type ProjectView,
} from "@hermes-helfer/core";
import { useState } from "react";
import { projectPath, useApi, useMinutes, useProjectCommand } from "../api/hooks";
import { ErrorView, FindingsBox, errorText, useNotify } from "./ui";

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
  muted: { color: tokens.colorNeutralForeground3 },
  minutes: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingTop: tokens.spacingVerticalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  meta: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "center" },
  list: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  quote: { color: tokens.colorNeutralForeground3, fontStyle: "italic" },
  done: { color: tokens.colorNeutralForeground3, textDecorationLine: "line-through" },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalXXL,
  },
  pair: { display: "flex", gap: tokens.spacingHorizontalL, flexWrap: "wrap" },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  item: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  chosen: { outline: `2px solid ${tokens.colorBrandStroke1}`, outlineOffset: "-1px" },
  grow: { flexGrow: 1, minWidth: "200px" },
});

function AgentNote({ m }: { m: MinutesView }) {
  if (m.producer.kind !== "ai") return null;
  return (
    <Badge appearance="tint" color="informative" icon={<Sparkle16Regular />}>
      {m.producer.edited ? "Vorschlag des Protokoll-Agenten, bearbeitet" : "Vorschlag des Protokoll-Agenten"}
    </Badge>
  );
}

function Quote({ text }: { text?: string | undefined }) {
  const s = useStyles();
  return text ? (
    <Caption1 block className={s.quote}>
      «{text}»
    </Caption1>
  ) : null;
}

function MinutesEntry({ code, m }: { code: string; m: MinutesView }) {
  const s = useStyles();
  const notify = useNotify();
  const done = useProjectCommand(code, (api, actionId: string) =>
    api.post(`${projectPath(code)}/minutes/${m.id}/actions/${actionId}/done`, { note: "" }),
  );
  return (
    <article className={s.minutes} aria-label={`${m.label} ${m.title}`} data-minutes={m.label}>
      <div className={s.meta}>
        <Subtitle2 as="h3">
          {m.label} {m.title}
        </Subtitle2>
        <Caption1 className={s.muted}>
          Besprechung vom {formatDay(m.heldOn)}, erfasst von {m.recordedBy.displayName}
        </Caption1>
        <AgentNote m={m} />
      </div>
      {m.decisions.length ? (
        <section className={s.section} aria-label="Entscheide">
          <Body1>
            <strong>Entscheide</strong>
          </Body1>
          <ul className={s.list}>
            {m.decisions.map((d) => (
              <li key={d.id}>
                <Body1>{d.text}</Body1>
                <Quote text={d.quote} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {m.actions.length ? (
        <Table aria-label={`Pendenzen aus ${m.label}`} size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Pendenz</TableHeaderCell>
              <TableHeaderCell>Verantwortlich</TableHeaderCell>
              <TableHeaderCell>Termin</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.actions.map((a) => (
              <TableRow key={a.id} data-action={a.text}>
                <TableCell>
                  <Body1 className={mergeClasses(a.done && s.done)}>{a.text}</Body1>
                  <Quote text={a.quote} />
                </TableCell>
                <TableCell>{a.ownerName ?? <span className={s.muted}>nicht zugewiesen</span>}</TableCell>
                <TableCell>
                  {a.due ? formatDay(a.due) : <span className={s.muted}>ohne</span>}
                  {a.overdue ? (
                    <Badge color="danger" appearance="tint" size="small">
                      überfällig
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  {a.done ? (
                    <Badge color="success" appearance="tint">
                      erledigt
                    </Badge>
                  ) : a.canComplete.ok ? (
                    <Button
                      size="small"
                      disabled={done.isPending}
                      onClick={() =>
                        done.mutate(a.id, {
                          onSuccess: () => notify("success", "Pendenz erledigt", a.text),
                          onError: (err) => notify("error", "Nicht gespeichert", errorText(err)),
                        })
                      }
                    >
                      Erledigt
                    </Button>
                  ) : (
                    <Badge appearance="outline">offen</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {m.questions.length ? (
        <section className={s.section} aria-label="Offene Fragen">
          <Body1>
            <strong>Offene Fragen</strong>
          </Body1>
          <ul className={s.list}>
            {m.questions.map((q) => (
              <li key={q.id}>
                <Body1>{q.text}</Body1>
                <Quote text={q.quote} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

export function MinutesTab({ code, onNew }: { code: string; onNew(): void }) {
  const s = useStyles();
  const q = useMinutes(code);
  if (q.isError) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Spinner label="Protokolle werden geladen …" />;
  const r = q.data;
  return (
    <section className={s.card} aria-label="Protokolle">
      <div className={s.head}>
        <div>
          <Subtitle1 as="h2">Protokolle</Subtitle1>
          <Caption1 block className={s.muted}>
            Entscheide, Pendenzen und offene Fragen aus Besprechungen. Offene Pendenzen erscheinen bei der
            verantwortlichen Person unter «Meine Aufgaben». {r.counts.openActions} offene Pendenzen
            {r.counts.overdue ? `, davon ${r.counts.overdue} überfällig` : ""}.
          </Caption1>
        </div>
        <div className={s.actions}>
          {r.canRecord.ok ? (
            <Button appearance="primary" onClick={onNew}>
              Protokoll erfassen
            </Button>
          ) : (
            <Caption1 className={s.muted}>{r.canRecord.reason}</Caption1>
          )}
        </div>
      </div>
      {r.items.length === 0 ? <Body1>Noch keine Protokolle erfasst.</Body1> : null}
      {r.items.map((m) => (
        <MinutesEntry key={m.id} code={code} m={m} />
      ))}
    </section>
  );
}

// ---------- New minutes ----------

interface ItemDraft {
  key: number;
  text: string;
  /** The passage of the notes, for items the agent proposed. */
  quote?: string;
  /** Index of the agent's item in the proposal. */
  source?: number;
  selected: boolean;
}

interface ActionDraft extends ItemDraft {
  /** A member, "" for nobody, or OTHER for someone outside the project. */
  owner: string;
  ownerName: string;
  due: string;
}

const OTHER = "__andere";
type Kind = "decisions" | "actions" | "questions";
const KINDS: { kind: Kind; title: string; item: string; empty: string }[] = [
  { kind: "decisions", title: "Entscheide", item: "Entscheid", empty: "Keine Entscheide." },
  { kind: "actions", title: "Pendenzen", item: "Pendenz", empty: "Keine Pendenzen." },
  { kind: "questions", title: "Offene Fragen", item: "Frage", empty: "Keine offenen Fragen." },
];

let nextKey = 0;
const today = () => new Date().toISOString().slice(0, 10);

export function NewMinutesDrawer({
  code,
  view,
  open,
  onClose,
}: {
  code: string;
  view: ProjectView;
  open: boolean;
  onClose(): void;
}) {
  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, v) => (!v.open ? onClose() : undefined)}
      position="end"
      size="large"
    >
      {open ? <NewMinutesForm code={code} view={view} onClose={onClose} /> : null}
    </OverlayDrawer>
  );
}

function NewMinutesForm({ code, view, onClose }: { code: string; view: ProjectView; onClose(): void }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const [title, setTitle] = useState("Projektsitzung");
  const [heldOn, setHeldOn] = useState(today());
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<"notes" | "review">("notes");
  const [proposal, setProposal] = useState<MinutesProposal>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [items, setItems] = useState<{
    decisions: ItemDraft[];
    actions: ActionDraft[];
    questions: ItemDraft[];
  }>({
    decisions: [],
    actions: [],
    questions: [],
  });

  const extract = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const p = await api.post<MinutesProposal>(`${projectPath(code)}/minutes/extract`, {
        title,
        heldOn,
        text: notes,
      });
      setProposal(p);
      const base = (x: { text: string; quote: string }, source: number) => ({
        key: nextKey++,
        text: x.text,
        quote: x.quote,
        source,
        selected: true,
      });
      setItems({
        decisions: p.decisions.map(base),
        questions: p.questions.map(base),
        actions: p.actions.map((a, i) => ({
          ...base(a, i),
          owner: a.ownerId ?? (a.ownerName ? OTHER : ""),
          ownerName: a.ownerId ? "" : a.ownerName,
          due: a.due ?? "",
        })),
      });
      setStep("review");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = useProjectCommand(code, () => {
    const chosen = <T extends ItemDraft>(list: T[]) => list.filter((x) => x.selected && x.text.trim());
    const ref = (x: ItemDraft) => ({ text: x.text, ...(x.source !== undefined ? { source: x.source } : {}) });
    return api.post(`${projectPath(code)}/minutes`, {
      title,
      heldOn,
      ...(proposal ? { proposalId: proposal.proposalId } : {}),
      decisions: chosen(items.decisions).map(ref),
      questions: chosen(items.questions).map(ref),
      actions: chosen(items.actions).map((a) => ({
        ...ref(a),
        ...(a.owner && a.owner !== OTHER ? { ownerId: a.owner } : {}),
        ...(a.owner === OTHER && a.ownerName.trim() ? { ownerName: a.ownerName.trim() } : {}),
        due: a.due,
      })),
    });
  });

  const edit = (kind: Kind, key: number, patch: Partial<ActionDraft>) =>
    setItems((all) => ({ ...all, [kind]: all[kind].map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const add = (kind: Kind) =>
    setItems((all) => ({
      ...all,
      [kind]: [
        ...all[kind],
        kind === "actions"
          ? { key: nextKey++, text: "", selected: true, owner: "", ownerName: "", due: "" }
          : { key: nextKey++, text: "", selected: true },
      ],
    }));
  const remove = (kind: Kind, key: number) =>
    setItems((all) => ({ ...all, [kind]: all[kind].filter((x) => x.key !== key) }));
  const count = (["decisions", "actions", "questions"] as const).reduce(
    (n, k) => n + items[k].filter((x) => x.selected && x.text.trim()).length,
    0,
  );
  const ownerLabel = (a: ActionDraft) =>
    a.owner === OTHER
      ? "Andere Person oder Stelle"
      : (view.members.find((m) => m.userId === a.owner)?.displayName ?? "Niemand zugewiesen");

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
          Protokoll erfassen
        </DrawerHeaderTitle>
        <Caption1 className={s.muted}>
          {step === "notes"
            ? "Füge die Notizen oder das Transkript ein. Der Protokoll-Agent schlägt Entscheide, Pendenzen und offene Fragen vor, jeden mit der Stelle im Text. Gespeichert wird nur, was du übernimmst; der Text selbst wird nicht gespeichert."
            : "Prüfe die Vorschläge: Übernommen wird, was angekreuzt ist. Ergänze Verantwortliche und Termine, wo sie fehlen."}
        </Caption1>
      </DrawerHeader>
      <DrawerBody>
        <div className={s.body}>
          <div className={s.pair}>
            <Field label="Besprechung" required className={s.grow}>
              <Input value={title} onChange={(_, d) => setTitle(d.value)} maxLength={200} />
            </Field>
            <Field label="Datum" required>
              <Input type="date" value={heldOn} onChange={(_, d) => setHeldOn(d.value)} />
            </Field>
          </div>
          {step === "notes" ? (
            <Field
              label="Notizen oder Transkript"
              hint={`${notes.length.toLocaleString("de-CH")} von ${MINUTES_TEXT_MAX.toLocaleString("de-CH")} Zeichen. Ohne KI-Modell erkennt der Agent nur Zeilen, die mit «Entscheid:», «Pendenz:» oder «Frage:» beginnen.`}
            >
              <Textarea
                value={notes}
                onChange={(_, d) => setNotes(d.value)}
                rows={14}
                resize="vertical"
                maxLength={MINUTES_TEXT_MAX}
              />
            </Field>
          ) : (
            <>
              {proposal ? <FindingsBox findings={proposal.findings} /> : null}
              {KINDS.map(({ kind, title: heading, item, empty }) => (
                <section key={kind} className={s.section} aria-label={heading}>
                  <Subtitle2 as="h3">{heading}</Subtitle2>
                  {items[kind].length === 0 ? <Caption1 className={s.muted}>{empty}</Caption1> : null}
                  {items[kind].map((x) => (
                    <div key={x.key} className={mergeClasses(s.item, x.selected && s.chosen)}>
                      <div className={s.meta}>
                        <Checkbox
                          label="Übernehmen"
                          checked={x.selected}
                          onChange={(_, d) => edit(kind, x.key, { selected: !!d.checked })}
                        />
                        {x.source === undefined ? (
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<Delete16Regular />}
                            onClick={() => remove(kind, x.key)}
                          >
                            Entfernen
                          </Button>
                        ) : null}
                      </div>
                      <Field label={item}>
                        <Input
                          value={x.text}
                          maxLength={MINUTES_ITEM_MAX}
                          onChange={(_, d) => edit(kind, x.key, { text: d.value })}
                        />
                      </Field>
                      <Quote text={x.quote} />
                      {kind === "actions" ? (
                        <div className={s.pair}>
                          <Field label="Verantwortlich" className={s.grow}>
                            <Dropdown
                              value={ownerLabel(x as ActionDraft)}
                              selectedOptions={[(x as ActionDraft).owner]}
                              onOptionSelect={(_, d) => edit(kind, x.key, { owner: d.optionValue ?? "" })}
                            >
                              <Option value="">Niemand zugewiesen</Option>
                              {view.members.map((m) => (
                                <Option key={m.userId} value={m.userId}>
                                  {m.displayName}
                                </Option>
                              ))}
                              <Option value={OTHER}>Andere Person oder Stelle</Option>
                            </Dropdown>
                          </Field>
                          {(x as ActionDraft).owner === OTHER ? (
                            <Field label="Name" className={s.grow}>
                              <Input
                                value={(x as ActionDraft).ownerName}
                                maxLength={120}
                                onChange={(_, d) => edit(kind, x.key, { ownerName: d.value })}
                              />
                            </Field>
                          ) : null}
                          <Field label="Termin">
                            <Input
                              type="date"
                              value={(x as ActionDraft).due}
                              onChange={(_, d) => edit(kind, x.key, { due: d.value })}
                            />
                          </Field>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  <div>
                    <Button size="small" icon={<Add16Regular />} onClick={() => add(kind)}>
                      {item} hinzufügen
                    </Button>
                  </div>
                </section>
              ))}
            </>
          )}
          {error ? (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          ) : null}
          {busy ? <Spinner label="Der Protokoll-Agent liest die Notizen …" /> : null}
        </div>
      </DrawerBody>
      <DrawerFooter>
        {step === "notes" ? (
          <>
            <Button
              appearance="primary"
              icon={<Sparkle16Regular />}
              disabled={busy || notes.trim().length < 20 || title.trim().length < MIN_TITLE}
              onClick={() => void extract()}
            >
              Mit dem Agenten auswerten
            </Button>
            <Button disabled={busy} onClick={() => setStep("review")}>
              Ohne Agent erfassen
            </Button>
          </>
        ) : (
          <>
            <Button
              appearance="primary"
              disabled={save.isPending || count === 0 || title.trim().length < MIN_TITLE}
              onClick={() => {
                setError(undefined);
                save.mutate(undefined, {
                  onSuccess: () => {
                    notify("success", "Protokoll erfasst", `${title}: ${count} Einträge`);
                    onClose();
                  },
                  onError: (err) => setError(errorText(err)),
                });
              }}
            >
              Protokoll übernehmen ({count})
            </Button>
            <Button onClick={() => setStep("notes")}>Zurück zu den Notizen</Button>
          </>
        )}
        <Button onClick={onClose}>Abbrechen</Button>
      </DrawerFooter>
    </>
  );
}
