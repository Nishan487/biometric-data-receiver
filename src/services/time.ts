/**
 * Punch time helpers — device wall-clock ⇄ Nepal time.
 *
 * THE PROBLEM
 * -----------
 * A ZKTeco ATTLOG row contains a bare string: "2026-10-05 08:59:58".
 * There is NO timezone attached — the device has no concept of one; an
 * admin simply sets its clock (normally to Nepal local time).
 *
 * WHAT WE DO
 * ----------
 *  1. Parse that string in whatever zone the device's clock uses
 *     (config.deviceClockTz, default Asia/Kathmandu) to get a real instant.
 *  2. Render the instant in the report zone (config.reportTz, default
 *     Asia/Kathmandu) as three values:
 *         timestampNepal : "2026-10-05 08:59:58"        (human readable)
 *         timestampIso   : "2026-10-05T08:59:58+05:45"  (unambiguous)
 *         timestampUtc   : "2026-10-05T03:14:58Z"
 *
 * Nepal Standard Time is a FIXED +05:45 with no DST, so the arithmetic is
 * exact year-round. Intl.DateTimeFormat handles the conversion (verified on
 * Node 24) — no date library needed.
 *
 * If the device clock turns out to be UTC instead of Nepal time, change
 * DEVICE_CLOCK_TZ in .env — no code change required.
 */
import { config } from '../config';

/** Parse "YYYY-MM-DD HH:MM:SS" (also accepts / separators and missing secs). */
const DEVICE_TIME_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/;

/**
 * Offset of an IANA zone at a given instant, in milliseconds.
 * wallClockAsUTC − actualUTC = how far ahead the zone is.
 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));

  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - instant;
}

/**
 * Convert a device wall-clock string to epoch milliseconds.
 * Returns null when the string is unparseable (we never throw on bad data —
 * the raw string is still reported as-is).
 */
export function parseDeviceTime(raw: string): number | null {
  const m = DEVICE_TIME_RE.exec((raw ?? '').trim());
  if (!m) return null;

  const [, y, mo, d, h, mi, s] = m;
  const wallAsUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? '0'),
  );

  const tz = config.deviceClockTz;
  // Fixed fast path for the common cases.
  if (tz === 'UTC' || tz === 'Etc/UTC') return wallAsUtc;
  if (tz === 'Asia/Kathmandu') return wallAsUtc - 345 * 60_000; // −05:45

  // Generic (two-pass) for any other zone.
  let epoch = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    epoch = wallAsUtc - zoneOffsetMs(epoch, tz);
  }
  return epoch;
}

/** IANA zone used for all output. */
function outTz(): string {
  return config.reportTz;
}

/** "2026-10-05" in the report zone — used to group punches into days. */
export function nepalDateOf(epoch: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: outTz(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epoch));
}

/** "08:59:58" in the report zone. */
export function nepalTimeOf(epoch: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: outTz(),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(epoch));
}

/** "2026-10-05 08:59:58" in the report zone (human readable). */
export function nepalDateTimeOf(epoch: number): string {
  return `${nepalDateOf(epoch)} ${nepalTimeOf(epoch)}`;
}

/**
 * ISO-8601 with the zone's own offset: "2026-10-05T08:59:58+05:45".
 * Intl yields "GMT+05:45"; ISO-8601 wants "+05:45".
 */
export function isoWithOffset(epoch: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: outTz(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(epoch));

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const off = (get('timeZoneName') || 'GMT+00:00').replace('GMT', '') || '+00:00';
  const sign = off.startsWith('-') || off.startsWith('+') ? off : `+${off}`;

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get(
    'minute',
  )}:${get('second')}${sign}`;
}

/** Instant → "2026-10-05 08:59:58" in the report zone, from a device string. */
export function deviceTimeToNepal(raw: string): {
  timestampNepal: string | null;
  timestampIso: string | null;
  timestampUtc: string | null;
} {
  const epoch = parseDeviceTime(raw);
  if (epoch === null) return { timestampNepal: null, timestampIso: null, timestampUtc: null };
  return {
    timestampNepal: nepalDateTimeOf(epoch),
    timestampIso: isoWithOffset(epoch),
    timestampUtc: new Date(epoch).toISOString(),
  };
}

/** Current server time in the report zone ("2026-10-05 13:29:44"). */
export function nowInReportTz(): string {
  return nepalDateTimeOf(Date.now());
}

/** Current server time as ISO with offset. */
export function nowIsoInReportTz(): string {
  return isoWithOffset(Date.now());
}
