/**
 * Vault QA Tools - Agent tools for whole-vault text-based search
 */

import type { App } from 'obsidian';
import type { AgentTool } from '../shared/types';
import type { HybridSearch } from './hybridSearch';

/**
 * Create the search_vault_qa tool
 */
export function createSearchVaultQATool(
  app: App,
  hybridSearch: HybridSearch
): AgentTool {
  return {
    name: 'search_vault_qa',
    description:
      'Search the entire vault using Obsidian search and keyword matching. ' +
      'Use this when you need to find information across the entire knowledge base.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The question or search query to find relevant information',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
        },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = String(args.query);
      const limit = args.limit ? Number(args.limit) : undefined;

      try {
        const results = await hybridSearch.search(query, {
          maxResults: limit,
        });

        if (results.length === 0) {
          return JSON.stringify({
            message: `No results found for "${query}"`,
            results: [],
          });
        }

        // Format results for the agent
        const formatted = results.map((r) => ({
          filePath: r.filePath,
          snippet: r.snippet,
          score: r.finalScore,
          sources: r.sources,
        }));

        return JSON.stringify({
          query,
          totalResults: formatted.length,
          results: formatted,
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          message: 'Search failed',
          results: [],
        });
      }
    },
  };
}

/**
 * Create the get_vault_status tool
 */
export function createVaultStatusTool(app: App): AgentTool {
  return {
    name: 'get_vault_status',
    description:
      'Get the current status of the vault. ' +
      'Returns the total number of markdown files.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async () => {
      try {
        const files = app.vault.getMarkdownFiles();
        return JSON.stringify({
          totalFiles: files.length,
          status: 'ready',
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          status: 'error',
        });
      }
    },
  };
}

/**
 * Export both tools together
 */
export function createVaultQATools(
  app: App,
  hybridSearch: HybridSearch
): AgentTool[] {
  return [
    createSearchVaultQATool(app, hybridSearch),
    createVaultStatusTool(app),
  ];
}
