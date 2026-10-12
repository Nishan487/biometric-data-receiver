/**
 * Raw-body capture middleware.
 *
 * WHY THIS EXISTS
 * ---------------
 * ZKTeco devices do NOT send JSON. They send plain text / custom payloads:
 *
 *   - POST /iclock/cdata?table=ATTLOG  -> "0\t1001\t1\t2024-05-04 09:01:22\t0\t0\n"
 *   - POST /iclock/cdata?table=FINGER  -> base64 / XXTEA-encoded template blob
 *   - POST /iclock/devicecmd           -> "Result: 1\n"  (command ack)
 *   - some firmware -> GBK-encoded text, no charset declared
 *
 * express.json() would ignore all of that (wrong content-type) and any
 * JSON.parse() downstream would blow up. So we buffer EVERYTHING as a
 * Buffer first, keep an exact byte copy on `req.rawBody`, and also expose
 * a best-effort UTF-8 string on `req.bodyText` for display/parsing.
 *
 * The buffered body is then re-exposed as `req.body` (string) so routes
 * can read it without re-consuming the stream.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Augment Express Request with our captured fields. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Byte-exact request body (Buffer). Empty buffer when no body. */
      rawBodyBuffer?: Buffer;
      /** Body decoded as UTF-8 (may contain replacement chars for GBK). */
      rawBody?: string;
      /** Convenience alias used by parsers. */
      bodyText?: string;
      /** High-resolution start time for duration measurement. */
      startTime?: [number, number];
    }
  }
}

export function rawBodyCapture(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });

    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      req.rawBodyBuffer = buf;
      req.rawBody = buf.length ? buf.toString('utf8') : '';
      req.bodyText = req.rawBody;
      // Expose as body so route handlers can read it directly.
      (req as unknown as { body: unknown }).body = req.rawBody;
      next();
    });

    req.on('error', (err) => {
      // Malformed stream: still continue so we can log what we got.
      console.error('[rawBody] request stream error:', err.message);
      const buf = Buffer.concat(chunks);
      req.rawBodyBuffer = buf;
      req.rawBody = buf.toString('utf8');
      req.bodyText = req.rawBody;
      next();
    });
  };
}
