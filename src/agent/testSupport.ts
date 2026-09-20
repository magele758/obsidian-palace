import type { App } from 'obsidian';
import type { LLMMessage, LLMResponse, LLMStreamDelta } from '../shared/types';

function chunkText(text: string, size = 8): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length > 0 ? out : [text];
}

export function fakeVaultApp(): App {
  return {
    vault: {
      getMarkdownFiles: () => [],
      cachedRead: async () => '',
      getAbstractFileByPath: () => null,
      create: async () => ({}),
      modify: async () => undefined,
    },
    metadataCache: {
      resolvedLinks: {},
      getCache: () => null,
    },
  } as unknown as App;
}

export function mockLlmStream(script: LLMResponse[]) {
  let turn = 0;
  const calls: LLMMessage[][] = [];
  return {
    calls,
    async stream(
      messages: LLMMessage[],
      onDelta: (delta: LLMStreamDelta) => void
    ): Promise<LLMResponse> {
      calls.push(messages);
      const response = script[turn] ?? { content: '', finish_reason: 'stop' };
      turn += 1;
      if (response.reasoning) {
        onDelta({ reasoning: response.reasoning });
      }
      if (response.content) {
        for (const piece of chunkText(response.content)) {
          onDelta({ content: piece });
        }
      }
      if (response.tool_calls) {
        onDelta({
          tool_calls: response.tool_calls.map((tc, index) => ({
            index,
            id: tc.id,
            type: tc.type,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });
      }
      return response;
    },
  };
}
