/**
 * Graph tools - Obsidian-native link/graph traversal tools for the agent
 */

import type { App } from 'obsidian';
import type { AgentTool } from '../../shared/types';

export function createGraphTools(app: App): AgentTool[] {
  return [
    createGetNoteLinks(app),
    createTraverseLinks(app),
    createFindOrphanNotes(app),
    createGetRelatedNotes(app),
  ];
}

function createGetNoteLinks(app: App): AgentTool {
  return {
    name: 'get_note_links',
    description: 'Get outgoing links and backlinks for a note path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note (e.g. "folder/note.md")' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const notePath = String(args.path);

      // Outgoing links: resolvedLinks[path] = { targetPath: count }
      const resolvedLinks = app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
      const outgoing = Object.keys(resolvedLinks[notePath] || {});

      // Backlinks: iterate all files and check if they link to notePath
      const incoming: string[] = [];
      for (const [srcPath, targets] of Object.entries(resolvedLinks)) {
        if (srcPath !== notePath && targets[notePath]) {
          incoming.push(srcPath);
        }
      }

      return JSON.stringify({ path: notePath, outgoing, incoming });
    },
  };
}

function createTraverseLinks(app: App): AgentTool {
  return {
    name: 'traverse_links',
    description: 'BFS traversal from a note up to a given depth. Returns all connected note paths.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Starting note path' },
        depth: { type: 'number', description: 'BFS depth (default: 1, max: 3)' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const startPath = String(args.path);
      const depth = Math.min(Number(args.depth) || 1, 3);
      const resolvedLinks = app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;

      const visited = new Set<string>([startPath]);
      const queue: Array<{ path: string; level: number }> = [{ path: startPath, level: 0 }];
      const connected: string[] = [];

      while (queue.length > 0) {
        const { path: current, level } = queue.shift()!;
        if (level >= depth) continue;

        const outgoing = Object.keys(resolvedLinks[current] || {});
        // Also gather backlinks
        const backlinks: string[] = [];
        for (const [srcPath, targets] of Object.entries(resolvedLinks)) {
          if (!visited.has(srcPath) && targets[current]) {
            backlinks.push(srcPath);
          }
        }

        for (const neighbor of [...outgoing, ...backlinks]) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            connected.push(neighbor);
            queue.push({ path: neighbor, level: level + 1 });
          }
        }
      }

      return JSON.stringify({ startPath, depth, connected });
    },
  };
}

function createFindOrphanNotes(app: App): AgentTool {
  return {
    name: 'find_orphan_notes',
    description: 'Find notes with no incoming and no outgoing links (limit 50).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async () => {
      const resolvedLinks = app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
      const allFiles = app.vault.getMarkdownFiles().map((f) => f.path);

      // Build set of files that have at least one incoming link
      const hasIncoming = new Set<string>();
      for (const targets of Object.values(resolvedLinks)) {
        for (const target of Object.keys(targets)) {
          hasIncoming.add(target);
        }
      }

      const orphans: string[] = [];
      for (const filePath of allFiles) {
        if (orphans.length >= 50) break;
        const outgoing = Object.keys(resolvedLinks[filePath] || {});
        if (outgoing.length === 0 && !hasIncoming.has(filePath)) {
          orphans.push(filePath);
        }
      }

      return JSON.stringify({ orphans, count: orphans.length });
    },
  };
}

function createGetRelatedNotes(app: App): AgentTool {
  return {
    name: 'get_related_notes',
    description: 'Get notes related to a given path by combining link neighbors and shared tags (limit 20).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const notePath = String(args.path);
      const resolvedLinks = app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;

      // Link neighbors (outgoing + backlinks)
      const outgoing = new Set<string>(Object.keys(resolvedLinks[notePath] || {}));
      const backlinks = new Set<string>();
      for (const [srcPath, targets] of Object.entries(resolvedLinks)) {
        if (srcPath !== notePath && targets[notePath]) {
          backlinks.add(srcPath);
        }
      }

      // Shared-tag neighbors
      const fileMeta = app.metadataCache.getCache(notePath);
      const sourceTags = new Set<string>(
        (fileMeta?.tags ?? []).map((t: { tag: string }) => t.tag)
      );

      const sharedTagPaths = new Set<string>();
      if (sourceTags.size > 0) {
        for (const file of app.vault.getMarkdownFiles()) {
          if (file.path === notePath) continue;
          const meta = app.metadataCache.getCache(file.path);
          const tags = (meta?.tags ?? []).map((t: { tag: string }) => t.tag);
          if (tags.some((t: string) => sourceTags.has(t))) {
            sharedTagPaths.add(file.path);
          }
        }
      }

      const related = new Set<string>([...outgoing, ...backlinks, ...sharedTagPaths]);
      related.delete(notePath);

      const results = Array.from(related)
        .slice(0, 20)
        .map((p) => ({
          path: p,
          byLink: outgoing.has(p) || backlinks.has(p),
          byTag: sharedTagPaths.has(p),
        }));

      return JSON.stringify({ path: notePath, related: results });
    },
  };
}
