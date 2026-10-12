/**
 * Console formatting helpers — makes the terminal output readable while
 * you watch a real device talk to the server.
 */
import type { RequestRecord } from '../types';

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;

function wrap(open: string, close: string) {
  return (s: string) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const c = {
  dim: wrap('2', '22'),
  bold: wrap('1', '22'),
  green: wrap('32', '39'),
  cyan: wrap('36', '39'),
  yellow: wrap('33', '39'),
  magenta: wrap('35', '39'),
  red: wrap('31', '39'),
  blue: wrap('34', '39'),
};

/** Local time with milliseconds: 2024-05-04 09:01:22.123 */
export function nowStamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** One-line summary used in the console. */
export function summarize(r: RequestRecord): string {
  const parts = [
    `${r.method} ${r.path}`,
    r.deviceSn ? `SN=${r.deviceSn}` : 'SN=-',
    r.table ? `table=${r.table}` : null,
    `ip=${r.clientIp}`,
    `${r.bodyLength}B`,
    r.punches.length ? `punches=${r.punches.length}` : null,
    `${r.durationMs}ms`,
    `-> ${r.responseStatus}`,
  ].filter(Boolean);
  return parts.join('  ');
}

/** Pretty block printed for each request. */
export function printRequest(r: RequestRecord): void {
  const line = c.dim('─'.repeat(72));
  console.log(line);
  console.log(
    `${c.bold(c.green('[' + String(r.id).padStart(4, '0') + ']'))} ${c.bold(
      c.cyan(r.kind.toUpperCase()),
    )}  ${c.yellow(nowStamp())}`,
  );
  console.log(`  ${c.bold('Endpoint :')} ${r.method} ${r.url}`);
  console.log(`  ${c.bold('Client   :')} ${r.clientIp}`);
  if (r.deviceSn) console.log(`  ${c.bold('Device   :')} SN=${r.deviceSn}`);
  if (r.table) console.log(`  ${c.bold('Table    :')} ${r.table}`);
  console.log(
    `  ${c.bold('Headers  :')} ${c.dim(JSON.stringify(r.headers))}`,
  );
  const q = Object.keys(r.query);
  if (q.length) {
    console.log(`  ${c.bold('Query    :')} ${c.dim(JSON.stringify(r.query))}`);
  } else {
    console.log(`  ${c.bold('Query    :')} ${c.dim('(none)')}`);
  }
  if (r.rawBody) {
    const body =
      r.rawBody.length > 800
        ? r.rawBody.slice(0, 800) + ` … (${r.rawBody.length} chars total)`
        : r.rawBody;
    console.log(`  ${c.bold('Raw body :')}`);
    console.log(c.dim(indent(body)));
  } else {
    console.log(`  ${c.bold('Raw body :')} ${c.dim('(empty)')}`);
  }
  if (r.punches.length) {
    console.log(`  ${c.bold('Parsed punches (' + r.punches.length + '):')}`);
    for (const p of r.punches.slice(0, 20)) {
      console.log(
        c.magenta(
          `    pin=${p.pin}  time=${p.timestamp}  status=${p.status}  verified=${
            p.verified ?? '-'
          }  workcode=${p.workcode ?? '-'}`,
        ),
      );
    }
    if (r.punches.length > 20) {
      console.log(c.dim(`    … and ${r.punches.length - 20} more`));
    }
  }
  console.log(
    `  ${c.bold('Response :')} ${r.responseStatus}  ${c.dim(`(${r.durationMs}ms)`)}`,
  );
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => '    ' + l)
    .join('\n');
}
