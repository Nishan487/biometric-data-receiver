/**
 * Route assembly.
 * Order matters: system routes first, then ADMS device routes, then a
 * global catch-all so NOTHING a device sends ever gets a 404.
 */
import { Router } from 'express';
import { systemRouter } from './system';
import { admsRouter } from './adms';

export function buildRoutes(): Router {
  const router = Router();

  router.use(systemRouter);
  router.use(admsRouter);

  // Global catch-all: unknown paths still get 200 + "OK".
  // (A 404 makes some firmware mark the server as down and stop pushing.)
  router.all('*', (req, res) => {
    console.log(`[CATCH-ALL] ${req.method} ${req.originalUrl}`);
    res.status(200).type('text/plain').send('OK');
  });

  return router;
}
