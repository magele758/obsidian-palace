/**
 * Tool: search_vault - Search for notes in the vault by keyword
 */

import type { App, TFile } from 'obsidian';
import type { AgentTool } from '../../shared/types';
import type { HybridSearch } from '../../vault-qa/hybridSearch';

export function createSearchVaultTool(app: App, hybridSearch?: HybridSearch | null): AgentTool {
  return {
    name: 'search_vault',
    description:
      'Search for notes in the vault by keyword. Returns matching file paths, content snippets, relevance scores, and citation paths (e.g. [[path]]) for grounding answers.',
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
      const query = String(args.query);
      const limit = Number(args.limit) || 10;

      // Use HybridSearch when available
      if (hybridSearch) {
        try {
          const results = await hybridSearch.search(query, { maxResults: limit });
          if (results.length === 0) {
            return JSON.stringify({ message: `No notes found matching "${query}"`, results: [] });
          }
          return JSON.stringify({
            results: results.map((r) => ({
              filePath: r.filePath,
              snippet: r.snippet,
              score: Math.round(r.finalScore * 100) / 100,
              citation: `[[${r.filePath.replace(/\.md$/, '')}]]`,
            })),
          });
        } catch {
          // fall through to keyword search
        }
      }

      // Keyword fallback
      const queryLower = query.toLowerCase();
      const files = app.vault.getMarkdownFiles();
      const results: Array<{ filePath: string; snippet: string; score: number; citation: string }> = [];

      for (const file of files) {
        if (results.length >= limit) break;

        const nameMatch = file.basename.toLowerCase().includes(queryLower);
        const content = await app.vault.cachedRead(file);
        const contentLower = content.toLowerCase();
        const idx = contentLower.indexOf(queryLower);

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

          results.push({
            filePath: file.path,
            snippet,
            score: nameMatch && idx !== -1 ? 1.0 : nameMatch ? 0.8 : 0.6,
            citation: `[[${file.path.replace(/\.md$/, '')}]]`,
          });
        }
      }

      if (results.length === 0) {
        return JSON.stringify({ message: `No notes found matching "${query}"`, results: [] });
      }

      return JSON.stringify({ results });
    },
  };
}
