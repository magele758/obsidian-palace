/**
 * Assemble @ppeng/agent-loop mini host for Obsidian — vault tools only.
 */

import { createDefaultMemoryStore, createMiniAssembledLoop } from './ppengMini';
import {
  loadRepetitionWatchdogConfig,
  RepetitionLoopAbortError,
  RepetitionStreamGuard,
} from '@mage-ai-lab/agent-loop/streaming';
import type { AgentSpec, AssembledLoop, ModelAdapter } from './loopTypes';
import type { ToolRegistry } from '../toolRegistry';
import { toToolContracts } from './toolAdapter';

export interface ObsidianLoopOptions {
  modelAdapter: ModelAdapter;
  toolRegistry: ToolRegistry;
  agent: AgentSpec;
  systemPrompt: string;
  maxTurnsPerRun: number;
  onToolResult?: (toolName: string, result: string) => void;
}

export function createObsidianAssembledLoop(options: ObsidianLoopOptions): {
  assembled: AssembledLoop;
  surface: ReturnType<typeof createDefaultMemoryStore>['surface'];
} {
  const { store, surface } = createDefaultMemoryStore({
    agent: options.agent,
    agents: [options.agent],
  });
  const tools = toToolContracts(options.toolRegistry);
  const sessionAbortControllers = new Map<string, AbortController>();

  const assembled = createMiniAssembledLoop({
    io: {
      model: options.modelAdapter,
      tools,
      store,
      agent: options.agent,
      agents: [options.agent],
      repoRoot: 'obsidian-vault',
      stateDir: 'obsidian-agent',
      maxTurns: options.maxTurnsPerRun,
      sessionAbortControllers,
      promptBuilder: {
        async buildSystemPrompt() {
          return options.systemPrompt;
        },
        buildMemoryAppendix() {
          return '';
        },
      },
      async runTurnWithRetries(input, onStream) {
        const adapter = options.modelAdapter;
        if (!adapter.runTurnStream) {
          return adapter.runTurn(input);
        }
        const env =
          typeof process !== 'undefined' && process.env ? process.env : {};
        const guard = new RepetitionStreamGuard(loadRepetitionWatchdogConfig(env));
        return adapter.runTurnStream(input, (chunk) => {
          if (chunk.type === 'text_delta') {
            const reason = guard.push(chunk.text);
            if (reason) throw new RepetitionLoopAbortError(reason);
          }
          onStream?.(chunk);
        });
      },
    },
  });

  const baseExecute = assembled.host.executeToolCalls.bind(assembled.host);
  assembled.host.executeToolCalls = async (
    toolCalls,
    context,
    allowExternal,
    sessionId,
    turnTools
  ) => {
    const results = await baseExecute(toolCalls, context, allowExternal, sessionId, turnTools);
    for (const result of results) {
      options.onToolResult?.(result.name, result.content);
    }
    return results;
  };

  return { assembled, surface };
}

export function abortAssembledSession(loop: AssembledLoop, sessionId: string): void {
  loop.host.sessionAbortControllers?.get(sessionId)?.abort();
}
