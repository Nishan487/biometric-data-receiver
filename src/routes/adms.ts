/**
 * ADMS device routes — everything under /iclock/*.
 *
 * The device is the HTTP client; it expects short plain-text answers:
 *   - "OK"              success
 *   - "OK\nStamp=<n>"   heartbeat answer (a NEWER stamp triggers an upload)
 *   - "ERROR" / "?"     some firmware treats anything else as failure
 *
 * We therefore return HTTP 200 + "OK" (with a Stamp for cdata) for every
 * ADMS call, whatever the device sends, so it keeps talking to us while you
 * observe the traffic.
 *
 * Easy extension points for a real ingestion service:
 *   - store `record.punches` in a DB inside the requestLogger/history hook
 *   - queue commands and answer GET /iclock/getrequest with them
 *   - validate SN against an allow-list and return "ERROR: unknown device"
 */
import { Router, type Request, type Response } from 'express';
import {
  admsResponse,
  classifyRequest,
  parsePunches,
  queryStringRecord,
} from '../services/parser';

/**
 * ============================================================================
 *  Per-device upload cursor (the "Stamp")
 * ============================================================================
 *  The device sends `Stamp=<n>` = "I have already uploaded up to record n".
 *  We reply with OUR cursor = "send me anything after n".
 *
 *  Rules that make the device push real data:
 *    - cursor starts at 0            => "I have nothing"  => the device uploads
 *      its ENTIRE buffered ATTLOG (including punches made before it was
 *      connected) the first time it talks to us.
 *    - the cursor only advances when the device POSTs data, using the stamp
 *      IT reported (or +1 per punch if it reports none) => no re-uploads.
 *
 *  IMPORTANT: never seed this with Date.now()/1000 or any large number.
 *  Firmware that treats a huge returned Stamp as "server already has records
 *  up to N" will upload NOTHING at all — which is exactly what we had before.
 * ============================================================================
 */
const cursors = new Map<string, number>();

/** Serial number of the calling device (falls back to 'unknown'). */
function snOf(query: Record<string, string>): string {
  return query['SN'] || query['sn'] || 'unknown';
}

/** Current cursor for a device — 0 until it has pushed something. */
function cursorOf(sn: string): number {
  return cursors.get(sn) ?? 0;
}

/** Advance the cursor after a successful upload. */
function advanceCursor(sn: string, query: Record<string, string>, punchCount: number): void {
  const reported = Number.parseInt(query['Stamp'] ?? '', 10);
  const current = cursorOf(sn);
  let next = current;
  if (Number.isFinite(reported) && reported > current) {
    next = reported;
  } else if (punchCount > 0) {
    next = current + punchCount;
  }
  cursors.set(sn, next);
}

/** Send a plain-text ADMS body with no content-type surprises. */
function reply(res: Response, body: string, status = 200): void {
  res.status(status);
  res.type('text/plain');
  res.send(body);
}

export const admsRouter: Router = Router();

/**
 * GET /iclock/cdata
 * Registration + heartbeat. The device says "I'm SN=..., my stamp is X".
 * We reply with our cursor for that device: 0 on first contact (=> "send me
 * everything you have"), then whatever we have stored so far.
 */
admsRouter.get('/iclock/cdata', (req: Request, res: Response) => {
  const q = queryStringRecord(req.query);
  const kind = classifyRequest(req.path, q, req.method);
  reply(res, admsResponse(kind, cursorOf(snOf(q))));
});

/**
 * POST /iclock/cdata?SN=...&table=ATTLOG
 * The actual data upload: ATTLOG punches, USERINFO, FINGER templates, etc.
 * The raw body has already been captured by the rawBody middleware and
 * parsed/recorded by requestLogger — here we only acknowledge receipt and
 * move our cursor forward so the device does not send these rows again.
 */
admsRouter.post('/iclock/cdata', (req: Request, res: Response) => {
  const q = queryStringRecord(req.query);
  const kind = classifyRequest(req.path, q, req.method);
  const punchCount = parsePunches(req.rawBody ?? '', q['table']).length;
  const sn = snOf(q);
  advanceCursor(sn, q, punchCount);
  // "OK" tells the device the rows were accepted.
  reply(res, admsResponse(kind, cursorOf(sn)));
});

/**
 * GET /iclock/getrequest
 * "Do you have any commands for me?" (enroll user, reboot, sync time, ...)
 * Answering plain "OK" means: nothing queued, keep polling.
 * To issue a command later, respond with e.g. "C:reboot:" or
 * "DataUpdate:USERINFO" and the device will act on it.
 */
admsRouter.get('/iclock/getrequest', (req: Request, res: Response) => {
  const q = queryStringRecord(req.query);
  reply(res, admsResponse('heartbeat', cursorOf(snOf(q))));
});

admsRouter.post('/iclock/getrequest', (req: Request, res: Response) => {
  const q = queryStringRecord(req.query);
  reply(res, admsResponse('heartbeat', cursorOf(snOf(q))));
});

/**
 * GET|POST /iclock/devicecmd?SN=...&CMD=...
 * The device reporting the outcome of a command we previously issued.
 * Body usually looks like "Result: 0" / "Result: 1" / "Error: ...".
 */
admsRouter.all('/iclock/devicecmd', (req: Request, res: Response) => {
  const q = queryStringRecord(req.query);
  reply(res, admsResponse('command-ack', cursorOf(snOf(q))));
});

/**
 * /iclock/* catch-all for any other path the firmware may use
 * (e.g. /iclock/devicecmd/, /iclock/ping, vendor-specific extras).
 * Still 200 so the device never gives up on us.
 */
admsRouter.all('/iclock/*', (req: Request, res: Response) => {
  console.log(`[ADMS] unhandled device path hit: ${req.method} ${req.originalUrl}`);
  reply(res, 'OK');
});
