/**
 * Assemble the existing Obsidian Palace tool set.
 * Do not register extra tools here — chat and both agent runners share this list.
 */

import type { App } from 'obsidian';
import type { SandboxProvider } from '../shared/types';
import type { HybridSearch } from '../vault-qa/hybridSearch';
import { ToolRegistry } from './toolRegistry';
import { createSearchVaultTool } from './tools/searchVault';
import { createReadNoteTool } from './tools/readNote';
import { createWriteNoteTool } from './tools/writeNote';
import { createListNotesTool } from './tools/listNotes';
import { createExecuteCodeTool } from './tools/executeCode';
import { createGraphTools } from './tools/graphTools';
import { createVaultStatusTool } from '../vault-qa';

export interface PalaceToolContext {
  app: App;
  hybridSearch?: HybridSearch | null;
  sandboxProvider?: SandboxProvider | null;
  confirmWrite?: (path: string, mode: string) => Promise<boolean>;
  vaultQAEnabled?: boolean;
}

export function createPalaceToolRegistry(ctx: PalaceToolContext): ToolRegistry {
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createSearchVaultTool(ctx.app, ctx.hybridSearch));
  toolRegistry.register(createReadNoteTool(ctx.app));
  toolRegistry.register(createWriteNoteTool(ctx.app, ctx.confirmWrite));
  toolRegistry.register(createListNotesTool(ctx.app));

  if (ctx.sandboxProvider) {
    toolRegistry.register(createExecuteCodeTool(ctx.sandboxProvider));
  }

  for (const tool of createGraphTools(ctx.app)) {
    toolRegistry.register(tool);
  }

  if (ctx.vaultQAEnabled && ctx.hybridSearch) {
    toolRegistry.register(createVaultStatusTool(ctx.app));
  }

  return toolRegistry;
}
