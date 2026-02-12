/**
 * Shared types used across Obsidian Palace plugin
 */

/* ---- LLM ---- */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMStreamDelta {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
  finish_reason: string;
}

/* ---- Agent ---- */

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface AgentContext {
  systemPrompt: string;
  tools: AgentTool[];
  skillInstructions?: string;
  maxIterations: number;
}

/* ---- Sandbox ---- */

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxProvider {
  readonly name: string;
  init(): Promise<void>;
  execute(code: string, language: string): Promise<SandboxExecResult>;
  destroy(): Promise<void>;
}

/* ---- Skills ---- */

export interface SkillMetadata {
  name: string;
  description: string;
}

export interface Skill {
  metadata: SkillMetadata;
  instructions: string;    // full SKILL.md body (without frontmatter)
  directory: string;        // path to skill directory
  source: string;           // e.g. '~/.claude/skills/my-skill'
}

/* ---- Palace (Memory Palace) ---- */

export interface KnowledgeNode {
  id: string;
  label: string;
  type: 'concept' | 'entity' | 'topic' | 'fact';
  description: string;
  sourceFile?: string;
  createdAt: number;
}

export interface KnowledgeEdge {
  id: string;
  source: string;     // node id
  target: string;     // node id
  label: string;      // relationship description
  weight: number;     // 0-1
}

export interface KnowledgeGraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  lastUpdated: number;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  sourceNodeId?: string;
  sourceFile?: string;
  createdAt: number;
  // SM-2 fields
  interval: number;      // days until next review
  repetitions: number;   // successful reviews in a row
  easeFactor: number;    // difficulty factor (>= 1.3)
  nextReview: number;    // timestamp
  lastReview?: number;
}

export interface PalaceData {
  graph: KnowledgeGraphData;
  flashcards: Flashcard[];
}
