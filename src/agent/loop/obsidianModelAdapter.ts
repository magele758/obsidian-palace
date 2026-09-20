/**
 * Wrap the plugin LLMClient as a @ppeng/agent-loop ModelAdapter.
 */

import type {
  ModelAdapter,
  ModelStreamChunk,
  ModelTurnInput,
  ModelTurnResult,
} from './loopTypes';
import type { LLMClient } from '../../shared/llmClient';
import type { ToolDefinition } from '../../shared/types';
import { llmResponseToTurnResult, sessionMessagesToLlm } from './messageConvert';

export function createObsidianModelAdapter(
  llmClient: Pick<LLMClient, 'stream'>,
  options?: { temperature?: number }
): ModelAdapter {
  const temperature = options?.temperature ?? 0.7;

  const adapter: ModelAdapter = {
    name: 'obsidian-llm',
    async runTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
      return adapter.runTurnStream!(input, () => undefined);
    },
    async summarizeMessages() {
      return '';
    },
    async runTurnStream(input, onChunk) {
      const messages = [
        { role: 'system' as const, content: input.systemPrompt },
        ...sessionMessagesToLlm(input.messages),
      ];
      const tools: ToolDefinition[] = input.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      const started = new Set<string>();
      const response = await llmClient.stream(
        messages,
        (delta) => {
          if (delta.content) {
            onChunk({ type: 'text_delta', text: delta.content });
          }
          if (delta.reasoning) {
            onChunk({ type: 'reasoning_delta', text: delta.reasoning });
          }
          if (!delta.tool_calls) return;
          for (const tc of delta.tool_calls) {
            const name = tc.function?.name;
            const id = tc.id;
            if (!name || !id || started.has(id)) continue;
            started.add(id);
            onChunk({ type: 'tool_call_start', toolCallId: id, name });
          }
        },
        {
          temperature: input.agent.temperature ?? temperature,
          tools: tools.length > 0 ? tools : undefined,
          signal: input.signal,
        }
      );
      const result = llmResponseToTurnResult(response);
      const done: ModelStreamChunk = { type: 'done', stopReason: result.stopReason };
      onChunk(done);
      return result;
    },
  };

  return adapter;
}
