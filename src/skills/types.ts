/**
 * Skill-related types (re-exported from shared for convenience)
 */

export type { Skill, SkillMetadata } from '../shared/types';

export interface SkillDirectory {
  path: string;        // e.g. '~/.claude/skills'
  expandedPath: string; // resolved absolute path
}
