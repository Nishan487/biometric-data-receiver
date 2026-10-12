/**
 * Express application wiring.
 *
 * Middleware order (important):
 *   1. rawBodyCapture  — must run FIRST so the byte-exact body is available
 *                        to everything downstream (ZKTeco sends plain text,
 *                        not JSON — see middleware/rawBody.ts).
 *   2. accessLogger     — Morgan one-line access log (console + log file).
 *   3. requestLogger    — builds the full RequestRecord on response finish,
 *                        pushes it into memory and appends it to the file.
 *   4. routes           — system routes, ADMS device routes, catch-all.
 */
import express, { type Express, type Request, type Response } from 'express';
import { rawBodyCapture } from './middleware/rawBody';
import { accessLogger } from './middleware/morgan';
import { requestLogger } from './middleware/requestLogger';
import { buildRoutes } from './routes';

export function createApp(): Express {
  const app = express();

  // Devices sometimes send via IPv6 or a proxy; keep Express trusting the
  // socket-level info only (no security-sensitive trust here, this is a mock).
  app.set('trust proxy', false);
  // Plain text responses (ZKTeco firmware chokes on JSON content-types).
  app.disable('x-powered-by');

  app.use(rawBodyCapture());
  app.use(accessLogger());
  app.use(requestLogger());

  app.use(buildRoutes());

  // Express default error handler — log it and still answer 200 so a bad
  // payload from the device never kills the connection test.
  app.use((err: Error, req: Request, res: Response, _next: unknown) => {
    console.error('[ERROR]', err.message, '\n', err.stack);
    if (!res.headersSent) {
      res.status(200).type('text/plain').send('OK');
    }
  });

  return app;
}
