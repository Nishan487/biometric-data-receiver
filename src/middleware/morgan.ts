/**
 * Morgan — standard HTTP access log (console only, one compact line per
 * request with method, URL, status, duration and user-agent).
 *
 * The machine-readable trail lives in logs/device-requests.log and is
 * written by requestLogger as pure JSONL — keeping morgan out of that file
 * means `tail -f logs/device-requests.log | jq .` always works.
 */
import morgan from 'morgan';
import { c, nowStamp } from '../utils/format';

/** Duration of the request in milliseconds (set by morgan's response timer). */
morgan.token('req-time-millis', (_req, res) => {
  const start = (res as unknown as { _start?: [number, number] })._start;
  if (!start) return '0';
  const diff = process.hrtime(start);
  return String(diff[0] * 1000 + Math.round(diff[1] / 1e6));
});

export function accessLogger() {
  return morgan(
    (tokens, req, res) =>
      [
        c.dim(nowStamp()),
        c.blue(tokens.method(req, res) || '-'),
        c.cyan(tokens.url(req, res) || '-'),
        c.yellow(tokens.status(req, res) || '-'),
        c.dim(`${tokens['req-time-millis'](req, res) || '?'}ms`),
        c.dim(tokens['user-agent'](req, res) || ''),
      ].join(' ') + '\n',
    { stream: process.stdout },
  );
}
