// A short fingerprint of what a person saw before deciding (a suggestion, an
// impact). The decision names it; when the basis changed meanwhile, the API
// answers 409 instead of recording a decision on figures nobody saw.

/** FNV-1a over the JSON of `value`, as 8 hex digits. Not for security: only to notice a change. */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
