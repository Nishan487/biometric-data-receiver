/**
 * Shared types for the ZKTeco ADMS mock server.
 *
 * Everything revolves around `RequestRecord` — one record per HTTP request
 * received from a device. Records are stored in the in-memory history array
 * and appended to logs/device-requests.log as JSON lines.
 */

/** A single parsed attendance punch extracted from an ATTLOG body. */
export interface PunchRecord {
  /** Employee PIN (as enrolled on the device, e.g. "1001"). */
  pin: string;
  /** Punch timestamp string exactly as the device sent it. */
  timestamp: string;
  /** How the punch was verified (1=PWD, 2=FINGER, 3=CARD, 4=FACE ...). */
  verified?: string;
  /** Punch status code: 0=CheckIn, 1=CheckOut, 2=BreakOut, 3=BreakIn, 4=OTIn, 5=OTOut (varies by firmware). */
  status: string;
  /** Work code if present in the log line. */
  workcode?: string;
}

/** What we think the request is, based on path + query table. */
export type RequestKind =
  | 'registration' // first contact / device hand-shake with SN
  | 'heartbeat' // device polling for commands (getrequest / cdata GET)
  | 'attendance-push' // POST ATTLOG (or other table) data
  | 'command-ack' // devicecmd response from device
  | 'system' // /health, /logs, /debug/network
  | 'unknown';

/**
 * Who made the request.
 *  - 'device' : real biometric traffic (/iclock/*) — what we actually care about
 *  - 'ui'     : browsers hitting /health, /logs, /favicon.ico, etc.
 *               (noise; hidden from GET /logs unless ?all=1)
 */
export type RequestSource = 'device' | 'ui';

/** The complete record of one HTTP request hitting the server. */
export interface RequestRecord {
  /** Monotonic id, starting at 1. */
  id: number;
  /** ISO timestamp when the server received the request. */
  receivedAt: string;
  method: string;
  /** Full original URL including query string. */
  url: string;
  /** Path only, e.g. /iclock/cdata. */
  path: string;
  clientIp: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  /** Body decoded as UTF-8 text ("" when there was no body). */
  rawBody: string;
  /** Body length in bytes. */
  bodyLength: number;
  /** Detected purpose of the request. */
  kind: RequestKind;
  /** Who sent it: real device traffic or our own UI/browser hits. */
  source: RequestSource;
  /** Device serial number (SN query param) when present. */
  deviceSn?: string;
  /** Data table being pushed (ATTLOG, USERINFO, FINGER, ...) when present. */
  table?: string;
  /** Punches parsed out of an ATTLOG body. */
  punches: PunchRecord[];
  /** Response status code we sent back. */
  responseStatus: number;
  /** How long the server took to answer, in ms (useful for timing analysis). */
  durationMs: number;
}

/** Shape of GET /debug/network. */
export interface NetworkInfo {
  serverIp: string;
  port: number;
  time: string;
}

/** Shape of GET /health. */
export interface HealthInfo {
  status: 'ok';
}

/**
 * One punch as returned by GET /punches.
 * Flattens the parent RequestRecord so consumers never have to dig into
 * the raw request (headers/body) just to read attendance events.
 */
export interface PunchView {
  /** Id of the HTTP request that carried this punch. */
  recordId: number;
  /** When the server received the upload (ISO). */
  receivedAt: string;
  /** Device serial number from the ?SN= query param (if any). */
  sn?: string;
  /** IP address of the device that pushed the punch. */
  deviceIp: string;
  /** Employee PIN enrolled on the device. */
  pin: string;
  /** Employee name known to the device ("" when the PIN is unknown). */
  name?: string;
  /** Punch time exactly as the device reported it (raw, untouched). */
  timestamp: string;
  /** Punch time in Nepal time: "2026-10-05 08:59:58". */
  timestampNepal?: string | null;
  /** Punch time as ISO-8601 with offset: "2026-10-05T08:59:58+05:45". */
  timestampIso?: string | null;
  /** Punch time in UTC: "2026-10-05T03:14:58Z". */
  timestampUtc?: string | null;
  /** Raw status code (0=CheckIn, 1=CheckOut, ...). */
  status: string;
  /** Human readable status. */
  statusLabel: string;
  /** Explicit alias of statusLabel so CSV readers see CheckIn/CheckOut plainly. */
  punchType: string;
  /** Raw verification code (1=Fingerprint, 2=Card, ...). */
  verified?: string;
  /** Human readable verification method. */
  verifiedLabel?: string;
  /** Work code if present. */
  workcode?: string;
  /** Request path that carried the punch (usually /iclock/cdata). */
  path: string;
  /** Epoch ms parsed from the device string (null when unparseable). */
  epochMs?: number | null;
}

/**
 * One employee's attendance for one day — GET /attendance.
 * checkIn and checkOut are deliberately SEPARATE fields (Nepal time).
 */
export interface AttendanceRecord {
  /** Device serial the punches came from. */
  sn?: string;
  /** Employee PIN. */
  pin: string;
  /** Employee name known to the device ("" when the PIN is unknown). */
  name?: string;
  /** Day in the report zone (Nepal): "2026-10-05". */
  date: string;
  /** First punch of the day: "08:59:58" (null when missing). */
  checkIn: string | null;
  /** Last punch of the day: "18:00:05" (null when only one punch). */
  checkOut: string | null;
  /** Same instants as ISO-8601 with +05:45 offset. */
  checkInIso: string | null;
  checkOutIso: string | null;
  /** Duration between check-in and check-out, in minutes. */
  workedMinutes: number | null;
  /** Human readable duration: "9h 00m". */
  worked: string | null;
  /** How many punches formed this record. */
  punchCount: number;
  /** Verification method of the check-in punch. */
  checkInVerified?: string;
  /** Verification method of the check-out punch. */
  checkOutVerified?: string;
  /** Device IP of the punches. */
  deviceIp: string;
}
