/**
 * Tool: write_note - Create or modify a note in the vault
 */

import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { AgentTool } from '../../shared/types';

export function createWriteNoteTool(app: App): AgentTool {
  return {
    name: 'write_note',
    description: 'Create a new note or overwrite an existing note in the vault.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Full path for the note (e.g. "folder/new-note.md")',
        },
        content: {
          type: 'string',
          description: 'Markdown content to write',
        },
        mode: {
          type: 'string',
          enum: ['create', 'overwrite', 'append'],
          description: 'Write mode: create (fail if exists), overwrite, or append (default: create)',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const filePath = String(args.path);
      const content = String(args.content);
      const mode = String(args.mode || 'create');

      const existing = app.vault.getAbstractFileByPath(filePath);

      if (mode === 'create' && existing) {
        return JSON.stringify({ error: `File already exists: ${filePath}. Use mode "overwrite" or "append".` });
      }

      try {
        if (existing instanceof TFile) {
          if (mode === 'append') {
            const oldContent = await app.vault.read(existing);
            await app.vault.modify(existing, oldContent + '\n' + content);
          } else {
            await app.vault.modify(existing, content);
          }
        } else {
          // Ensure parent directory exists
          const dir = filePath.substring(0, filePath.lastIndexOf('/'));
          if (dir) {
            const dirExists = app.vault.getAbstractFileByPath(dir);
            if (!dirExists) {
              await app.vault.createFolder(dir);
            }
          }
          await app.vault.create(filePath, content);
        }

        return JSON.stringify({ success: true, path: filePath, mode });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    },
  };
}
