/**
 * Skill Loader - scans directories for SKILL.md files and parses them.
 *
 * Follows the Claude Skills architecture:
 * - Level 1: Metadata (name + description from YAML frontmatter) - always loaded
 * - Level 2: Instructions (SKILL.md body) - loaded on demand
 * - Level 3: Resources (scripts, references) - accessed as needed
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Skill, SkillMetadata } from '../shared/types';

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Expects format:
 * ---
 * name: skill-name
 * description: what this skill does
 * ---
 */
function parseFrontmatter(content: string): { metadata: SkillMetadata; body: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2];

  // Simple YAML parser for name and description
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

/**
 * Resolve ~ to home directory and normalize path
 */
function expandPath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

/**
 * Scan a single directory for skill subdirectories containing SKILL.md
 */
function scanDirectory(dirPath: string): Skill[] {
  const expanded = expandPath(dirPath);
  const skills: Skill[] = [];

  if (!fs.existsSync(expanded)) return skills;

  try {
    const entries = fs.readdirSync(expanded, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(expanded, entry.name);
      const skillFile = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillFile)) continue;

      try {
        const content = fs.readFileSync(skillFile, 'utf-8');
        const parsed = parseFrontmatter(content);
        if (!parsed) continue;

        skills.push({
          metadata: parsed.metadata,
          instructions: parsed.body,
          directory: skillDir,
          source: path.join(dirPath, entry.name),
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

/**
 * Default skill directories to scan
 */
export const DEFAULT_SKILL_DIRECTORIES = [
  '~/.claude/skills',
  '~/.codex/skills',
  '~/.agents/skills',
];

/**
 * Load all skills from the specified directories
 */
export function loadAllSkills(directories?: string[]): Skill[] {
  const dirs = directories || DEFAULT_SKILL_DIRECTORIES;
  const allSkills: Skill[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const skills = scanDirectory(dir);
    for (const skill of skills) {
      // Deduplicate by name
      if (!seen.has(skill.metadata.name)) {
        seen.add(skill.metadata.name);
        allSkills.push(skill);
      }
    }
  }

  return allSkills;
}

/**
 * Read the full SKILL.md instructions for a skill (Level 2 loading)
 */
export function loadSkillInstructions(skill: Skill): string {
  return skill.instructions;
}

/**
 * List files in a skill's directory (Level 3 resources)
 */
export function listSkillResources(skill: Skill): string[] {
  try {
    const files: string[] = [];
    const walk = (dir: string, prefix: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel);
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

/**
 * Read a specific resource file from a skill directory
 */
export function readSkillResource(skill: Skill, relativePath: string): string | null {
  try {
    const fullPath = path.join(skill.directory, relativePath);
    // Security: ensure the path is within the skill directory
    if (!fullPath.startsWith(skill.directory)) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}
