/**
 * ChatView engine switch: kernel (ppeng mini) or retained legacy runner.
 */

import type { LLMClient } from '../shared/llmClient';
import { AgentRunner } from './agentRunner';
import { AgentLoopRunner } from './loop/agentLoopRunner';
import { createObsidianModelAdapter } from './loop/obsidianModelAdapter';
import type { ToolRegistry } from './toolRegistry';

export type PalaceAgentEngine = 'kernel' | 'legacy';

export interface PalaceAgentConfig {
  engine: PalaceAgentEngine;
  llmClient: Pick<LLMClient, 'stream'>;
  toolRegistry: ToolRegistry;
  maxIterations: number;
  systemPrompt: string;
  temperature?: number;
}

export type PalaceAgent = AgentLoopRunner | AgentRunner;

export function createPalaceAgent(config: PalaceAgentConfig): PalaceAgent {
  const { toolRegistry, maxIterations, systemPrompt, temperature } = config;
  if (config.engine === 'legacy') {
    return new AgentRunner({
      llmClient: config.llmClient as LLMClient,
      toolRegistry,
      maxIterations,
      systemPrompt,
      temperature,
    });
  }
  return new AgentLoopRunner({
    modelAdapter: createObsidianModelAdapter(config.llmClient, { temperature }),
    toolRegistry,
    maxIterations,
    systemPrompt,
    temperature,
  });
}
