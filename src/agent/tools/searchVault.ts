/**
 * Tool: search_vault - Search for notes in the vault by keyword
 */

import type { App, TFile } from 'obsidian';
import type { AgentTool } from '../../shared/types';

export function createSearchVaultTool(app: App): AgentTool {
  return {
    name: 'search_vault',
    description: 'Search for notes in the vault by keyword. Returns matching file paths and content snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword or phrase',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
        },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = String(args.query).toLowerCase();
      const limit = Number(args.limit) || 10;

      const files = app.vault.getMarkdownFiles();
      const results: Array<{ path: string; snippet: string }> = [];

      for (const file of files) {
        if (results.length >= limit) break;

        // Check filename match
        const nameMatch = file.basename.toLowerCase().includes(query);

        // Check content match
        const content = await app.vault.cachedRead(file);
        const contentLower = content.toLowerCase();
        const idx = contentLower.indexOf(query);

        if (nameMatch || idx !== -1) {
          let snippet = '';
          if (idx !== -1) {
            const start = Math.max(0, idx - 80);
            const end = Math.min(content.length, idx + query.length + 80);
            snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
            if (start > 0) snippet = '...' + snippet;
            if (end < content.length) snippet += '...';
          } else {
            snippet = content.slice(0, 160).replace(/\n/g, ' ').trim();
            if (content.length > 160) snippet += '...';
          }

          results.push({ path: file.path, snippet });
        }
      }

      if (results.length === 0) {
        return JSON.stringify({ message: `No notes found matching "${args.query}"`, results: [] });
      }

      return JSON.stringify({ results });
    },
  };
}
