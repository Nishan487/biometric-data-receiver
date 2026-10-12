/**
 * requestLogger — the heart of the mock server.
 *
 * For EVERY request received (device or browser) it:
 *   1. Waits until the response has finished (res 'finish') so we know the
 *      status code we actually returned.
 *   2. Builds a RequestRecord with:
 *        - HTTP method, full URL, path
 *        - all headers
 *        - all query parameters
 *        - RAW body (byte-exact, captured by rawBody middleware)
 *        - client IP (res.locals / socket, honoring X-Forwarded-For)
 *        - extracted device SN, data table, parsed punches, request kind
 *   3. Pushes it into the in-memory history (GET /logs reads from there)
 *   4. Appends it to logs/device-requests.log as JSONL
 *   5. Prints a readable block to the console
 *
 * This middleware never throws: logging failures must not break the device
 * connection test.
 */
import type { Request, Response, NextFunction } from 'express';
import type { RequestKind, RequestRecord, RequestSource } from '../types';
import { queryStringRecord, classifyRequest, parsePunches } from '../services/parser';
import { nextRecordId, pushRecord } from '../services/history';
import { appendRecord } from '../services/fileLogger';
import { ingestOperlog } from '../services/users';
import { printRequest, nowStamp } from '../utils/format';

/** Client IP: trust X-Forwarded-For when behind a proxy, else the socket. */
function clientIpOf(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/** Normalize headers to a flat string map for storage/display. */
function headersOf(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

/**
 * Decide whether this is real biometric traffic or our own browser/UI noise.
 * Only /iclock/* is device traffic — everything else (health checks, favicon
 * fetches, /logs browsing) is tagged 'ui' and hidden from GET /logs by default.
 */
function sourceOf(req: Request): RequestSource {
  return req.path.startsWith('/iclock/') ? 'device' : 'ui';
}

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const t0 = process.hrtime.bigint();

    res.on('finish', () => {
      try {
        const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
        const query = queryStringRecord(req.query);
        const kind: RequestKind = classifyRequest(req.path, query, req.method);
        const rawBody = req.rawBody ?? '';
        const table = query['table'];

        const record: RequestRecord = {
          id: nextRecordId(),
          receivedAt: new Date().toISOString(),
          method: req.method,
          url: req.originalUrl || req.url,
          path: req.path,
          clientIp: clientIpOf(req),
          headers: headersOf(req),
          query,
          rawBody,
          bodyLength: req.rawBodyBuffer ? req.rawBodyBuffer.length : Buffer.byteLength(rawBody),
          kind,
          source: sourceOf(req),
          deviceSn: query['SN'] || query['sn'],
          table,
          punches: parsePunches(rawBody, table),
          responseStatus: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        };

        pushRecord(record);
        appendRecord(record);
        printRequest(record);

        // Keep the PIN→name roster fresh whenever the device pushes users.
        if ((table || '').toUpperCase() === 'OPERLOG') ingestOperlog(rawBody);
      } catch (err) {
        console.error(`[${nowStamp()}] requestLogger error:`, err);
      }
    });

    next();
  };
}
