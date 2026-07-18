/**
 * Related Notes View - Shows notes related to the active file via links and shared tags
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type ObsidianPalacePlugin from '../main';

export const RELATED_NOTES_VIEW_TYPE = 'palace-related-notes';

interface RelatedNote {
  path: string;
  label: string;
  relation: 'backlink' | 'outgoing' | 'shared-tag';
}

export class RelatedNotesView extends ItemView {
  plugin: ObsidianPalacePlugin;
  private contentEl2: HTMLElement;
  private currentPath: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianPalacePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return RELATED_NOTES_VIEW_TYPE; }
  getDisplayText() { return 'Related Notes'; }
  getIcon() { return 'git-fork'; }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('palace-related-notes-root');

    const header = root.createDiv({ cls: 'palace-related-notes-header' });
    const iconEl = header.createSpan({ cls: 'palace-related-notes-header-icon' });
    setIcon(iconEl, 'git-fork');
    header.createSpan({ text: 'Related Notes' });

    this.contentEl2 = root.createDiv({ cls: 'palace-related-notes-content' });

    // Listen for active file changes
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.refresh())
    );
    this.registerEvent(
      this.app.workspace.on('file-open', () => this.refresh())
    );

    await this.refresh();
  }

  async onClose() {
    // nothing
  }

  private async refresh() {
    const activeFile = this.app.workspace.getActiveFile();
    const newPath = activeFile?.path ?? null;

    if (newPath === this.currentPath) return;
    this.currentPath = newPath;
    this.render(activeFile);
  }

  private render(file: TFile | null) {
    this.contentEl2.empty();

    if (!file) {
      this.contentEl2.createDiv({
        cls: 'palace-related-notes-empty',
        text: 'Open a note to see related notes.',
      });
      return;
    }

    const related = this.getRelated(file);

    if (related.length === 0) {
      this.contentEl2.createDiv({
        cls: 'palace-related-notes-empty',
        text: 'No related notes found.',
      });
      return;
    }

    // Group by relation type
    const groups: Record<string, RelatedNote[]> = {
      backlink: [],
      outgoing: [],
      'shared-tag': [],
    };
    for (const note of related) {
      groups[note.relation].push(note);
    }

    const labels: Record<string, string> = {
      backlink: 'Backlinks',
      outgoing: 'Outgoing Links',
      'shared-tag': 'Shared Tags',
    };

    for (const [type, notes] of Object.entries(groups)) {
      if (notes.length === 0) continue;

      const section = this.contentEl2.createDiv({ cls: 'palace-related-notes-section' });
      section.createDiv({ cls: 'palace-related-notes-section-title', text: labels[type] });

      const list = section.createDiv({ cls: 'palace-related-notes-list' });
      for (const note of notes) {
        const item = list.createDiv({ cls: 'palace-related-notes-item' });

        const iconEl = item.createSpan({ cls: 'palace-related-notes-item-icon' });
        setIcon(iconEl, type === 'backlink' ? 'corner-down-left' : type === 'outgoing' ? 'arrow-right' : 'tag');

        const nameEl = item.createSpan({
          cls: 'palace-related-notes-item-name',
          text: note.label,
        });
        nameEl.title = note.path;

        item.addEventListener('click', () => {
          const target = this.app.vault.getAbstractFileByPath(note.path);
          if (target instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(target);
          }
        });
      }
    }
  }

  private getRelated(file: TFile): RelatedNote[] {
    const resolvedLinks = this.app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
    const filePath = file.path;
    const seen = new Set<string>();
    const results: RelatedNote[] = [];

    // Outgoing links
    for (const target of Object.keys(resolvedLinks[filePath] || {})) {
      if (!seen.has(target)) {
        seen.add(target);
        results.push({ path: target, label: this.basename(target), relation: 'outgoing' });
      }
    }

    // Backlinks
    for (const [srcPath, targets] of Object.entries(resolvedLinks)) {
      if (srcPath !== filePath && targets[filePath] && !seen.has(srcPath)) {
        seen.add(srcPath);
        results.push({ path: srcPath, label: this.basename(srcPath), relation: 'backlink' });
      }
    }

    // Shared-tag neighbors (limit 10)
    const fileMeta = this.app.metadataCache.getCache(filePath);
    const sourceTags = new Set<string>(
      (fileMeta?.tags ?? []).map((t: { tag: string }) => t.tag)
    );

    if (sourceTags.size > 0) {
      let tagCount = 0;
      for (const f of this.app.vault.getMarkdownFiles()) {
        if (tagCount >= 10) break;
        if (f.path === filePath || seen.has(f.path)) continue;
        const meta = this.app.metadataCache.getCache(f.path);
        const tags = (meta?.tags ?? []).map((t: { tag: string }) => t.tag);
        if (tags.some((t: string) => sourceTags.has(t))) {
          seen.add(f.path);
          results.push({ path: f.path, label: this.basename(f.path), relation: 'shared-tag' });
          tagCount++;
        }
      }
    }

    return results;
  }

  private basename(path: string): string {
    const name = path.split('/').pop() || path;
    return name.replace(/\.md$/, '');
  }
}
