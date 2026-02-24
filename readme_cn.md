# Obsidian Palace

[English](./README.md)

> AI 驱动的 Obsidian 知识管理插件

将你的 Obsidian 笔记库转变为智能知识库，具备 AI Agent 能力、记忆宫殿（知识图谱 + 闪卡）、文档翻译、技能系统和云端沙箱。

支持**任何 OpenAI 兼容 API**（OpenAI、DeepSeek、通义千问、Moonshot、硅基流动等）

---

## 功能一览

| 功能 | 说明 |
|------|------|
| **AI Agent** | 与笔记库对话，支持工具调用（搜索、读写笔记、执行代码） |
| **记忆宫殿** | 提取知识图谱，间隔重复闪卡复习 |
| **文档翻译** | 翻译文档，保留格式 |
| **技能系统** | 自动加载 `.claude/skills` 目录下的自定义技能 |
| **云端沙箱** | 通过 E2B 安全执行 Python/JavaScript 代码 |
| **笔记库问答** | 使用 Obsidian + Grep 混合搜索整个笔记库 |

---

## 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Obsidian Palace                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  对话面板    │    │  记忆宫殿    │    │   翻译器     │          │
│  │  (侧边栏)    │    │   (标签页)   │    │  (编辑器)    │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                   │                   │                   │
│         └───────────────────┼───────────────────┘                   │
│                             ▼                                       │
│                    ┌────────────────┐                               │
│                    │   LLM 客户端   │◄──── OpenAI 兼容 API          │
│                    │   (流式输出)   │                               │
│                    └───────┬────────┘                               │
│                            │                                        │
│         ┌──────────────────┼──────────────────┐                    │
│         ▼                  ▼                  ▼                    │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐              │
│  │ Agent 运行器 │   │ 图谱提取器  │   │   分块器    │              │
│  └──────┬──────┘   └─────────────┘   └─────────────┘              │
│         │                                                          │
│         ▼                                                          │
│  ┌─────────────────────────────────────────────────────┐          │
│  │                    工具注册表                        │          │
│  ├──────────┬──────────┬──────────┬──────────┬────────┤          │
│  │  搜索    │  读取    │  写入    │  列出    │ 执行   │          │
│  │  笔记库  │  笔记    │  笔记    │  笔记    │ 代码   │          │
│  └──────────┴──────────┴──────────┴──────────┴────────┘          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────┐          │
│  │              笔记库问答（文本搜索）                   │          │
│  ├─────────────────────┬───────────────────────────────┤          │
│  │    Obsidian 搜索    │        Grep 搜索              │          │
│  │  (文件名+内容匹配)   │     (正则/关键词)             │          │
│  └─────────────────────┴───────────────────────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户输入 ──► 技能匹配 ──► Agent 运行器 ──► LLM API
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
       工具: 搜索        工具: 读取        工具: 写入
            │                 │                 │
            └─────────────────┼─────────────────┘
                              ▼
                        Obsidian 笔记库
```

---

## 安装

### 环境要求

- Node.js 18+
- Obsidian 0.16.0+

### 手动安装

```bash
# 克隆并构建
git clone https://github.com/magele758/obsidian-palace.git
cd obsidian-palace
npm install
npm run build
```

复制以下文件到你的笔记库：

```
<你的笔记库>/.obsidian/plugins/obsidian-ai-translate/
├── main.js
├── manifest.json
└── styles.css
```

重启 Obsidian，在设置 → 第三方插件中启用 **Obsidian Palace**。

---

## 配置

### LLM 设置

| 设置项 | 说明 | 示例 |
|--------|------|------|
| **API Base URL** | OpenAI 兼容的 API 地址 | `https://api.openai.com/v1` |
| **API Key** | API 密钥 | `sk-xxx...` |
| **模型名称** | 模型标识符 | `gpt-4o`、`deepseek-chat` |

### 服务商示例

| 服务商 | Base URL | 模型 |
|--------|----------|------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`、`gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`、`deepseek-reasoner` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus`、`qwen-max` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | 多种模型可选 |

### Agent 设置

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 启用 Agent 模式 | 允许 AI 使用工具 | 开启 |
| 最大迭代次数 | 每次请求工具调用轮数 | 10 |

### 沙箱设置

| 设置项 | 说明 |
|--------|------|
| 沙箱提供商 | `禁用` 或 `E2B` |
| E2B API Key | 启用代码执行时必填 |
| E2B Domain | 可选自定义域名 |

### 笔记库问答设置

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 启用笔记库问答 | 全库文本搜索 | 关闭 |
| Obsidian 权重 | Obsidian 搜索权重 | 0.6 |
| Grep 权重 | 关键词匹配权重 | 0.4 |
| 最大结果数 | 返回结果上限 | 10 |

---

## 使用指南

### AI 助手

1. 通过**左侧图标**或命令 `Open AI Assistant` 打开
2. 选择文档（可选）作为上下文
3. 提问或使用快捷操作：
   - 📝 **摘要** — 简洁文档总结
   - 🔑 **关键概念** — 提取主要概念
   - ❓ **生成问答** — 创建问答对
   - 🔍 **深度分析** — 全面文档分析
   - 🧠 **提取知识** — 添加到记忆宫殿

### 记忆宫殿

1. 通过**大脑图标**或命令 `Open Memory Palace` 打开
2. 从文档提取知识：
   - 命令：`Extract Knowledge from Current Document`
   - 右键菜单：Extract Knowledge
3. 功能：
   - **图谱视图** — 交互式知识网络
   - **闪卡** — SM-2 间隔重复复习
   - **统计** — 跟踪学习进度

### 文档翻译

1. **整篇翻译**：命令 `Translate Current Document`
2. **选中翻译**：选中文本 → 命令 `Translate Selected Text`
3. 模式：新文件、追加或替换

### 笔记库问答

启用后，AI agent 可搜索整个笔记库：

```
用户: "找出所有关于机器学习的笔记"

Agent 使用: search_vault_qa 工具
         └── Obsidian 搜索 (文件名 + 内容匹配)
         └── Grep 搜索 (关键词/正则匹配)
         └── 混合排序 → 返回最佳结果
```

---

## 开发

```bash
# 开发模式（带 sourcemap）
npm run dev

# 生产构建
npm run build

# 监听模式
npm run dev -- --watch
```

### 项目结构

```
src/
├── main.ts              # 插件入口
├── settings.ts          # 设置界面
├── chatView.ts          # AI 对话面板
├── translator.ts        # 文档翻译
├── shared/
│   ├── types.ts         # 类型定义
│   └── llmClient.ts     # OpenAI 兼容客户端
├── agent/
│   ├── agentRunner.ts   # 多步推理
│   ├── toolRegistry.ts  # 工具管理
│   └── tools/           # Agent 工具
├── palace/
│   ├── palaceView.ts    # 记忆宫殿界面
│   ├── knowledgeGraph.ts
│   ├── graphExtractor.ts
│   └── reviewScheduler.ts
├── skills/
│   ├── skillRegistry.ts # 技能匹配
│   └── skillLoader.ts
├── sandbox/
│   └── e2bProvider.ts   # E2B 集成
└── vault-qa/
    ├── hybridSearch.ts  # 文本搜索
    ├── obsidianSearch.ts
    ├── grepSearch.ts
    └── qaTool.ts
```

---

## 许可证

MIT © magele758
