import type { SkillRequirement } from '../shops/types';

/**
 * Skills configuration
 */
export const SkillsConfig = {
  // Resource name for skills
  skillsResource: 'eb-skills',
};

/**
 * Get a player's skill level
 */
export function getPlayerSkillLevel(playerId: number, skillName: string): number {
  try {
    const skillExport = exports[SkillsConfig.skillsResource];
    if (skillExport?.getSkillLevel) {
      const level = skillExport.getSkillLevel(playerId, skillName);
      return typeof level === 'number' ? level : 0;
    }
    return 0;
  } catch (error) {
    // Resource may not be running
    return 0;
  }
}

/**
 * Check if player meets a skill requirement
 */
export function checkSkillRequirement(
  playerId: number,
  requirement: SkillRequirement
): { hasSkill: boolean; currentLevel: number } {
  const currentLevel = getPlayerSkillLevel(playerId, requirement.skill);
  return {
    hasSkill: currentLevel >= requirement.level,
    currentLevel,
  };
}

/**
 * Get multiple skill levels for a player
 */
export function getPlayerSkills(
  playerId: number,
  skillNames: string[]
): Record<string, number> {
  const skills: Record<string, number> = {};

  for (const skillName of skillNames) {
    skills[skillName] = getPlayerSkillLevel(playerId, skillName);
  }

  return skills;
}

/**
 * Check if skills resource is available
 */
export function isSkillsResourceAvailable(): boolean {
  try {
    const skillExport = exports[SkillsConfig.skillsResource];
    return typeof skillExport?.getSkillLevel === 'function';
  } catch {
    return false;
  }
}

/**
 * Get relevant skills for a shop type
 */
export function getRelevantSkills(shopType: string): string[] {
  // Map shop types to relevant skills
  const shopSkillMap: Record<string, string[]> = {
    fishing_shop: ['fishing'],
    hunting_shop: ['hunting'],
    mining_shop: ['mining'],
    blackmarket: ['criminal'],
  };

  return shopSkillMap[shopType] || [];
}
