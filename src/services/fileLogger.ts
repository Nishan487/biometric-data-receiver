/**
 * Appends every received request to logs/device-requests.log.
 *
 * Format: one JSON object per line (JSONL) so the file stays grep-able and
 * machine-parseable:
 *   tail -f logs/device-requests.log | jq .
 *
 * Writes are fire-and-forget; a mock/debug server must never crash because
 * the disk filled up. If you extend this into a real service, replace it
 * with a proper streaming/rotating logger (pino / winston).
 */
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import type { RequestRecord } from '../types';

const logPath = path.resolve(process.cwd(), config.logFile);

/** Make sure logs/ exists before the first write. */
function ensureLogFile(): void {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync('', '');
    }
  } catch {
    // Ignore — logging must never break the server.
  }
}

ensureLogFile();

/** Append one record as a JSONL line. */
export function appendRecord(record: RequestRecord): void {
  try {
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // Ignore write errors (full disk / permissions) in mock mode.
  }
}

/** Append an arbitrary text block (used for request/response tracing). */
export function appendText(text: string): void {
  try {
    fs.appendFileSync(logPath, text, 'utf8');
  } catch {
    // Ignore.
  }
}

export const logFilePath = logPath;
