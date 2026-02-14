/**
 * Skill Loader - scans directories for SKILL.md files and parses them.
 *
 * Follows the Claude Skills architecture:
 * - Level 1: Metadata (name + description from YAML frontmatter) - always loaded
 * - Level 2: Instructions (SKILL.md body) - loaded on demand
 * - Level 3: Resources (scripts, references) - accessed as needed
 *
 * Uses Node.js fs/path/os modules safely - gracefully degrades if unavailable.
 */

import type { Skill, SkillMetadata } from '../shared/types';

/* ---- Node.js module access ---- */

interface NodeModules {
  fs: typeof import('fs');
  path: typeof import('path');
  os: typeof import('os');
}

let _nodeModules: NodeModules | null | undefined;

function getNodeModules(): NodeModules | null {
  if (_nodeModules !== undefined) return _nodeModules;
  try {
    // Use eval to prevent esbuild from bundling/externalizing these
    const _require = (globalThis as any).require || require;
    _nodeModules = {
      fs: _require('fs'),
      path: _require('path'),
      os: _require('os'),
    };
  } catch {
    _nodeModules = null;
    console.warn('Obsidian Palace: Node.js modules not available, skills disabled');
  }
  return _nodeModules;
}

/* ---- YAML Frontmatter Parser ---- */

function parseFrontmatter(content: string): { metadata: SkillMetadata; body: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2];

  let name = '';
  let description = '';

  for (const line of frontmatter.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');

    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }

  if (!name || !description) return null;

  return {
    metadata: { name, description },
    body: body.trim(),
  };
}

/* ---- Path Utils ---- */

function expandPath(p: string): string {
  const node = getNodeModules();
  if (!node) return p;

  if (p.startsWith('~')) {
    return node.path.join(node.os.homedir(), p.slice(1));
  }
  return node.path.resolve(p);
}

/* ---- Directory Scanner ---- */

function scanDirectory(dirPath: string): Skill[] {
  const node = getNodeModules();
  if (!node) return [];

  const expanded = expandPath(dirPath);
  const skills: Skill[] = [];

  if (!node.fs.existsSync(expanded)) return skills;

  try {
    const entries = node.fs.readdirSync(expanded, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = node.path.join(expanded, entry.name);
      const skillFile = node.path.join(skillDir, 'SKILL.md');

      if (!node.fs.existsSync(skillFile)) continue;

      try {
        const content = node.fs.readFileSync(skillFile, 'utf-8');
        const parsed = parseFrontmatter(content);
        if (!parsed) continue;

        skills.push({
          metadata: parsed.metadata,
          instructions: parsed.body,
          directory: skillDir,
          source: node.path.join(dirPath, entry.name),
        });
      } catch {
        // Skip invalid skill files
      }
    }
  } catch {
    // Directory not readable
  }

  return skills;
}

/* ---- Public API ---- */

export const DEFAULT_SKILL_DIRECTORIES = [
  '~/.claude/skills',
  '~/.codex/skills',
  '~/.agents/skills',
];

/**
 * Load all skills from the specified directories.
 * Returns empty array if Node.js modules are not available.
 */
export function loadAllSkills(directories?: string[]): Skill[] {
  if (!getNodeModules()) return [];

  const dirs = directories || DEFAULT_SKILL_DIRECTORIES;
  const allSkills: Skill[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const skills = scanDirectory(dir);
    for (const skill of skills) {
      if (!seen.has(skill.metadata.name)) {
        seen.add(skill.metadata.name);
        allSkills.push(skill);
      }
    }
  }

  return allSkills;
}

export function loadSkillInstructions(skill: Skill): string {
  return skill.instructions;
}

export function listSkillResources(skill: Skill): string[] {
  const node = getNodeModules();
  if (!node) return [];

  try {
    const files: string[] = [];
    const walk = (dir: string, prefix: string) => {
      const entries = node.fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(node.path.join(dir, entry.name), rel);
        } else {
          files.push(rel);
        }
      }
    };
    walk(skill.directory, '');
    return files;
  } catch {
    return [];
  }
}

export function readSkillResource(skill: Skill, relativePath: string): string | null {
  const node = getNodeModules();
  if (!node) return null;

  try {
    const fullPath = node.path.join(skill.directory, relativePath);
    if (!fullPath.startsWith(skill.directory)) return null;
    return node.fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}
