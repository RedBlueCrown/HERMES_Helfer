import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
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
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi, useMe, useReference } from "../api/hooks";
import { errorText, useNotify } from "./ui";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: tokens.spacingHorizontalM },
});

/** The PMO creates a project; the project lead is the PMO person themselves or another person. */
export function NewProjectDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Dialog open={open} onOpenChange={(_, d) => (!d.open ? onClose() : undefined)} modalType="modal">
      <DialogSurface>{open ? <NewProjectForm onClose={onClose} /> : null}</DialogSurface>
    </Dialog>
  );
}

function NewProjectForm({ onClose }: { onClose(): void }) {
  const s = useStyles();
  const api = useApi();
  const me = useMe();
  const ref = useReference();
  const qc = useQueryClient();
  const notify = useNotify();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState("init");
  const [lead, setLead] = useState<"me" | "other">("me");
  const [leadId, setLeadId] = useState("");
  const [leadName, setLeadName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const projectLead =
    lead === "me" && me.data
      ? { userId: me.data.userId, displayName: me.data.displayName }
      : { userId: leadId.trim(), displayName: leadName.trim() };
  const valid =
    code.trim().length >= 2 &&
    name.trim().length >= 3 &&
    projectLead.userId.length > 0 &&
    projectLead.displayName.length > 0;

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.post<{ code: string }>("/api/projects", {
        code: code.trim(),
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        phase,
        projectLead,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["portfolio"] }),
      ]);
      notify("success", "Vorhaben angelegt", `${created.code} ${name.trim()}`);
      onClose();
      void navigate(`/vorhaben/${encodeURIComponent(created.code)}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <DialogBody>
        <DialogTitle>Neues Vorhaben</DialogTitle>
        <DialogContent className={s.form}>
          <div className={s.row}>
            <Field label="Kürzel" hint="2 bis 20 Zeichen, z. B. CRM-2" required>
              <Input value={code} onChange={(_, d) => setCode(d.value.toUpperCase())} maxLength={20} />
            </Field>
            <Field label="Startphase">
              <Dropdown
                value={ref.data?.phases.find((p) => p.id === phase)?.label ?? ""}
                selectedOptions={[phase]}
                onOptionSelect={(_, d) => setPhase(d.optionValue ?? "init")}
              >
                {(ref.data?.phases ?? []).map((p) => (
                  <Option key={p.id} value={p.id}>
                    {p.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>
          </div>
          <Field label="Name" required>
            <Input value={name} onChange={(_, d) => setName(d.value)} maxLength={120} />
          </Field>
          <Field label="Beschreibung">
            <Textarea value={description} onChange={(_, d) => setDescription(d.value)} rows={2} />
          </Field>
          <Field label="Projektleitung">
            <RadioGroup value={lead} onChange={(_, d) => setLead(d.value as "me" | "other")}>
              <Radio value="me" label={`Ich selbst (${me.data?.displayName ?? "…"})`} />
              <Radio value="other" label="Andere Person" />
            </RadioGroup>
          </Field>
          {lead === "other" ? (
            <div className={s.row}>
              <Field label="Kennung (Entra ID)" required>
                <Input value={leadId} onChange={(_, d) => setLeadId(d.value)} />
              </Field>
              <Field label="Name" required>
                <Input value={leadName} onChange={(_, d) => setLeadName(d.value)} />
              </Field>
            </div>
          ) : null}
          {error ? (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button appearance="primary" type="submit" disabled={!valid || busy}>
            Anlegen
          </Button>
          <Button onClick={onClose}>Abbrechen</Button>
        </DialogActions>
      </DialogBody>
    </form>
  );
}
