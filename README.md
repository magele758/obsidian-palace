# Obsidian Palace

[中文文档](./readme_cn.md)

> AI-powered knowledge management plugin for Obsidian

An intelligent assistant that transforms your Obsidian vault into an interactive knowledge base with AI Agent capabilities, Memory Palace (knowledge graph + flashcards), document translation, skill system, and cloud sandbox.

Supports **any OpenAI-compatible API** (OpenAI, DeepSeek, Qwen, Moonshot, SiliconFlow, etc.)

---

## Features at a Glance

| Feature | Description |
|---------|-------------|
| **AI Agent** | Chat with your vault using tools (search, read/write notes, execute code) |
| **Memory Palace** | Extract knowledge graphs and review with spaced repetition flashcards |
| **Document Translation** | Translate documents with format preservation |
| **Skill System** | Auto-load custom skills from `.claude/skills` directories |
| **Cloud Sandbox** | Execute Python/JavaScript code securely via E2B |
| **Vault QA** | Search entire vault with Obsidian + Grep hybrid search |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Obsidian Palace                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  Chat View   │    │ Palace View  │    │  Translator  │          │
│  │  (Sidebar)   │    │   (Tab)      │    │   (Editor)   │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                   │                   │                   │
│         └───────────────────┼───────────────────┘                   │
│                             ▼                                       │
│                    ┌────────────────┐                               │
│                    │  LLM Client    │◄──── OpenAI-compatible API    │
│                    │  (Streaming)   │                               │
│                    └───────┬────────┘                               │
│                            │                                        │
│         ┌──────────────────┼──────────────────┐                    │
│         ▼                  ▼                  ▼                    │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐              │
│  │   Agent     │   │   Graph     │   │  Chunker    │              │
│  │   Runner    │   │  Extractor  │   │             │              │
│  └──────┬──────┘   └─────────────┘   └─────────────┘              │
│         │                                                          │
│         ▼                                                          │
│  ┌─────────────────────────────────────────────────────┐          │
│  │                    Tool Registry                     │          │
│  ├──────────┬──────────┬──────────┬──────────┬────────┤          │
│  │  Search  │  Read    │  Write   │  List    │ Exec   │          │
│  │  Vault   │  Note    │  Note    │  Notes   │ Code   │          │
│  └──────────┴──────────┴──────────┴──────────┴────────┘          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────┐          │
│  │              Vault QA (Text Search)                  │          │
│  ├─────────────────────┬───────────────────────────────┤          │
│  │   Obsidian Search   │        Grep Search            │          │
│  │   (Filename+Match)  │    (Regex/Keyword)            │          │
│  └─────────────────────┴───────────────────────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Input ──► Skill Matcher ──► Agent Runner ──► LLM API
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              Tool: Search      Tool: Read        Tool: Write
                    │                 │                 │
                    └─────────────────┼─────────────────┘
                                      ▼
                              Obsidian Vault
```

---

## Installation

### Prerequisites

- Node.js 18+
- Obsidian 0.16.0+

### Manual Install

```bash
# Clone and build
git clone https://github.com/magele758/obsidian-palace.git
cd obsidian-palace
npm install
npm run build
```

Copy these files to your vault:

```
<your-vault>/.obsidian/plugins/obsidian-ai-translate/
├── main.js
├── manifest.json
└── styles.css
```

Restart Obsidian and enable **Obsidian Palace** in Settings → Community Plugins.

---

## Configuration

### LLM Settings

| Setting | Description | Example |
|---------|-------------|---------|
| **API Base URL** | OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| **API Key** | Your API key | `sk-xxx...` |
| **Model Name** | Model identifier | `gpt-4o`, `deepseek-chat` |

### Provider Examples

| Provider | Base URL | Models |
|----------|----------|--------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus`, `qwen-max` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | Various models |

### Agent Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enable Agent Mode | Allow AI to use tools | On |
| Max Iterations | Tool-calling rounds per request | 10 |

### Sandbox Settings

| Setting | Description |
|---------|-------------|
| Provider | `Disabled` or `E2B` |
| E2B API Key | Required for code execution |
| E2B Domain | Optional custom domain |

### Vault QA Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enable Vault QA | Whole-vault text search | Off |
| Obsidian Weight | Search weight for Obsidian search | 0.6 |
| Grep Weight | Search weight for keyword matching | 0.4 |
| Max Results | Maximum results returned | 10 |

---

## Usage Guide

### AI Assistant

1. Open via **ribbon icon** or command `Open AI Assistant`
2. Select a document (optional) for context
3. Ask questions or use quick actions:
   - 📝 **Summary** — Concise document summary
   - 🔑 **Key Concepts** — Extract main concepts
   - ❓ **Generate Q&A** — Create Q&A pairs
   - 🔍 **Deep Analysis** — Thorough document analysis
   - 🧠 **Extract Knowledge** — Add to Memory Palace

### Memory Palace

1. Open via **brain icon** or command `Open Memory Palace`
2. Extract knowledge from documents:
   - Command: `Extract Knowledge from Current Document`
   - Context menu: Right-click → Extract Knowledge
3. Features:
   - **Graph View** — Interactive knowledge network
   - **Flashcards** — SM-2 spaced repetition review
   - **Statistics** — Track learning progress

### Document Translation

1. **Full document**: Command `Translate Current Document`
2. **Selection**: Select text → Command `Translate Selected Text`
3. Modes: New file, Append, or Replace

### Vault QA

When enabled, the AI agent can search your entire vault:

```
User: "Find all notes about machine learning"

Agent uses: search_vault_qa tool
         └── Obsidian Search (filename + content match)
         └── Grep Search (keyword/regex match)
         └── Hybrid ranking → Return top results
```

---

## Development

```bash
# Development mode (with sourcemap)
npm run dev

# Production build
npm run build

# Watch mode
npm run dev -- --watch
```

### Project Structure

```
src/
├── main.ts              # Plugin entry point
├── settings.ts          # Settings UI
├── chatView.ts          # AI chat panel
├── translator.ts        # Document translation
├── shared/
│   ├── types.ts         # Type definitions
│   └── llmClient.ts     # OpenAI-compatible client
├── agent/
│   ├── agentRunner.ts   # Multi-step reasoning
│   ├── toolRegistry.ts  # Tool management
│   └── tools/           # Agent tools
├── palace/
│   ├── palaceView.ts    # Memory Palace UI
│   ├── knowledgeGraph.ts
│   ├── graphExtractor.ts
│   └── reviewScheduler.ts
├── skills/
│   ├── skillRegistry.ts # Skill matching
│   └── skillLoader.ts
├── sandbox/
│   └── e2bProvider.ts   # E2B integration
└── vault-qa/
    ├── hybridSearch.ts  # Text-based search
    ├── obsidianSearch.ts
    ├── grepSearch.ts
    └── qaTool.ts
```

---

## License

MIT © magele758
