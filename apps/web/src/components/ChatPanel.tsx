import {
  Button,
  Caption1,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Spinner,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular, Send20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import { commands, useMe, useProjectCommand } from "../api/hooks";
import type { ChatAction, ChatReply } from "../api/types";
import { RichText, errorText, useNotify } from "./ui";

interface Message {
  role: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
}

const START = ["Was ist als Nächstes?", "Meine Aufgaben", "Wie steht das Gate?", "Welche Ergebnisse fehlen?"];
const MAX = 2000;

const useStyles = makeStyles({
  log: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
  },
  msg: { padding: tokens.spacingHorizontalM, borderRadius: tokens.borderRadiusLarge, maxWidth: "92%" },
  user: { alignSelf: "flex-end", backgroundColor: tokens.colorBrandBackground2 },
  bot: { alignSelf: "flex-start", backgroundColor: tokens.colorNeutralBackground3 },
  chips: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS },
  footer: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, width: "100%" },
  input: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "end" },
  grow: { flexGrow: 1 },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function ChatPanel({
  code,
  open,
  onClose,
  onOpenDeliverable,
}: {
  code: string;
  open: boolean;
  onClose(): void;
  onOpenDeliverable(id: string): void;
}) {
  const s = useStyles();
  const me = useMe();
  const notify = useNotify();
  // History lives in this tab only (todo-later H06: server-side, 90 days).
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState(START);
  const [input, setInput] = useState("");
  const chat = useProjectCommand(code, commands.chat(code));
  const start = useProjectCommand(code, commands.startSkill(code));
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setSuggestions(START);
  }, [code]);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages, chat.isPending]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || chat.isPending) return;
    const history = messages.slice(-8).map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));
    setMessages((m) => [...m, { role: "user", text: message }]);
    setInput("");
    chat.mutate(
      { message: message.slice(0, MAX), history },
      {
        onSuccess: (reply) => {
          const r = reply as ChatReply;
          setMessages((m) => [...m, { role: "assistant", text: r.text, actions: r.actions }]);
          setSuggestions(r.suggestions.length ? r.suggestions : START);
        },
        onError: (e) =>
          setMessages((m) => [...m, { role: "assistant", text: `Das hat nicht geklappt: ${errorText(e)}` }]),
      },
    );
  };

  const runAction = (a: ChatAction) => {
    if (a.kind === "open_deliverable") onOpenDeliverable(a.deliverableId);
    else if (a.kind === "start_skill") {
      start.mutate(a.skillId, {
        onSuccess: () => notify("info", "Entwurf angestossen", a.label),
        onError: (e) => notify("error", "Nicht möglich", errorText(e)),
      });
    }
  };

  const ai = me.data?.ai;
  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, d) => (!d.open ? onClose() : undefined)}
      position="end"
      size="medium"
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label="Assistent schliessen"
              icon={<Dismiss24Regular />}
              onClick={onClose}
            />
          }
        >
          Delivery-Assistent
        </DrawerHeaderTitle>
        <Caption1 className={s.muted}>
          {ai?.supportsChat
            ? `KI-Modell ${ai.model} (${ai.region})`
            : "Ohne KI-Modell: Antworten aus festen Regeln (Testmodus)"}
        </Caption1>
      </DrawerHeader>
      <DrawerBody>
        <div className={s.log} role="log" aria-live="polite" aria-label="Unterhaltung mit dem Assistenten">
          {messages.length === 0 ? (
            <div className={mergeClasses(s.msg, s.bot)}>
              <RichText
                text={
                  "Ich zeige dir den Stand, deine Aufgaben und den nächsten Schritt und stosse auf Wunsch Entwürfe an.\nEntscheide triffst du selbst."
                }
              />
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div key={i} className={mergeClasses(s.msg, m.role === "user" ? s.user : s.bot)}>
              {m.role === "user" ? m.text : <RichText text={m.text} />}
              {m.actions?.length ? (
                <div className={s.chips}>
                  {m.actions
                    .filter((a) => a.kind !== "run_started")
                    .map((a, j) => (
                      <Button key={j} size="small" appearance="primary" onClick={() => runAction(a)}>
                        {a.label}
                      </Button>
                    ))}
                </div>
              ) : null}
            </div>
          ))}
          {chat.isPending ? (
            <Spinner size="tiny" label="Assistent antwortet …" labelPosition="after" />
          ) : null}
          <div ref={endRef} />
        </div>
      </DrawerBody>
      <DrawerFooter>
        <div className={s.footer}>
          <div className={s.chips}>
            {suggestions.map((x) => (
              <Button key={x} size="small" onClick={() => send(x)} disabled={chat.isPending}>
                {x}
              </Button>
            ))}
          </div>
          <form
            className={s.input}
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Textarea
              className={s.grow}
              aria-label="Nachricht an den Assistenten"
              placeholder="Frag etwas oder sag «Starte …»"
              value={input}
              maxLength={MAX}
              onChange={(_, d) => setInput(d.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <Button
              type="submit"
              appearance="primary"
              icon={<Send20Regular />}
              aria-label="Senden"
              disabled={!input.trim() || chat.isPending}
            />
          </form>
          <Caption1 className={s.muted}>
            KI-Antworten können Fehler enthalten. Entscheide triffst du selbst.
          </Caption1>
        </div>
      </DrawerFooter>
    </OverlayDrawer>
  );
}
