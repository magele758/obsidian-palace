/**
 * Agent runner backed by @ppeng/agent-loop mini (`createMiniAssembledLoop`).
 * Streaming callbacks match the legacy AgentRunner so ChatView can swap engines.
 */

import type { LLMMessage } from '../../shared/types';
import type { ToolRegistry } from '../toolRegistry';
import { abortAssembledSession, createObsidianAssembledLoop } from './obsidianHost';
import { createPalaceAgentSpec } from './memoryStore';
import { extractAssistantText, llmMessagesToSessionSeed } from './messageConvert';
import type { ModelAdapter } from './loopTypes';

export interface AgentLoopStreamCallbacks {
  onThinking?: (toolName: string) => void;
  onReasoning?: () => void;
  onToken?: (token: string) => void;
  onToolResult?: (toolName: string, result: string) => void;
  onDone?: (fullResponse: string) => void;
  onError?: (error: Error) => void;
}

export interface AgentLoopRunnerConfig {
  modelAdapter: ModelAdapter;
  toolRegistry: ToolRegistry;
  maxIterations: number;
  systemPrompt: string;
  temperature?: number;
}

export class AgentLoopRunner {
  private config: AgentLoopRunnerConfig;

  constructor(config: AgentLoopRunnerConfig) {
    this.config = config;
  }

  async run(
    messages: LLMMessage[],
    callbacks: AgentLoopStreamCallbacks,
    signal?: AbortSignal
  ): Promise<string> {
    if (signal?.aborted) throw abortError();

    const { modelAdapter, toolRegistry, maxIterations, systemPrompt, temperature } = this.config;
    const agent = createPalaceAgentSpec(systemPrompt, temperature);
    const { assembled, surface } = createObsidianAssembledLoop({
      modelAdapter,
      toolRegistry,
      agent,
      systemPrompt,
      maxTurnsPerRun: maxIterations,
      onToolResult: (name, result) => callbacks.onToolResult?.(name, result),
    });

    const session = surface.createSession({
      title: 'obsidian-chat',
      mode: 'chat',
      agentId: agent.id,
    });
    for (const seeded of llmMessagesToSessionSeed(messages)) {
      surface.appendMessage(session.id, seeded.role, seeded.parts);
    }

    const onAbort = () => abortAssembledSession(assembled, session.id);
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const record = await assembled.run(session.id, {
        onModelStreamChunk: (chunk) => {
          if (chunk.type === 'text_delta') callbacks.onToken?.(chunk.text);
          if (chunk.type === 'reasoning_delta') callbacks.onReasoning?.();
          if (chunk.type === 'tool_call_start') callbacks.onThinking?.(chunk.name);
        },
      });

      if (signal?.aborted || isAbortOutcome(record.metadata)) {
        throw abortError();
      }

      const text = extractAssistantText(assembled.store.foldMessages(session.id));
      callbacks.onDone?.(text);
      return text;
    } catch (err) {
      if (signal?.aborted) throw abortError();
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'AbortError') throw error;
      callbacks.onError?.(error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function isAbortOutcome(metadata: Record<string, unknown> | undefined): boolean {
  const outcome = metadata?.outcome;
  if (!outcome || typeof outcome !== 'object') return false;
  const reason = (outcome as { reason?: unknown }).reason;
  return reason === 'abort';
}
