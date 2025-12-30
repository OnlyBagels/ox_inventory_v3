import Config from '@common/config';

// Hotbar slot boundaries (these match the slot indices defined in the web UI)
// Player inventory is 11 wide, hotbar starts at slot 55 (row 6)
const HOTBAR_START_SLOT = 55;
const INV_WIDTH = Config.Player_Width ?? 11;

// Weapon name patterns for each hotbar slot type
// These patterns match the weapon names in weapons.json
const PRIMARY_WEAPON_PATTERNS = [
  'RIFLE', 'CARBINE', 'SMG', 'SHOTGUN', 'MG', 'MINIGUN', 'GUSENBERG',
  'MUSKET', 'RAILGUN', 'COMPACTRIFLE', 'MILITARYRIFLE', 'HEAVYRIFLE',
  'TACTICALRIFLE', 'MARKSMANRIFLE', 'SNIPERRIFLE', 'HEAVYSNIPER',
  'COMBATMG', 'GRENADELAUNCHER', 'RPG', 'HOMINGLAUNCHER', 'FIREWORK',
  'BULLPUP', 'SPECIALCARBINE', 'ASSAULTRIFLE', 'ADVANCEDRIFLE',
  'BATTLERIFLE', 'COMBATPDW', 'MACHINEPISTOL', 'MINISMG', 'DOUBLEACTION',
];

const SECONDARY_WEAPON_PATTERNS = [
  'PISTOL', 'COMBATPISTOL', 'APPISTOL', 'STUNGUN', 'FLAREGUN',
  'MARKSMANPISTOL', 'REVOLVER', 'VINTAGEPISTOL', 'CERAMICPISTOL',
  'NAVYREVOLVER', 'GADGETPISTOL', 'SNSPISTOL', 'HEAVYPISTOL',
  'MICROSMG', // Micro SMG is typically a sidearm
];

const MELEE_WEAPON_PATTERNS = [
  'KNIFE', 'NIGHTSTICK', 'HAMMER', 'BAT', 'CROWBAR', 'GOLFCLUB',
  'BOTTLE', 'DAGGER', 'HATCHET', 'MACHETE', 'FLASHLIGHT', 'SWITCHBLADE',
  'KNUCKLE', 'POOLCUE', 'WRENCH', 'BATTLEAXE', 'STONE_HATCHET',
];

type HotbarSlotConfig = {
  startSlot: number;
  width: number;
  height: number;
  allowedPatterns: string[] | null;
  allowedCategories: string[] | null;
};

// Build hotbar slots from config
function buildHotbarSlots(): Record<string, HotbarSlotConfig> {
  const slots: Record<string, HotbarSlotConfig> = {};
  let currentSlot = HOTBAR_START_SLOT;
  let currentRow = 0;
  let rowStartSlot = HOTBAR_START_SLOT;
  let maxHeightInRow = 0;

  // Get slot configs from config (order matters for positioning)
  const slotConfigs = [
    { id: 'primary', config: { Width: Config.Hotbar_Slots_Primary_Width, Height: Config.Hotbar_Slots_Primary_Height, Categories: Config.Hotbar_Slots_Primary_Categories } },
    { id: 'secondary', config: { Width: Config.Hotbar_Slots_Secondary_Width, Height: Config.Hotbar_Slots_Secondary_Height, Categories: Config.Hotbar_Slots_Secondary_Categories } },
    { id: 'melee', config: { Width: Config.Hotbar_Slots_Melee_Width, Height: Config.Hotbar_Slots_Melee_Height, Categories: Config.Hotbar_Slots_Melee_Categories } },
    { id: 'utility1', config: { Width: Config.Hotbar_Slots_Utility1_Width, Height: Config.Hotbar_Slots_Utility1_Height, Categories: Config.Hotbar_Slots_Utility1_Categories } },
    { id: 'utility2', config: { Width: Config.Hotbar_Slots_Utility2_Width, Height: Config.Hotbar_Slots_Utility2_Height, Categories: Config.Hotbar_Slots_Utility2_Categories } },
    { id: 'bag', config: { Width: Config.Hotbar_Slots_Bag_Width, Height: Config.Hotbar_Slots_Bag_Height, Categories: Config.Hotbar_Slots_Bag_Categories } },
    { id: 'armor', config: { Width: Config.Hotbar_Slots_Armor_Width, Height: Config.Hotbar_Slots_Armor_Height, Categories: Config.Hotbar_Slots_Armor_Categories } },
  ];

  // Filter out undefined slots and build the hotbar
  for (const { id, config } of slotConfigs) {
    if (!config.Width || !config.Height) continue;

    const width = config.Width;
    const height = config.Height;
    const categories = config.Categories as string[] | undefined;

    // Check if we need to move to next row
    const slotCol = (currentSlot - rowStartSlot) % INV_WIDTH;
    if (slotCol + width > INV_WIDTH) {
      // Move to next row
      currentRow++;
      rowStartSlot = HOTBAR_START_SLOT + currentRow * INV_WIDTH;
      currentSlot = rowStartSlot;
      maxHeightInRow = 0;
    }

    // Determine allowed patterns based on slot type
    let allowedPatterns: string[] | null = null;
    if (id === 'primary') allowedPatterns = PRIMARY_WEAPON_PATTERNS;
    else if (id === 'secondary') allowedPatterns = SECONDARY_WEAPON_PATTERNS;
    else if (id === 'melee') allowedPatterns = MELEE_WEAPON_PATTERNS;

    slots[id] = {
      startSlot: currentSlot,
      width,
      height,
      allowedPatterns,
      allowedCategories: categories || null,
    };

    // Move to next position
    currentSlot += width;
    maxHeightInRow = Math.max(maxHeightInRow, height);
  }

  return slots;
}

// Hotbar slot definitions with their positions and allowed weapon patterns
export const HOTBAR_SLOTS = buildHotbarSlots();

/**
 * Get all slot indices occupied by a hotbar slot
 */
function getHotbarSlotIndices(slotConfig: typeof HOTBAR_SLOTS[keyof typeof HOTBAR_SLOTS]): number[] {
  const slots: number[] = [];
  for (let row = 0; row < slotConfig.height; row++) {
    for (let col = 0; col < slotConfig.width; col++) {
      slots.push(slotConfig.startSlot + row * INV_WIDTH + col);
    }
  }
  return slots;
}

/**
 * Check if a slot index is within a hotbar slot
 */
export function getHotbarSlotForIndex(slotIndex: number): keyof typeof HOTBAR_SLOTS | null {
  for (const [slotId, config] of Object.entries(HOTBAR_SLOTS)) {
    const indices = getHotbarSlotIndices(config);
    if (indices.includes(slotIndex)) {
      return slotId as keyof typeof HOTBAR_SLOTS;
    }
  }
  return null;
}

/**
 * Check if a slot index is within any hotbar slot
 */
export function isHotbarSlot(slotIndex: number): boolean {
  return getHotbarSlotForIndex(slotIndex) !== null;
}

/**
 * Check if a weapon name matches any of the allowed patterns for a slot
 */
function matchesWeaponPattern(weaponName: string, patterns: string[]): boolean {
  const upperName = weaponName.toUpperCase();
  return patterns.some(pattern => upperName.includes(pattern));
}

/**
 * Validate if an item can be placed in a hotbar slot
 * This should be called on the server before allowing item movement
 */
export function canPlaceItemInHotbarSlot(
  itemName: string | undefined,
  itemCategory: string | undefined,
  targetSlot: number
): { allowed: boolean; reason?: string } {
  const hotbarSlotId = getHotbarSlotForIndex(targetSlot);

  // Not a hotbar slot - allow (regular inventory rules apply)
  if (!hotbarSlotId) {
    return { allowed: true };
  }

  const slotConfig = HOTBAR_SLOTS[hotbarSlotId];

  // Check category restrictions first (for bag, armor, utility slots)
  if (slotConfig.allowedCategories) {
    if (!itemCategory || !slotConfig.allowedCategories.includes(itemCategory)) {
      const categoryNames: Record<string, string> = {
        bag: 'bags',
        vest: 'plate carriers',
        container: 'containers',
        weapon: 'weapons',
      };
      const allowedNames = slotConfig.allowedCategories.map(c => categoryNames[c] || c).join(' or ');
      return {
        allowed: false,
        reason: `This slot only accepts ${allowedNames}`
      };
    }
    // Category matched, allow the item
    return { allowed: true };
  }

  // Utility slots without category restrictions - any item allowed
  if (slotConfig.allowedPatterns === null) {
    return { allowed: true };
  }

  // Weapon slots require weapons
  if (itemCategory !== 'weapon') {
    return {
      allowed: false,
      reason: `Only weapons can be placed in the ${hotbarSlotId} slot`
    };
  }

  // Check if the weapon name matches the allowed patterns
  if (!itemName) {
    return {
      allowed: false,
      reason: 'Invalid weapon'
    };
  }

  if (!matchesWeaponPattern(itemName, slotConfig.allowedPatterns)) {
    const slotTypeNames: Record<string, string> = {
      primary: 'rifles, shotguns, SMGs, and heavy weapons',
      secondary: 'pistols and small sidearms',
      melee: 'melee weapons',
    };

    return {
      allowed: false,
      reason: `This slot only accepts ${slotTypeNames[hotbarSlotId] || 'specific weapons'}`
    };
  }

  return { allowed: true };
}
