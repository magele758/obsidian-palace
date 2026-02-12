import {
  ItemView, WorkspaceLeaf, MarkdownRenderer, Notice,
  setIcon, FuzzySuggestModal, TFile, App
} from 'obsidian';
import type AITranslatorPlugin from './main';

export const CHAT_VIEW_TYPE = 'ai-chat-view';

/* ---- 文档搜索选择弹窗 ---- */
class DocSearchModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('搜索知识库中的文档...');
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

/* ---- 类型 ---- */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_ACTIONS = [
  { label: '📝 总结', prompt: '请用简洁的中文总结这篇文档的核心内容，分要点列出。' },
  { label: '🔑 关键概念', prompt: '请提取这篇文档中的关键概念和术语，并逐一简要解释。' },
  { label: '❓ 生成问答', prompt: '基于这篇文档的内容，生成5个有深度的问答对，帮助理解文档。' },
  { label: '🔍 深度分析', prompt: '请对这篇文档进行深度分析，包括：主题、论点、逻辑结构、潜在的不足或可改进之处。' },
  { label: '✏️ 改写优化', prompt: '请指出这篇文档在表达、结构、逻辑上可以优化的地方，并给出具体建议。' },
];

const SYSTEM_PROMPT = `你是一个嵌入在 Obsidian 笔记软件中的 AI 助手。用户会给你一篇文档的内容，你需要基于文档内容回答用户的问题。

规则：
1. 回答应基于文档内容，必要时可结合你的知识补充。
2. 使用 Markdown 格式回答。
3. 回答应简洁、准确、有条理。
4. 如果文档内容不足以回答问题，请明确说明。`;

/* ---- ChatView ---- */
export class ChatView extends ItemView {
  plugin: AITranslatorPlugin;
  private messages: ChatMessage[] = [];
  private messagesContainer: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private isLoading = false;

  // 锁定选中的文件，不随焦点变化
  private selectedFile: TFile | null = null;
  private selectedDocContent: string | null = null;
  private docInfoEl: HTMLElement;
  private abortController: AbortController | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AITranslatorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return CHAT_VIEW_TYPE; }
  getDisplayText() { return 'AI 助手'; }
  getIcon() { return 'message-square'; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('ai-chat-container');

    // -- 顶部栏 --
    const header = container.createDiv({ cls: 'ai-chat-header' });
    const titleRow = header.createDiv({ cls: 'ai-chat-header-title' });
    const iconEl = titleRow.createSpan({ cls: 'ai-chat-header-icon' });
    setIcon(iconEl, 'bot');
    titleRow.createSpan({ text: 'AI 文档助手' });

    const headerActions = header.createDiv({ cls: 'ai-chat-header-actions' });
    const clearBtn = headerActions.createEl('button', {
      cls: 'ai-chat-icon-btn',
      attr: { 'aria-label': '清空对话' },
    });
    setIcon(clearBtn, 'trash-2');
    clearBtn.addEventListener('click', () => this.clearChat());

    // -- 文档选择栏（点击搜索选文件） --
    this.docInfoEl = container.createDiv({ cls: 'ai-chat-doc-info' });
    this.docInfoEl.addEventListener('click', () => this.openDocPicker());
    this.renderDocInfo();

    // -- 消息区域 --
    this.messagesContainer = container.createDiv({ cls: 'ai-chat-messages' });
    this.renderWelcome();

    // -- 快捷操作 --
    const quickActions = container.createDiv({ cls: 'ai-chat-quick-actions' });
    for (const action of QUICK_ACTIONS) {
      const btn = quickActions.createEl('button', {
        cls: 'ai-chat-quick-btn',
        text: action.label,
      });
      btn.addEventListener('click', () => {
        if (!this.isLoading) {
          this.inputEl.value = action.prompt;
          this.sendCurrentMessage();
        }
      });
    }

    // -- 输入区域 --
    const inputArea = container.createDiv({ cls: 'ai-chat-input-area' });
    this.inputEl = inputArea.createEl('textarea', {
      cls: 'ai-chat-input',
      attr: { placeholder: '输入问题，与文档对话…', rows: '3' },
    });
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendCurrentMessage();
      }
    });

    const inputActions = inputArea.createDiv({ cls: 'ai-chat-input-actions' });
    this.sendBtn = inputActions.createEl('button', { cls: 'ai-chat-send-btn' });
    setIcon(this.sendBtn, 'send');
    this.sendBtn.addEventListener('click', () => this.sendCurrentMessage());
  }

  async onClose() {
    this.abortController?.abort();
  }

  /* ---------- 文档选择 ---------- */

  /** 打开模糊搜索弹窗选文件 */
  private openDocPicker() {
    new DocSearchModal(this.app, async (file) => {
      this.selectedFile = file;
      this.selectedDocContent = await this.app.vault.cachedRead(file);
      this.renderDocInfo();
      new Notice(`已选择文档: ${file.basename}`);
    }).open();
  }

  /** 渲染文档信息栏 */
  private renderDocInfo() {
    this.docInfoEl.empty();
    if (this.selectedFile) {
      const icon = this.docInfoEl.createSpan({ cls: 'ai-chat-doc-icon' });
      setIcon(icon, 'file-text');
      this.docInfoEl.createSpan({ text: this.selectedFile.path, cls: 'ai-chat-doc-name' });
      const changeHint = this.docInfoEl.createSpan({ text: '更换', cls: 'ai-chat-doc-change' });
      setIcon(changeHint, 'search');
    } else {
      const icon = this.docInfoEl.createSpan({ cls: 'ai-chat-doc-icon' });
      setIcon(icon, 'search');
      this.docInfoEl.createSpan({ text: '点击搜索并选择文档', cls: 'ai-chat-doc-none' });
    }
  }

  /* ---------- 消息渲染 ---------- */

  private renderWelcome() {
    this.messagesContainer.empty();
    const welcome = this.messagesContainer.createDiv({ cls: 'ai-chat-welcome' });
    welcome.createEl('div', { cls: 'ai-chat-welcome-icon', text: '🤖' });
    welcome.createEl('div', {
      cls: 'ai-chat-welcome-title',
      text: '你好！我是你的 AI 文档助手',
    });
    welcome.createEl('div', {
      cls: 'ai-chat-welcome-desc',
      text: '先点击上方搜索栏选择一篇文档，然后使用快捷操作或直接输入问题开始对话。',
    });
  }

  private appendMessage(role: 'user' | 'assistant', content: string): HTMLElement {
    const welcome = this.messagesContainer.querySelector('.ai-chat-welcome');
    if (welcome) welcome.remove();

    const msgEl = this.messagesContainer.createDiv({
      cls: `ai-chat-msg ai-chat-msg-${role}`,
    });
    const avatar = msgEl.createDiv({ cls: 'ai-chat-msg-avatar' });
    setIcon(avatar, role === 'user' ? 'user' : 'bot');

    const bubble = msgEl.createDiv({ cls: 'ai-chat-msg-bubble' });

    if (role === 'assistant') {
      MarkdownRenderer.render(this.app, content || '…', bubble, '', this);
    } else {
      bubble.createEl('p', { text: content });
    }

    this.scrollToBottom();
    return msgEl;
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    });
  }

  /* ---------- 发送 / AI 响应 ---------- */

  private async sendCurrentMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isLoading) return;

    const { baseUrl, apiKey, modelName } = this.plugin.settings;
    if (!baseUrl || !apiKey || !modelName) {
      new Notice('请先在设置中配置 API');
      return;
    }

    if (!this.selectedFile || !this.selectedDocContent) {
      new Notice('请先选择一篇文档');
      this.openDocPicker();
      return;
    }

    this.inputEl.value = '';
    this.messages.push({ role: 'user', content: text });
    this.appendMessage('user', text);
    await this.getAIResponse(text);
  }

  private async getAIResponse(userMessage: string) {
    this.isLoading = true;
    this.sendBtn.disabled = true;
    this.sendBtn.addClass('ai-chat-loading');

    const msgEl = this.appendMessage('assistant', '');
    const bubble = msgEl.querySelector('.ai-chat-msg-bubble') as HTMLElement;
    bubble.empty();
    bubble.createDiv({ cls: 'ai-chat-typing', text: '思考中' });

    try {
      const result = await this.callChatAPI(userMessage, bubble);
      this.messages.push({ role: 'assistant', content: result });
      bubble.empty();
      await MarkdownRenderer.render(this.app, result, bubble, '', this);
      this.scrollToBottom();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      const msg = error instanceof Error ? error.message : String(error);
      bubble.empty();
      bubble.createDiv({ cls: 'ai-chat-error', text: `错误: ${msg}` });
    } finally {
      this.isLoading = false;
      this.sendBtn.disabled = false;
      this.sendBtn.removeClass('ai-chat-loading');
    }
  }

  private async callChatAPI(userMessage: string, bubble: HTMLElement): Promise<string> {
    const { baseUrl, apiKey, modelName } = this.plugin.settings;

    const docContext = `以下是用户选择的文档《${this.selectedFile!.basename}》的内容：\n\n---\n${this.selectedDocContent}\n---\n\n`;

    type APIMessage = { role: string; content: string };
    const apiMessages: APIMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: docContext + '请记住上面的文档内容，接下来我会对你提问。' },
      { role: 'assistant', content: '好的，我已经仔细阅读了文档内容，请问有什么问题？' },
    ];

    // 历史消息（不含刚 push 的最后一条 user）
    for (let i = 0; i < this.messages.length - 1; i++) {
      apiMessages.push({ role: this.messages[i].role, content: this.messages[i].content });
    }
    apiMessages.push({ role: 'user', content: userMessage });

    const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
    this.abortController = new AbortController();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: apiMessages,
          temperature: 0.7,
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API 请求失败 (${response.status}): ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取响应流');

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              bubble.empty();
              await MarkdownRenderer.render(this.app, fullContent, bubble, '', this);
              this.scrollToBottom();
            }
          } catch {
            // ignore parse errors for partial chunks
          }
        }
      }

      this.abortController = null;
      return fullContent || '（无响应内容）';
    } catch (error) {
      this.abortController = null;
      throw error;
    }
  }

  /* ---------- 清空 ---------- */

  private clearChat() {
    this.messages = [];
    // 保留选中的文档，只清空对话
    this.renderWelcome();
  }
}
