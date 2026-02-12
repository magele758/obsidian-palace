# AI Translator - Obsidian 插件

使用 AI 翻译 Obsidian 中的文档内容。支持任何 OpenAI 兼容的 Chat Completion API（如 OpenAI、DeepSeek、通义千问、Moonshot 等）。

## 功能

- **翻译整篇文档** — 自动生成翻译后的新文件（如 `article.zh.md`）
- **翻译选中文本** — 选中文本后直接替换为翻译结果
- **右键菜单** — 文件管理器和编辑器右键菜单均可触发翻译
- **智能分块** — 长文档自动分段翻译，避免超出 token 限制
- **保留格式** — 翻译时保留 Markdown 格式、链接、代码块等

## 安装

### 手动安装

1. 构建插件（需要 Node.js）：

```bash
cd obsidian-ai-plugin
npm install
npm run build
```

2. 将以下 3 个文件复制到你的 Obsidian Vault 插件目录：

```
<你的Vault>/.obsidian/plugins/obsidian-ai-translator/
├── main.js
├── manifest.json
└── styles.css
```

3. 重启 Obsidian，在 `设置 → 第三方插件` 中启用 **AI Translator**。

## 配置

在 `设置 → AI Translator` 中配置以下选项：

| 设置项 | 说明 | 示例 |
|--------|------|------|
| **API Base URL** | API 服务地址 | `https://api.openai.com/v1` |
| **API Key** | API 密钥 | `sk-xxx...` |
| **模型名称** | 使用的模型 | `gpt-4o`、`deepseek-chat` |
| **目标语言** | 翻译目标语言 | `简体中文`（默认） |
| **自定义系统提示词** | 可选，留空使用默认提示词 | — |
| **单次翻译最大字符数** | 分块大小，建议 2000-5000 | `3000`（默认） |

### 常见服务商配置示例

**OpenAI：**
- Base URL: `https://api.openai.com/v1`
- Model: `gpt-4o`

**DeepSeek：**
- Base URL: `https://api.deepseek.com/v1`
- Model: `deepseek-chat`

**通义千问（阿里云）：**
- Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- Model: `qwen-plus`

**Moonshot（月之暗面）：**
- Base URL: `https://api.moonshot.cn/v1`
- Model: `moonshot-v1-8k`

**硅基流动（SiliconFlow）：**
- Base URL: `https://api.siliconflow.cn/v1`
- Model: 按需选择

## 使用方法

### 翻译整篇文档

1. 打开要翻译的 Markdown 文档
2. 使用以下任一方式触发：
   - 按 `Ctrl/Cmd + P` 打开命令面板，搜索 **"翻译当前文档"**
   - 在编辑器中右键 → **"AI 翻译全文（生成新文件）"**
   - 在文件管理器中右键文件 → **"AI 翻译此文档"**
3. 等待翻译完成，翻译结果自动保存为新文件并打开

### 翻译选中文本

1. 在编辑器中选中要翻译的文本
2. 使用以下任一方式触发：
   - 按 `Ctrl/Cmd + P` 打开命令面板，搜索 **"翻译选中文本"**
   - 右键 → **"AI 翻译选中文本"**
3. 选中的文本会被翻译结果直接替换

## 注意事项

- 翻译整篇文档时会生成新文件，不会修改原文件
- 翻译选中文本会直接替换选区内容，可用 `Ctrl/Cmd + Z` 撤销
- 长文档会自动分段翻译，可在设置中调整分块大小
- 翻译过程中会显示进度提示（第 x/y 段）
- 如果翻译中断，已翻译的部分不会丢失（整篇翻译模式下需重新开始）

## 开发

```bash
# 安装依赖
npm install

# 开发模式（带 sourcemap）
npm run dev

# 生产构建
npm run build
```
