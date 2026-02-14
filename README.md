# Obsidian Palace

[中文文档 (Chinese Documentation)](./readme_cn.md)

AI-powered knowledge management plugin for Obsidian. Integrates an AI Agent with tool calling, Memory Palace (knowledge graph + spaced repetition flashcards), document translation, skill system, and cloud sandbox.

Supports any OpenAI-compatible Chat Completion API (OpenAI, DeepSeek, Qwen, Moonshot, SiliconFlow, etc.).

## Features

### AI Assistant (Agent)

- **Chat Panel** — Conversational AI assistant in a side panel with streaming responses
- **Tool Calling** — Agent can search vault, read/write notes, list files, and execute code
- **Document Context** — Select a document to ground the conversation
- **Session History** — Persistent chat sessions with auto-titling
- **Quick Actions** — One-click summarization, key concept extraction, Q&A generation, deep analysis

### Memory Palace

- **Knowledge Graph** — Extract concepts, entities, topics, and facts from documents via LLM
- **Graph Visualization** — Interactive SVG force-directed graph of your knowledge
- **Flashcard Review** — SM-2 spaced repetition algorithm for effective memorization
- **Statistics Dashboard** — Track concepts, connections, due cards, and learning progress

### Document Translation

- **Translate Entire Documents** — Generates a translated new file (e.g., `article.zh.md`)
- **Translate Selected Text** — Replaces selected text with the translation
- **Multiple Modes** — New file, append to original, or replace original
- **Smart Chunking** — Long documents are split into chunks to avoid token limits
- **Format Preservation** — Preserves Markdown formatting, links, code blocks, etc.

### Skill System

- **Auto-loading** — Scans `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills` for SKILL.md files
- **Skill Matching** — Automatically activates relevant skills based on user messages
- **Custom Directories** — Configure additional skill directories in settings

### Cloud Sandbox (E2B)

- **Code Execution** — Run Python and JavaScript code in a secure cloud sandbox
- **E2B Integration** — Uses E2B REST API directly (no SDK dependency)

## Installation

### Manual Installation

1. Build the plugin (requires Node.js):

```bash
npm install
npm run build
```

2. Copy the following 3 files to your Obsidian Vault plugin directory:

```
<your-vault>/.obsidian/plugins/obsidian-palace/
├── main.js
├── manifest.json
└── styles.css
```

3. Restart Obsidian and enable **Obsidian Palace** in `Settings → Community Plugins`.

## Configuration

Configure in `Settings → Obsidian Palace`:

### LLM Configuration

| Setting | Description | Example |
|---------|-------------|---------|
| **API Base URL** | OpenAI-compatible API endpoint | `https://api.openai.com/v1` |
| **API Key** | API key for the LLM service | `sk-xxx...` |
| **Model Name** | Model to use | `gpt-4o`, `deepseek-chat` |

### Common Provider Examples

| Provider | Base URL | Model |
|----------|----------|-------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Qwen (Alibaba) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | Choose as needed |

### Agent Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable Agent Mode** | Allow AI to use tools | `On` |
| **Max Agent Iterations** | Maximum tool-calling rounds per request | `10` |

### Sandbox Settings

| Setting | Description |
|---------|-------------|
| **Sandbox Provider** | `Disabled` or `E2B` |
| **E2B API Key** | Required if E2B is enabled |
| **E2B Domain** | Optional custom domain |

### Translation Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Target Language** | Translation target language | `简体中文` |
| **Translation Mode** | New file / Append / Replace | `New file` |
| **Custom System Prompt** | Optional, use `{targetLang}` as placeholder | — |
| **Max Chunk Size** | Characters per chunk (2000-5000) | `3000` |

## Usage

### AI Assistant

1. Click the **chat icon** in the ribbon (left sidebar) or run command **"Open AI Assistant"**
2. Optionally select a document for context by clicking the document picker
3. Type your question or use a quick action button
4. The agent will automatically use tools (search, read, write) when needed

### Memory Palace

1. Click the **brain icon** in the ribbon or run command **"Open Memory Palace"**
2. Extract knowledge from a document: open a .md file → run command **"Extract Knowledge from Current Document"** (or right-click the file → **"Extract Knowledge"**)
3. View the knowledge graph, review flashcards, or check statistics

### Document Translation

1. **Full document**: Open a .md file → `Cmd/Ctrl + P` → **"Translate Current Document"** (or right-click)
2. **Selection**: Select text → `Cmd/Ctrl + P` → **"Translate Selected Text"** (or right-click)

## Development

```bash
# Install dependencies
npm install

# Development mode (with sourcemap)
npm run dev

# Production build
npm run build
```

## License

MIT
