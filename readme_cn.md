# Obsidian Palace

AI 驱动的 Obsidian 知识管理插件。集成 AI Agent（工具调用）、记忆宫殿（知识图谱 + 间隔重复闪卡）、文档翻译、技能系统和云端沙箱。

支持任何 OpenAI 兼容的 Chat Completion API（OpenAI、DeepSeek、通义千问、Moonshot、硅基流动等）。

## 功能

### AI 助手（Agent）

- **对话面板** — 侧边栏 AI 助手，支持流式输出
- **工具调用** — Agent 可搜索笔记库、读写笔记、列出文件、执行代码
- **文档上下文** — 选择文档作为对话的参考依据
- **会话历史** — 持久化聊天记录，自动命名
- **快捷操作** — 一键摘要、关键概念提取、问答生成、深度分析

### 记忆宫殿

- **知识图谱** — 通过 LLM 从文档中提取概念、实体、主题和事实
- **图谱可视化** — SVG 力导向图展示知识网络
- **闪卡复习** — SM-2 间隔重复算法，高效记忆
- **统计面板** — 跟踪概念数、连接数、待复习卡片和学习进度

### 文档翻译

- **翻译整篇文档** — 生成翻译后的新文件（如 `article.zh.md`）
- **翻译选中文本** — 选中文本直接替换为翻译结果
- **多种模式** — 新文件、追加到原文、替换原文
- **智能分块** — 长文档自动分段，避免超出 token 限制
- **保留格式** — 保留 Markdown 格式、链接、代码块等

### 技能系统

- **自动加载** — 扫描 `~/.claude/skills`、`~/.codex/skills`、`~/.agents/skills` 中的 SKILL.md 文件
- **技能匹配** — 根据用户消息自动激活相关技能
- **自定义目录** — 在设置中配置额外的技能目录

### 云端沙箱（E2B）

- **代码执行** — 在安全的云端沙箱中运行 Python 和 JavaScript 代码
- **E2B 集成** — 直接调用 E2B REST API（无 SDK 依赖）

## 安装

### 手动安装

1. 构建插件（需要 Node.js）：

```bash
npm install
npm run build
```

2. 将以下 3 个文件复制到 Obsidian Vault 插件目录：

```
<你的Vault>/.obsidian/plugins/obsidian-palace/
├── main.js
├── manifest.json
└── styles.css
```

3. 重启 Obsidian，在 `设置 → 第三方插件` 中启用 **Obsidian Palace**。

## 配置

在 `设置 → Obsidian Palace` 中配置：

### LLM 配置

| 设置项 | 说明 | 示例 |
|--------|------|------|
| **API Base URL** | OpenAI 兼容的 API 地址 | `https://api.openai.com/v1` |
| **API Key** | API 密钥 | `sk-xxx...` |
| **模型名称** | 使用的模型 | `gpt-4o`、`deepseek-chat` |

### 常见服务商配置

| 服务商 | Base URL | 模型 |
|--------|----------|------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问（阿里云） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Moonshot（月之暗面） | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | 按需选择 |

### Agent 设置

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| **启用 Agent 模式** | 允许 AI 使用工具 | 开启 |
| **最大迭代次数** | 每次请求最多工具调用轮数 | `10` |

### 沙箱设置

| 设置项 | 说明 |
|--------|------|
| **沙箱提供商** | `禁用` 或 `E2B` |
| **E2B API Key** | 启用 E2B 时必填 |
| **E2B Domain** | 可选自定义域名 |

### 翻译设置

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| **目标语言** | 翻译目标语言 | `简体中文` |
| **翻译模式** | 新文件 / 追加 / 替换 | 新文件 |
| **自定义系统提示词** | 可选，用 `{targetLang}` 作为占位符 | — |
| **单次最大字符数** | 每块字符数（2000-5000） | `3000` |

## 使用方法

### AI 助手

1. 点击左侧栏的**对话图标**，或运行命令 **"Open AI Assistant"**
2. 可选：点击文档选择器选择一个文档作为上下文
3. 输入问题或使用快捷操作按钮
4. Agent 会在需要时自动调用工具（搜索、读写笔记等）

### 记忆宫殿

1. 点击左侧栏的**大脑图标**，或运行命令 **"Open Memory Palace"**
2. 提取知识：打开 .md 文件 → 运行命令 **"Extract Knowledge from Current Document"**（或右键文件 → **"Extract Knowledge"**）
3. 查看知识图谱、复习闪卡或查看统计数据

### 文档翻译

1. **整篇翻译**：打开 .md 文件 → `Cmd/Ctrl + P` → **"Translate Current Document"**（或右键菜单）
2. **选中翻译**：选中文本 → `Cmd/Ctrl + P` → **"Translate Selected Text"**（或右键菜单）

## 开发

```bash
# 安装依赖
npm install

# 开发模式（带 sourcemap）
npm run dev

# 生产构建
npm run build
```

## 许可证

MIT
