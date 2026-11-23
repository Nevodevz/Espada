/** How long ago `fromIso` (UTC, with or without a zone suffix) was, e.g. «4 мин», «1 ч 10 мин», «2 дн». */
export function formatWaiting(fromIso: string, now: Date): string {
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(fromIso);
  const from = new Date(hasZone ? fromIso : `${fromIso}Z`).getTime();
  const min = Math.max(0, Math.floor((now.getTime() - from) / 60_000));
  if (min >= 48 * 60) return `${Math.floor(min / 1440)} дн`;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  return `${min} мин`;
}
