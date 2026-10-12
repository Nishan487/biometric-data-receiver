/**
 * ============================================================================
 *  What is ZKTeco ADMS?
 * ============================================================================
 *  ADMS (Asynchronous Data Management System) is ZKTeco's "push" protocol.
 *  Unlike the old pull protocol (where a PC polls the device over TCP 4370
 *  using ZK's proprietary SDK protocol), in ADMS mode the *device* is the
 *  HTTP client: it periodically calls out to a URL you configure as the
 *  "Server Address" / "Server Port" and PUSHES its data to you.
 *
 * ============================================================================
 *  Why do devices call /iclock/* endpoints?
 * ============================================================================
 *  ZKTeco firmware (and the compatible "iClock" / "ZKBio" family) speaks the
 *  legacy InBiometrics/iClock HTTP dialect. The device only ever calls a small
 *  fixed set of paths:
 *
 *    GET  /iclock/cdata?SN=XXXX&Stamp=123&ErrorUpdate=0&TransFlag=...
 *         -> "heartbeat / registration". The server replies with an STAMP.
 *           If our stamp differs from the device's, the device uploads data.
 *
 *    POST /iclock/cdata?SN=XXXX&table=ATTLOG&Stamp=124&Flag=...
 *         -> the actual upload. Body is TAB-separated lines of punches.
 *         Also used for table=USERINFO (enrolled users), table=FINGER /
 *         table=TEMPLATE (fingerprint templates, base64/XXTEA-encoded blobs),
 *         table=OPERLOG, table=SYSLOG ...
 *
 *    GET  /iclock/getrequest?SN=XXXX&Stamp=...
 *         -> "any commands for me?" Server replies "OK" (nothing) or a
 *           command line such as "C:reload:20240101" / "DataUpdate:..."
 *
 *    GET|POST /iclock/devicecmd?SN=XXXX&CMD=...
 *         -> device reporting the result of a previously issued command
 *           (ack/nack with a "Result: n" body).
 *
 *    Anything else under /iclock/*  -> unknown to us; still answer 200 so the
 *           device never thinks the server is dead and stops pushing.
 *
 * ============================================================================
 *  How attendance data is typically pushed
 * ============================================================================
 *  1. Device boots / loses and regains network  -> GET /iclock/cdata (reg)
 *  2. Device polls every few seconds           -> GET /iclock/cdata (heartbeat)
 *  3. User punches on the device               -> row is written to ATTLOG
 *  4. On the next poll the server returns a STAMP newer than the device's
 *     -> device POSTs the accumulated rows to /iclock/cdata?table=ATTLOG
 *  5. Server replies "OK" and the device advances its stamp.
 *
 *  ATTLOG line format (TAB-separated, one punch per line):
 *       sn\tuserId\tverified\ttime\taction\tworkCode
 *  e.g. 0\t1001\t1\t2024-05-04 09:01:22\t0\t0
 *
 * ============================================================================
 *  What to capture for protocol analysis
 * ============================================================================
 *  - Client IP + every header (User-Agent tells you the firmware family)
 *  - Full query string (SN, table, Stamp, Flag, TransFlag, ErrorUpdate...)
 *  - RAW body, byte-exact: templates/logs are NOT JSON and any JSON.parse
 *    middleware would destroy them. Encoding matters (GBK vs UTF-8).
 *  - Method + exact path (devices vary: some use GET with ?TransFlag=...)
 *  - Our response status + body (the device may retry or give up based on it)
 *  - Timing between heartbeats and pushes (reveals the device's poll interval)
 * ============================================================================
 */

import type { PunchRecord, RequestKind } from '../types';

/** Query params always arrive as strings in Express. Normalise to a plain map. */
export function queryStringRecord(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    out[k] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  return out;
}

/**
 * Classify what the device is doing from path + query.
 * Kept intentionally simple and easy to extend.
 */
export function classifyRequest(
  path: string,
  query: Record<string, string>,
  method: string,
): RequestKind {
  if (path === '/health' || path === '/logs' || path === '/debug/network') return 'system';

  if (path.startsWith('/iclock/')) {
    const table = (query['table'] || '').toUpperCase();

    // POST with a table => the device is uploading data.
    if (method === 'POST' && table) return 'attendance-push';

    // devicecmd = device acknowledging a command we gave it.
    if (path === '/iclock/devicecmd') return 'command-ack';

    // cdata without table, or getrequest => polling.
    if (path === '/iclock/cdata' || path === '/iclock/getrequest') {
      // A POST with no table is still usually an empty upload / registration.
      return method === 'POST' ? 'registration' : 'heartbeat';
    }

    // Registration often shows up as the very first call with SN but no table.
    if (query['SN'] && !table) return 'registration';
    return 'unknown';
  }

  return 'unknown';
}

/**
 * Parse an ATTLOG (or similar) body into structured punches.
 *
 * Handles:
 *  - "ATTLOG\t..." header line (some firmware prefixes the table name)
 *  - Blank lines and trailing newlines
 *  - Both TAB-separated rows and rows the device may pad with spaces
 *
 * Returns [] for non-attendance bodies (USERINFO/FINGER etc.) so the raw
 * body is always preserved in the record anyway.
 */
export function parsePunches(rawBody: string, table?: string): PunchRecord[] {
  if (!rawBody) return [];
  const t = (table || '').toUpperCase();
  // If a table is explicitly something else, do not try to parse punches.
  if (t && t !== 'ATTLOG') return [];

  const punches: PunchRecord[] = [];
  const lines = rawBody.split(/\r?\n/);

  const TIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip informational header lines like "ATTLOG" or "SN:xxxx".
    if (/^[A-Za-z]+$/i.test(trimmed)) continue;

    const cols = trimmed.split('\t');

    if (cols.length >= 5) {
      const timeIdx = cols.findIndex((c) => TIME_RE.test(c.trim()));

      if (timeIdx === 1) {
        // Official ZKTeco PUSH SDK layout:
        //   Pin HT Time HT Status HT Verify HT Workcode HT Reserved HT Reserved
        //   HT MaskFlag HT Temperature HT ConvTemperature
        punches.push({
          pin: cols[0].trim(),
          timestamp: cols[1].trim(),
          status: cols[2].trim(),
          verified: cols[3].trim(),
          workcode: cols[4].trim(),
        } as PunchRecord);
        continue;
      }

      if (timeIdx === 3 || timeIdx === -1) {
        // Legacy iClock layout (and no-datetime fallback):
        //   sn, userId, verified, time, action, workCode
        punches.push({
          pin: cols[1].trim(),
          verified: cols[2].trim(),
          timestamp: cols[3].trim(),
          status: cols[4].trim(),
          workcode: cols[5] !== undefined ? cols[5].trim() : undefined,
        } as PunchRecord);
        continue;
      }
    }
    // Fallback: single-space separated "1001 2024-05-04 09:01:22 0 0"
    const sp = trimmed.split(/\s+/);
    if (sp.length >= 3) {
      punches.push({
        pin: sp[0],
        timestamp: sp.slice(1, 3).join(' '),
        status: sp[3] ?? '0',
        workcode: sp[4],
      } as PunchRecord);
    }
  }
  return punches;
}

/**
 * Body for responses that ZKTeco firmware understands.
 *  - "OK"            : generic success (cdata / devicecmd)
 *  - "OK\nStamp=<n>" : heartbeat answer; a *newer* stamp makes the device upload
 *  - "OK\n" + empty  : getrequest => "no commands queued"
 *
 * For a pure connectivity test, "OK" for everything is enough — the device
 * will still push its data as long as we answer 200.
 */
export function admsResponse(kind: RequestKind, stamp: number): string {
  switch (kind) {
    case 'heartbeat':
      return `OK\nStamp=${stamp}\n`;
    case 'attendance-push':
      return 'OK';
    case 'command-ack':
      return 'OK';
    case 'registration':
      return `OK\nStamp=${stamp}\n`;
    default:
      return 'OK';
  }
}
