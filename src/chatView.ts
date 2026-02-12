/**
 * Chat View - AI Assistant panel with Agent capabilities.
 *
 * Refactored to use AgentRunner for tool calling, skill integration, etc.
 */

import {
  ItemView, WorkspaceLeaf, MarkdownRenderer, Notice,
  setIcon, FuzzySuggestModal, TFile, App
} from 'obsidian';
import type ObsidianPalacePlugin from './main';
import { LLMClient } from './shared/llmClient';
import { AgentRunner } from './agent/agentRunner';
import { ToolRegistry } from './agent/toolRegistry';
import { createSearchVaultTool } from './agent/tools/searchVault';
import { createReadNoteTool } from './agent/tools/readNote';
import { createWriteNoteTool } from './agent/tools/writeNote';
import { createListNotesTool } from './agent/tools/listNotes';
import { createExecuteCodeTool } from './agent/tools/executeCode';
import type { LLMMessage } from './shared/types';

export const CHAT_VIEW_TYPE = 'ai-chat-view';

/* ---- Doc Search Modal ---- */
class DocSearchModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Search documents...');
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

/* ---- Types ---- */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_ACTIONS = [
  { label: '📝 Summary', prompt: 'Summarize this document concisely, listing key points.' },
  { label: '🔑 Key Concepts', prompt: 'Extract key concepts and terms from this document and explain each briefly.' },
  { label: '❓ Generate Q&A', prompt: 'Generate 5 insightful Q&A pairs based on this document.' },
  { label: '🔍 Deep Analysis', prompt: 'Provide a deep analysis of this document: theme, arguments, structure, and potential improvements.' },
  { label: '🧠 Extract Knowledge', prompt: 'Extract knowledge nodes and relationships from this document for my Memory Palace.' },
];

const AGENT_SYSTEM_PROMPT = `You are an AI assistant embedded in Obsidian, a knowledge management tool. You have access to the user's vault (document collection) through tools.

Capabilities:
- Search, read, and write notes in the vault
- Execute code in a cloud sandbox (if configured)
- Answer questions based on document context
- Extract knowledge and build knowledge graphs

Rules:
1. Use tools proactively when needed to answer questions or complete tasks.
2. When a document is selected, base your answers on its content first.
3. Use Markdown formatting in responses.
4. Be concise and accurate.
5. If you need more information, search the vault or ask the user.`;

/* ---- ChatView ---- */
export class ChatView extends ItemView {
  plugin: ObsidianPalacePlugin;
  private messages: ChatMessage[] = [];
  private llmMessages: LLMMessage[] = [];
  private messagesContainer: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private isLoading = false;

  private selectedFile: TFile | null = null;
  private selectedDocContent: string | null = null;
  private docInfoEl: HTMLElement;
  private abortController: AbortController | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianPalacePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return CHAT_VIEW_TYPE; }
  getDisplayText() { return 'AI Assistant'; }
  getIcon() { return 'message-square'; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('ai-chat-container');

    // Header
    const header = container.createDiv({ cls: 'ai-chat-header' });
    const titleRow = header.createDiv({ cls: 'ai-chat-header-title' });
    const iconEl = titleRow.createSpan({ cls: 'ai-chat-header-icon' });
    setIcon(iconEl, 'bot');
    titleRow.createSpan({ text: 'AI Assistant' });

    const headerActions = header.createDiv({ cls: 'ai-chat-header-actions' });
    const clearBtn = headerActions.createEl('button', {
      cls: 'ai-chat-icon-btn',
      attr: { 'aria-label': 'Clear chat' },
    });
    setIcon(clearBtn, 'trash-2');
    clearBtn.addEventListener('click', () => this.clearChat());

    // Doc picker
    this.docInfoEl = container.createDiv({ cls: 'ai-chat-doc-info' });
    this.docInfoEl.addEventListener('click', () => this.openDocPicker());
    this.renderDocInfo();

    // Messages
    this.messagesContainer = container.createDiv({ cls: 'ai-chat-messages' });
    this.renderWelcome();

    // Quick actions
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

    // Input
    const inputArea = container.createDiv({ cls: 'ai-chat-input-area' });
    this.inputEl = inputArea.createEl('textarea', {
      cls: 'ai-chat-input',
      attr: { placeholder: 'Ask a question or give a task...', rows: '3' },
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

  /* ---------- Doc Picker ---------- */

  private openDocPicker() {
    new DocSearchModal(this.app, async (file) => {
      this.selectedFile = file;
      this.selectedDocContent = await this.app.vault.cachedRead(file);
      this.renderDocInfo();
      new Notice(`Selected: ${file.basename}`);
    }).open();
  }

  private renderDocInfo() {
    this.docInfoEl.empty();
    if (this.selectedFile) {
      const icon = this.docInfoEl.createSpan({ cls: 'ai-chat-doc-icon' });
      setIcon(icon, 'file-text');
      this.docInfoEl.createSpan({ text: this.selectedFile.path, cls: 'ai-chat-doc-name' });
      const changeHint = this.docInfoEl.createSpan({ text: 'change', cls: 'ai-chat-doc-change' });
      setIcon(changeHint, 'search');
    } else {
      const icon = this.docInfoEl.createSpan({ cls: 'ai-chat-doc-icon' });
      setIcon(icon, 'search');
      this.docInfoEl.createSpan({ text: 'Click to select a document (optional)', cls: 'ai-chat-doc-none' });
    }
  }

  /* ---------- Message Rendering ---------- */

  private renderWelcome() {
    this.messagesContainer.empty();
    const welcome = this.messagesContainer.createDiv({ cls: 'ai-chat-welcome' });
    welcome.createEl('div', { cls: 'ai-chat-welcome-icon', text: '🤖' });
    welcome.createEl('div', { cls: 'ai-chat-welcome-title', text: 'AI Assistant' });
    welcome.createEl('div', {
      cls: 'ai-chat-welcome-desc',
      text: 'Select a document or just ask a question. I can search your vault, execute code, and more.',
    });

    // Show skill info
    const skillCount = this.plugin.skillRegistry?.size ?? 0;
    if (skillCount > 0) {
      welcome.createEl('div', {
        cls: 'ai-chat-welcome-skills',
        text: `${skillCount} skill(s) loaded`,
      });
    }
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

  /* ---------- Send / Agent Response ---------- */

  private async sendCurrentMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isLoading) return;

    const { baseUrl, apiKey, modelName } = this.plugin.settings;
    if (!baseUrl || !apiKey || !modelName) {
      new Notice('Please configure API settings first');
      return;
    }

    this.inputEl.value = '';
    this.messages.push({ role: 'user', content: text });
    this.appendMessage('user', text);

    await this.getAgentResponse(text);
  }

  private async getAgentResponse(userMessage: string) {
    this.isLoading = true;
    this.sendBtn.disabled = true;
    this.sendBtn.addClass('ai-chat-loading');

    const msgEl = this.appendMessage('assistant', '');
    const bubble = msgEl.querySelector('.ai-chat-msg-bubble') as HTMLElement;
    bubble.empty();
    bubble.createDiv({ cls: 'ai-chat-typing', text: 'Thinking' });

    const { baseUrl, apiKey, modelName, agentEnabled, agentMaxIterations } = this.plugin.settings;

    try {
      const llmClient = new LLMClient({ baseUrl, apiKey, modelName });

      // Build system prompt
      let systemPrompt = AGENT_SYSTEM_PROMPT;

      // Add skill metadata
      const skillSummary = this.plugin.skillRegistry?.buildMetadataSummary();
      if (skillSummary) {
        systemPrompt += '\n\n' + skillSummary;
      }

      // Add skill instructions if a match is found
      const matchedSkill = this.plugin.skillRegistry?.findMatch(userMessage);
      if (matchedSkill) {
        systemPrompt += `\n\n## Active Skill: ${matchedSkill.metadata.name}\n\n${matchedSkill.instructions}`;
      }

      // Build context messages
      const contextMessages: LLMMessage[] = [];

      // Document context
      if (this.selectedFile && this.selectedDocContent) {
        contextMessages.push({
          role: 'user',
          content: `[Document context: "${this.selectedFile.basename}"]\n\n---\n${this.selectedDocContent}\n---\n\nPlease remember this document. I'll ask questions next.`,
        });
        contextMessages.push({
          role: 'assistant',
          content: 'I\'ve read the document. What would you like to know?',
        });
      }

      // Chat history
      for (let i = 0; i < this.messages.length - 1; i++) {
        contextMessages.push({
          role: this.messages[i].role,
          content: this.messages[i].content,
        });
      }
      contextMessages.push({ role: 'user', content: userMessage });

      let result: string;

      if (agentEnabled) {
        // Agent mode with tool calling
        const toolRegistry = new ToolRegistry();
        toolRegistry.register(createSearchVaultTool(this.app));
        toolRegistry.register(createReadNoteTool(this.app));
        toolRegistry.register(createWriteNoteTool(this.app));
        toolRegistry.register(createListNotesTool(this.app));
        toolRegistry.register(createExecuteCodeTool(this.plugin.sandboxProvider));

        const agent = new AgentRunner({
          llmClient,
          toolRegistry,
          maxIterations: agentMaxIterations,
          systemPrompt,
          temperature: 0.7,
        });

        this.abortController = new AbortController();
        let fullText = '';

        result = await agent.run(
          contextMessages,
          {
            onToken: (token) => {
              fullText += token;
              bubble.empty();
              MarkdownRenderer.render(this.app, fullText, bubble, '', this);
              this.scrollToBottom();
            },
            onThinking: (toolName) => {
              bubble.empty();
              const thinking = bubble.createDiv({ cls: 'ai-chat-tool-status' });
              thinking.createSpan({ text: `🔧 Using: ${toolName}` });
              if (fullText) {
                const prev = bubble.createDiv();
                MarkdownRenderer.render(this.app, fullText, prev, '', this);
              }
              this.scrollToBottom();
            },
            onToolResult: (toolName, _result) => {
              // Tool results are passed back to LLM, no need to display
            },
          },
          this.abortController.signal
        );
      } else {
        // Simple streaming mode (no tools)
        this.abortController = new AbortController();
        let fullText = '';

        const response = await llmClient.stream(
          [{ role: 'system', content: systemPrompt }, ...contextMessages],
          (delta) => {
            if (delta.content) {
              fullText += delta.content;
              bubble.empty();
              MarkdownRenderer.render(this.app, fullText, bubble, '', this);
              this.scrollToBottom();
            }
          },
          { temperature: 0.7, signal: this.abortController.signal }
        );
        result = response.content || fullText;
      }

      this.messages.push({ role: 'assistant', content: result });
      bubble.empty();
      await MarkdownRenderer.render(this.app, result, bubble, '', this);
      this.scrollToBottom();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      const msg = error instanceof Error ? error.message : String(error);
      bubble.empty();
      bubble.createDiv({ cls: 'ai-chat-error', text: `Error: ${msg}` });
    } finally {
      this.isLoading = false;
      this.sendBtn.disabled = false;
      this.sendBtn.removeClass('ai-chat-loading');
      this.abortController = null;
    }
  }

  private clearChat() {
    this.messages = [];
    this.llmMessages = [];
    this.renderWelcome();
  }
}
