import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../toolRegistry';
import { toToolContracts } from './toolAdapter';

describe('toolAdapter', () => {
  it('maps only registered Obsidian tools — no extras', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'search_vault',
      description: 'search',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async (args) => JSON.stringify({ query: args.query }),
    });
    registry.register({
      name: 'read_note',
      description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async () => JSON.stringify({ content: 'ok' }),
    });

    const contracts = toToolContracts(registry);
    expect(contracts.map((c) => c.name).sort()).toEqual(['read_note', 'search_vault']);
    expect(contracts.some((c) => c.name === 'bash' || c.name === 'web_search')).toBe(false);

    const search = contracts.find((c) => c.name === 'search_vault');
    const result = await search!.execute(
      {
        repoRoot: 'obsidian-vault',
        stateDir: 'obsidian-agent',
        session: {
          id: 's',
          status: 'running',
          agentId: 'obsidian-palace',
          createdAt: new Date().toISOString(),
          metadata: {},
        },
        agent: {
          id: 'obsidian-palace',
          name: 'Obsidian Palace',
          role: 'assistant',
          instructions: 'test',
          capabilities: [],
        },
      },
      { query: 'graph' }
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('graph');
  });
});
