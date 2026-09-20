/**
 * Map Obsidian AgentTool instances onto @ppeng/agent-loop ToolContract.
 * No extra tools are invented here.
 */

import type { RunContext, SideEffectLevel, ToolContract } from './loopTypes';
import type { AgentTool } from '../../shared/types';
import type { ToolRegistry } from '../toolRegistry';
import { toolContentLooksFailed } from './messageConvert';

export function agentToolToContract(tool: AgentTool): ToolContract {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
    approvalMode: 'never',
    sideEffectLevel: inferSideEffect(tool.name),
    execute: async (_context: RunContext, args: Record<string, unknown>) => {
      const content = await tool.execute(args);
      return { ok: !toolContentLooksFailed(content), content };
    },
  };
}

export function toToolContracts(registry: ToolRegistry): ToolContract[] {
  return registry.getAll().map(agentToolToContract);
}

function inferSideEffect(name: string): SideEffectLevel {
  if (name === 'execute_code') return 'system';
  if (name === 'write_note') return 'workspace';
  return 'none';
}
