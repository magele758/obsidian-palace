/**
 * Graph Extractor - uses LLM to extract knowledge nodes and edges from documents.
 */

import { LLMClient } from '../shared/llmClient';
import type {
  KnowledgeNode,
  KnowledgeEdge,
  Flashcard,
  LLMMessage,
} from '../shared/types';
import type { ExtractionResult } from './types';

const EXTRACTION_PROMPT = `You are a knowledge graph extractor. Analyze the given document and extract:

1. **Knowledge Nodes**: Key concepts, entities, topics, and facts
2. **Knowledge Edges**: Relationships between nodes
3. **Flashcards**: Question-answer pairs for review

Output ONLY valid JSON in this exact format:
{
  "nodes": [
    {
      "id": "<unique-kebab-case-id>",
      "label": "<short label>",
      "type": "concept|entity|topic|fact",
      "description": "<1-2 sentence description>"
    }
  ],
  "edges": [
    {
      "source": "<node-id>",
      "target": "<node-id>",
      "label": "<relationship description>",
      "weight": <0.0-1.0>
    }
  ],
  "flashcards": [
    {
      "front": "<question>",
      "back": "<answer>"
    }
  ]
}

Rules:
- Extract 5-15 nodes depending on document length
- Create edges only between extracted nodes
- Generate 3-8 flashcards covering key knowledge points
- Node IDs must be unique, kebab-case
- Edge weights: 1.0 = very strong relation, 0.5 = moderate, 0.1 = weak
- Focus on the most important and memorable knowledge`;

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export class GraphExtractor {
  constructor(private llmClient: LLMClient) {}

  /**
   * Extract knowledge graph data from a document
   */
  async extract(content: string, sourceFile?: string): Promise<ExtractionResult> {
    const messages: LLMMessage[] = [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `Document:\n\n${content}` },
    ];

    const response = await this.llmClient.complete(messages, {
      temperature: 0.3,
    });

    if (!response.content) {
      throw new Error('LLM returned empty response during extraction');
    }

    // Parse JSON from response (handle potential markdown code blocks)
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    let parsed: {
      nodes: Array<{ id: string; label: string; type: string; description: string }>;
      edges: Array<{ source: string; target: string; label: string; weight: number }>;
      flashcards: Array<{ front: string; back: string }>;
    };

    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error('Failed to parse extraction result as JSON');
    }

    const now = Date.now();

    // Transform to our types
    const nodes: KnowledgeNode[] = (parsed.nodes || []).map(n => ({
      id: n.id || generateId(),
      label: n.label,
      type: (n.type as KnowledgeNode['type']) || 'concept',
      description: n.description,
      sourceFile,
      createdAt: now,
    }));

    const nodeIds = new Set(nodes.map(n => n.id));

    const edges: KnowledgeEdge[] = (parsed.edges || [])
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({
        id: `${e.source}-${e.target}-${generateId()}`,
        source: e.source,
        target: e.target,
        label: e.label,
        weight: Math.max(0, Math.min(1, e.weight || 0.5)),
      }));

    const flashcards: Flashcard[] = (parsed.flashcards || []).map(f => ({
      id: generateId(),
      front: f.front,
      back: f.back,
      sourceFile,
      createdAt: now,
      interval: 1,
      repetitions: 0,
      easeFactor: 2.5,
      nextReview: now,
    }));

    return { nodes, edges, flashcards };
  }
}
