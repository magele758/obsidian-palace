/**
 * Obsidian Palace - AI-powered knowledge management plugin
 *
 * Features:
 * - AI Agent with tool calling (search, read/write notes, code execution)
 * - Skill system (loads from ~/.claude, ~/.codex, ~/.agents)
 * - Memory Palace (knowledge graph + spaced repetition flashcards)
 * - Document translation (OpenAI-compatible APIs)
 * - Cloud sandbox (E2B) for code execution
 */

import { App, Editor, MarkdownView, Modal, Notice, Plugin, TFile } from 'obsidian';
import { PalaceSettings, PalaceSettingTab, DEFAULT_SETTINGS } from './settings';
import { Translator, TranslatorConfig } from './translator';
import { ChatView, CHAT_VIEW_TYPE } from './chatView';
import { PalaceView, PALACE_VIEW_TYPE } from './palace/palaceView';
import { LLMClient } from './shared/llmClient';
import { KnowledgeGraph } from './palace/knowledgeGraph';
import { GraphExtractor } from './palace/graphExtractor';
import { SkillRegistry } from './skills/skillRegistry';
import { E2BProvider } from './sandbox/e2bProvider';
import type { PalaceData, SandboxProvider, ChatSession, AgentTool } from './shared/types';

// Vault QA imports (text-based search only)
import {
  HybridSearch,
  createVaultQATools,
} from './vault-qa';

const PALACE_DATA_KEY = 'palace-data';
const CHAT_SESSIONS_KEY = 'chat-sessions';

export default class ObsidianPalacePlugin extends Plugin {
  settings: PalaceSettings;
  knowledgeGraph: KnowledgeGraph;
  palaceData: PalaceData | null = null;
  chatSessions: ChatSession[] = [];
  skillRegistry: SkillRegistry;
  sandboxProvider: SandboxProvider | null = null;

  // Vault QA components (text-based search only)
  hybridSearch: HybridSearch | null = null;

  // Batch processing state
  isProcessing = false;
  private abortController: AbortController | null = null;

  // Callback for settings UI
  getVaultQATools?: () => AgentTool[];
  toggleVaultQA?: (enabled: boolean) => Promise<void>;

  async onload() {
    // Load all data at once to reduce disk I/O
    const store = await this.readStore();
    
    // Init settings
    const saved = (store.settings || {}) as Record<string, unknown>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved) as PalaceSettings;

    // Init palace data
    const palaceData = store[PALACE_DATA_KEY] as PalaceData | undefined;
    if (palaceData) {
      this.palaceData = palaceData;
      this.knowledgeGraph = new KnowledgeGraph(palaceData.graph);
    } else {
      this.palaceData = { graph: { nodes: [], edges: [], lastUpdated: 0 }, flashcards: [] };
      this.knowledgeGraph = new KnowledgeGraph();
    }

    // Init chat sessions
    this.chatSessions = (store[CHAT_SESSIONS_KEY] as ChatSession[] | undefined) || [];
    this.chatSessions.sort((a, b) => b.updatedAt - a.updatedAt);

    // Init skill registry
    this.skillRegistry = new SkillRegistry();
    this.loadSkills();

    // Init sandbox if configured
    this.initSandbox();

    // Init Vault QA if enabled
    if (this.settings.vaultQAEnabled) {
      console.log('Obsidian Palace: Vault QA is enabled, initializing...');
      this.initVaultQA();
    } else {
      console.log('Obsidian Palace: Vault QA is disabled in settings');
    }

    // Setup toggle callback for settings
    this.toggleVaultQA = async (enabled: boolean) => {
      if (enabled && !this.hybridSearch) {
        console.log('Obsidian Palace: Enabling Vault QA...');
        this.initVaultQA();
      } else if (!enabled && this.hybridSearch) {
        console.log('Obsidian Palace: Disabling Vault QA...');
        this.cleanupVaultQA();
      }
    };

    // Settings tab
    this.addSettingTab(new PalaceSettingTab(this.app, this));

    // Register views
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.registerView(PALACE_VIEW_TYPE, (leaf) => new PalaceView(leaf, this));

    // Ribbon icons
    this.addRibbonIcon('message-square', 'Open AI Assistant', () => {
      this.activateChatView();
    });

    this.addRibbonIcon('brain', 'Open Memory Palace', () => {
      this.activatePalaceView();
    });

    // Commands
    this.addCommand({
      id: 'open-ai-chat',
      name: 'Open AI Assistant',
      callback: () => this.activateChatView(),
    });

    this.addCommand({
      id: 'open-palace',
      name: 'Open Memory Palace',
      callback: () => this.activatePalaceView(),
    });

    this.addCommand({
      id: 'extract-knowledge',
      name: 'Extract Knowledge from Current Document',
      callback: () => this.extractKnowledge(),
    });

    this.addCommand({
      id: 'extract-knowledge-batch',
      name: 'Extract Knowledge from All Documents',
      callback: () => this.extractKnowledgeBatch(),
    });

    this.addCommand({
      id: 'extract-knowledge-incremental',
      name: 'Extract Knowledge from New Documents',
      callback: () => this.extractKnowledgeIncremental(),
    });

    this.addCommand({
      id: 'stop-knowledge-extraction',
      name: 'Stop Knowledge Extraction',
      callback: () => this.stopKnowledgeExtraction(),
    });

    this.addCommand({
      id: 'translate-current-document',
      name: 'Translate Current Document',
      callback: () => this.translateCurrentDocument(),
    });

    this.addCommand({
      id: 'translate-selection',
      name: 'Translate Selected Text',
      editorCallback: (editor: Editor) => {
        this.translateSelection(editor);
      },
    });

    // Context menus
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
          menu.addItem((item) => {
            item.setTitle('AI Translate').setIcon('languages')
              .onClick(() => this.translateFile(file));
          });

          if (this.settings.palaceEnabled) {
            menu.addItem((item) => {
              item.setTitle('Extract Knowledge').setIcon('brain')
                .onClick(() => this.extractKnowledgeFromFile(file));
            });
          }
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (editor.getSelection()) {
          menu.addItem((item) => {
            item.setTitle('AI Translate Selection').setIcon('languages')
              .onClick(() => this.translateSelection(editor));
          });
        }

        menu.addItem((item) => {
          item.setTitle('AI Translate Full Document').setIcon('languages')
            .onClick(() => this.translateCurrentDocument());
        });
      })
    );
  }

  async onunload() {
    // Clean up sandbox
    if (this.sandboxProvider) {
      await this.sandboxProvider.destroy();
    }

    // Clean up Vault QA
    this.cleanupVaultQA();
  }

  /* ---- Unified Data Layer ---- */
  /*
   * Plugin data structure:
   * {
   *   settings: PalaceSettings,
   *   "palace-data": PalaceData,
   *   "chat-sessions": ChatSession[]
   * }
   */

  private async readStore(): Promise<Record<string, unknown>> {
    return (await this.loadData()) || {};
  }

  private async writeStore(store: Record<string, unknown>) {
    await this.saveData(store);
  }

  async loadSettings() {
    // Backward compatibility for calls
    const store = await this.readStore();
    const saved = (store.settings || {}) as Record<string, unknown>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved) as PalaceSettings;
  }

  async saveSettings() {
    const store = await this.readStore();
    store.settings = this.settings;
    await this.writeStore(store);
  }

  async loadPalaceData() {
    // Backward compatibility for calls
    const store = await this.readStore();
    const palaceData = store[PALACE_DATA_KEY] as PalaceData | undefined;

    if (palaceData) {
      this.palaceData = {
        ...palaceData,
        ui: {
          graphViewMode: palaceData.ui?.graphViewMode ?? '2d',
        },
      };
      this.knowledgeGraph = new KnowledgeGraph(palaceData.graph);
    } else {
      this.palaceData = {
        graph: { nodes: [], edges: [], lastUpdated: 0 },
        flashcards: [],
        ui: {
          graphViewMode: '2d',
        },
      };
      this.knowledgeGraph = new KnowledgeGraph();
    }
  }

  async savePalaceData() {
    if (!this.palaceData) return;
    this.palaceData.graph = this.knowledgeGraph.getData();
    const store = await this.readStore();
    store[PALACE_DATA_KEY] = this.palaceData;
    await this.writeStore(store);
  }

  async loadChatSessions() {
    // Backward compatibility for calls
    const store = await this.readStore();
    this.chatSessions = (store[CHAT_SESSIONS_KEY] as ChatSession[] | undefined) || [];
    this.chatSessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveChatSessions() {
    const store = await this.readStore();
    store[CHAT_SESSIONS_KEY] = this.chatSessions;
    await this.writeStore(store);
  }

  createChatSession(title?: string): ChatSession {
    const session: ChatSession = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: title || 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.chatSessions.unshift(session);
    return session;
  }

  async updateChatSession(session: ChatSession) {
    session.updatedAt = Date.now();
    // Auto-title from first user message if still default
    if (session.title === 'New Chat' && session.messages.length > 0) {
      const firstUserMsg = session.messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        session.title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
      }
    }
    const idx = this.chatSessions.findIndex(s => s.id === session.id);
    if (idx >= 0) {
      this.chatSessions[idx] = session;
    }
    await this.saveChatSessions();
  }

  async deleteChatSession(id: string) {
    this.chatSessions = this.chatSessions.filter(s => s.id !== id);
    await this.saveChatSessions();
  }

  /* ---- Skills ---- */

  loadSkills() {
    this.skillRegistry.load(this.settings.skillDirectories);
    const count = this.skillRegistry.size;
    if (count > 0) {
      console.log(`Obsidian Palace: loaded ${count} skill(s)`);
    }
  }

  /* ---- Sandbox ---- */

  private initSandbox() {
    if (this.settings.sandboxProvider === 'e2b' && this.settings.e2bApiKey) {
      this.sandboxProvider = new E2BProvider(
        this.settings.e2bApiKey,
        this.settings.e2bDomain || undefined
      );
    } else {
      this.sandboxProvider = null;
    }
  }

  /* ---- Knowledge Extraction ---- */

  private validateLLMSettings(): boolean {
    if (!this.settings.baseUrl) {
      new Notice('Please configure API Base URL in settings');
      return false;
    }
    if (!this.settings.apiKey) {
      new Notice('Please configure API Key in settings');
      return false;
    }
    if (!this.settings.modelName) {
      new Notice('Please configure Model Name in settings');
      return false;
    }
    return true;
  }

  private createLLMClient(): LLMClient {
    return new LLMClient({
      baseUrl: this.settings.baseUrl,
      apiKey: this.settings.apiKey,
      modelName: this.settings.modelName,
    });
  }

  async extractKnowledge() {
    if (!this.validateLLMSettings()) return;

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView?.file) {
      new Notice('Please open a Markdown document first');
      return;
    }

    await this.extractKnowledgeFromFile(activeView.file);
  }

  async extractKnowledgeFromFile(file: TFile) {
    if (!this.validateLLMSettings()) return;

    const content = await this.app.vault.cachedRead(file);
    if (!content.trim()) {
      new Notice('Document is empty');
      return;
    }

    const notice = new Notice(`Extracting knowledge from: ${file.basename}...`, 0);

    try {
      const extractor = new GraphExtractor(this.createLLMClient());
      const result = await extractor.extract(content, file.path);

      // Merge into knowledge graph
      this.knowledgeGraph.merge(result.nodes, result.edges);

      // Add flashcards
      if (this.palaceData) {
        this.palaceData.flashcards.push(...result.flashcards);
        // Track processed file
        if (!this.palaceData.processedFiles) {
          this.palaceData.processedFiles = [];
        }
        if (!this.palaceData.processedFiles.includes(file.path)) {
          this.palaceData.processedFiles.push(file.path);
        }
      }

      await this.savePalaceData();

      notice.hide();
      new Notice(
        `Extracted: ${result.nodes.length} concepts, ${result.edges.length} connections, ${result.flashcards.length} flashcards`
      );

      // Refresh Palace view if open
      const palaceLeaves = this.app.workspace.getLeavesOfType(PALACE_VIEW_TYPE);
      for (const leaf of palaceLeaves) {
        (leaf.view as PalaceView).onOpen();
      }
    } catch (error) {
      notice.hide();
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`Knowledge extraction failed: ${msg}`, 8000);
    }
  }

  /**
   * Extract knowledge from all markdown files in the vault
   */
  async extractKnowledgeBatch() {
    if (!this.validateLLMSettings()) return;

    const files = this.app.vault.getMarkdownFiles();
    if (files.length === 0) {
      new Notice('No markdown files found in vault');
      return;
    }

    // Confirm with user
    const confirmed = await this.showConfirmDialog(
      'Extract Knowledge from All Documents',
      `This will process ${files.length} markdown files. This may take a while and consume API credits. Continue?`
    );
    if (!confirmed) return;

    await this.processFiles(files, 'all');
  }

  /**
   * Extract knowledge from files not yet processed (incremental update)
   */
  async extractKnowledgeIncremental() {
    if (!this.validateLLMSettings()) return;

    const processedFiles = new Set(this.palaceData?.processedFiles || []);
    const allFiles = this.app.vault.getMarkdownFiles();
    const newFiles = allFiles.filter(f => !processedFiles.has(f.path));

    if (newFiles.length === 0) {
      new Notice('No new documents to process');
      return;
    }

    const confirmed = await this.showConfirmDialog(
      'Extract Knowledge from New Documents',
      `Found ${newFiles.length} new/modified files to process. Continue?`
    );
    if (!confirmed) return;

    await this.processFiles(newFiles, 'incremental');
  }

  /**
   * Process a list of files for knowledge extraction with concurrency
   */
  private async processFiles(files: TFile[], mode: 'all' | 'incremental') {
    const concurrency = this.settings.palaceConcurrency || 10;
    this.isProcessing = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const notice = new Notice('', 0);

    let completedCount = 0;
    let successCount = 0;
    let failCount = 0;
    let totalNodes = 0;
    let totalEdges = 0;
    let totalCards = 0;
    const failedFiles: string[] = [];

    // Initialize processedFiles if needed
    if (!this.palaceData) {
      this.palaceData = { graph: { nodes: [], edges: [], lastUpdated: 0 }, flashcards: [], processedFiles: [] };
    }
    if (!this.palaceData.processedFiles) {
      this.palaceData.processedFiles = [];
    }

    // Process a single file
    const processFile = async (file: TFile) => {
      if (signal.aborted) return null;

      try {
        const content = await this.app.vault.cachedRead(file);
        if (!content.trim() || signal.aborted) {
          completedCount++;
          return null;
        }

        // Create a new extractor for each concurrent request
        const extractor = new GraphExtractor(this.createLLMClient());
        const result = await extractor.extract(content, file.path);

        if (signal.aborted) return null;

        completedCount++;
        successCount++;
        notice.setMessage(`Processing: ${completedCount}/${files.length} (success: ${successCount})`);

        return result;
      } catch (error) {
        if (signal.aborted) return null;
        console.error(`Failed to extract from ${file.path}:`, error);
        completedCount++;
        failCount++;
        failedFiles.push(file.path);
        return null;
      }
    };

    // Process files in batches with concurrency limit
    const results: Array<{ file: TFile; result: Awaited<ReturnType<typeof processFile>> }>[] = [];

    for (let i = 0; i < files.length; i += concurrency) {
      if (signal.aborted) break;

      const batch = files.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (file) => ({
          file,
          result: await processFile(file),
        }))
      );
      results.push(batchResults);

      // Merge results from this batch
      for (const { file, result } of batchResults) {
        if (result) {
          this.knowledgeGraph.merge(result.nodes, result.edges);
          this.palaceData!.flashcards.push(...result.flashcards);
          if (!this.palaceData!.processedFiles!.includes(file.path)) {
            this.palaceData!.processedFiles!.push(file.path);
          }
          totalNodes += result.nodes.length;
          totalEdges += result.edges.length;
          totalCards += result.flashcards.length;
        }
      }

      // Save after each batch
      await this.savePalaceData();
    }

    this.isProcessing = false;
    this.abortController = null;
    notice.hide();

    const wasAborted = signal.aborted;
    
    let summaryMsg = wasAborted
      ? `Extraction stopped!\nProcessed: ${successCount}/${files.length} files\nExtracted: ${totalNodes} concepts, ${totalEdges} connections, ${totalCards} flashcards`
      : `Batch extraction complete!\nProcessed: ${successCount}/${files.length} files\nExtracted: ${totalNodes} concepts, ${totalEdges} connections, ${totalCards} flashcards`;
    
    if (failCount > 0) {
      summaryMsg += `\nFailed: ${failCount} files. Check console for details.`;
      console.warn('Obsidian Palace: Failed to extract from these files:', failedFiles);
    }
    
    new Notice(summaryMsg, 10000);

    // Refresh Palace view if open
    const palaceLeaves = this.app.workspace.getLeavesOfType(PALACE_VIEW_TYPE);
    for (const leaf of palaceLeaves) {
      (leaf.view as PalaceView).onOpen();
    }
  }

  /**
   * Stop ongoing knowledge extraction
   */
  stopKnowledgeExtraction() {
    if (this.isProcessing && this.abortController) {
      this.abortController.abort();
      new Notice('Stopping knowledge extraction...');
    } else {
      new Notice('No extraction in progress');
    }
  }

  /**
   * Show a confirmation dialog
   */
  private showConfirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmModal(this.app, title, message, resolve);
      modal.open();
    });
  }

  /* ---- Views ---- */

  async activateChatView() {
    const existing = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async activatePalaceView() {
    const existing = this.app.workspace.getLeavesOfType(PALACE_VIEW_TYPE);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf('tab');
    if (leaf) {
      await leaf.setViewState({ type: PALACE_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  /* ---- Translation (kept from original) ---- */

  private createTranslator(): Translator {
    const config: TranslatorConfig = {
      baseUrl: this.settings.baseUrl,
      apiKey: this.settings.apiKey,
      modelName: this.settings.modelName,
      targetLang: this.settings.targetLang,
      systemPrompt: this.settings.systemPrompt,
      maxChunkSize: this.settings.maxChunkSize,
    };
    return new Translator(config);
  }

  private getTranslatedFilePath(originalPath: string): string {
    const dir = originalPath.substring(0, originalPath.lastIndexOf('/'));
    const fileName = originalPath.substring(originalPath.lastIndexOf('/') + 1);
    const baseName = fileName.replace(/\.md$/, '');
    const langSuffix = this.settings.targetLang === '简体中文' ? 'zh' : this.settings.targetLang;
    const newName = `${baseName}.${langSuffix}.md`;
    return dir ? `${dir}/${newName}` : newName;
  }

  async translateCurrentDocument() {
    if (!this.validateLLMSettings()) return;

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView?.file) {
      new Notice('Please open a Markdown document first');
      return;
    }
    await this.translateFile(activeView.file);
  }

  async translateFile(file: TFile) {
    if (!this.validateLLMSettings()) return;

    const translator = this.createTranslator();
    const content = await this.app.vault.cachedRead(file);
    if (!content.trim()) {
      new Notice('Document is empty');
      return;
    }

    const mode = this.settings.translationMode;
    const notice = new Notice(`Translating: ${file.basename}...`, 0);

    try {
      const translated = await translator.translateDocument(content, (current, total) => {
        notice.setMessage(`Translating: ${file.basename} (${current}/${total})`);
      });

      if (mode === 'replace') {
        await this.app.vault.modify(file, translated);
        notice.hide();
        new Notice('Translation complete! Original replaced.');
      } else if (mode === 'append') {
        const separator = '\n\n---\n\n';
        const langLabel = this.settings.targetLang;
        const appendContent = `${content}${separator}## Translation (${langLabel})\n\n${translated}`;
        await this.app.vault.modify(file, appendContent);
        notice.hide();
        new Notice('Translation complete! Appended below original.');
      } else {
        const newPath = this.getTranslatedFilePath(file.path);
        const existing = this.app.vault.getAbstractFileByPath(newPath);
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, translated);
        } else {
          await this.app.vault.create(newPath, translated);
        }
        notice.hide();
        new Notice(`Translation saved to: ${newPath}`);

        const newFile = this.app.vault.getAbstractFileByPath(newPath);
        if (newFile instanceof TFile) {
          await this.app.workspace.getLeaf(false).openFile(newFile);
        }
      }
    } catch (error) {
      notice.hide();
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`Translation failed: ${msg}`, 8000);
    }
  }

  async translateSelection(editor: Editor) {
    if (!this.validateLLMSettings()) return;

    const selection = editor.getSelection();
    if (!selection.trim()) {
      new Notice('Please select text to translate');
      return;
    }

    const translator = this.createTranslator();
    const notice = new Notice('Translating selection...', 0);

    try {
      const translated = await translator.translateDocument(selection, (current, total) => {
        notice.setMessage(`Translating selection (${current}/${total})`);
      });
      editor.replaceSelection(translated);
      notice.hide();
      new Notice('Selection translated!');
    } catch (error) {
      notice.hide();
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`Translation failed: ${msg}`, 8000);
    }
  }

  /* ---- Vault QA Methods (Text-based search only) ---- */

  /**
   * Initialize Vault QA components
   */
  private initVaultQA(): void {
    try {
      console.log('Obsidian Palace: Initializing text-based Vault QA...');

      // Initialize hybrid search (Obsidian + grep only)
      this.hybridSearch = new HybridSearch(this.app, {
        obsidianWeight: this.settings.obsidianWeight,
        grepWeight: this.settings.grepWeight,
        maxResults: this.settings.vaultQAMaxResults,
      });

      // Set up callback for chat view
      this.getVaultQATools = (): AgentTool[] => {
        if (!this.hybridSearch) return [];
        return createVaultQATools(this.app, this.hybridSearch);
      };

      console.log('Obsidian Palace: Vault QA initialized!');
      new Notice('Vault QA ready');
    } catch (err) {
      console.error('Obsidian Palace: Failed to init Vault QA', err);
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Vault QA init failed: ${msg}`, 8000);
      this.cleanupVaultQA();
    }
  }

  /**
   * Clean up Vault QA components
   */
  private cleanupVaultQA(): void {
    this.hybridSearch = null;
    this.getVaultQATools = undefined;
  }
}

/**
 * Simple confirmation modal for batch operations
 */
class ConfirmModal extends Modal {
  private title: string;
  private message: string;
  private resolve: (value: boolean) => void;

  constructor(app: App, title: string, message: string, resolve: (value: boolean) => void) {
    super(app);
    this.title = title;
    this.message = message;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', { text: this.message });

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.gap = '10px';
    buttonContainer.style.marginTop = '20px';

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => {
      this.close();
      this.resolve(false);
    });

    const confirmBtn = buttonContainer.createEl('button', { text: 'Continue', cls: 'mod-cta' });
    confirmBtn.addEventListener('click', () => {
      this.close();
      this.resolve(true);
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
