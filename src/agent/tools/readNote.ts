/**
 * Tool: read_note - Read the full content of a note
 */

import type { App, TFile } from 'obsidian';
import type { AgentTool } from '../../shared/types';

export function createReadNoteTool(app: App): AgentTool {
  return {
    name: 'read_note',
    description: 'Read the full content of a note by its path. Use search_vault first to find the path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Full path to the note file (e.g. "folder/note.md")',
        },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const filePath = String(args.path);
      const file = app.vault.getAbstractFileByPath(filePath);

      if (!file || !(file as TFile).extension) {
        return JSON.stringify({ error: `File not found: ${filePath}` });
      }

      const content = await app.vault.cachedRead(file as TFile);
      const stat = (file as TFile).stat;

      return JSON.stringify({
        path: filePath,
        content,
        size: content.length,
        modified: stat.mtime,
      });
    },
  };
}
