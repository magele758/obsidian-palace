import { App, PluginSettingTab, Setting } from 'obsidian';
import type AITranslatorPlugin from './main';

export type TranslationMode = 'newFile' | 'append' | 'replace';

export interface AITranslatorSettings {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  targetLang: string;
  systemPrompt: string;
  maxChunkSize: number;
  translationMode: TranslationMode;
}

export const DEFAULT_SETTINGS: Partial<AITranslatorSettings> = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  modelName: 'gpt-4o',
  targetLang: '简体中文',
  systemPrompt: '',
  maxChunkSize: 3000,
  translationMode: 'newFile',
};

export class AITranslatorSettingTab extends PluginSettingTab {
  plugin: AITranslatorPlugin;

  constructor(app: App, plugin: AITranslatorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'AI Translator 设置' });

    new Setting(containerEl)
      .setName('API Base URL')
      .setDesc('OpenAI 兼容 API 的基础地址（如 https://api.openai.com/v1）')
      .addText((text) =>
        text
          .setPlaceholder('https://api.openai.com/v1')
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.baseUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('API 密钥')
      .addText((text) => {
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    new Setting(containerEl)
      .setName('模型名称')
      .setDesc('使用的模型名称（如 gpt-4o, deepseek-chat 等）')
      .addText((text) =>
        text
          .setPlaceholder('gpt-4o')
          .setValue(this.plugin.settings.modelName)
          .onChange(async (value) => {
            this.plugin.settings.modelName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('目标语言')
      .setDesc('翻译的目标语言')
      .addText((text) =>
        text
          .setPlaceholder('简体中文')
          .setValue(this.plugin.settings.targetLang)
          .onChange(async (value) => {
            this.plugin.settings.targetLang = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('翻译模式')
      .setDesc('选择翻译结果的输出方式')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('newFile', '生成新文件')
          .addOption('append', '追加到原文下方')
          .addOption('replace', '替换原文')
          .setValue(this.plugin.settings.translationMode)
          .onChange(async (value) => {
            this.plugin.settings.translationMode = value as TranslationMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('自定义系统提示词')
      .setDesc('留空使用默认提示词。可用 {targetLang} 作为目标语言占位符。')
      .addTextArea((text) => {
        text
          .setPlaceholder('留空使用默认提示词...')
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
      });

    new Setting(containerEl)
      .setName('单次翻译最大字符数')
      .setDesc('长文档会按此大小分块翻译，建议 2000-5000')
      .addText((text) =>
        text
          .setPlaceholder('3000')
          .setValue(String(this.plugin.settings.maxChunkSize))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.maxChunkSize = num;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
