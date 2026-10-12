/**
 * One-off: re-parse punches stored in logs/device-requests.log from their
 * raw ATTLOG bodies (fixes records written with the pre-fix parser).
 * Run: npx tsx scripts/reparse-log.ts
 */
import fs from 'fs';
import path from 'path';
import { parsePunches } from '../src/services/parser';
import type { RequestRecord } from '../src/types';

const logFile = path.resolve(__dirname, '../logs/device-requests.log');
const backup = `${logFile}.bak`;

if (!fs.existsSync(logFile)) {
  console.log('no log file, nothing to do');
  process.exit(0);
}

fs.copyFileSync(logFile, backup);

const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
let changed = 0;
let punchesTotal = 0;

const out = lines.map((line) => {
  if (!line.trim()) return line;
  let rec: RequestRecord;
  try {
    rec = JSON.parse(line) as RequestRecord;
  } catch {
    return line;
  }
  const tableMatch = /[?&]table=([^&]+)/i.exec(rec.url || '');
  const table = tableMatch ? decodeURIComponent(tableMatch[1]) : undefined;
  if ((table || '').toUpperCase() !== 'ATTLOG') return line;

  const before = JSON.stringify(rec.punches || []);
  rec.punches = parsePunches(rec.rawBody || '', table);
  const after = JSON.stringify(rec.punches);
  if (before !== after) changed++;
  punchesTotal += rec.punches.length;
  return JSON.stringify(rec);
});

fs.writeFileSync(logFile, out.join('\n'), 'utf8');
console.log(`re-parsed ${changed} ATTLOG records, total punches now ${punchesTotal}`);
console.log(`backup written to ${backup}`);
