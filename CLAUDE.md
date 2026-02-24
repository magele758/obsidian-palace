# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Obsidian Palace** - AI-powered knowledge management plugin for Obsidian. Integrates an AI Agent with tool calling, Memory Palace (knowledge graph + spaced repetition flashcards), document translation, skill system, and cloud sandbox. Supports any OpenAI-compatible Chat Completion API.

## Build & Development Commands

```bash
# Install dependencies
npm install

# Development mode (with inline sourcemap)
npm run dev

# Production build (minified)
npm run build
```

## Architecture

### Directory Structure

```
src/
├── main.ts                 # Plugin entry point, lifecycle management
├── settings.ts             # Settings UI and configuration
├── chatView.ts            # AI Assistant chat panel
├── translator.ts          # Document translation
├── shared/
│   ├── types.ts           # Core type definitions
│   └── llmClient.ts       # Unified LLM API client
├── agent/
│   ├── agentRunner.ts     # Multi-step reasoning loop
│   ├── toolRegistry.ts    # Tool registration/execution
│   └── tools/             # Search, read, write, executeCode tools
├── palace/
│   ├── palaceView.ts      # Memory Palace UI (graph, review, stats)
│   ├── knowledgeGraph.ts  # Graph data structure
│   ├── graphExtractor.ts  # LLM-based knowledge extraction
│   └── reviewScheduler.ts # SM-2 spaced repetition
├── skills/
│   ├── skillRegistry.ts   # Skill loading and matching
│   └── skillLoader.ts     # SKILL.md file loading
└── sandbox/
    └── e2bProvider.ts     # E2B cloud sandbox integration
```

### Core Modules

**main.ts** - Orchestrates plugin lifecycle:
- Loads settings, chat sessions, and palace data
- Initializes skill registry and sandbox
- Registers views (Chat, Palace) and commands
- Handles knowledge extraction and translation workflows
- Unified data layer using Obsidian's `loadData()`/`saveData()`

**shared/types.ts** - Defines all core data structures:
- `ChatSession`, `ChatMessage` - Conversation history
- `LLMMessage`, `ToolCall` - LLM communication
- `AgentTool` - Tool definitions with schemas
- `KnowledgeNode`, `KnowledgeEdge` - Graph entities
- `Flashcard` - Spaced repetition cards (SM-2 fields)
- `PalaceData` - Complete plugin state

**shared/llmClient.ts** - Unified OpenAI-compatible client with streaming and tool calling support.

**agent/agentRunner.ts** - Multi-step reasoning loop that manages conversation history and tool execution.

**agent/toolRegistry.ts** - Registry for agent tools (searchVault, readNote, writeNote, listNotes, executeCode).

## Data Storage

Plugin data is stored in a unified structure:
```typescript
{
  settings: PalaceSettings,
  "palace-data": PalaceData,        // Knowledge graph + flashcards
  "chat-sessions": ChatSession[]    // Conversation history
}
```

## Key Settings

- **LLM**: API Base URL, API Key, Model Name (supports OpenAI, DeepSeek, Qwen, Moonshot, etc.)
- **Agent**: Enable Agent Mode, Max Agent Iterations
- **Sandbox**: E2B API Key, Custom Domain
- **Translation**: Target Language, Mode (newFile/append/replace), Max Chunk Size
- **Skills**: Skill Directories (default: `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`)

## Build System

Uses **esbuild** (configured in `esbuild.config.mjs`):
- Target: ES2018, Format: CommonJS
- External: obsidian, electron, codemirror, lezer
- Output: `main.js` in project root
