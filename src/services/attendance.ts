/**
 * Daily attendance pairing — GET /attendance.
 *
 * Turns the flat punch list into one row per employee per day with TWO
 * distinct fields:  checkIn  and  checkOut  (Nepal time).
 *
 * PAIRING RULES (robust to either device configuration)
 * -----------------------------------------------------
 *  - Device sends real status codes:
 *        checkIn  = earliest punch with status 0 (CheckIn)
 *        checkOut = latest   punch with status 1 (CheckOut)
 *  - Device sends the same code for every punch (common!):
 *        checkIn  = first punch of the day
 *        checkOut = last punch of the day, but ONLY when there is more than
 *                   one punch (a lone punch is a check-in with no check-out)
 *  - Days are grouped by the punch's NEPAL date, so punches that cross
 *    midnight (23:50 in, 00:10 out) land on different days instead of
 *    producing a negative duration.
 *
 * Zero punches / unparseable timestamps are skipped gracefully.
 */
import type { AttendanceRecord, PunchView } from '../types';
import { isoWithOffset, nepalDateOf, nepalTimeOf, parseDeviceTime } from './time';
import { getUserName } from './users';

export interface AttendanceQuery {
  /** Restrict to one device serial. */
  sn?: string;
  /** Restrict to one employee PIN. */
  pin?: string;
  /** Inclusive start day (Nepal), "YYYY-MM-DD". */
  from?: string;
  /** Inclusive end day (Nepal), "YYYY-MM-DD". */
  to?: string;
}

/** "9h 00m" / "0h 45m". */
function humanDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

interface Worked extends PunchView {
  epoch: number;
  day: string;
}

/**
 * Build attendance rows from punches.
 * @param punches flat punch list (already Nepal-time enriched)
 */
export function buildAttendance(
  punches: PunchView[],
  q: AttendanceQuery = {},
): AttendanceRecord[] {
  // Group key: device + employee + nepal day.
  const groups = new Map<string, Worked[]>();

  for (const p of punches) {
    const epoch = p.epochMs ?? parseDeviceTime(p.timestamp);
    if (epoch === null) continue; // cannot place in a day
    const day = nepalDateOf(epoch);

    if (q.sn && p.sn !== q.sn) continue;
    if (q.pin && p.pin !== q.pin) continue;
    if (q.from && day < q.from) continue;
    if (q.to && day > q.to) continue;

    const key = `${p.sn ?? ''}|${p.pin}|${day}`;
    const list = groups.get(key);
    if (list) list.push({ ...p, epoch, day });
    else groups.set(key, [{ ...p, epoch, day }]);
  }

  const rows: AttendanceRecord[] = [];

  for (const [key, list] of groups) {
    list.sort((a, b) => a.epoch - b.epoch);
    const first = list[0];
    const last = list[list.length - 1];

    const explicitIns = list.filter((p) => p.status === '0');
    const explicitOuts = list.filter((p) => p.status === '1');

    // ---- check-in ----
    const inPunch = explicitIns.length ? explicitIns[0] : first;

    // ---- check-out ----
    let outPunch: Worked | null = null;
    if (explicitOuts.length) {
      outPunch = explicitOuts[explicitOuts.length - 1];
    } else if (list.length > 1) {
      // No explicit CheckOut code → treat the last punch as the check-out.
      outPunch = last;
    }

    const workedMinutes =
      outPunch && outPunch.epoch > inPunch.epoch
        ? Math.round((outPunch.epoch - inPunch.epoch) / 60_000)
        : null;

    const [, pin, date] = key.split('|');

    rows.push({
      sn: first.sn,
      pin,
      name: getUserName(pin) || undefined,
      date,
      checkIn: nepalTimeOf(inPunch.epoch),
      checkOut: outPunch ? nepalTimeOf(outPunch.epoch) : null,
      checkInIso: isoWithOffset(inPunch.epoch),
      checkOutIso: outPunch ? isoWithOffset(outPunch.epoch) : null,
      workedMinutes,
      worked: workedMinutes !== null ? humanDuration(workedMinutes) : null,
      punchCount: list.length,
      checkInVerified: inPunch.verifiedLabel,
      checkOutVerified: outPunch?.verifiedLabel,
      deviceIp: first.deviceIp,
    });
  }

  // Newest day first, then by PIN — the natural reading order.
  rows.sort((a, b) => (a.date === b.date ? a.pin.localeCompare(b.pin) : b.date.localeCompare(a.date)));
  return rows;
}

const CSV_HEADER = [
  'sn',
  'pin',
  'name',
  'date',
  'checkIn',
  'checkOut',
  'checkInIso',
  'checkOutIso',
  'workedMinutes',
  'worked',
  'punchCount',
  'checkInVerified',
  'checkOutVerified',
  'deviceIp',
];

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Attendance rows → CSV attachment (UTF-8 BOM for Excel). */
export function attendanceToCsv(rows: AttendanceRecord[]): string {
  const body = rows.map((r) =>
    [
      r.sn,
      r.pin,
      r.name,
      r.date,
      r.checkIn,
      r.checkOut,
      r.checkInIso,
      r.checkOutIso,
      r.workedMinutes,
      r.worked,
      r.punchCount,
      r.checkInVerified,
      r.checkOutVerified,
      r.deviceIp,
    ]
      .map(csvCell)
      .join(','),
  );
  return '\uFEFF' + [CSV_HEADER.join(','), ...body].join('\r\n') + '\r\n';
}
