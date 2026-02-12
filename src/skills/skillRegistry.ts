/**
 * Skill Registry - manages loaded skills and matches them to user requests.
 */

import type { Skill } from '../shared/types';
import { loadAllSkills, DEFAULT_SKILL_DIRECTORIES } from './skillLoader';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  /**
   * Load skills from directories
   */
  load(directories?: string[]): void {
    this.skills.clear();
    const loaded = loadAllSkills(directories || DEFAULT_SKILL_DIRECTORIES);
    for (const skill of loaded) {
      this.skills.set(skill.metadata.name, skill);
    }
  }

  /**
   * Get all loaded skills
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a skill by name
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Build a compact metadata summary for inclusion in system prompt.
   * This is Level 1 loading - only name and description.
   */
  buildMetadataSummary(): string {
    const skills = this.getAll();
    if (skills.length === 0) return '';

    const lines = skills.map(
      s => `- **${s.metadata.name}**: ${s.metadata.description}`
    );

    return [
      '## Available Skills',
      '',
      'The following skills are available. When a user request matches a skill, use its instructions.',
      '',
      ...lines,
    ].join('\n');
  }

  /**
   * Find the best matching skill for a user message.
   * Simple keyword matching - can be upgraded to semantic matching later.
   */
  findMatch(userMessage: string): Skill | null {
    const lower = userMessage.toLowerCase();
    let bestMatch: Skill | null = null;
    let bestScore = 0;

    for (const skill of this.skills.values()) {
      const desc = skill.metadata.description.toLowerCase();
      const name = skill.metadata.name.toLowerCase();

      // Check explicit skill name mention
      if (lower.includes(name) || lower.includes(`/${name}`)) {
        return skill;
      }

      // Score based on keyword overlap
      const keywords = desc.split(/\s+/).filter(w => w.length > 3);
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = skill;
      }
    }

    // Require minimum match threshold
    return bestScore >= 2 ? bestMatch : null;
  }

  /**
   * Get the number of loaded skills
   */
  get size(): number {
    return this.skills.size;
  }
}
