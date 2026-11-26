/** Strip «@» and whitespace from a Telegram username typed by a user. */
export function normalizeUsername(s: string): string {
  return s.replace(/\s+/g, "").replace(/^@+/, "");
}
