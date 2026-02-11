import { Editor, MarkdownView, Notice, Plugin, TFile, TFolder } from 'obsidian';
import { AITranslatorSettings, AITranslatorSettingTab, DEFAULT_SETTINGS } from './settings';
import { Translator, TranslatorConfig } from './translator';
import { ChatView, CHAT_VIEW_TYPE } from './chatView';

export default class AITranslatorPlugin extends Plugin {
  settings: AITranslatorSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AITranslatorSettingTab(this.app, this));

    // 注册聊天视图
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf) => new ChatView(leaf, this)
    );

    // Ribbon 图标：打开 AI 助手面板
    this.addRibbonIcon('message-square', '打开 AI 助手', () => {
      this.activateChatView();
    });

    // 命令：打开 AI 助手
    this.addCommand({
      id: 'open-ai-chat',
      name: '打开 AI 文档助手',
      callback: () => this.activateChatView(),
    });

    // 命令：翻译当前文档全文
    this.addCommand({
      id: 'translate-current-document',
      name: '翻译当前文档',
      callback: () => this.translateCurrentDocument(),
    });

    // 命令：翻译选中文本
    this.addCommand({
      id: 'translate-selection',
      name: '翻译选中文本',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.translateSelection(editor);
      },
    });

    // 文件管理器右键菜单
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
          menu.addItem((item) => {
            item
              .setTitle('AI 翻译此文档')
              .setIcon('languages')
              .onClick(() => this.translateFile(file));
          });
        }
      })
    );

    // 编辑器右键菜单
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (editor.getSelection()) {
          menu.addItem((item) => {
            item
              .setTitle('AI 翻译选中文本')
              .setIcon('languages')
              .onClick(() => this.translateSelection(editor));
          });
        }

        menu.addItem((item) => {
          item
            .setTitle('AI 翻译全文')
            .setIcon('languages')
            .onClick(() => this.translateCurrentDocument());
        });
      })
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as AITranslatorSettings;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private validateSettings(): boolean {
    if (!this.settings.baseUrl) {
      new Notice('请先在设置中配置 API Base URL');
      return false;
    }
    if (!this.settings.apiKey) {
      new Notice('请先在设置中配置 API Key');
      return false;
    }
    if (!this.settings.modelName) {
      new Notice('请先在设置中配置模型名称');
      return false;
    }
    return true;
  }

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

  /**
   * 生成翻译文件的路径，避免覆盖已有文件
   */
  private getTranslatedFilePath(originalPath: string): string {
    const dir = originalPath.substring(0, originalPath.lastIndexOf('/'));
    const fileName = originalPath.substring(originalPath.lastIndexOf('/') + 1);
    const baseName = fileName.replace(/\.md$/, '');
    const langSuffix = this.settings.targetLang === '简体中文' ? 'zh' : this.settings.targetLang;
    const newName = `${baseName}.${langSuffix}.md`;
    return dir ? `${dir}/${newName}` : newName;
  }

  /**
   * 翻译当前打开的文档
   */
  async translateCurrentDocument() {
    if (!this.validateSettings()) return;

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      new Notice('请先打开一个 Markdown 文档');
      return;
    }

    await this.translateFile(activeView.file);
  }

  /**
   * 翻译指定文件
   */
  async translateFile(file: TFile) {
    if (!this.validateSettings()) return;

    const translator = this.createTranslator();
    const content = await this.app.vault.cachedRead(file);

    if (!content.trim()) {
      new Notice('文档内容为空，无需翻译');
      return;
    }

    const mode = this.settings.translationMode;
    let notice = new Notice(`正在翻译: ${file.basename}...`, 0);

    try {
      const translated = await translator.translateDocument(content, (current, total) => {
        notice.setMessage(`正在翻译: ${file.basename} (${current}/${total} 段)`);
      });

      if (mode === 'replace') {
        // 替换模式：直接用翻译内容替换原文
        await this.app.vault.modify(file, translated);
        notice.hide();
        new Notice('翻译完成！已替换原文');

      } else if (mode === 'append') {
        // 追加模式：在原文下方追加翻译内容
        const separator = '\n\n---\n\n';
        const langLabel = this.settings.targetLang;
        const appendContent = `${content}${separator}## 翻译 (${langLabel})\n\n${translated}`;
        await this.app.vault.modify(file, appendContent);
        notice.hide();
        new Notice('翻译完成！已追加到原文下方');

      } else {
        // newFile 模式：生成新文件
        const newPath = this.getTranslatedFilePath(file.path);

        const existing = this.app.vault.getAbstractFileByPath(newPath);
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, translated);
        } else {
          await this.app.vault.create(newPath, translated);
        }

        notice.hide();
        new Notice(`翻译完成! 已保存到: ${newPath}`);

        const newFile = this.app.vault.getAbstractFileByPath(newPath);
        if (newFile instanceof TFile) {
          await this.app.workspace.getLeaf(false).openFile(newFile);
        }
      }
    } catch (error) {
      notice.hide();
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`翻译失败: ${msg}`, 8000);
      console.error('AI Translator error:', error);
    }
  }

  /**
   * 打开右侧 AI 助手面板
   */
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

  /**
   * 翻译编辑器中选中的文本
   */
  async translateSelection(editor: Editor) {
    if (!this.validateSettings()) return;

    const selection = editor.getSelection();
    if (!selection.trim()) {
      new Notice('请先选中要翻译的文本');
      return;
    }

    const translator = this.createTranslator();
    const notice = new Notice('正在翻译选中文本...', 0);

    try {
      const translated = await translator.translateDocument(selection, (current, total) => {
        notice.setMessage(`正在翻译选中文本 (${current}/${total} 段)`);
      });

      editor.replaceSelection(translated);
      notice.hide();
      new Notice('选中文本翻译完成!');
    } catch (error) {
      notice.hide();
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`翻译失败: ${msg}`, 8000);
      console.error('AI Translator error:', error);
    }
  }
}
