/**
 * Grep Search - Direct file content regex/keyword matching
 */

import type { App, TFile } from 'obsidian';
import type { GrepSearchResult } from './types';

const CONTEXT_LINES = 2;

/**
 * Search all files with regex/keyword matching
 */
export async function grepSearch(
  app: App,
  query: string,
  limit: number = 10,
  options: {
    caseSensitive?: boolean;
    useRegex?: boolean;
  } = {}
): Promise<GrepSearchResult[]> {
  const results: GrepSearchResult[] = [];
  const files = app.vault.getMarkdownFiles();
  const { caseSensitive = false, useRegex = false } = options;

  // Build the regex pattern
  let pattern: RegExp;
  try {
    if (useRegex) {
      pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } else {
      pattern = new RegExp(escapeRegex(query), caseSensitive ? 'g' : 'gi');
    }
  } catch {
    // Invalid regex, fall back to literal search
    pattern = new RegExp(escapeRegex(query), caseSensitive ? 'g' : 'gi');
  }

  for (const file of files) {
    if (results.length >= limit) break;

    try {
      const content = await app.vault.cachedRead(file);
      const fileResults = searchInContent(content, file.path, pattern, limit - results.length);
      results.push(...fileResults);
    } catch {
      // Skip files we can't read
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.grepScore - a.grepScore);

  return results.slice(0, limit);
}

/**
 * Search within a single file's content
 */
function searchInContent(
  content: string,
  filePath: string,
  pattern: RegExp,
  limit: number
): GrepSearchResult[] {
  const results: GrepSearchResult[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (results.length >= limit) break;

    const line = lines[i];
    let match: RegExpExecArray | null;

    // Reset regex lastIndex
    pattern.lastIndex = 0;

    while ((match = pattern.exec(line)) !== null) {
      if (results.length >= limit) break;

      // Collect context
      const before: string[] = [];
      const after: string[] = [];

      for (let j = 1; j <= CONTEXT_LINES; j++) {
        if (i - j >= 0) before.unshift(lines[i - j]);
        if (i + j < lines.length) after.push(lines[i + j]);
      }

      // Calculate score:
      // - Base score for match
      // - Bonus for earlier in file
      // - Bonus for shorter line (more focused match)
      let score = 1.0;
      score += Math.max(0, 1.0 - i / lines.length);
      score += Math.max(0, 1.0 - line.length / 500);

      results.push({
        filePath,
        line: i + 1, // 1-based line numbers
        column: match.index + 1, // 1-based column
        content: line,
        before,
        after,
        grepScore: score,
      });
    }
  }

  return results;
}

/**
 * Quick keyword search that just checks for existence
 */
export async function quickGrep(
  app: App,
  query: string,
  limit: number = 20
): Promise<Array<{ filePath: string; matches: number }>> {
  const results: Array<{ filePath: string; matches: number }> = [];
  const files = app.vault.getMarkdownFiles();
  const queryLower = query.toLowerCase();

  for (const file of files) {
    if (results.length >= limit) break;

    try {
      const content = await app.vault.cachedRead(file);
      const contentLower = content.toLowerCase();

      let matches = 0;
      let lastIndex = 0;
      while ((lastIndex = contentLower.indexOf(queryLower, lastIndex)) !== -1) {
        matches++;
        lastIndex += queryLower.length;
      }

      if (matches > 0) {
        results.push({ filePath: file.path, matches });
      }
    } catch {
      // Skip files we can't read
    }
  }

  // Sort by number of matches descending
  results.sort((a, b) => b.matches - a.matches);

  return results;
}

/**
 * Escape regex special characters
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
