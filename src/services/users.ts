/**
 * Employee roster (PIN → name) taken from device OPERLOG pushes.
 *
 * The device sends OPERLOG bodies containing lines like:
 *   USER PIN=16\tName=Kshitiz\tPri=0\tPasswd=\tCard=\tGrp=1\t...
 * whenever users are created/updated (and typically once for the whole
 * roster shortly after the first connection).
 *
 * Names are:
 *   - rebuilt from logs/device-requests.log on first use (survives restarts)
 *   - updated live whenever a new OPERLOG arrives
 * and attached to /punches, /attendance and their CSV exports.
 */
import fs from 'fs';
import type { RequestRecord } from '../types';
import { logFilePath } from './fileLogger';

export interface DeviceUser {
  pin: string;
  name: string;
}

const users = new Map<string, string>();
let loaded = false;

/**
 * Extract USER entries from an OPERLOG body.
 * Tolerant of field order / extra fields: we only need PIN and Name.
 */
export function parseOperlogUsers(rawBody: string): DeviceUser[] {
  const out: DeviceUser[] = [];
  if (!rawBody) return out;

  for (const line of rawBody.split(/\r?\n/)) {
    if (!/^USER\s/.test(line)) continue; // skip FP/FACE/etc. entries
    let pin = '';
    let name = '';
    for (const field of line.split('\t')) {
      const f = field.trim();
      if (f.startsWith('USER PIN=')) pin = f.slice('USER PIN='.length).trim();
      else if (f.startsWith('PIN=') && !pin) pin = f.slice(4).trim();
      else if (f.startsWith('Name=')) name = f.slice(5).trim();
    }
    if (pin && name) out.push({ pin, name });
  }
  return out;
}

/** Merge parsed users into the map. Returns how many were added/updated. */
export function ingestOperlog(rawBody: string): number {
  const parsed = parseOperlogUsers(rawBody);
  for (const u of parsed) users.set(u.pin, u.name);
  return parsed.length;
}

/** Rebuild the map from the JSONL file log (idempotent, first call only). */
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(logFilePath)) return;
    const text = fs.readFileSync(logFilePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as RequestRecord;
        const isOperlog =
          (rec.table || '').toUpperCase() === 'OPERLOG' ||
          (rec.url || '').includes('table=OPERLOG');
        if (isOperlog && rec.rawBody) ingestOperlog(rec.rawBody);
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // never let roster loading break the server
  }
}

/** Display name for a PIN ("" when unknown). */
export function getUserName(pin: string | undefined): string {
  if (!pin) return '';
  ensureLoaded();
  return users.get(pin) ?? '';
}

/** Full roster for GET /users. */
export function listUsers(): DeviceUser[] {
  ensureLoaded();
  return [...users.entries()]
    .map(([pin, name]) => ({ pin, name }))
    .sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }));
}
