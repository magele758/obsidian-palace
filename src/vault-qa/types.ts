/**
 * Vault QA - Type definitions for whole-vault knowledge base QA
 * (Vector/embedding types removed - pure text-based search)
 */

/* ---- Search Results ---- */

export interface ObsidianSearchResult {
  /** File path */
  filePath: string;
  /** Content snippet */
  snippet: string;
  /** Raw score from Obsidian search */
  obsidianScore: number;
  /** Normalized score (0-1) */
  normalizedObsidianScore?: number;
}

export interface GrepSearchResult {
  /** File path */
  filePath: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Matching line content */
  content: string;
  /** Context before match */
  before: string[];
  /** Context after match */
  after: string[];
  /** Raw match score */
  grepScore: number;
  /** Normalized score (0-1) */
  normalizedGrepScore?: number;
}

export interface HybridSearchResult {
  /** File path */
  filePath: string;
  /** Relevant content snippet */
  snippet: string;
  /** Final combined score (0-1) */
  finalScore: number;
  /** Individual component scores */
  scores: {
    obsidian?: number;
    grep?: number;
  };
  /** Which search methods contributed */
  sources: ('obsidian' | 'grep')[];
}

/* ---- Search Configuration ---- */

export interface TextSearchConfig {
  /** Weight for Obsidian search (0-1) */
  obsidianWeight: number;
  /** Weight for grep search (0-1) */
  grepWeight: number;
  /** Maximum number of results to return */
  maxResults: number;
}

export const DEFAULT_SEARCH_CONFIG: TextSearchConfig = {
  obsidianWeight: 0.6,
  grepWeight: 0.4,
  maxResults: 10,
};

/* ---- Vault Status ---- */

export interface VaultStatus {
  /** Total files in vault */
  totalFiles: number;
  /** Current search status */
  status: 'ready' | 'searching' | 'error';
}
