// The project's folder for its files (Projektablage): a link to a folder in
// SharePoint or OneDrive, recorded by the project lead or the PMO. The app keeps
// only the link and does not reach into the folder (filing documents through
// Microsoft Graph: Inkrement 3, open question F9).

/** The longest link the app keeps. */
export const MAX_STORAGE_URL = 2000;

/** https and a host name, then a path, query or fragment: no user name, no port, no other scheme. */
const LINK = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/?#]|$)/i;
/** Spaces, characters outside ASCII and characters a browser treats differently from a link. */
const UNSAFE = /[^\x21-\x7e]|["<>\\^`{|}]/;

/** Whether a host is one of the allowed ones; «*.example.com» allows every host below example.com. */
export function storageHostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((entry) => {
    const a = entry.trim().toLowerCase();
    return a.startsWith("*.") ? h.endsWith(a.slice(1)) : h === a;
  });
}

/** The host of a link in the form the app keeps, in lower case; undefined for any other text. */
export function storageLinkHost(url: string): string | undefined {
  if (url.length > MAX_STORAGE_URL || UNSAFE.test(url)) return undefined;
  return LINK.exec(url)?.[1]?.toLowerCase();
}

/**
 * Why a link cannot be the Projektablage, for the person; undefined if it can.
 * `allowed`: the organisation's hosts (policy documentStorageHosts). An empty
 * link removes the Projektablage.
 */
export function validateStorageLink(url: string, allowed: readonly string[]): string | undefined {
  if (url === "") return undefined;
  if (url.length > MAX_STORAGE_URL) return `Der Link ist zu lang (höchstens ${MAX_STORAGE_URL} Zeichen).`;
  if (UNSAFE.test(url)) {
    return "Der Link enthält Leerzeichen oder Zeichen, die in einem Link nicht vorkommen.";
  }
  const host = storageLinkHost(url);
  if (!host) {
    return "Das ist kein vollständiger Link. Öffne den Ordner im Browser und kopiere die Adresse; sie beginnt mit https://.";
  }
  if (!storageHostAllowed(host, allowed)) {
    return `Links auf «${host}» sind hier nicht vorgesehen. Die Projektablage liegt auf: ${allowed.join(", ")}.`;
  }
  return undefined;
}
