/**
 * Convert between Obsidian LLM messages and @ppeng/agent-loop SessionMessage parts.
 */

import type { ModelTurnResult, SessionMessage } from './loopTypes';
import type { LLMMessage, LLMResponse } from '../../shared/types';

export function sessionMessagesToLlm(messages: SessionMessage[]): LLMMessage[] {
  const out: LLMMessage[] = [];
  for (const message of messages) {
    if (message.hidden) continue;
    if (message.role === 'assistant') {
      const text = textFromParts(message);
      const toolCalls = message.parts.filter((p) => p.type === 'tool_call');
      const llm: LLMMessage = { role: 'assistant', content: text };
      if (toolCalls.length > 0) {
        llm.tool_calls = toolCalls.map((p) => {
          if (p.type !== 'tool_call') {
            throw new Error('expected tool_call part');
          }
          return {
            id: p.toolCallId,
            type: 'function' as const,
            function: {
              name: p.name,
              arguments: JSON.stringify(p.input ?? {}),
            },
          };
        });
      }
      out.push(llm);
      continue;
    }
    if (message.role === 'tool') {
      for (const part of message.parts) {
        if (part.type !== 'tool_result') continue;
        out.push({
          role: 'tool',
          content: part.content,
          tool_call_id: part.toolCallId,
        });
      }
      continue;
    }
    const text = textFromParts(message);
    if (!text) continue;
    out.push({ role: message.role, content: text });
  }
  return out;
}

export function llmMessagesToSessionSeed(messages: LLMMessage[]): Array<{
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts: SessionMessage['parts'];
}> {
  const seeded: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    parts: SessionMessage['parts'];
  }> = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      seeded.push({
        role: 'tool',
        parts: [
          {
            type: 'tool_result',
            toolCallId: message.tool_call_id || '',
            name: '',
            content: message.content,
            ok: true,
          },
        ],
      });
      continue;
    }
    if (message.role === 'assistant') {
      const parts: SessionMessage['parts'] = [];
      if (message.content) {
        parts.push({ type: 'text', text: message.content });
      }
      for (const tc of message.tool_calls ?? []) {
        parts.push({
          type: 'tool_call',
          toolCallId: tc.id,
          name: tc.function.name,
          input: parseArgs(tc.function.arguments),
        });
      }
      if (parts.length === 0) {
        parts.push({ type: 'text', text: '' });
      }
      seeded.push({ role: 'assistant', parts });
      continue;
    }
    seeded.push({
      role: message.role,
      parts: [{ type: 'text', text: message.content }],
    });
  }
  return seeded;
}

export function llmResponseToTurnResult(response: LLMResponse): ModelTurnResult {
  const assistantParts: ModelTurnResult['assistantParts'] = [];
  if (response.reasoning) {
    assistantParts.push({ type: 'reasoning', text: response.reasoning });
  }
  if (response.content) {
    assistantParts.push({ type: 'text', text: response.content });
  }
  for (const tc of response.tool_calls ?? []) {
    assistantParts.push({
      type: 'tool_call',
      toolCallId: tc.id,
      name: tc.function.name,
      input: parseArgs(tc.function.arguments),
    });
  }
  const toolCallCount = response.tool_calls?.length ?? 0;
  return {
    assistantParts,
    stopReason: toolCallCount > 0 ? 'tool_use' : 'end',
    finishReason: response.finish_reason,
    truncated: response.finish_reason === 'length',
  };
}

export function extractAssistantText(messages: SessionMessage[]): string {
  const texts: string[] = [];
  const reasoning: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || message.hidden) continue;
    const text = joinParts(message, 'text').trim();
    const think = joinParts(message, 'reasoning').trim();
    if (text) texts.push(text);
    if (think) reasoning.push(think);
  }
  if (texts.length > 0) return texts[texts.length - 1];
  if (reasoning.length > 0) return reasoning[reasoning.length - 1];
  return '';
}

function joinParts(message: SessionMessage, type: 'text' | 'reasoning'): string {
  return message.parts
    .filter((p) => p.type === type)
    .map((p) => (p.type === 'text' || p.type === 'reasoning' ? p.text : ''))
    .join('');
}

function textFromParts(message: SessionMessage): string {
  return joinParts(message, 'text');
}

export function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function toolContentLooksFailed(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { error?: unknown };
    return Boolean(parsed && typeof parsed === 'object' && parsed.error);
  } catch {
    return false;
  }
}
