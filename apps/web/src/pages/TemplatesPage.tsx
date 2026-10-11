import {
  Badge,
  Body1,
  Button,
  Caption1,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Link,
  MessageBar,
  MessageBarBody,
  OverlayDrawer,
  SearchBox,
  Spinner,
  Subtitle2,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Title2,
  makeStyles,
  tokens,
  type BadgeProps,
} from "@fluentui/react-components";
import { ArrowDownload16Regular, ArrowUpload16Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { useDeferredValue, useRef, useState } from "react";
import { saveFile } from "../api/client";
import { templateFilePath, useApi, useMe, useTemplates, useUploadTemplate } from "../api/hooks";
import type { FieldSource, TemplateField, TemplateOverview } from "../api/types";
import { ErrorView, RestrictedBadge, errorText, formatDate, useNotify } from "../components/ui";

/** The API's limit for an upload (apps/api/src/documents/docx.ts). */
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT =
  ".docx,.dotx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.wordprocessingml.template";

const SOURCES: Record<FieldSource, { label: string; color: BadgeProps["color"]; hint: string }> = {
  agent: {
    label: "Agent",
    color: "brand",
    hint: "Der Agent entwirft das Feld; Menschen prüfen es in der App.",
  },
  engine: {
    label: "HERMES Helfer",
    color: "informative",
    hint: "Der HERMES Helfer setzt das Feld aus dem Vorhaben ein, nie ein Agent.",
  },
  person: {
    label: "Person",
    color: "subtle",
    hint: "Unterschrift, Freigabe und Klassifizierung füllen Menschen im Dokument aus.",
  },
};

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  intro: { maxWidth: "860px" },
  tools: { display: "flex", gap: tokens.spacingHorizontalL, alignItems: "center", flexWrap: "wrap" },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    padding: tokens.spacingHorizontalL,
    overflowX: "auto",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  name: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: tokens.spacingVerticalXXS,
  },
  counts: { display: "flex", gap: tokens.spacingHorizontalXS, flexWrap: "wrap" },
  body: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  chapter: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  field: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    alignItems: "start",
    padding: `${tokens.spacingVerticalXS} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  hidden: { display: "none" },
});

function SourceCounts({ fields }: { fields: readonly TemplateField[] }) {
  const s = useStyles();
  return (
    <span className={s.counts}>
      {(Object.keys(SOURCES) as FieldSource[]).map((source) => {
        const n = fields.filter((f) => f.source === source).length;
        return n ? (
          <Badge key={source} appearance="tint" color={SOURCES[source].color} title={SOURCES[source].hint}>
            {n} {SOURCES[source].label}
          </Badge>
        ) : null;
      })}
    </span>
  );
}

function FieldList({ fields }: { fields: readonly TemplateField[] }) {
  const s = useStyles();
  const chapters = [...new Set(fields.map((f) => f.chapter))];
  return (
    <>
      {chapters.map((chapter) => (
        <section key={chapter} className={s.chapter}>
          <Subtitle2 as="h3">{chapter}</Subtitle2>
          {fields
            .filter((f) => f.chapter === chapter)
            .map((f) => (
              <div key={f.id} className={s.field}>
                <span>
                  <Body1 block>{f.label === f.chapter ? "Text des Kapitels" : f.label}</Body1>
                  {f.fact ? <Caption1 className={s.muted}>{f.fact}</Caption1> : null}
                </span>
                <Badge appearance="tint" color={SOURCES[f.source].color} title={SOURCES[f.source].hint}>
                  {SOURCES[f.source].label}
                </Badge>
              </div>
            ))}
        </section>
      ))}
    </>
  );
}

function TemplateDrawer({ item, onClose }: { item: TemplateOverview | undefined; onClose(): void }) {
  const s = useStyles();
  const api = useApi();
  const notify = useNotify();
  const upload = useUploadTemplate();
  const input = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const t = item?.template;

  const send = (file: File | undefined) => {
    if (!file || !item) return;
    if (file.size > MAX_BYTES) {
      notify("error", "Datei zu gross", "Eine Vorlage darf höchstens 5 MB gross sein.");
      return;
    }
    upload.mutate(
      { deliverableId: item.deliverableId, file },
      {
        onSuccess: (kept) =>
          notify(
            "success",
            `Vorlage gespeichert: Version ${kept.version}`,
            `${kept.fields.length} Felder erkannt. Neue Entwürfe folgen ihnen.`,
          ),
        onError: (e) => notify("error", "Vorlage nicht gespeichert", errorText(e)),
      },
    );
  };
  const download = async () => {
    if (!item) return;
    setDownloading(true);
    try {
      saveFile(await api.download(templateFilePath(item.deliverableId)));
    } catch (e) {
      notify("error", "Download nicht möglich", errorText(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <OverlayDrawer
      open={!!item}
      onOpenChange={(_, v) => (!v.open ? onClose() : undefined)}
      position="end"
      size="medium"
    >
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
          {item ? `Vorlage: ${item.name}` : "…"}
        </DrawerHeaderTitle>
        {item ? (
          <Caption1>
            Phase {item.phase}
            {item.skill ? ` · Entwurf im Schritt «${item.skill.name}»` : ""}
          </Caption1>
        ) : null}
      </DrawerHeader>
      <DrawerBody>
        {item ? (
          <div className={s.body}>
            {t ? (
              <Body1>
                «{t.fileName}», Version {t.version}, gespeichert von {t.uploadedBy.displayName},{" "}
                {formatDate(t.uploadedAt)}. {t.fields.length} Felder.
              </Body1>
            ) : (
              <Body1>Für dieses Ergebnis gibt es noch keine Vorlage.</Body1>
            )}
            <div className={s.actions}>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className={s.hidden}
                aria-label="Word-Vorlage wählen"
                onChange={(e) => {
                  send(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button
                appearance="primary"
                icon={<ArrowUpload16Regular />}
                disabled={upload.isPending}
                onClick={() => input.current?.click()}
              >
                {t ? "Neue Version hochladen" : "Vorlage hochladen"}
              </Button>
              {t ? (
                <Button
                  icon={<ArrowDownload16Regular />}
                  disabled={downloading}
                  onClick={() => void download()}
                >
                  Vorlage herunterladen
                </Button>
              ) : null}
              {upload.isPending ? <Spinner size="tiny" label="Wird geprüft …" /> : null}
            </div>
            <Caption1 className={s.muted}>
              Die Felder erkennt der HERMES Helfer am Aufbau: Kapitel im Format «Überschrift 1», darunter
              fette Bezeichnungen mit einem leeren Absatz, oder Tabellen mit zwei Spalten und leerer rechter
              Zelle. Makros sind nicht erlaubt. Frühere Versionen bleiben gespeichert.
            </Caption1>
            {t ? <FieldList fields={t.fields} /> : null}
          </div>
        ) : null}
      </DrawerBody>
    </OverlayDrawer>
  );
}

/** The PMO's Word templates: one per result, the fields they have and who fills them. */
export function TemplatesPage() {
  const s = useStyles();
  const me = useMe();
  const allowed = !!me.data?.can.manageTemplates;
  const q = useTemplates(allowed);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyWith, setOnlyWith] = useState(false);
  const term = useDeferredValue(search.trim().toLowerCase());

  if (!allowed) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>Die Vorlagen verwaltet das PMO.</MessageBarBody>
      </MessageBar>
    );
  }
  const items = (q.data?.items ?? []).filter(
    (i) => (!onlyWith || i.template) && (!term || i.name.toLowerCase().includes(term)),
  );
  const withTemplate = (q.data?.items ?? []).filter((i) => i.template).length;

  return (
    <div className={s.page}>
      <Title2 as="h1">Vorlagen</Title2>
      <Body1 className={s.intro}>
        Die Word-Vorlagen der Organisation, eine je Ergebnis. Der Agent entwirft die Felder der Vorlage, der
        HERMES Helfer setzt die Fakten des Vorhabens ein, und Unterschriften und Freigaben bleiben den
        Menschen. Wer ein Ergebnis lesen darf, lädt es als Word-Dokument herunter.
      </Body1>
      <div className={s.tools}>
        <SearchBox
          placeholder="Ergebnis suchen"
          value={search}
          onChange={(_, v) => setSearch(v.value)}
          aria-label="Ergebnis suchen"
        />
        <Switch
          checked={onlyWith}
          onChange={(_, v) => setOnlyWith(v.checked)}
          label={`Nur mit Vorlage (${withTemplate})`}
        />
      </div>
      {q.isError ? <ErrorView error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isPending ? <Spinner label="Wird geladen …" /> : null}
      {q.data ? (
        <div className={s.card}>
          <Table aria-label="Vorlagen je Ergebnis" size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Ergebnis</TableHeaderCell>
                <TableHeaderCell>Entwurf im Schritt</TableHeaderCell>
                <TableHeaderCell>Vorlage</TableHeaderCell>
                <TableHeaderCell>Felder</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.deliverableId} data-template={i.deliverableId}>
                  <TableCell>
                    <span className={s.name}>
                      <Link as="button" onClick={() => setSelected(i.deliverableId)}>
                        {i.name}
                      </Link>
                      <Caption1 className={s.muted}>Phase {i.phase}</Caption1>
                      {i.restricted ? <RestrictedBadge /> : null}
                    </span>
                  </TableCell>
                  <TableCell>{i.skill?.name ?? "–"}</TableCell>
                  <TableCell>
                    {i.template ? (
                      <span className={s.name}>
                        <Body1>{i.template.fileName}</Body1>
                        <Caption1 className={s.muted}>
                          Version {i.template.version} · {formatDate(i.template.uploadedAt)}
                        </Caption1>
                      </span>
                    ) : (
                      <Caption1 className={s.muted}>keine</Caption1>
                    )}
                  </TableCell>
                  <TableCell>{i.template ? <SourceCounts fields={i.template.fields} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!items.length ? <Caption1 className={s.muted}>Keine Ergebnisse gefunden.</Caption1> : null}
        </div>
      ) : null}
      <TemplateDrawer
        item={q.data?.items.find((i) => i.deliverableId === selected)}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
