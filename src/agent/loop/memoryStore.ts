/**
 * Palace agent id/spec for the ppeng mini loop store.
 */

import type { AgentSpec } from './loopTypes';

export const PALACE_AGENT_ID = 'obsidian-palace';

export function createPalaceAgentSpec(instructions: string, temperature?: number): AgentSpec {
  return {
    id: PALACE_AGENT_ID,
    name: 'Obsidian Palace',
    role: 'assistant',
    instructions,
    capabilities: ['vault'],
    temperature,
  };
}
