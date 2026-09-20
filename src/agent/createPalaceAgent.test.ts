import { describe, expect, it } from 'vitest';
import { AgentRunner } from './agentRunner';
import { createPalaceAgent } from './createPalaceAgent';
import { AgentLoopRunner } from './loop/agentLoopRunner';
import { createPalaceToolRegistry } from './palaceTools';
import { fakeVaultApp, mockLlmStream } from './testSupport';

describe('createPalaceAgent longitudinal stack', () => {
  it('defaults to AgentLoopRunner (ppeng kernel) not the legacy runner', () => {
    const agent = createPalaceAgent({
      engine: 'kernel',
      llmClient: mockLlmStream([]),
      toolRegistry: createPalaceToolRegistry({ app: fakeVaultApp() }),
      maxIterations: 3,
      systemPrompt: 'sys',
    });
    expect(agent).toBeInstanceOf(AgentLoopRunner);
    expect(agent).not.toBeInstanceOf(AgentRunner);
  });

  it('keeps the original AgentRunner when engine is legacy', () => {
    const agent = createPalaceAgent({
      engine: 'legacy',
      llmClient: mockLlmStream([]),
      toolRegistry: createPalaceToolRegistry({ app: fakeVaultApp() }),
      maxIterations: 3,
      systemPrompt: 'sys',
    });
    expect(agent).toBeInstanceOf(AgentRunner);
  });

  it('kernel path: mock LLM tool_call → palace search_vault → final text', async () => {
    const llm = mockLlmStream([
      {
        content: null,
        finish_reason: 'tool_calls',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'search_vault', arguments: '{"query":"palace"}' },
          },
        ],
      },
      { content: 'searched the vault', finish_reason: 'stop' },
    ]);
    const agent = createPalaceAgent({
      engine: 'kernel',
      llmClient: llm,
      toolRegistry: createPalaceToolRegistry({ app: fakeVaultApp() }),
      maxIterations: 4,
      systemPrompt: 'You are the Obsidian vault assistant.',
    });

    const thinking: string[] = [];
    const tokens: string[] = [];
    const tools: string[] = [];
    let reasoning = 0;
    const text = await agent.run([{ role: 'user', content: 'find palace' }], {
      onThinking: (name) => thinking.push(name),
      onReasoning: () => {
        reasoning += 1;
      },
      onToken: (t) => tokens.push(t),
      onToolResult: (name) => tools.push(name),
    });

    expect(tools).toEqual(['search_vault']);
    expect(thinking).toContain('search_vault');
    expect(tokens.join('')).toBe('searched the vault');
    expect(tokens.length).toBeGreaterThan(1);
    expect(text).toBe('searched the vault');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0]?.some((m) => m.role === 'system')).toBe(true);
    expect(llm.calls[1]?.some((m) => m.role === 'tool' && m.tool_call_id === 'c1')).toBe(true);
  });

  it('kernel path: does not execute tools that are not in palaceTools', async () => {
    const llm = mockLlmStream([
      {
        content: null,
        finish_reason: 'tool_calls',
        tool_calls: [
          {
            id: 'x',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"ls"}' },
          },
        ],
      },
      { content: 'no extra tools', finish_reason: 'stop' },
    ]);
    const agent = createPalaceAgent({
      engine: 'kernel',
      llmClient: llm,
      toolRegistry: createPalaceToolRegistry({ app: fakeVaultApp() }),
      maxIterations: 4,
      systemPrompt: 'sys',
    });
    const used: string[] = [];
    const text = await agent.run([{ role: 'user', content: 'ls' }], {
      onToolResult: (name, result) => used.push(`${name}:${result}`),
    });
    expect(used[0]).toMatch(/^bash:.*Unknown tool/i);
    expect(text).toBe('no extra tools');
  });

  it('kernel path: streams answer text without dumping hidden reasoning', async () => {
    const llm = mockLlmStream([
      {
        content: 'Hi! How can I help?',
        reasoning: 'The user said hi. Greet them briefly.',
        finish_reason: 'stop',
      },
    ]);
    const agent = createPalaceAgent({
      engine: 'kernel',
      llmClient: llm,
      toolRegistry: createPalaceToolRegistry({ app: fakeVaultApp() }),
      maxIterations: 4,
      systemPrompt: 'sys',
    });
    const tokens: string[] = [];
    let reasoning = 0;
    const text = await agent.run([{ role: 'user', content: 'hi' }], {
      onToken: (t) => tokens.push(t),
      onReasoning: () => {
        reasoning += 1;
      },
    });
    expect(reasoning).toBeGreaterThan(0);
    expect(tokens.join('')).toBe('Hi! How can I help?');
    expect(tokens.length).toBeGreaterThan(1);
    expect(text).toBe('Hi! How can I help?');
    expect(text).not.toContain('Greet them briefly');
  });

  it('kernel path: reasoning-only mock reply is promoted to visible text', async () => {
    const llm = mockLlmStream([
      {
        content: null,
        reasoning: 'The user said hi. Greet them briefly.',
        finish_reason: 'stop',
      },
    ]);
    const agent = createPalaceAgent({
      engine: 'kernel',
      llmClient: llm,
      toolRegistry: createPalaceToolRegistry({ app: fakeVaultApp() }),
      maxIterations: 4,
      systemPrompt: 'sys',
    });
    const text = await agent.run([{ role: 'user', content: 'hi' }], {});
    expect(text).toContain('Greet them briefly');
  });

  it('legacy path still completes a mock-model turn', async () => {
    const llm = mockLlmStream([{ content: 'legacy ok', finish_reason: 'stop' }]);
    const agent = createPalaceAgent({
      engine: 'legacy',
      llmClient: llm,
      toolRegistry: createPalaceToolRegistry({ app: fakeVaultApp() }),
      maxIterations: 3,
      systemPrompt: 'sys',
    });
    const text = await agent.run([{ role: 'user', content: 'hi' }], {});
    expect(text).toBe('legacy ok');
  });
});
