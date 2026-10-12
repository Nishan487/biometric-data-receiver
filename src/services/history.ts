/**
 * In-memory request history (no database).
 *
 * A simple ring buffer capped at config.historyMax entries. GET /logs reads
 * from here. Swap this out for a real DB when turning the mock into a
 * production ingestion service — the interface (push/peek) stays the same.
 */
import { config } from '../config';
import type { RequestRecord } from '../types';

const history: RequestRecord[] = [];
let nextId = 1;

/** Reserve the next sequential id (used before the record is fully built). */
export function nextRecordId(): number {
  return nextId++;
}

/** Append a record, trimming the oldest entries when over capacity. */
export function pushRecord(record: RequestRecord): void {
  history.push(record);
  if (history.length > config.historyMax) {
    history.splice(0, history.length - config.historyMax);
  }
}

/** The last `count` requests, newest last. */
export function lastRecords(count: number): RequestRecord[] {
  return history.slice(Math.max(0, history.length - count));
}

/** Total number of requests seen since boot. */
export function recordCount(): number {
  return history.length;
}

/** Last record (handy for debugging / future extension). */
export function lastRecord(): RequestRecord | undefined {
  return history[history.length - 1];
}
