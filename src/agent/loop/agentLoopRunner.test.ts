import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../toolRegistry';
import { AgentLoopRunner } from './agentLoopRunner';
import type { ModelAdapter, ModelTurnResult } from './loopTypes';

function stubAdapter(impl: (turn: number) => ModelTurnResult): ModelAdapter {
  let turn = 0;
  return {
    name: 'stub',
    async runTurn() {
      turn += 1;
      return impl(turn);
    },
    async summarizeMessages() {
      return '';
    },
  };
}

describe('AgentLoopRunner (ppeng mini)', () => {
  it('returns model text without inventing extra tools', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'search_vault',
      description: 'search vault',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async () => JSON.stringify({ results: [] }),
    });

    const runner = new AgentLoopRunner({
      modelAdapter: stubAdapter(() => ({
        stopReason: 'end',
        assistantParts: [{ type: 'text', text: 'hello from kernel' }],
      })),
      toolRegistry: registry,
      maxIterations: 4,
      systemPrompt: 'You are the Obsidian vault assistant.',
    });

    const text = await runner.run([{ role: 'user', content: 'hi' }], {});
    expect(text).toBe('hello from kernel');
  });

  it('executes only the registered vault tool then finishes', async () => {
    const queries: string[] = [];
    const registry = new ToolRegistry();
    registry.register({
      name: 'search_vault',
      description: 'search vault',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async (args) => {
        queries.push(String(args.query));
        return JSON.stringify({ results: [{ filePath: 'a.md' }] });
      },
    });

    const runner = new AgentLoopRunner({
      modelAdapter: stubAdapter((turn) => {
        if (turn === 1) {
          return {
            stopReason: 'tool_use',
            assistantParts: [
              {
                type: 'tool_call',
                toolCallId: 'call-1',
                name: 'search_vault',
                input: { query: 'palace' },
              },
            ],
          };
        }
        return {
          stopReason: 'end',
          assistantParts: [{ type: 'text', text: 'found palace' }],
        };
      }),
      toolRegistry: registry,
      maxIterations: 4,
      systemPrompt: 'sys',
    });

    const used: string[] = [];
    const text = await runner.run([{ role: 'user', content: 'find palace' }], {
      onToolResult: (name) => used.push(name),
    });

    expect(queries).toEqual(['palace']);
    expect(used).toEqual(['search_vault']);
    expect(text).toBe('found palace');
  });

  it('does not execute unknown extra tools', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'list_notes',
      description: 'list',
      parameters: { type: 'object', properties: {} },
      execute: async () => JSON.stringify({ notes: [] }),
    });

    const runner = new AgentLoopRunner({
      modelAdapter: stubAdapter((turn) => {
        if (turn === 1) {
          return {
            stopReason: 'tool_use',
            assistantParts: [
              { type: 'tool_call', toolCallId: 'x', name: 'bash', input: { command: 'ls' } },
            ],
          };
        }
        return {
          stopReason: 'end',
          assistantParts: [{ type: 'text', text: 'no bash' }],
        };
      }),
      toolRegistry: registry,
      maxIterations: 4,
      systemPrompt: 'sys',
    });

    const used: string[] = [];
    const text = await runner.run([{ role: 'user', content: 'ls' }], {
      onToolResult: (name, result) => used.push(`${name}:${result}`),
    });
    expect(used[0]?.startsWith('bash:')).toBe(true);
    expect(used[0]).toMatch(/Unknown tool/i);
    expect(text).toBe('no bash');
  });
});
