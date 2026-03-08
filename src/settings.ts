import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type ObsidianPalacePlugin from './main';

export type TranslationMode = 'newFile' | 'append' | 'replace';

export interface PalaceSettings {
  // LLM settings
  baseUrl: string;
  apiKey: string;
  modelName: string;

  // Translation settings
  targetLang: string;
  systemPrompt: string;
  maxChunkSize: number;
  translationMode: TranslationMode;

  // Agent settings
  agentEnabled: boolean;
  agentMaxIterations: number;

  // Sandbox settings
  sandboxProvider: 'e2b' | 'none';
  e2bApiKey: string;
  e2bDomain: string;

  // Skill settings
  skillDirectories: string[];

  // Palace settings
  palaceEnabled: boolean;
  palaceConcurrency: number;

  // Vault QA settings (text-based search only)
  vaultQAEnabled: boolean;
  obsidianWeight: number;
  grepWeight: number;
  vaultQAMaxResults: number;
}

export const DEFAULT_SETTINGS: Partial<PalaceSettings> = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  modelName: 'gpt-4o',
  targetLang: '简体中文',
  systemPrompt: '',
  maxChunkSize: 3000,
  translationMode: 'newFile',
  agentEnabled: true,
  agentMaxIterations: 10,
  sandboxProvider: 'none',
  e2bApiKey: '',
  e2bDomain: '',
  skillDirectories: ['~/.claude/skills', '~/.codex/skills', '~/.agents/skills'],
  palaceEnabled: true,
  palaceConcurrency: 10,
  // Vault QA defaults (text-based search)
  vaultQAEnabled: false,
  obsidianWeight: 0.6,
  grepWeight: 0.4,
  vaultQAMaxResults: 10,
};

export class PalaceSettingTab extends PluginSettingTab {
  plugin: ObsidianPalacePlugin;

  constructor(app: App, plugin: ObsidianPalacePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    /* ======== LLM Settings ======== */
    containerEl.createEl('h2', { text: 'Obsidian Palace Settings' });

    containerEl.createEl('h3', { text: 'LLM Configuration' });

    new Setting(containerEl)
      .setName('API Base URL')
      .setDesc('OpenAI-compatible API endpoint')
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
      .setDesc('API key for the LLM service')
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
      .setName('Model Name')
      .setDesc('Model to use (e.g. gpt-4o, deepseek-chat, qwen-plus)')
      .addText((text) =>
        text
          .setPlaceholder('gpt-4o')
          .setValue(this.plugin.settings.modelName)
          .onChange(async (value) => {
            this.plugin.settings.modelName = value;
            await this.plugin.saveSettings();
          })
      );

    /* ======== Agent Settings ======== */
    containerEl.createEl('h3', { text: 'Agent' });

    new Setting(containerEl)
      .setName('Enable Agent Mode')
      .setDesc('Allow AI to use tools: search vault, read/write notes, execute code')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.agentEnabled)
          .onChange(async (value) => {
            this.plugin.settings.agentEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Max Agent Iterations')
      .setDesc('Maximum tool-calling rounds per request (default: 10)')
      .addText((text) =>
        text
          .setPlaceholder('10')
          .setValue(String(this.plugin.settings.agentMaxIterations))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0 && num <= 50) {
              this.plugin.settings.agentMaxIterations = num;
              await this.plugin.saveSettings();
            }
          })
      );

    /* ======== Sandbox Settings ======== */
    containerEl.createEl('h3', { text: 'Cloud Sandbox' });

    new Setting(containerEl)
      .setName('Sandbox Provider')
      .setDesc('Cloud sandbox for code execution')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('none', 'Disabled')
          .addOption('e2b', 'E2B')
          .setValue(this.plugin.settings.sandboxProvider)
          .onChange(async (value) => {
            this.plugin.settings.sandboxProvider = value as 'e2b' | 'none';
            await this.plugin.saveSettings();
            this.display(); // refresh to show/hide E2B key
          })
      );

    if (this.plugin.settings.sandboxProvider === 'e2b') {
      new Setting(containerEl)
        .setName('E2B API Key')
        .setDesc('Required. Get your key at https://e2b.dev')
        .addText((text) => {
          text
            .setPlaceholder('e2b_...')
            .setValue(this.plugin.settings.e2bApiKey)
            .onChange(async (value) => {
              this.plugin.settings.e2bApiKey = value;
              await this.plugin.saveSettings();
            });
          text.inputEl.type = 'password';
        });

      new Setting(containerEl)
        .setName('E2B Domain')
        .setDesc('Optional. Custom E2B API domain (leave empty for default)')
        .addText((text) =>
          text
            .setPlaceholder('e2b.dev')
            .setValue(this.plugin.settings.e2bDomain)
            .onChange(async (value) => {
              this.plugin.settings.e2bDomain = value;
              await this.plugin.saveSettings();
            })
        );
    }

    /* ======== Skill Settings ======== */
    containerEl.createEl('h3', { text: 'Skills' });

    new Setting(containerEl)
      .setName('Skill Directories')
      .setDesc('Directories to scan for SKILL.md files (one per line)')
      .addTextArea((text) => {
        text
          .setPlaceholder('~/.claude/skills\n~/.codex/skills\n~/.agents/skills')
          .setValue(this.plugin.settings.skillDirectories.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.skillDirectories = value
              .split('\n')
              .map(s => s.trim())
              .filter(s => s.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 40;
      });

    const skillCount = this.plugin.skillRegistry?.size ?? 0;
    new Setting(containerEl)
      .setName('Loaded Skills')
      .setDesc(`${skillCount} skill(s) loaded`)
      .addButton((btn) =>
        btn.setButtonText('Reload').onClick(async () => {
          this.plugin.loadSkills();
          this.display();
        })
      );

    /* ======== Memory Palace Settings ======== */
    containerEl.createEl('h3', { text: 'Memory Palace' });

    new Setting(containerEl)
      .setName('Enable Memory Palace')
      .setDesc('Knowledge graph extraction and spaced repetition review')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.palaceEnabled)
          .onChange(async (value) => {
            this.plugin.settings.palaceEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Batch Concurrency')
      .setDesc('Number of concurrent API requests when processing documents (1-50)')
      .addText((text) =>
        text
          .setPlaceholder('10')
          .setValue(String(this.plugin.settings.palaceConcurrency || 10))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 1 && num <= 50) {
              this.plugin.settings.palaceConcurrency = num;
              await this.plugin.saveSettings();
            }
          })
      );

    /* ======== Translation Settings ======== */
    containerEl.createEl('h3', { text: 'Translation' });

    new Setting(containerEl)
      .setName('Target Language')
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
      .setName('Translation Mode')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('newFile', 'New file')
          .addOption('append', 'Append to original')
          .addOption('replace', 'Replace original')
          .setValue(this.plugin.settings.translationMode)
          .onChange(async (value) => {
            this.plugin.settings.translationMode = value as TranslationMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Custom System Prompt')
      .setDesc('Leave empty for default. Use {targetLang} as placeholder.')
      .addTextArea((text) => {
        text
          .setPlaceholder('Leave empty for default...')
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 40;
      });

    new Setting(containerEl)
      .setName('Max Chunk Size')
      .setDesc('Characters per translation chunk (2000-5000)')
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

    /* ======== Vault QA Settings ======== */
    containerEl.createEl('h3', { text: 'Vault Knowledge Base QA' });

    new Setting(containerEl)
      .setName('Enable Vault QA')
      .setDesc('Whole-vault text-based search using Obsidian and grep')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.vaultQAEnabled)
          .onChange(async (value) => {
            this.plugin.settings.vaultQAEnabled = value;
            await this.plugin.saveSettings();
            // Toggle Vault QA components
            if (this.plugin.toggleVaultQA) {
              await this.plugin.toggleVaultQA(value);
            }
            this.display();
          })
      );

    if (this.plugin.settings.vaultQAEnabled) {
      containerEl.createEl('h4', { text: 'Search Weights', cls: 'setting-item-heading' });
      containerEl.createEl('p', {
        text: 'Adjust the weight of each search method. Weights are relative to each other.',
        cls: 'setting-item-description',
      });

      new Setting(containerEl)
        .setName('Obsidian Search Weight')
        .setDesc('Weight for Obsidian built-in search (0-1)')
        .addText((text) =>
          text
            .setPlaceholder('0.6')
            .setValue(String(this.plugin.settings.obsidianWeight))
            .onChange(async (value) => {
              const num = parseFloat(value);
              if (!isNaN(num) && num >= 0 && num <= 1) {
                this.plugin.settings.obsidianWeight = num;
                await this.plugin.saveSettings();
              }
            })
        );

      new Setting(containerEl)
        .setName('Grep Search Weight')
        .setDesc('Weight for keyword/regex matching (0-1)')
        .addText((text) =>
          text
            .setPlaceholder('0.4')
            .setValue(String(this.plugin.settings.grepWeight))
            .onChange(async (value) => {
              const num = parseFloat(value);
              if (!isNaN(num) && num >= 0 && num <= 1) {
                this.plugin.settings.grepWeight = num;
                await this.plugin.saveSettings();
              }
            })
        );

      new Setting(containerEl)
        .setName('Max Results')
        .setDesc('Maximum number of search results to return (default: 10)')
        .addText((text) =>
          text
            .setPlaceholder('10')
            .setValue(String(this.plugin.settings.vaultQAMaxResults))
            .onChange(async (value) => {
              const num = parseInt(value, 10);
              if (!isNaN(num) && num > 0) {
                this.plugin.settings.vaultQAMaxResults = num;
                await this.plugin.saveSettings();
              }
            })
        );
    }
  }
}
