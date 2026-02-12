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

import { Editor, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { PalaceSettings, PalaceSettingTab, DEFAULT_SETTINGS } from './settings';
import { Translator, TranslatorConfig } from './translator';
import { ChatView, CHAT_VIEW_TYPE } from './chatView';
import { PalaceView, PALACE_VIEW_TYPE } from './palace/palaceView';
import { LLMClient } from './shared/llmClient';
import { KnowledgeGraph } from './palace/knowledgeGraph';
import { GraphExtractor } from './palace/graphExtractor';
import { SkillRegistry } from './skills/skillRegistry';
import { E2BProvider } from './sandbox/e2bProvider';
import type { PalaceData, SandboxProvider, ChatSession } from './shared/types';

const PALACE_DATA_KEY = 'palace-data';
const CHAT_SESSIONS_KEY = 'chat-sessions';

export default class ObsidianPalacePlugin extends Plugin {
  settings: PalaceSettings;
  knowledgeGraph: KnowledgeGraph;
  palaceData: PalaceData | null = null;
  chatSessions: ChatSession[] = [];
  skillRegistry: SkillRegistry;
  sandboxProvider: SandboxProvider | null = null;

  async onload() {
    await this.loadSettings();
    await this.loadPalaceData();
    await this.loadChatSessions();

    // Init skill registry
    this.skillRegistry = new SkillRegistry();
    this.loadSkills();

    // Init sandbox if configured
    this.initSandbox();

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
  }

  /* ---- Settings ---- */

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as PalaceSettings;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /* ---- Palace Data ---- */

  async loadPalaceData() {
    const stored = await this.loadData();
    const palaceData = stored?.[PALACE_DATA_KEY] as PalaceData | undefined;

    if (palaceData) {
      this.palaceData = palaceData;
      this.knowledgeGraph = new KnowledgeGraph(palaceData.graph);
    } else {
      this.palaceData = { graph: { nodes: [], edges: [], lastUpdated: 0 }, flashcards: [] };
      this.knowledgeGraph = new KnowledgeGraph();
    }
  }

  async savePalaceData() {
    if (!this.palaceData) return;
    this.palaceData.graph = this.knowledgeGraph.getData();
    const data = await this.loadData() || {};
    data[PALACE_DATA_KEY] = this.palaceData;
    await this.saveData(data);
  }

  /* ---- Chat Sessions ---- */

  async loadChatSessions() {
    const stored = await this.loadData();
    this.chatSessions = (stored?.[CHAT_SESSIONS_KEY] as ChatSession[] | undefined) || [];
    // Sort by most recently updated
    this.chatSessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveChatSessions() {
    const data = await this.loadData() || {};
    data[CHAT_SESSIONS_KEY] = this.chatSessions;
    await this.saveData(data);
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
}
