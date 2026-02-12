/**
 * Palace-related types (re-exported from shared)
 */

export type {
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeGraphData,
  Flashcard,
  PalaceData,
} from '../shared/types';

export interface ExtractionResult {
  nodes: import('../shared/types').KnowledgeNode[];
  edges: import('../shared/types').KnowledgeEdge[];
  flashcards: import('../shared/types').Flashcard[];
}
