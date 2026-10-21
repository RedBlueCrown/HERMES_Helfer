import {
  Badge,
  Body1,
  Button,
  Caption1,
  Field,
  MessageBar,
  MessageBarBody,
  Spinner,
  Subtitle2,
  Textarea,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Sparkle16Regular } from "@fluentui/react-icons";
import { PASSAGE_KIND_LABELS, QUESTION_MAX, type KnowledgeAnswer } from "@hermes-helfer/core";
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/hooks";
import { errorText } from "../components/ui";

const SUGGESTIONS = [
  "Welche Lessons Learned gibt es zu externen Lieferanten?",
  "Was wurde zur Migration entschieden?",
  "Wer ist in welchem Vorhaben Projektleitung?",
];

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, maxWidth: "960px" },
  muted: { color: tokens.colorNeutralForeground3 },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  row: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "center" },
  answer: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  cite: { fontSize: tokens.fontSizeBase200, verticalAlign: "super", textDecorationLine: "none" },
  sources: {
    margin: 0,
    paddingLeft: 0,
    listStyleType: "none",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  source: {
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    paddingLeft: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  excerpt: { fontStyle: "italic", color: tokens.colorNeutralForeground2, overflowWrap: "anywhere" },
});

/** The answer's text, its [Q1] marks as links to the sources below. */
function AnswerText({ text }: { text: string }) {
  const s = useStyles();
  const parts = text.split(/(\[Q\d+\])/g);
  return (
    <Body1 className={s.answer}>
      {parts.map((part, i) => {
        const id = /^\[(Q\d+)\]$/.exec(part)?.[1];
        return id ? (
          <a key={i} href={`#quelle-${id}`} className={s.cite} aria-label={`Quelle ${id}`}>
            [{id}]
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </Body1>
  );
}

export function KnowledgePage() {
  const s = useStyles();
  const api = useApi();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<KnowledgeAnswer>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 3) return;
    setQuestion(text);
    setBusy(true);
    setError(undefined);
    try {
      setAnswer(await api.post<KnowledgeAnswer>("/api/knowledge/ask", { question: text }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.page}>
      <div>
        <Title2 as="h1">Wissen</Title2>
        <Caption1 block className={s.muted}>
          Fragen über alle Vorhaben, die du lesen darfst: freigegebene Ergebnisse, Protokolle, Risiken,
          Gate-Entscheide und Rollen. Der Wissen-Agent antwortet nur aus diesen Unterlagen und nennt die
          Quellen; vertrauliche Ergebnisse bleiben bei den Rollen, die sie lesen dürfen.
        </Caption1>
      </div>
      <form
        className={s.card}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <Field label="Deine Frage">
          <Textarea
            value={question}
            onChange={(_, d) => setQuestion(d.value)}
            maxLength={QUESTION_MAX}
            resize="vertical"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
        </Field>
        <div className={s.row}>
          <Button
            appearance="primary"
            type="submit"
            icon={<Sparkle16Regular />}
            disabled={busy || question.trim().length < 3}
          >
            Fragen
          </Button>
          {SUGGESTIONS.map((x) => (
            <Button key={x} size="small" appearance="secondary" disabled={busy} onClick={() => void ask(x)}>
              {x}
            </Button>
          ))}
        </div>
      </form>
      {busy ? <Spinner label="Der Wissen-Agent sucht in den Unterlagen …" /> : null}
      {error ? (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      {answer && !busy ? (
        <section className={s.card} aria-label="Antwort">
          <Subtitle2 as="h2">{answer.question}</Subtitle2>
          <AnswerText text={answer.answer} />
          <Caption1 className={s.muted}>
            Durchsucht: {answer.searched.projects} Vorhaben, {answer.searched.passages} Auszüge · Antwort des
            Wissen-Agenten ({answer.producer.model})
          </Caption1>
          {answer.sources.length ? (
            <>
              <Subtitle2 as="h3">Quellen</Subtitle2>
              <ol className={s.sources}>
                {answer.sources.map((x) => (
                  <li key={x.id} id={`quelle-${x.id}`} className={s.source}>
                    <div className={s.row}>
                      <Badge appearance="outline">{x.id}</Badge>
                      <Body1>
                        <strong>{x.projectCode}</strong> {x.projectName}
                      </Body1>
                      <Badge appearance="tint">{PASSAGE_KIND_LABELS[x.kind]}</Badge>
                    </div>
                    <Caption1>{x.title}</Caption1>
                    <Caption1 className={s.excerpt}>«{x.excerpt}»</Caption1>
                    <Caption1>
                      <Link to={`/vorhaben/${encodeURIComponent(x.projectCode)}`}>Vorhaben öffnen</Link>
                    </Caption1>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
