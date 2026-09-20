/**
 * Desktop Obsidian has Node http/https. Use them for SSE so we are not stuck
 * with Chromium fetch / requestUrl, both of which often buffer the whole body.
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

export async function postSseBytes(
  url: string,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  onBytes: (chunk: Buffer) => void | Promise<void>
): Promise<void> {
  const parsed = new URL(url);
  const lib = parsed.protocol === 'https:' ? https : http;
  const payload = Buffer.from(body, 'utf8');

  await new Promise<void>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': String(payload.length),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            reject(new Error(`API request failed (${status}): ${text}`));
          });
          res.on('error', reject);
          return;
        }

        let chain = Promise.resolve();
        res.on('data', (chunk: Buffer) => {
          res.pause();
          chain = chain
            .then(() => onBytes(chunk))
            .then(() => res.resume())
            .catch(reject);
        });
        res.on('end', () => {
          chain.then(() => resolve()).catch(reject);
        });
        res.on('error', reject);
      }
    );

    const abort = () => {
      req.destroy(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    req.on('error', (err) => {
      signal?.removeEventListener('abort', abort);
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}
