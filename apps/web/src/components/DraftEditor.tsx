import {
  Button,
  Field,
  MessageBar,
  MessageBarBody,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { DraftContent } from "@hermes-helfer/core";
import { useState } from "react";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  actions: { display: "flex", gap: tokens.spacingHorizontalS },
});

/** Structured editor: summary, one field per section, open points (one per line). */
export function DraftEditor(props: {
  initial: DraftContent;
  submitLabel: string;
  submitting: boolean;
  error?: string;
  onSubmit(draft: DraftContent): void;
  onCancel(): void;
}) {
  const s = useStyles();
  const [summary, setSummary] = useState(props.initial.summary);
  const [bodies, setBodies] = useState(props.initial.sections.map((x) => x.body));
  const [openPoints, setOpenPoints] = useState(props.initial.openPoints.join("\n"));
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit({
          summary,
          sections: props.initial.sections.map((x, i) => ({ heading: x.heading, body: bodies[i] ?? "" })),
          openPoints: openPoints
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        });
      }}
    >
      <Field label="Zusammenfassung" required>
        <Textarea value={summary} onChange={(_, d) => setSummary(d.value)} rows={3} resize="vertical" />
      </Field>
      {props.initial.sections.map((x, i) => (
        <Field key={x.heading} label={x.heading}>
          <Textarea
            value={bodies[i] ?? ""}
            onChange={(_, d) => setBodies((b) => b.map((v, j) => (j === i ? d.value : v)))}
            rows={4}
            resize="vertical"
          />
        </Field>
      ))}
      <Field label="Offene Punkte" hint="Ein Punkt pro Zeile">
        <Textarea value={openPoints} onChange={(_, d) => setOpenPoints(d.value)} rows={2} resize="vertical" />
      </Field>
      {props.error ? (
        <MessageBar intent="error">
          <MessageBarBody>{props.error}</MessageBarBody>
        </MessageBar>
      ) : null}
      <div className={s.actions}>
        <Button type="submit" appearance="primary" disabled={props.submitting || !summary.trim()}>
          {props.submitLabel}
        </Button>
        <Button onClick={props.onCancel}>Abbrechen</Button>
      </div>
    </form>
  );
}
