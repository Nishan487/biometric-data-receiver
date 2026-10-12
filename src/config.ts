/**
 * Configuration loaded from .env (dotenv).
 * All values have safe defaults so the server runs even without a .env file.
 */
import dotenv from 'dotenv';

dotenv.config();

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** Interface to bind. 0.0.0.0 = all interfaces, so devices on the LAN can reach us. */
  host: process.env.HOST || '0.0.0.0',
  /** Port configured on the device ("Server Port"). */
  port: intEnv('PORT', 8081),
  /** Ring-buffer size for the in-memory request history. */
  historyMax: intEnv('HISTORY_MAX', 500),
  /** Log file the device traffic is appended to. */
  logFile: 'logs/device-requests.log',
  /** How many recent requests GET /logs returns. */
  logsLimit: 100,
  /**
   * Timezone the biometric device's clock is set to (it has none of its own).
   * 'Asia/Kathmandu' = device shows Nepal local time (the normal setup).
   * Set to 'UTC' if the device clock is actually UTC — punch times are then
   * shifted +05:45 when reported.
   */
  deviceClockTz: process.env.DEVICE_CLOCK_TZ || 'Asia/Kathmandu',
  /** Timezone all reported times are expressed in. */
  reportTz: process.env.REPORT_TZ || 'Asia/Kathmandu',
  /**
   * Optional TLS (HTTPS) cert/key paths. When both exist, the server listens
   * with HTTPS — required by devices that push over TLS (port 8081).
   */
  tlsCert: process.env.TLS_CERT || '',
  tlsKey: process.env.TLS_KEY || '',
  /**
   * Plain-HTTP mirror port (browser convenience) used when TLS is enabled on
   * the main port. 0 = disabled.
   */
  httpPort: intEnv('HTTP_PORT', 8080),
} as const;
