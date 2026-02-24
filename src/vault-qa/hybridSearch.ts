/**
 * Hybrid Search - Combines Obsidian and grep search with weighted scoring
 * (Vector search removed - pure text-based search)
 */

import type { App } from 'obsidian';
import type {
  ObsidianSearchResult,
  GrepSearchResult,
  HybridSearchResult,
} from './types';
import { searchWithObsidian } from './obsidianSearch';
import { grepSearch } from './grepSearch';

export interface TextSearchConfig {
  /** Weight for Obsidian search (0-1) */
  obsidianWeight: number;
  /** Weight for grep search (0-1) */
  grepWeight: number;
  /** Maximum number of results to return */
  maxResults: number;
}

const DEFAULT_CONFIG: TextSearchConfig = {
  obsidianWeight: 0.6,
  grepWeight: 0.4,
  maxResults: 10,
};

/**
 * Text-based hybrid searcher combining Obsidian and grep search
 */
export class HybridSearch {
  private app: App;
  private config: TextSearchConfig;

  constructor(app: App, config: Partial<TextSearchConfig> = {}) {
    this.app = app;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TextSearchConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Perform hybrid text search
   */
  async search(
    query: string,
    options: Partial<TextSearchConfig> = {}
  ): Promise<HybridSearchResult[]> {
    const config = { ...this.config, ...options };
    const maxResults = config.maxResults || 10;

    // Run both searches in parallel
    const [obsidianResults, grepResults] = await Promise.allSettled([
      searchWithObsidian(this.app, query, maxResults),
      grepSearch(this.app, query, maxResults),
    ]);

    // Collect successful results
    const successful: {
      obsidian?: ObsidianSearchResult[];
      grep?: GrepSearchResult[];
    } = {};

    if (obsidianResults.status === 'fulfilled') {
      successful.obsidian = obsidianResults.value;
    }
    if (grepResults.status === 'fulfilled') {
      successful.grep = grepResults.value;
    }

    // Merge and rank
    return this.mergeResults(
      successful.obsidian || [],
      successful.grep || [],
      config
    );
  }

  /**
   * Merge results from both search methods
   */
  private mergeResults(
    obsidianResults: ObsidianSearchResult[],
    grepResults: GrepSearchResult[],
    config: TextSearchConfig
  ): HybridSearchResult[] {
    const merged = new Map<string, HybridSearchResult>();

    // Normalize scores for each result set
    const normalizedObsidian = this.normalizeScores(obsidianResults, (r) => r.obsidianScore);
    const normalizedGrep = this.normalizeScores(grepResults, (r) => r.grepScore);

    // Add Obsidian results
    for (const result of normalizedObsidian) {
      const filePath = result.item.filePath;
      const score = result.normalized * config.obsidianWeight;

      const existing = merged.get(filePath);
      if (existing) {
        existing.finalScore += score;
        existing.scores.obsidian = result.normalized;
        existing.sources.push('obsidian');
        // Use longer snippet
        if (!existing.snippet || existing.snippet.length < result.item.snippet.length) {
          existing.snippet = result.item.snippet;
        }
      } else {
        merged.set(filePath, {
          filePath,
          snippet: result.item.snippet,
          finalScore: score,
          scores: { obsidian: result.normalized },
          sources: ['obsidian'],
        });
      }
    }

    // Add grep results
    for (const result of normalizedGrep) {
      const filePath = result.item.filePath;
      const score = result.normalized * config.grepWeight;

      const existing = merged.get(filePath);
      if (existing) {
        existing.finalScore += score;
        existing.scores.grep = result.normalized;
        existing.sources.push('grep');
        // Build a nice snippet from grep result if we don't have one
        if (!existing.snippet) {
          const context = [
            ...result.item.before,
            result.item.content,
            ...result.item.after,
          ].join('\n');
          existing.snippet = context.slice(0, 400) + (context.length > 400 ? '...' : '');
        }
      } else {
        const context = [
          ...result.item.before,
          result.item.content,
          ...result.item.after,
        ].join('\n');
        merged.set(filePath, {
          filePath,
          snippet: context.slice(0, 400) + (context.length > 400 ? '...' : ''),
          finalScore: score,
          scores: { grep: result.normalized },
          sources: ['grep'],
        });
      }
    }

    // Convert to array, sort, and limit
    const results = Array.from(merged.values());
    results.sort((a, b) => b.finalScore - a.finalScore);

    return results.slice(0, config.maxResults);
  }

  /**
   * Normalize scores to 0-1 range
   */
  private normalizeScores<T>(
    results: T[],
    getScore: (item: T) => number
  ): Array<{ item: T; normalized: number; raw: number }> {
    if (results.length === 0) return [];

    const scores = results.map((r) => getScore(r));
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);

    if (maxScore === minScore) {
      return results.map((item) => ({ item, normalized: 1.0, raw: getScore(item) }));
    }

    return results.map((item) => {
      const raw = getScore(item);
      const normalized = (raw - minScore) / (maxScore - minScore);
      return { item, normalized, raw };
    });
  }
}
