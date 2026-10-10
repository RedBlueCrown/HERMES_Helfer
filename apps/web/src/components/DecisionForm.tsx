import {
  Button,
  Checkbox,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add16Regular, Delete16Regular } from "@fluentui/react-icons";
import {
  DUE_OPTIONS,
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  type Decision,
  type DueOption,
  type ProjectRole,
} from "@hermes-helfer/core";
import { useState } from "react";

export interface DecisionValues {
  role?: ProjectRole;
  decision: Decision;
  reason: string;
  konsent: boolean;
  conditions: { text: string; ownerRole: ProjectRole; due: DueOption }[];
}

export interface DecisionFormProps {
  /** Approver roles the viewer can decide as (skill decisions); omit for gates. */
  roles?: { role: ProjectRole; label: string; konsent: boolean }[];
  /** Committee decision for gates. */
  gateKonsent?: boolean;
  veto?: boolean;
  /** A reason even for a plain approval (change requests). */
  reasonRequired?: boolean;
  rejectLabel: string;
  submitting: boolean;
  error?: string;
  /** Called when the input changes, so the parent can clear a server error that no longer applies. */
  onEdit?(): void;
  onSubmit(values: DecisionValues): void;
  onCancel?(): void;
}

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 180px 180px auto",
    gap: tokens.spacingHorizontalS,
    alignItems: "end",
  },
  actions: { display: "flex", gap: tokens.spacingHorizontalS },
});

export function DecisionForm(p: DecisionFormProps) {
  const s = useStyles();
  const [role, setRole] = useState<ProjectRole | undefined>(p.roles?.[0]?.role);
  const [decision, setDecision] = useState<Decision>("freigegeben");
  const [reason, setReason] = useState("");
  const [konsent, setKonsent] = useState(false);
  const [conditions, setConditions] = useState([
    { text: "", ownerRole: "PL" as ProjectRole, due: DUE_OPTIONS[1]! },
  ]);

  const touch = () => p.onEdit?.();
  const roleDef = p.roles?.find((r) => r.role === role);
  const konsentRequired = p.roles ? !!roleDef?.konsent : !!p.gateKonsent;
  const reasonRequired = decision !== "freigegeben" || !!p.veto || !!p.reasonRequired;
  const setCondition = (i: number, patch: Partial<(typeof conditions)[number]>) => {
    touch();
    setConditions((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit({
          ...(role ? { role } : {}),
          decision,
          reason,
          konsent,
          conditions: decision === "mit Auflagen" ? conditions : [],
        });
      }}
    >
      {p.roles && p.roles.length > 1 ? (
        <Field label="Entscheidende Rolle">
          <Dropdown
            value={roleDef?.label ?? ""}
            selectedOptions={role ? [role] : []}
            onOptionSelect={(_, d) => setRole(d.optionValue as ProjectRole)}
          >
            {p.roles.map((r) => (
              <Option key={r.role} value={r.role}>
                {r.label}
              </Option>
            ))}
          </Dropdown>
        </Field>
      ) : null}
      <Field label="Entscheid">
        <RadioGroup value={decision} onChange={(_, d) => (touch(), setDecision(d.value as Decision))}>
          <Radio value="freigegeben" label="Freigeben" />
          <Radio value="mit Auflagen" label="Freigeben mit Auflagen" />
          <Radio value="zurückgewiesen" label={p.rejectLabel} />
        </RadioGroup>
      </Field>
      <Field
        label={reasonRequired ? "Begründung (Pflicht)" : "Begründung"}
        hint={
          p.veto
            ? "Diese Rolle hat ein Veto: Ein Entscheid braucht immer eine Begründung."
            : p.reasonRequired
              ? "Jeder Entscheid zu einem Change Request braucht eine Begründung. Sie steht im Projektverlauf."
              : "Wird im Projektverlauf festgehalten."
        }
      >
        <Textarea
          value={reason}
          onChange={(_, d) => (touch(), setReason(d.value))}
          resize="vertical"
          rows={3}
        />
      </Field>
      {decision === "mit Auflagen" ? (
        <Field label="Auflagen">
          {conditions.map((c, i) => (
            <div className={s.row} key={i}>
              <Input
                aria-label={`Auflage ${i + 1}`}
                placeholder="z. B. Restrisiken mit verantwortlicher Person ergänzen"
                value={c.text}
                onChange={(_, d) => setCondition(i, { text: d.value })}
              />
              <Dropdown
                aria-label="Verantwortlich"
                value={PROJECT_ROLE_LABELS[c.ownerRole]}
                selectedOptions={[c.ownerRole]}
                onOptionSelect={(_, d) => setCondition(i, { ownerRole: d.optionValue as ProjectRole })}
              >
                {PROJECT_ROLES.map((r) => (
                  <Option key={r} value={r}>
                    {PROJECT_ROLE_LABELS[r]}
                  </Option>
                ))}
              </Dropdown>
              <Dropdown
                aria-label="Frist"
                value={c.due}
                selectedOptions={[c.due]}
                onOptionSelect={(_, d) => setCondition(i, { due: (d.optionValue as DueOption) ?? c.due })}
              >
                {DUE_OPTIONS.map((x) => (
                  <Option key={x} value={x}>
                    {x}
                  </Option>
                ))}
              </Dropdown>
              <Button
                aria-label="Auflage entfernen"
                icon={<Delete16Regular />}
                appearance="subtle"
                disabled={conditions.length === 1}
                onClick={() => setConditions((l) => l.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          <div>
            <Button
              size="small"
              icon={<Add16Regular />}
              onClick={() =>
                setConditions((l) => [...l, { text: "", ownerRole: "PL", due: DUE_OPTIONS[1]! }])
              }
            >
              Auflage hinzufügen
            </Button>
          </div>
        </Field>
      ) : null}
      {konsentRequired && decision !== "zurückgewiesen" ? (
        <Checkbox
          checked={konsent}
          onChange={(_, d) => (touch(), setKonsent(!!d.checked))}
          label="Konsent festgestellt: Im Projektausschuss bestehen keine schwerwiegenden, begründeten Einwände."
        />
      ) : null}
      {p.error ? (
        <MessageBar intent="error">
          <MessageBarBody>{p.error}</MessageBarBody>
        </MessageBar>
      ) : null}
      <div className={s.actions}>
        <Button type="submit" appearance="primary" disabled={p.submitting}>
          Entscheid erfassen
        </Button>
        {p.onCancel ? <Button onClick={p.onCancel}>Abbrechen</Button> : null}
      </div>
    </form>
  );
}
