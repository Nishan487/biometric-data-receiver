/**
 * System/debug routes — used by us, not by the device.
 *
 *   GET /health          -> { "status": "ok" }
 *   GET /logs            -> device (/iclock/*) traffic; ?all=1 for everything
 *   GET /debug/network   -> { serverIp, port, time }
 *   GET /punches         -> ONLY parsed punches (Nepal time + ISO + UTC)
 *   GET /punches.csv     -> same data as a downloadable CSV
 *   GET /attendance      -> one row/employee/day: checkIn + checkOut (Nepal)
 *   GET /attendance.csv  -> same rows as CSV
 *   GET /users           -> employee roster (PIN + name) from device OPERLOG
 *
 * Note: GET /logs returns the same records that are appended (JSONL) to
 * logs/device-requests.log, so you can inspect recent traffic without a DB.
 * GET /punches / GET /attendance read the in-memory history merged with the
 * JSONL file, so punches survive a server restart.
 */
import { Router, type Request, type Response } from 'express';
import { config } from '../config';
import { lastRecords } from '../services/history';
import { detectLanIp } from '../services/network';
import { collectPunches, punchesToCsv } from '../services/punches';
import { buildAttendance, attendanceToCsv, type AttendanceQuery } from '../services/attendance';
import { listUsers } from '../services/users';
import { nowInReportTz } from '../services/time';
import type { HealthInfo, NetworkInfo } from '../types';

export const systemRouter: Router = Router();

/** GET /health — liveness check used by the banner / monitoring. */
systemRouter.get('/health', (_req: Request, res: Response<HealthInfo>) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /logs — recent requests.
 *   /logs        -> DEVICE traffic only (/iclock/*) — the useful view
 *   /logs?all=1  -> everything, including browser/favicon/health noise
 * In-memory records always carry a 'source' field (set at request time).
 * Order: LATEST operation first, oldest last (top→bottom = newest→oldest).
 */
systemRouter.get('/logs', (req: Request, res: Response) => {
  const wantAll = req.query.all === '1' || req.query.all === 'true';
  const stored = lastRecords(config.historyMax);
  const records = wantAll ? stored : stored.filter((r) => r.source === 'device');
  const visible = records.slice(-config.logsLimit).reverse();
  res.status(200).json({
    count: visible.length,
    total: stored.length,
    deviceOnly: !wantAll,
    limit: config.logsLimit,
    receivedAt: new Date().toISOString(),
    requests: visible,
  });
});

/** Default number of punches returned by GET /punches. */
const PUNCH_LIMIT_DEFAULT = 200;

/**
 * Read ?sn= and ?limit= safely.
 * A bad limit (NaN / negative / absurd) falls back to defaults instead of
 * throwing — this endpoint is meant to be hit from a browser or a phone.
 */
function parsePunchQuery(req: Request): { sn?: string; limit: number } {
  const raw = req.query;
  const sn = typeof raw.sn === 'string' && raw.sn.length ? raw.sn : undefined;
  const parsed = typeof raw.limit === 'string' ? Number.parseInt(raw.limit, 10) : NaN;
  const limit =
    Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 5000) : PUNCH_LIMIT_DEFAULT;
  return { sn, limit };
}

/**
 * GET /punches — the punches-only view (LATEST punch first).
 *   /punches                 last 200 punches, newest→oldest
 *   /punches?sn=ACCE19240001 one device only
 *   /punches?limit=50        newest 50
 */
systemRouter.get('/punches', (req: Request, res: Response) => {
  const { sn, limit } = parsePunchQuery(req);
  const punches = collectPunches({ sn, limit });
  res.status(200).json({
    count: punches.length,
    limit,
    sn: sn ?? null,
    receivedAt: new Date().toISOString(),
    serverTimeNepal: nowInReportTz(),
    deviceClockTz: config.deviceClockTz,
    reportTz: config.reportTz,
    punches,
  });
});

/**
 * GET /punches.csv — same data, Excel-ready.
 * Served as an attachment so a phone/browser downloads it directly.
 */
systemRouter.get('/punches.csv', (req: Request, res: Response) => {
  const { sn, limit } = parsePunchQuery(req);
  const punches = collectPunches({ sn, limit: Math.max(limit, 5000) });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.status(200);
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="punches-${stamp}.csv"`);
  res.send(punchesToCsv(punches));
});

/** GET /debug/network — IP/port/time so you can fill the device config. */
systemRouter.get('/debug/network', (_req: Request, res: Response<NetworkInfo>) => {
  const info: NetworkInfo = {
    serverIp: detectLanIp(),
    port: config.port,
    time: new Date().toISOString(),
  };
  res.status(200).json(info);
});

/**
 * GET /users — employee roster (PIN + name) as known by the device.
 * Built from OPERLOG pushes; names also appear on /punches and /attendance.
 */
systemRouter.get('/users', (_req: Request, res: Response) => {
  const users = listUsers();
  res.status(200).json({
    count: users.length,
    receivedAt: new Date().toISOString(),
    users,
  });
});

/**
 * Read the common filters shared by /attendance endpoints.
 * ?sn= ?pin= ?from=YYYY-MM-DD ?to=YYYY-MM-DD ?limit=
 * Bad values degrade to "no filter" instead of throwing.
 */
function parseAttendanceQuery(req: Request): AttendanceQuery & { limit: number } {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length ? v : undefined;
  const rawLimit = str(req.query.limit);
  const n = rawLimit ? Number.parseInt(rawLimit, 10) : NaN;
  return {
    sn: str(req.query.sn),
    pin: str(req.query.pin),
    from: str(req.query.from),
    to: str(req.query.to),
    limit: Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 5000,
  };
}

/**
 * GET /attendance — ONE ROW PER EMPLOYEE PER DAY with separate
 *                   checkIn / checkOut times (Nepal time, +05:45).
 *
 *   /attendance
 *   /attendance?sn=ACCE19240001
 *   /attendance?pin=1001&from=2026-10-01&to=2026-10-05
 */
const attendanceJsonHandler = (req: Request, res: Response): void => {
  const { limit, ...filters } = parseAttendanceQuery(req);
  const punches = collectPunches({ sn: filters.sn, limit });
  const rows = buildAttendance(punches, filters);
  res.status(200).json({
    count: rows.length,
    filters: {
      sn: filters.sn ?? null,
      pin: filters.pin ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
    },
    serverTimeNepal: nowInReportTz(),
    reportTz: config.reportTz,
    receivedAt: new Date().toISOString(),
    attendance: rows,
  });
};

/** GET /attendance.csv — the same rows as an Excel-ready download. */
const attendanceCsvHandler = (req: Request, res: Response): void => {
  const { limit, ...filters } = parseAttendanceQuery(req);
  const punches = collectPunches({ sn: filters.sn, limit });
  const rows = buildAttendance(punches, filters);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.status(200);
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${stamp}.csv"`);
  res.send(attendanceToCsv(rows));
};

systemRouter.get('/attendance', attendanceJsonHandler);
systemRouter.get('/attendance.csv', attendanceCsvHandler);

/**
 * Typo-proof aliases.
 * "/attendence" (missing the second 'a') used to fall through to the global
 * catch-all and return plain "OK" — i.e. the CSV download silently did
 * nothing. Same handlers are registered on both spellings.
 */
systemRouter.get('/attendence', attendanceJsonHandler);
systemRouter.get('/attendence.csv', attendanceCsvHandler);
