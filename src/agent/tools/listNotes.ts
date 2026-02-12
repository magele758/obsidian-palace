/**
 * Tool: list_notes - List notes in a folder or the entire vault
 */

import type { App, TFile, TFolder } from 'obsidian';
import type { AgentTool } from '../../shared/types';

export function createListNotesTool(app: App): AgentTool {
  return {
    name: 'list_notes',
    description: 'List markdown notes in the vault or a specific folder. Returns paths, sizes, and modification times.',
    parameters: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description: 'Folder path to list (empty or "/" for root)',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
      },
      required: [],
    },
    execute: async (args) => {
      const folder = String(args.folder || '');
      const recursive = Boolean(args.recursive);
      const limit = Number(args.limit) || 50;

      let files: TFile[];

      if (recursive || !folder) {
        files = app.vault.getMarkdownFiles();
        if (folder) {
          const prefix = folder.endsWith('/') ? folder : folder + '/';
          files = files.filter(f => f.path.startsWith(prefix));
        }
      } else {
        const dir = app.vault.getAbstractFileByPath(folder);
        if (!dir || !('children' in dir)) {
          return JSON.stringify({ error: `Folder not found: ${folder}` });
        }
        files = (dir as TFolder).children
          .filter(f => f instanceof Object && 'extension' in f && (f as TFile).extension === 'md')
          .map(f => f as TFile);
      }

      // Sort by modification time, newest first
      files.sort((a, b) => b.stat.mtime - a.stat.mtime);

      const results = files.slice(0, limit).map(f => ({
        path: f.path,
        name: f.basename,
        size: f.stat.size,
        modified: f.stat.mtime,
      }));

      return JSON.stringify({
        folder: folder || '/',
        total: files.length,
        shown: results.length,
        notes: results,
      });
    },
  };
}
