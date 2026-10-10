import {
  Badge,
  Body1,
  Button,
  Caption1,
  Checkbox,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  SpinButton,
  Subtitle1,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkCircle16Filled, Delete16Regular } from "@fluentui/react-icons";
import {
  INVOLVEMENT_OPTIONS,
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  type Level,
  type ProjectProfile,
  type ProjectRole,
} from "@hermes-helfer/core";
import { useState } from "react";
import { useApi, projectPath, useProjectCommand } from "../api/hooks";
import type { ParticipantView, PhaseView, ProjectView } from "../api/types";
import { errorText, formatDate, useNotify } from "./ui";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
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
  muted: { color: tokens.colorNeutralForeground3 },
  inline: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: tokens.spacingHorizontalM,
  },
  form: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 220px auto",
    gap: tokens.spacingHorizontalS,
    alignItems: "end",
  },
});

function InvolveCell({ code, phase, p }: { code: string; phase: PhaseView; p: ParticipantView }) {
  const s = useStyles();
  const notify = useNotify();
  const [how, setHow] = useState(INVOLVEMENT_OPTIONS[0]!);
  const record = useProjectCommand(code, (api) =>
    api.post(`${projectPath(code)}/participation`, { phase: phase.id, participantId: p.id, how }),
  );
  if (p.involved) {
    return (
      <span className={s.inline}>
        <CheckmarkCircle16Filled color={tokens.colorPaletteGreenForeground1} />
        <Caption1>{p.at ? `${p.how}, ${formatDate(p.at)}` : "einbezogen"}</Caption1>
      </span>
    );
  }
  if (!p.canRecord) return <Caption1 className={s.muted}>offen</Caption1>;
  return (
    <span className={s.inline}>
      <Dropdown
        aria-label="Wie einbezogen"
        size="small"
        value={how}
        selectedOptions={[how]}
        onOptionSelect={(_, d) => setHow(d.optionValue ?? how)}
      >
        {INVOLVEMENT_OPTIONS.map((o) => (
          <Option key={o} value={o}>
            {o}
          </Option>
        ))}
      </Dropdown>
      <Button
        size="small"
        disabled={record.isPending}
        onClick={() =>
          record.mutate(undefined, {
            onSuccess: () => notify("success", "Beteiligung erfasst", p.label),
            onError: (e) => notify("error", "Nicht möglich", errorText(e)),
          })
        }
      >
        Einbezogen
      </Button>
    </span>
  );
}

function ProfileCard({ code, view }: { code: string; view: ProjectView }) {
  const s = useStyles();
  const notify = useNotify();
  const [p, setP] = useState<ProjectProfile>(view.profile);
  const editable = view.canEditProfile.ok;
  const save = useProjectCommand(code, (api) => api.put(`${projectPath(code)}/profile`, { profile: p }));
  const levels: Level[] = ["niedrig", "mittel", "hoch"];
  const flag = (k: keyof ProjectProfile, label: string) => (
    <Checkbox
      label={label}
      checked={p[k] as boolean}
      disabled={!editable}
      onChange={(_, d) => setP((x) => ({ ...x, [k]: !!d.checked }))}
    />
  );
  const level = (k: "schutzbedarf" | "verfuegbarkeit", label: string) => (
    <Field label={label}>
      <Dropdown
        value={p[k]}
        selectedOptions={[p[k]]}
        disabled={!editable}
        onOptionSelect={(_, d) => setP((x) => ({ ...x, [k]: (d.optionValue as Level) ?? x[k] }))}
      >
        {levels.map((l) => (
          <Option key={l} value={l}>
            {l}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
  return (
    <section className={s.card} aria-label="Vorhabensprofil">
      <div>
        <Subtitle1 as="h2">Vorhabensprofil</Subtitle1>
        <Caption1 block className={s.muted}>
          Bestimmt, wer in welcher Phase einbezogen werden muss.
        </Caption1>
      </div>
      <div className={s.grid}>
        {level("schutzbedarf", "Schutzbedarf")}
        {level("verfuegbarkeit", "Verfügbarkeit")}
        <Field label="Schnittstellen">
          <SpinButton
            value={p.schnittstellen}
            min={0}
            max={50}
            disabled={!editable}
            onChange={(_, d) =>
              setP((x) => ({
                ...x,
                schnittstellen: Math.max(0, Math.min(50, Number(d.value ?? d.displayValue ?? 0) || 0)),
              }))
            }
          />
        </Field>
      </div>
      <div className={s.grid}>
        {flag("personendaten", "Personendaten")}
        {flag("cloud", "Cloud-Nutzung")}
        {flag("lieferant", "Externer Lieferant")}
        {flag("neueTechnologie", "Neue Technologie")}
        {flag("externeNutzende", "Portal für externe Nutzende")}
      </div>
      {editable ? (
        <div>
          <Button
            appearance="primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () =>
                  notify("success", "Profil gespeichert", "Die nötige Beteiligung wurde neu bestimmt."),
                onError: (e) => notify("error", "Nicht möglich", errorText(e)),
              })
            }
          >
            Profil speichern
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function MembersCard({ code, view }: { code: string; view: ProjectView }) {
  const s = useStyles();
  const notify = useNotify();
  const api = useApi();
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ProjectRole>("FACH");
  const add = useProjectCommand(code, () =>
    api.post(`${projectPath(code)}/members`, { userId: userId.trim(), displayName: name.trim(), role }),
  );
  const remove = useProjectCommand(code, (a, v: { userId: string; role: ProjectRole }) =>
    a.del(`${projectPath(code)}/members/${encodeURIComponent(v.userId)}/roles/${v.role}`),
  );
  const manage = view.can.manageMembers;
  return (
    <section className={s.card} aria-label="Rollen im Vorhaben">
      <div>
        <Subtitle1 as="h2">Rollen im Vorhaben</Subtitle1>
        <Caption1 block className={s.muted}>
          Rollen vergibt die Projektleitung oder das PMO. Jede Änderung steht im Verlauf.
        </Caption1>
      </div>
      <Table size="small" aria-label="Mitglieder">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Person</TableHeaderCell>
            <TableHeaderCell>Rollen</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.members.map((m) => (
            <TableRow key={m.userId}>
              <TableCell>{m.displayName}</TableCell>
              <TableCell>
                <span className={s.inline}>
                  {m.roles.map((r) => (
                    <Badge key={r} appearance="tint" color="brand">
                      {PROJECT_ROLE_LABELS[r]}
                      {manage ? (
                        <Button
                          size="small"
                          appearance="transparent"
                          aria-label={`Rolle ${PROJECT_ROLE_LABELS[r]} von ${m.displayName} entfernen`}
                          icon={<Delete16Regular />}
                          onClick={() =>
                            remove.mutate(
                              { userId: m.userId, role: r },
                              {
                                onSuccess: () => notify("success", "Rolle entfernt"),
                                onError: (e) => notify("error", "Nicht möglich", errorText(e)),
                              },
                            )
                          }
                        />
                      ) : null}
                    </Badge>
                  ))}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {manage ? (
        <>
          <MessageBar intent="info">
            <MessageBarBody>
              Pilot: Personen werden mit ihrer Entra-ID-Kennung erfasst. Eine Personensuche folgt
              (todo-later).
            </MessageBarBody>
          </MessageBar>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate(undefined, {
                onSuccess: () => {
                  setUserId("");
                  setName("");
                  notify("success", "Rolle vergeben");
                },
                onError: (err) => notify("error", "Nicht möglich", errorText(err)),
              });
            }}
          >
            <Field label="Kennung (Entra ID)">
              <Input value={userId} onChange={(_, d) => setUserId(d.value)} />
            </Field>
            <Field label="Name">
              <Input value={name} onChange={(_, d) => setName(d.value)} />
            </Field>
            <Field label="Rolle">
              <Dropdown
                value={PROJECT_ROLE_LABELS[role]}
                selectedOptions={[role]}
                onOptionSelect={(_, d) => setRole((d.optionValue as ProjectRole) ?? role)}
              >
                {PROJECT_ROLES.map((r) => (
                  <Option key={r} value={r}>
                    {PROJECT_ROLE_LABELS[r]}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Button type="submit" disabled={!userId.trim() || !name.trim() || add.isPending}>
              Rolle vergeben
            </Button>
          </form>
        </>
      ) : null}
    </section>
  );
}

export function ParticipationTab({
  code,
  view,
  phase,
}: {
  code: string;
  view: ProjectView;
  phase: PhaseView;
}) {
  const s = useStyles();
  return (
    <div className={s.stack}>
      <section className={s.card} aria-label={`Beteiligte ${phase.label}`}>
        <div>
          <Subtitle1 as="h2">Beteiligte: {phase.label}</Subtitle1>
          <Caption1 block className={s.muted}>
            Pflicht-Beteiligte müssen einbezogen sein, sonst bleibt das Gate zu. Welche Rollen Pflicht sind,
            ergibt sich aus dem Vorhabensprofil.
          </Caption1>
        </div>
        <Table size="small" aria-label="Beteiligte">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Wer</TableHeaderCell>
              <TableHeaderCell>Warum</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {phase.participants.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Body1 block>{p.label}</Body1>
                  <span className={s.inline}>
                    <Badge appearance="outline" color={p.required ? "brand" : "subtle"}>
                      {p.required ? "Pflicht" : "empfohlen"}
                    </Badge>
                    {p.triggers.map((t) => (
                      <Badge key={t} appearance="tint" color="informative">
                        {t}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell>
                  <Caption1>{p.why}</Caption1>
                  <Caption1 block className={s.muted}>
                    Verantwortlich: {p.ownerLabel}
                  </Caption1>
                </TableCell>
                <TableCell>
                  <InvolveCell code={code} phase={phase} p={p} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <ProfileCard key={view.lastSeq} code={code} view={view} />
      <MembersCard code={code} view={view} />
    </div>
  );
}
