import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { LLMClient } from './llmClient';

function sse(content: string, finish?: string): string {
  const choice: Record<string, unknown> = { delta: { content } };
  if (finish) choice.finish_reason = finish;
  return `data: ${JSON.stringify({ choices: [choice] })}\n\n`;
}

describe('LLMClient.stream', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
    server = undefined;
  });

  it('forwards SSE tokens as they arrive instead of waiting for the whole body', async () => {
    const tokens: string[] = [];
    const times: number[] = [];
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse('Hel'));
      setTimeout(() => {
        res.write(sse('lo', 'stop'));
        res.write('data: [DONE]\n\n');
        res.end();
      }, 40);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const client = new LLMClient({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'test',
      modelName: 'mock',
    });
    const response = await client.stream([{ role: 'user', content: 'hi' }], (delta) => {
      if (!delta.content) return;
      tokens.push(delta.content);
      times.push(Date.now());
    });
    expect(tokens).toEqual(['Hel', 'lo']);
    expect(response.content).toBe('Hello');
    expect(times[1]! - times[0]!).toBeGreaterThan(15);
  });
});
