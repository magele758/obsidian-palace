import { describe, expect, it } from 'vitest';
import { AgentRunner } from './agentRunner';
import { ToolRegistry } from './toolRegistry';
import type { LLMMessage, LLMResponse, LLMStreamDelta } from '../shared/types';

describe('legacy AgentRunner', () => {
  it('still completes a text-only turn', async () => {
    const registry = new ToolRegistry();
    const llm = {
      async stream(
        _messages: LLMMessage[],
        onDelta: (delta: LLMStreamDelta) => void
      ): Promise<LLMResponse> {
        onDelta({ content: 'legacy ok' });
        return { content: 'legacy ok', finish_reason: 'stop' };
      },
    };

    const runner = new AgentRunner({
      llmClient: llm as never,
      toolRegistry: registry,
      maxIterations: 3,
      systemPrompt: 'sys',
    });
    const text = await runner.run([{ role: 'user', content: 'hi' }], {});
    expect(text).toBe('legacy ok');
  });
});
