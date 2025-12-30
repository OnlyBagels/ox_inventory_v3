// Weapon groups
export const GROUP_PETROLCAN = GetHashKey('GROUP_PETROLCAN');
export const GROUP_FIREEXTINGUISHER = GetHashKey('GROUP_FIREEXTINGUISHER');
export const GROUP_MELEE = GetHashKey('GROUP_MELEE');
export const GROUP_PISTOL = GetHashKey('GROUP_PISTOL');
export const GROUP_STUNGUN = GetHashKey('GROUP_STUNGUN');
export const GROUP_UNARMED = GetHashKey('GROUP_UNARMED');

// Additional weapon groups for hotbar restrictions
export const GROUP_SMG = GetHashKey('GROUP_SMG');
export const GROUP_SHOTGUN = GetHashKey('GROUP_SHOTGUN');
export const GROUP_RIFLE = GetHashKey('GROUP_RIFLE');
export const GROUP_MG = GetHashKey('GROUP_MG');
export const GROUP_SNIPER = GetHashKey('GROUP_SNIPER');
export const GROUP_HEAVY = GetHashKey('GROUP_HEAVY');
export const GROUP_THROWN = GetHashKey('GROUP_THROWN');

// Special weapon hashes
export const WEAPON_FIREEXTINGUISHER = GetHashKey('WEAPON_FIREEXTINGUISHER');
export const WEAPON_PETROLCAN = GetHashKey('WEAPON_PETROLCAN');
export const WEAPON_HAZARDCAN = GetHashKey('WEAPON_HAZARDCAN');
export const WEAPON_FERTILIZERCAN = GetHashKey('WEAPON_FERTILIZERCAN');

// Hotbar slot restriction groups
export const PRIMARY_WEAPON_GROUPS = [
  GROUP_SMG,
  GROUP_SHOTGUN,
  GROUP_RIFLE,
  GROUP_MG,
  GROUP_SNIPER,
  GROUP_HEAVY,
];

export const SECONDARY_WEAPON_GROUPS = [
  GROUP_PISTOL,
  GROUP_STUNGUN,
];

export const MELEE_WEAPON_GROUPS = [
  GROUP_MELEE,
];
