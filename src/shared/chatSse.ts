/**
 * OpenAI-compatible chat SSE assembler.
 * Yields to the event loop between visible deltas so Obsidian can paint
 * even when a proxy dumps many events in one TCP chunk.
 */

import type { LLMResponse, LLMStreamDelta, ToolCall } from './types';

export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type ToolAcc = { id: string; name: string; arguments: string };

export class ChatSseAssembler {
  private pending = '';
  private fullContent = '';
  private fullReasoning = '';
  private finishReason = '';
  private readonly toolCalls = new Map<number, ToolAcc>();

  constructor(private onDelta: (delta: LLMStreamDelta) => void) {}

  async pushText(chunk: string): Promise<void> {
    this.pending += chunk;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() || '';
    for (const line of lines) {
      const visible = this.consumeLine(line);
      if (visible) await yieldToUi();
    }
  }

  async flush(): Promise<void> {
    if (this.pending.trim()) this.consumeLine(this.pending);
    this.pending = '';
  }

  result(): LLMResponse {
    let toolCalls: ToolCall[] | undefined;
    if (this.toolCalls.size > 0) {
      toolCalls = [];
      for (const [, tc] of this.toolCalls) {
        toolCalls.push({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        });
      }
    }
    return {
      content: this.fullContent || null,
      reasoning: this.fullReasoning || undefined,
      tool_calls: toolCalls,
      finish_reason: this.finishReason || 'stop',
    };
  }

  private consumeLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return false;

    let json: {
      choices?: Array<{
        finish_reason?: string;
        delta?: {
          content?: string;
          reasoning_content?: string;
          reasoning?: string;
          tool_calls?: LLMStreamDelta['tool_calls'];
        };
      }>;
    };
    try {
      json = JSON.parse(data);
    } catch {
      return false;
    }

    const choice = json.choices?.[0];
    if (!choice) return false;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;

    const delta = choice.delta;
    if (!delta) return false;

    let visible = false;
    if (delta.content) {
      this.fullContent += delta.content;
      this.onDelta({ content: delta.content });
      visible = true;
    }
    const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
    if (reasoningDelta) {
      this.fullReasoning += reasoningDelta;
      this.onDelta({ reasoning: reasoningDelta });
      visible = true;
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!this.toolCalls.has(idx)) {
          this.toolCalls.set(idx, {
            id: tc.id || '',
            name: tc.function?.name || '',
            arguments: '',
          });
        }
        const acc = this.toolCalls.get(idx)!;
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
      }
      this.onDelta({ tool_calls: delta.tool_calls });
    }
    return visible;
  }
}
