/**
 * Entry point: starts the ZKTeco ADMS mock server on 0.0.0.0:8081
 * (host/port come from .env, defaults in src/config.ts).
 *
 * Run in live/watch mode:   npm run dev
 * Run compiled:             npm run build && npm start
 */
import { createApp } from './app';
import { config } from './config';
import { printBanner } from './utils/banner';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';

const app = createApp();

const useTls =
  config.tlsCert &&
  config.tlsKey &&
  fs.existsSync(config.tlsCert) &&
  fs.existsSync(config.tlsKey);

const server: http.Server = useTls
  ? https.createServer(
      {
        cert: fs.readFileSync(config.tlsCert),
        key: fs.readFileSync(config.tlsKey),
        minVersion: 'TLSv1.2',
      },
      app,
    )
  : http.createServer(app);

server.listen(config.port, config.host, () => {
  if (useTls) console.log('[TLS] HTTPS enabled (device pushes over TLS)');
  printBanner();
});

// When the main port is TLS-only (device requirement), mirror the same app
// on a plain-HTTP port so browsers can view /punches, /attendance, /logs.
if (useTls && config.httpPort && config.httpPort !== config.port) {
  const httpServer = http.createServer(app);
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[HTTP mirror] port ${config.httpPort}: ${err.message}`);
  });
  httpServer.listen(config.httpPort, config.host, () => {
    console.log(`[HTTP] plain HTTP mirror on port ${config.httpPort} (for browsers)`);
  });
}

// Keep the process alive and surface socket-level errors (EADDRINUSE etc.).
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n[FAIL] Port ${config.port} is already in use.\n` +
        `       Stop the other process or change PORT in .env\n` +
        `       (and update "Server Port" on the device to match).\n`,
    );
  } else {
    console.error('[FAIL] server error:', err.message);
  }
  process.exit(1);
});

// Friendly shutdown (Ctrl+C in watch mode).
process.on('SIGINT', () => {
  console.log('\nShutting down ZKTeco ADMS mock server...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
});
