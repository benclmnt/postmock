// Postmark reads zoneless query dates as US Eastern time and emits Eastern offsets
// (docs/02 §7.1; refs/api_messages-api.md:40-41).
const EASTERN = "America/New_York";

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Minutes east of UTC for US Eastern at `instant` (-300 or -240). */
export function easternOffsetMinutes(instant: Date): number {
  const parts = partsFormat.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((x) => x.type === type)?.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((wall - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The instant of an Eastern wall-clock time. */
export function easternWallTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let offset = easternOffsetMinutes(new Date(wall));
  offset = easternOffsetMinutes(new Date(wall - offset * 60000));
  return new Date(wall - offset * 60000);
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, "0");

/**
 * ISO 8601 with 7 fraction digits, e.g. `2014-02-17T07:25:01.4178645-05:00` (docs/02 §7.1).
 * `zone: "utc"` gives the `Z` form some surfaces use (bounce list, webhooks, bulk).
 */
export function formatTimestamp(instant: Date, zone: "eastern" | "utc" = "eastern"): string {
  const offset = zone === "utc" ? 0 : easternOffsetMinutes(instant);
  const w = new Date(instant.getTime() + offset * 60000);
  const date = `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
  const time = `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}:${pad(w.getUTCSeconds())}`;
  const fraction = `${pad(w.getUTCMilliseconds(), 3)}0000`;
  const suffix =
    zone === "utc"
      ? "Z"
      : `${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return `${date}T${time}.${fraction}${suffix}`;
}

/** `YYYY-MM-DD` in Eastern time, the stats `Date` shape (docs/08 E8). */
export function formatEasternDate(instant: Date): string {
  const w = new Date(instant.getTime() + easternOffsetMinutes(instant) * 60000);
  return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
}
