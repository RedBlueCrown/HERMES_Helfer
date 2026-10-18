// The project's folder for its files (Projektablage): a link to SharePoint or
// OneDrive. The PL or the PMO records it; every member opens the folder from here.

import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Edit20Regular, FolderOpen20Regular } from "@fluentui/react-icons";
import { validateStorageLink } from "@hermes-helfer/core";
import { useState } from "react";
import { projectPath, useProject, useProjectCommand } from "../api/hooks";
import type { ProjectView } from "../api/types";
import { errorText, formatDay, useNotify } from "./ui";

const useStyles = makeStyles({
  buttons: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  form: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  muted: { color: tokens.colorNeutralForeground3 },
});

/** Opens the folder in a new tab; the app's address does not go along (noreferrer). */
const external = { target: "_blank", rel: "noopener noreferrer" } as const;

/** The header's buttons: open the Projektablage, and link or change it. */
export function StorageButtons({ code, view }: { code: string; view: ProjectView }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const { link, canSet } = view.storage;
  if (!link && !canSet.ok) return null;
  return (
    <div className={s.buttons}>
      {link ? (
        <Button as="a" href={link.url} {...external} icon={<FolderOpen20Regular />} title={link.host}>
          Projektablage
        </Button>
      ) : null}
      {canSet.ok ? (
        <Button
          appearance={link ? "subtle" : "secondary"}
          icon={link ? <Edit20Regular /> : <FolderOpen20Regular />}
          aria-label={link ? "Projektablage ändern" : undefined}
          title={link ? "Projektablage ändern" : undefined}
          onClick={() => setOpen(true)}
        >
          {link ? null : "Projektablage verknüpfen"}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)} modalType="modal">
        <DialogSurface>
          {open ? <StorageForm code={code} view={view} onClose={() => setOpen(false)} /> : null}
        </DialogSurface>
      </Dialog>
    </div>
  );
}

function StorageForm({ code, view, onClose }: { code: string; view: ProjectView; onClose(): void }) {
  const s = useStyles();
  const notify = useNotify();
  const { link, hosts } = view.storage;
  const [url, setUrl] = useState(link?.url ?? "");
  const save = useProjectCommand(code, (api, next: string) =>
    api.put(`${projectPath(code)}/storage`, { url: next }),
  );
  const text = url.trim();
  const problem = text ? validateStorageLink(text, hosts) : undefined;
  const store = (next: string) =>
    save.mutate(next, {
      onSuccess: () => {
        notify("success", next ? "Projektablage verknüpft" : "Projektablage entfernt");
        onClose();
      },
      onError: (err) => notify("error", "Nicht möglich", errorText(err)),
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        store(text);
      }}
    >
      <DialogBody>
        <DialogTitle>Projektablage</DialogTitle>
        <DialogContent className={s.form}>
          <Body1>
            Der Ordner mit den Unterlagen des Vorhabens. Alle Mitglieder öffnen ihn von hier aus; wer welche
            Dateien sieht, regeln die Berechtigungen des Ordners.
          </Body1>
          <Field
            label="Link zum Ordner"
            validationState={problem ? "error" : "none"}
            validationMessage={problem}
            hint={`Öffne den Ordner in SharePoint oder OneDrive und kopiere die Adresse aus der Adresszeile des Browsers. Möglich: ${hosts.join(", ")}`}
          >
            <Input type="url" value={url} onChange={(_, d) => setUrl(d.value)} placeholder="https://…" />
          </Field>
          <MessageBar intent="info" layout="multiline">
            <MessageBarBody>
              Verknüpfe den Ordner selbst, keinen Freigabelink «Jeder mit dem Link»: Alle, die das Vorhaben
              sehen, sehen auch den Link.
            </MessageBarBody>
          </MessageBar>
          {link ? (
            <Caption1 className={s.muted}>
              Verknüpft von {link.by.displayName} am {formatDay(link.at)}
            </Caption1>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            appearance="primary"
            type="submit"
            disabled={!text || !!problem || text === link?.url || save.isPending}
          >
            Speichern
          </Button>
          {link ? (
            <Button disabled={save.isPending} onClick={() => store("")}>
              Entfernen
            </Button>
          ) : null}
          <Button onClick={onClose}>Abbrechen</Button>
        </DialogActions>
      </DialogBody>
    </form>
  );
}

/** Where a downloaded document goes: the Projektablage, if the project has one. */
export function StorageHint({ code }: { code: string }) {
  const s = useStyles();
  const link = useProject(code).data?.storage.link;
  if (!link) return null;
  return (
    <Caption1 className={s.muted}>
      Lege das heruntergeladene Dokument in der{" "}
      <Link href={link.url} {...external}>
        Projektablage
      </Link>{" "}
      ab ({link.host}).
    </Caption1>
  );
}
