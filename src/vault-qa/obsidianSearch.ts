/**
 * Obsidian Search - Wrapper for Obsidian built-in search API
 */

import type { App, TFile } from 'obsidian';
import type { ObsidianSearchResult } from './types';

/**
 * Search the vault using Obsidian's built-in search
 */
export async function searchWithObsidian(
  app: App,
  query: string,
  limit: number = 10
): Promise<ObsidianSearchResult[]> {
  const results: ObsidianSearchResult[] = [];
  const files = app.vault.getMarkdownFiles();
  const queryLower = query.toLowerCase();

  for (const file of files) {
    if (results.length >= limit) break;

    try {
      const content = await app.vault.cachedRead(file);
      const contentLower = content.toLowerCase();

      // Calculate score based on:
      // - File name match (higher weight)
      // - Content match frequency
      // - Proximity to start
      let score = 0;
      let snippet = '';

      // File name match
      if (file.basename.toLowerCase().includes(queryLower)) {
        score += 2.0;
        snippet = content.slice(0, 200).replace(/\n/g, ' ').trim();
        if (content.length > 200) snippet += '...';
      }

      // Content matches
      const matches = [...contentLower.matchAll(new RegExp(escapeRegex(queryLower), 'gi'))];
      if (matches.length > 0) {
        // Score based on number of matches (diminishing returns)
        score += Math.min(matches.length * 0.5, 2.0);

        // Get snippet around first match
        const firstMatch = matches[0];
        const matchIndex = firstMatch.index || 0;
        const start = Math.max(0, matchIndex - 80);
        const end = Math.min(content.length, matchIndex + query.length + 80);
        snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
        if (start > 0) snippet = '...' + snippet;
        if (end < content.length) snippet += '...';
      }

      // If we found any match
      if (score > 0) {
        results.push({
          filePath: file.path,
          snippet: snippet || content.slice(0, 200).replace(/\n/g, ' ').trim(),
          obsidianScore: score,
        });
      }
    } catch {
      // Skip files we can't read
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.obsidianScore - a.obsidianScore);

  return results.slice(0, limit);
}

/**
 * Quick file name search (doesn't read content)
 */
export function searchFileNames(
  app: App,
  query: string,
  limit: number = 20
): ObsidianSearchResult[] {
  const results: ObsidianSearchResult[] = [];
  const files = app.vault.getMarkdownFiles();
  const queryLower = query.toLowerCase();

  for (const file of files) {
    if (results.length >= limit) break;

    if (file.basename.toLowerCase().includes(queryLower)) {
      results.push({
        filePath: file.path,
        snippet: file.path,
        obsidianScore: 1.0,
      });
    }
  }

  return results;
}

/**
 * Escape regex special characters
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
