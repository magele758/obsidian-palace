/**
 * Chat View - AI Assistant panel with Agent capabilities and session history.
 */

import {
  ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, Modal,
  setIcon, FuzzySuggestModal, TFile, App
} from 'obsidian';
import type ObsidianPalacePlugin from './main';
import { LLMClient } from './shared/llmClient';
import { createPalaceAgent } from './agent/createPalaceAgent';
import { createPalaceToolRegistry } from './agent/palaceTools';
import type { LLMMessage, ChatSession, ChatMessage } from './shared/types';
import { LiveBubble } from './chat/liveBubble';

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

/* ---- Write Confirm Modal ---- */
class WriteConfirmModal extends Modal {
  private resolveFn: (value: boolean) => void;
  private settled = false;
  private filePath: string;
  private mode: string;

  constructor(app: App, filePath: string, mode: string, resolve: (value: boolean) => void) {
    super(app);
    this.filePath = filePath;
    this.mode = mode;
    this.resolveFn = resolve;
  }

  private settle(value: boolean) {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn(value);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Confirm write' });
    contentEl.createEl('p', {
      text: `The agent wants to ${this.mode} "${this.filePath}". Allow?`,
    });

    const btnRow = contentEl.createDiv({ cls: 'modal-button-container' });
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '8px';
    btnRow.style.marginTop = '16px';

    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => { this.settle(false); this.close(); });

    const okBtn = btnRow.createEl('button', { text: 'Allow', cls: 'mod-cta' });
    okBtn.addEventListener('click', () => { this.settle(true); this.close(); });
  }

  onClose() {
    this.settle(false);
    this.contentEl.empty();
  }
}

/* ---- Constants ---- */
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
- Traverse the vault link graph (get_note_links, traverse_links, find_orphan_notes, get_related_notes)
- Execute code in a cloud sandbox (if configured)
- Answer questions based on document context
- Extract knowledge and build knowledge graphs
- Search entire vault with text search (search_vault, search_vault_qa if enabled)

Rules:
1. Use tools proactively when needed to answer questions or complete tasks.
2. When a document is selected, base your answers on its content first.
3. Prefer search_vault or search_vault_qa for vault-wide queries; use graph tools to explore connections.
4. Use Markdown formatting in responses.
5. Be concise and accurate.
6. When citing a vault note, always include its wiki-link, e.g. [[path/to/note]] or the citation field returned by search_vault.
7. If you need more information, search the vault or ask the user.`;

/* ---- ChatView ---- */
export class ChatView extends ItemView {
  plugin: ObsidianPalacePlugin;

  // Session
  private currentSession: ChatSession | null = null;
  private showSessionList = false;

  // UI elements
  private rootContainer: HTMLElement;
  private sessionListEl: HTMLElement;
  private chatPanelEl: HTMLElement;
  private messagesContainer: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private docInfoEl: HTMLElement;
  private isLoading = false;

  // Doc context
  private selectedFile: TFile | null = null;
  private selectedDocContent: string | null = null;
  private abortController: AbortController | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianPalacePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return CHAT_VIEW_TYPE; }
  getDisplayText() { return 'AI Assistant'; }
  getIcon() { return 'message-square'; }

  async onOpen() {
    this.rootContainer = this.containerEl.children[1] as HTMLElement;
    this.rootContainer.empty();
    this.rootContainer.addClass('ai-chat-root');

    // Load latest session or create new
    if (this.plugin.chatSessions.length > 0) {
      this.currentSession = this.plugin.chatSessions[0];
      // Restore doc context
      if (this.currentSession.docPath) {
        const file = this.app.vault.getAbstractFileByPath(this.currentSession.docPath);
        if (file instanceof TFile) {
          this.selectedFile = file;
          this.selectedDocContent = await this.app.vault.cachedRead(file);
        }
      }
    }

    this.render();
    await this.consumePendingAsk();
  }

  /** Prefill/send a prompt queued by Ask about Selection */
  async consumePendingAsk() {
    const prompt = this.plugin.pendingAskPrompt;
    if (!prompt || this.isLoading) return;
    this.plugin.pendingAskPrompt = null;

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile) {
      this.selectedFile = activeFile;
      this.selectedDocContent = await this.app.vault.cachedRead(activeFile);
      this.renderDocInfo();
    }

    this.inputEl.value = prompt;
    await this.sendCurrentMessage();
  }

  async onClose() {
    this.abortController?.abort();
  }

  /* ========== Full Render ========== */

  private render() {
    this.rootContainer.empty();

    // Session list (toggleable sidebar)
    this.sessionListEl = this.rootContainer.createDiv({
      cls: `ai-session-list ${this.showSessionList ? 'ai-session-list-open' : ''}`,
    });
    this.renderSessionList();

    // Chat panel
    this.chatPanelEl = this.rootContainer.createDiv({ cls: 'ai-chat-container' });
    this.renderChatPanel();
  }

  /* ========== Session List ========== */

  private renderSessionList() {
    this.sessionListEl.empty();

    // Header
    const header = this.sessionListEl.createDiv({ cls: 'ai-session-list-header' });
    header.createSpan({ text: 'Chat History' });
    const closeBtn = header.createEl('button', { cls: 'ai-chat-icon-btn' });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => {
      this.showSessionList = false;
      this.render();
    });

    // New chat button
    const newBtn = this.sessionListEl.createEl('button', {
      cls: 'ai-session-new-btn',
      text: '+ New Chat',
    });
    newBtn.addEventListener('click', () => this.newSession());

    // Session items
    const list = this.sessionListEl.createDiv({ cls: 'ai-session-items' });
    for (const session of this.plugin.chatSessions) {
      const item = list.createDiv({
        cls: `ai-session-item ${session.id === this.currentSession?.id ? 'ai-session-item-active' : ''}`,
      });

      const info = item.createDiv({ cls: 'ai-session-item-info' });
      info.createDiv({ cls: 'ai-session-item-title', text: session.title });
      info.createDiv({
        cls: 'ai-session-item-meta',
        text: `${session.messages.length} msgs · ${this.formatTime(session.updatedAt)}`,
      });

      info.addEventListener('click', () => this.switchSession(session.id));

      const delBtn = item.createEl('button', {
        cls: 'ai-chat-icon-btn ai-session-del-btn',
      });
      setIcon(delBtn, 'trash-2');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSession(session.id);
      });
    }

    if (this.plugin.chatSessions.length === 0) {
      list.createDiv({ cls: 'ai-session-empty', text: 'No chat history' });
    }
  }

  private formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /* ========== Chat Panel ========== */

  private renderChatPanel() {
    this.chatPanelEl.empty();

    // Header
    const header = this.chatPanelEl.createDiv({ cls: 'ai-chat-header' });

    const leftActions = header.createDiv({ cls: 'ai-chat-header-left' });
    const historyBtn = leftActions.createEl('button', {
      cls: 'ai-chat-icon-btn',
      attr: { 'aria-label': 'Chat history' },
    });
    setIcon(historyBtn, 'history');
    historyBtn.addEventListener('click', () => {
      this.showSessionList = !this.showSessionList;
      this.render();
    });

    const titleRow = header.createDiv({ cls: 'ai-chat-header-title' });
    const iconEl = titleRow.createSpan({ cls: 'ai-chat-header-icon' });
    setIcon(iconEl, 'bot');
    titleRow.createSpan({ text: this.currentSession?.title || 'AI Assistant' });

    const headerActions = header.createDiv({ cls: 'ai-chat-header-actions' });

    const newChatBtn = headerActions.createEl('button', {
      cls: 'ai-chat-icon-btn',
      attr: { 'aria-label': 'New chat' },
    });
    setIcon(newChatBtn, 'plus');
    newChatBtn.addEventListener('click', () => this.newSession());

    const clearBtn = headerActions.createEl('button', {
      cls: 'ai-chat-icon-btn',
      attr: { 'aria-label': 'Clear chat' },
    });
    setIcon(clearBtn, 'trash-2');
    clearBtn.addEventListener('click', () => this.clearCurrentChat());

    // Doc picker
    this.docInfoEl = this.chatPanelEl.createDiv({ cls: 'ai-chat-doc-info' });
    this.docInfoEl.addEventListener('click', () => this.openDocPicker());
    this.renderDocInfo();

    // Messages
    this.messagesContainer = this.chatPanelEl.createDiv({ cls: 'ai-chat-messages' });
    this.restoreMessages();

    // Quick actions
    const quickActions = this.chatPanelEl.createDiv({ cls: 'ai-chat-quick-actions' });
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
    const inputArea = this.chatPanelEl.createDiv({ cls: 'ai-chat-input-area' });
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

  /**
   * Restore messages from current session into the UI
   */
  private restoreMessages() {
    if (!this.currentSession || this.currentSession.messages.length === 0) {
      this.renderWelcome();
      return;
    }

    this.messagesContainer.empty();
    for (const msg of this.currentSession.messages) {
      this.appendMessageEl(msg.role, msg.content);
    }
    this.scrollToBottom();
  }

  /* ========== Session Management ========== */

  private async newSession() {
    const session = this.plugin.createChatSession();
    await this.plugin.saveChatSessions();
    this.currentSession = session;
    this.selectedFile = null;
    this.selectedDocContent = null;
    this.showSessionList = false;
    this.render();
  }

  private async switchSession(id: string) {
    const session = this.plugin.chatSessions.find(s => s.id === id);
    if (!session) return;

    this.currentSession = session;
    this.selectedFile = null;
    this.selectedDocContent = null;

    // Restore doc context
    if (session.docPath) {
      const file = this.app.vault.getAbstractFileByPath(session.docPath);
      if (file instanceof TFile) {
        this.selectedFile = file;
        this.selectedDocContent = await this.app.vault.cachedRead(file);
      }
    }

    this.showSessionList = false;
    this.render();
  }

  private async deleteSession(id: string) {
    await this.plugin.deleteChatSession(id);
    if (this.currentSession?.id === id) {
      this.currentSession = this.plugin.chatSessions[0] || null;
      if (this.currentSession?.docPath) {
        const file = this.app.vault.getAbstractFileByPath(this.currentSession.docPath);
        if (file instanceof TFile) {
          this.selectedFile = file;
          this.selectedDocContent = await this.app.vault.cachedRead(file);
        }
      } else {
        this.selectedFile = null;
        this.selectedDocContent = null;
      }
    }
    this.render();
  }

  private async clearCurrentChat() {
    if (!this.currentSession) return;
    this.currentSession.messages = [];
    this.currentSession.title = 'New Chat';
    await this.plugin.updateChatSession(this.currentSession);
    this.render();
  }

  /**
   * Ensure a session exists before sending a message
   */
  private ensureSession(): ChatSession {
    if (!this.currentSession) {
      this.currentSession = this.plugin.createChatSession();
    }
    return this.currentSession;
  }

  /* ========== Doc Picker ========== */

  private openDocPicker() {
    new DocSearchModal(this.app, async (file) => {
      this.selectedFile = file;
      this.selectedDocContent = await this.app.vault.cachedRead(file);
      this.renderDocInfo();
      // Save doc association to session
      const session = this.ensureSession();
      session.docPath = file.path;
      await this.plugin.updateChatSession(session);
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

  /* ========== Message Rendering ========== */

  private renderWelcome() {
    this.messagesContainer.empty();
    const welcome = this.messagesContainer.createDiv({ cls: 'ai-chat-welcome' });
    welcome.createEl('div', { cls: 'ai-chat-welcome-icon', text: '🤖' });
    welcome.createEl('div', { cls: 'ai-chat-welcome-title', text: 'AI Assistant' });
    welcome.createEl('div', {
      cls: 'ai-chat-welcome-desc',
      text: 'Select a document or just ask a question. I can search your vault, execute code, and more.',
    });

    const skillCount = this.plugin.skillRegistry?.size ?? 0;
    if (skillCount > 0) {
      welcome.createEl('div', {
        cls: 'ai-chat-welcome-skills',
        text: `${skillCount} skill(s) loaded`,
      });
    }
  }

  private appendMessageEl(role: 'user' | 'assistant', content: string): HTMLElement {
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

  /* ========== Send / Agent Response ========== */

  private async sendCurrentMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isLoading) return;

    const { baseUrl, apiKey, modelName } = this.plugin.settings;
    if (!baseUrl || !apiKey || !modelName) {
      new Notice('Please configure API settings first');
      return;
    }

    const session = this.ensureSession();

    this.inputEl.value = '';
    session.messages.push({ role: 'user', content: text });
    this.appendMessageEl('user', text);

    // Save immediately (title auto-updates)
    await this.plugin.updateChatSession(session);
    // Refresh session list title if visible
    if (this.showSessionList) {
      this.renderSessionList();
    }

    await this.getAgentResponse(text);
  }

  private async getAgentResponse(userMessage: string) {
    this.isLoading = true;
    this.sendBtn.disabled = true;
    this.sendBtn.addClass('ai-chat-loading');

    const msgEl = this.appendMessageEl('assistant', '');
    const bubble = msgEl.querySelector('.ai-chat-msg-bubble') as HTMLElement;
    bubble.empty();
    bubble.createDiv({ cls: 'ai-chat-typing', text: 'Thinking' });

    const session = this.currentSession!;
    const { baseUrl, apiKey, modelName, agentEnabled, agentMaxIterations } = this.plugin.settings;
    const live = new LiveBubble(bubble);

    try {
      const llmClient = new LLMClient({ baseUrl, apiKey, modelName });
      const maxCtx = this.plugin.settings.maxDocContextChars ?? 12000;

      // Build system prompt
      let systemPrompt = AGENT_SYSTEM_PROMPT;

      const skillSummary = this.plugin.skillRegistry?.buildMetadataSummary();
      if (skillSummary) systemPrompt += '\n\n' + skillSummary;

      const matchedSkill = this.plugin.skillRegistry?.findMatch(userMessage);
      if (matchedSkill) {
        systemPrompt += `\n\n## Active Skill: ${matchedSkill.metadata.name}\n\n${matchedSkill.instructions}`;
      }

      // Resolve @mention and #tag context from the user message
      const extraContext = await this.resolveMessageContext(userMessage, maxCtx);

      // Build context messages
      const contextMessages: LLMMessage[] = [];

      if (this.selectedFile && this.selectedDocContent) {
        const truncated = this.selectedDocContent.length > maxCtx
          ? this.selectedDocContent.slice(0, maxCtx) + '\n\n[...truncated]'
          : this.selectedDocContent;
        contextMessages.push({
          role: 'user',
          content: `[Document context: "${this.selectedFile.basename}"]\n\n---\n${truncated}\n---\n\nPlease remember this document. I'll ask questions next.`,
        });
        contextMessages.push({
          role: 'assistant',
          content: 'I\'ve read the document. What would you like to know?',
        });
      }

      // Inject @mention / #tag extra context
      if (extraContext) {
        contextMessages.push({ role: 'user', content: extraContext });
        contextMessages.push({ role: 'assistant', content: 'I\'ve read the additional context. What would you like to know?' });
      }

      // Recent chat history only (avoid unbounded context growth)
      const MAX_HISTORY = 16;
      const prior = session.messages.slice(0, -1);
      const recent = prior.length > MAX_HISTORY ? prior.slice(-MAX_HISTORY) : prior;
      for (const msg of recent) {
        contextMessages.push({ role: msg.role, content: msg.content });
      }
      contextMessages.push({ role: 'user', content: userMessage });

      let result: string;
      this.abortController = new AbortController();

      if (agentEnabled) {
        // Build write confirm callback if required
        const confirmWrite = this.plugin.settings.requireWriteConfirm
          ? (path: string, mode: string) =>
              new Promise<boolean>((resolve) => {
                new WriteConfirmModal(this.app, path, mode, resolve).open();
              })
          : undefined;

        const toolRegistry = createPalaceToolRegistry({
          app: this.app,
          hybridSearch: this.plugin.hybridSearch,
          sandboxProvider: this.plugin.sandboxProvider,
          confirmWrite,
          vaultQAEnabled: this.plugin.settings.vaultQAEnabled,
        });

        const agent = createPalaceAgent({
          engine: this.plugin.settings.agentEngine === 'legacy' ? 'legacy' : 'kernel',
          llmClient,
          toolRegistry,
          maxIterations: agentMaxIterations,
          systemPrompt,
          temperature: 0.7,
        });

        result = await agent.run(
          contextMessages,
          {
            onToken: (token) => {
              live.append(token);
              this.scrollToBottom();
            },
            onReasoning: () => {
              if (live.text) return;
              live.showStatus('思考中…');
              this.scrollToBottom();
            },
            onThinking: (toolName) => {
              live.showTool(toolName);
              this.scrollToBottom();
            },
            onToolResult: () => {},
          },
          this.abortController.signal
        );
      } else {
        const response = await llmClient.stream(
          [{ role: 'system', content: systemPrompt }, ...contextMessages],
          (delta) => {
            if (delta.content) {
              live.append(delta.content);
              this.scrollToBottom();
            }
          },
          { temperature: 0.7, signal: this.abortController.signal }
        );
        result = response.content || live.text;
      }

      // Save assistant response to session
      session.messages.push({ role: 'assistant', content: result });
      await this.plugin.updateChatSession(session);
      await live.commit(this.app, this, result);
      this.scrollToBottom();
    } catch (error) {
      live.discard();
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

  /**
   * Resolve @path/to/note.md, @Note Name mentions and #tag references in a message.
   * Returns an injected context block or null.
   */
  private async resolveMessageContext(message: string, maxChars: number): Promise<string | null> {
    const parts: string[] = [];

    // @mention: @path/to/note or @Note Name (resolved against vault files)
    const mentionPattern = /@([\w/.:-]+(?:\s[\w/.:-]+)*)/g;
    const mentionMatches = [...message.matchAll(mentionPattern)];
    for (const match of mentionMatches) {
      const raw = match[1].trim();
      // Try exact path match first, then basename match
      const allFiles = this.app.vault.getMarkdownFiles();
      const file =
        (this.app.vault.getAbstractFileByPath(raw) as TFile | null) ||
        (this.app.vault.getAbstractFileByPath(raw + '.md') as TFile | null) ||
        allFiles.find((f) => f.basename.toLowerCase() === raw.toLowerCase()) ||
        null;

      if (file instanceof TFile) {
        const content = await this.app.vault.cachedRead(file);
        const truncated = content.length > maxChars
          ? content.slice(0, maxChars) + '\n\n[...truncated]'
          : content;
        parts.push(`[Mentioned note: "${file.path}"]\n\n---\n${truncated}\n---`);
      }
    }

    // #tag: inject up to 10 file paths with that tag (frontmatter + inline)
    const tagPattern = /(?:^|[\s(])#([\w/-]+)/g;
    const tagMatches = [...message.matchAll(tagPattern)];
    for (const match of tagMatches) {
      const tagName = match[1].toLowerCase();
      const files = this.app.vault.getMarkdownFiles().filter((f) => {
        const cache = this.app.metadataCache.getFileCache(f);
        if (!cache) return false;
        const tags = [
          ...(cache.tags ?? []).map((t) => t.tag.replace(/^#/, '').toLowerCase()),
          ...((cache.frontmatter?.tags as string[] | string | undefined)
            ? (Array.isArray(cache.frontmatter.tags)
                ? cache.frontmatter.tags
                : String(cache.frontmatter.tags).split(/[,\s]+/))
                .map((t) => String(t).replace(/^#/, '').toLowerCase())
            : []),
        ];
        return tags.includes(tagName);
      }).slice(0, 10);

      if (files.length > 0) {
        parts.push(
          `[Notes tagged #${tagName}]: ${files.map((f) => `[[${f.path.replace(/\.md$/, '')}]]`).join(', ')}`
        );
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }
}
