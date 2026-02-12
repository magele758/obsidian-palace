# AI Translator - Obsidian Plugin

[中文文档 (Chinese Documentation)](./readme_cn.md)

Translate documents in Obsidian using AI. Supports any OpenAI-compatible Chat Completion API (e.g., OpenAI, DeepSeek, Qwen, Moonshot, etc.).

## Features

- **Translate Entire Documents** — Automatically generates a translated new file (e.g., `article.zh.md`)
- **Translate Selected Text** — Replaces selected text with the translation directly
- **Context Menu** — Trigger translation from both the file explorer and editor context menus
- **Smart Chunking** — Long documents are automatically split into chunks to avoid token limits
- **Format Preservation** — Preserves Markdown formatting, links, code blocks, etc.

## Installation

### Manual Installation

1. Build the plugin (requires Node.js):

```bash
cd obsidian-ai-plugin
npm install
npm run build
```

2. Copy the following 3 files to your Obsidian Vault plugin directory:

```
<your-vault>/.obsidian/plugins/obsidian-ai-translator/
├── main.js
├── manifest.json
└── styles.css
```

3. Restart Obsidian and enable **AI Translator** in `Settings → Community Plugins`.

## Configuration

Configure the following options in `Settings → AI Translator`:

| Setting | Description | Example |
|---------|-------------|---------|
| **API Base URL** | API service endpoint | `https://api.openai.com/v1` |
| **API Key** | API key | `sk-xxx...` |
| **Model Name** | Model to use | `gpt-4o`, `deepseek-chat` |
| **Target Language** | Translation target language | `简体中文` (default) |
| **Custom System Prompt** | Optional, leave empty for default | — |
| **Max Chunk Size** | Chunk size, recommended 2000-5000 | `3000` (default) |

### Common Provider Examples

**OpenAI:**
- Base URL: `https://api.openai.com/v1`
- Model: `gpt-4o`

**DeepSeek:**
- Base URL: `https://api.deepseek.com/v1`
- Model: `deepseek-chat`

**Qwen (Alibaba Cloud):**
- Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- Model: `qwen-plus`

**Moonshot:**
- Base URL: `https://api.moonshot.cn/v1`
- Model: `moonshot-v1-8k`

**SiliconFlow:**
- Base URL: `https://api.siliconflow.cn/v1`
- Model: Choose as needed

## Usage

### Translate Entire Document

1. Open the Markdown document you want to translate
2. Trigger translation using any of the following:
   - Press `Ctrl/Cmd + P` to open the command palette, search for **"Translate current document"**
   - Right-click in the editor → **"AI Translate full text (new file)"**
   - Right-click a file in the file explorer → **"AI Translate this document"**
3. Wait for translation to complete; the result is automatically saved as a new file and opened

### Translate Selected Text

1. Select the text you want to translate in the editor
2. Trigger translation using any of the following:
   - Press `Ctrl/Cmd + P` to open the command palette, search for **"Translate selected text"**
   - Right-click → **"AI Translate selected text"**
3. The selected text will be replaced with the translation

## Notes

- Translating an entire document generates a new file without modifying the original
- Translating selected text replaces the selection directly; use `Ctrl/Cmd + Z` to undo
- Long documents are automatically chunked; adjust chunk size in settings
- Translation progress is displayed (chunk x/y)
- If translation is interrupted, already translated parts are not lost (full document mode requires restart)

## Development

```bash
# Install dependencies
npm install

# Development mode (with sourcemap)
npm run dev

# Production build
npm run build
```
