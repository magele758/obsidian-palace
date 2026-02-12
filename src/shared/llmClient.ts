/**
 * Unified LLM client supporting both streaming and non-streaming,
 * with tool calling support for OpenAI-compatible APIs.
 */

import { requestUrl } from 'obsidian';
import type { LLMMessage, LLMResponse, LLMStreamDelta, ToolDefinition, ToolCall } from './types';

export interface LLMClientConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export class LLMClient {
  constructor(private config: LLMClientConfig) {}

  /**
   * Non-streaming completion (for translation, extraction, etc.)
   */
  async complete(
    messages: LLMMessage[],
    options?: {
      temperature?: number;
      tools?: ToolDefinition[];
      maxTokens?: number;
    }
  ): Promise<LLMResponse> {
    const url = this.config.baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages: messages.map(m => this.serializeMessage(m)),
      temperature: options?.temperature ?? 0.7,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }
    if (options?.maxTokens) {
      body.max_tokens = options.maxTokens;
    }

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status !== 200) {
      throw new Error(`API request failed (${response.status}): ${response.text}`);
    }

    const data = response.json;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('API returned empty response');
    }

    return {
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
      finish_reason: choice.finish_reason,
    };
  }

  /**
   * Streaming completion with callback for deltas.
   * Returns the full assembled response.
   */
  async stream(
    messages: LLMMessage[],
    onDelta: (delta: LLMStreamDelta) => void,
    options?: {
      temperature?: number;
      tools?: ToolDefinition[];
      signal?: AbortSignal;
    }
  ): Promise<LLMResponse> {
    const url = this.config.baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages: messages.map(m => this.serializeMessage(m)),
      temperature: options?.temperature ?? 0.7,
      stream: true,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API request failed (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Cannot get response stream');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    const toolCallAccumulator: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const choice = json.choices?.[0];
          if (!choice) continue;

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          const delta = choice.delta;
          if (!delta) continue;

          // Handle content
          if (delta.content) {
            fullContent += delta.content;
            onDelta({ content: delta.content });
          }

          // Handle tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallAccumulator.has(idx)) {
                toolCallAccumulator.set(idx, {
                  id: tc.id || '',
                  name: tc.function?.name || '',
                  arguments: '',
                });
              }
              const acc = toolCallAccumulator.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            }
            onDelta({ tool_calls: delta.tool_calls });
          }
        } catch {
          // ignore parse errors for partial chunks
        }
      }
    }

    // Build final tool_calls
    let toolCalls: ToolCall[] | undefined;
    if (toolCallAccumulator.size > 0) {
      toolCalls = [];
      for (const [, tc] of toolCallAccumulator) {
        toolCalls.push({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        });
      }
    }

    return {
      content: fullContent || null,
      tool_calls: toolCalls,
      finish_reason: finishReason || 'stop',
    };
  }

  private serializeMessage(msg: LLMMessage): Record<string, unknown> {
    const result: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };
    if (msg.tool_call_id) result.tool_call_id = msg.tool_call_id;
    if (msg.tool_calls) result.tool_calls = msg.tool_calls;
    return result;
  }
}
