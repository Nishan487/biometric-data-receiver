/**
 * Punch collection for GET /punches and GET /punches.csv.
 *
 * WHERE PUNCHES COME FROM
 * -----------------------
 * A punch is stored as part of a RequestRecord (see middleware/requestLogger)
 * whenever the device POSTs /iclock/cdata?table=ATTLOG. Two places hold them:
 *
 *   1. in-memory history (services/history.ts) — fast, but wiped on restart
 *   2. logs/device-requests.log (JSONL)        — survives restarts
 *
 * We merge both and de-duplicate by record id + timestamp + url, so punches
 * remain visible after the server restarts while still reflecting anything
 * that only exists in memory (should not normally happen, since every record
 * is appended to the file as well).
 *
 * To turn this into a real ingestion service: replace readFileRecords() with
 * a DB query — collectPunches()'s output shape stays the same.
 */
import fs from 'fs';
import type { PunchView, RequestRecord } from '../types';
import { lastRecords } from './history';
import { logFilePath } from './fileLogger';
import { deviceTimeToNepal, parseDeviceTime } from './time';
import { getUserName } from './users';

/** ATTLOG status codes → human labels (varies a little by firmware). */
const STATUS_LABELS: Record<string, string> = {
  '0': 'CheckIn',
  '1': 'CheckOut',
  '2': 'BreakOut',
  '3': 'BreakIn',
  '4': 'OTIn',
  '5': 'OTOut',
  '6': 'CheckIn',
  '7': 'CheckOut',
  // Firmware with punch-state ("auto state") disabled records 255 = neutral
  // punch; check-in/out is then derived from first/last punch of the day.
  '255': 'Normal',
};

/** Verified-by codes → human labels (common ZKTeco mapping). */
const VERIFIED_LABELS: Record<string, string> = {
  '0': 'Password',
  '1': 'Fingerprint',
  '2': 'Card',
  '3': 'Face',
  '4': 'Palm',
  '5': 'Iris',
  '15': 'Face',
  '100': 'Face',
  '200': 'Face',
};

function label(map: Record<string, string>, code: string | undefined): string | undefined {
  if (code === undefined || code === '') return undefined;
  return map[code] ?? `Code(${code})`;
}

/**
 * Read the JSONL log file and parse it back into RequestRecords.
 * Tolerant of corruption: a malformed line is skipped rather than throwing
 * (a debug server must not 500 because someone edited the file).
 */
export function readFileRecords(): RequestRecord[] {
  try {
    if (!fs.existsSync(logFilePath)) return [];
    const text = fs.readFileSync(logFilePath, 'utf8');
    const out: RequestRecord[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as RequestRecord;
        if (rec && Array.isArray(rec.punches)) out.push(rec);
      } catch {
        // skip malformed line
      }
    }
    return out;
  } catch {
    return [];
  }
}

export interface PunchQuery {
  /** Restrict to one device serial number. */
  sn?: string;
  /** Newest N punches to return (after filtering). */
  limit?: number;
  /** Read the file log in addition to memory (default true). */
  fromFile?: boolean;
}

/** Merge memory + file records, de-duplicated, then flatten into punches. */
export function collectPunches(q: PunchQuery = {}): PunchView[] {
  const fromFile = q.fromFile !== false;
  const seen = new Set<string>();
  const records: RequestRecord[] = [];

  const add = (rec: RequestRecord): void => {
    const key = `${rec.id}|${rec.receivedAt}|${rec.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push(rec);
  };

  for (const rec of lastRecords(Number.MAX_SAFE_INTEGER)) add(rec);
  if (fromFile) for (const rec of readFileRecords()) add(rec);

  // Oldest first so the final limit keeps the most recent punches.
  records.sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));

  const punchViews: PunchView[] = [];
  for (const rec of records) {
    if (!rec.punches || rec.punches.length === 0) continue;
    const sn = rec.deviceSn;
    if (q.sn && sn !== q.sn) continue;

    for (const p of rec.punches) {
      // Real punch time in Nepal time (+05:45), derived from the raw string.
      const t = deviceTimeToNepal(p.timestamp);
      const statusLabel = label(STATUS_LABELS, p.status) ?? `Code(${p.status})`;
      punchViews.push({
        recordId: rec.id,
        receivedAt: rec.receivedAt,
        sn,
        deviceIp: rec.clientIp,
        pin: p.pin,
        name: getUserName(p.pin) || undefined,
        timestamp: p.timestamp,
        timestampNepal: t.timestampNepal,
        timestampIso: t.timestampIso,
        timestampUtc: t.timestampUtc,
        status: p.status,
        statusLabel,
        punchType: statusLabel,
        verified: p.verified,
        verifiedLabel: label(VERIFIED_LABELS, p.verified),
        workcode: p.workcode,
        path: rec.path,
        epochMs: parseDeviceTime(p.timestamp),
      });
    }
  }

  if (q.limit && q.limit > 0 && punchViews.length > q.limit) {
    // Newest first: latest punch at the top of /punches.
    return punchViews.slice(punchViews.length - q.limit).reverse();
  }
  // Newest first: latest punch at the top of /punches.
  return punchViews.reverse();
}

/** RFC-4180-ish CSV escaping for the punches export. */
function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = [
  'recordId',
  'receivedAt',
  'sn',
  'deviceIp',
  'pin',
  'name',
  'punchTime',
  'punchTimeNepal',
  'punchTimeIso',
  'punchTimeUtc',
  'punchType',
  'status',
  'statusLabel',
  'verified',
  'verifiedLabel',
  'workcode',
];

/** Serialise punches to CSV (Excel friendly, UTF-8 with BOM). */
export function punchesToCsv(punches: PunchView[]): string {
  const rows = punches.map((p) =>
    [
      p.recordId,
      p.receivedAt,
      p.sn,
      p.deviceIp,
      p.pin,
      p.name,
      p.timestamp,
      p.timestampNepal,
      p.timestampIso,
      p.timestampUtc,
      p.punchType,
      p.status,
      p.statusLabel,
      p.verified,
      p.verifiedLabel,
      p.workcode,
    ]
      .map(csvCell)
      .join(','),
  );
  // BOM so Excel opens UTF-8 correctly (PINs/names with accents).
  return '\uFEFF' + [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}
