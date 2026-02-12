/**
 * Agent Runner - multi-step reasoning loop with tool calling.
 *
 * Flow:
 * 1. Build messages with system prompt + skill context + user message
 * 2. Call LLM with tool definitions
 * 3. If LLM returns tool_calls → execute tools → append results → loop
 * 4. If LLM returns text → done, return to user
 * 5. Limit max iterations to prevent infinite loops
 */

import { LLMClient } from '../shared/llmClient';
import { ToolRegistry } from './toolRegistry';
import type { LLMMessage, LLMStreamDelta } from '../shared/types';

export interface AgentRunnerConfig {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  maxIterations: number;
  systemPrompt: string;
  temperature?: number;
}

export interface AgentStreamCallbacks {
  /** Called when the agent starts thinking / calling tools */
  onThinking?: (toolName: string) => void;
  /** Called for each text token from the LLM */
  onToken?: (token: string) => void;
  /** Called when a tool is executed, with name and result */
  onToolResult?: (toolName: string, result: string) => void;
  /** Called when the agent finishes */
  onDone?: (fullResponse: string) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export class AgentRunner {
  private config: AgentRunnerConfig;

  constructor(config: AgentRunnerConfig) {
    this.config = config;
  }

  /**
   * Run the agent with streaming output.
   * @param messages - conversation history
   * @param callbacks - streaming callbacks
   * @param signal - abort signal
   * @returns final text response
   */
  async run(
    messages: LLMMessage[],
    callbacks: AgentStreamCallbacks,
    signal?: AbortSignal
  ): Promise<string> {
    const { llmClient, toolRegistry, maxIterations, systemPrompt, temperature } = this.config;
    const toolDefs = toolRegistry.toDefinitions();

    // Build full message list
    const fullMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      // Call LLM with streaming
      let fullText = '';
      const response = await llmClient.stream(
        fullMessages,
        (delta: LLMStreamDelta) => {
          if (delta.content) {
            fullText += delta.content;
            callbacks.onToken?.(delta.content);
          }
          if (delta.tool_calls) {
            // Tool calls are being accumulated in the stream handler
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                callbacks.onThinking?.(tc.function.name);
              }
            }
          }
        },
        { temperature, tools: toolDefs.length > 0 ? toolDefs : undefined, signal }
      );

      // If the LLM returned tool calls, execute them
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Add assistant message with tool calls to history
        fullMessages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });

        // Execute each tool call
        for (const toolCall of response.tool_calls) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

          const toolName = toolCall.function.name;
          let toolArgs: Record<string, unknown>;
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          callbacks.onThinking?.(toolName);
          const result = await toolRegistry.execute(toolName, toolArgs);
          callbacks.onToolResult?.(toolName, result);

          // Add tool result to messages
          fullMessages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        // Reset fullText for next iteration (the LLM will produce new text)
        fullText = '';
        continue;
      }

      // No tool calls → final text response
      const finalResponse = response.content || fullText || '';
      callbacks.onDone?.(finalResponse);
      return finalResponse;
    }

    // Max iterations reached
    const msg = `Agent reached maximum iterations (${maxIterations}). Partial response returned.`;
    callbacks.onError?.(new Error(msg));
    return fullMessages
      .filter(m => m.role === 'assistant')
      .map(m => m.content)
      .join('\n') || msg;
  }
}
