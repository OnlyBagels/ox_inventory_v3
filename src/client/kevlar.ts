import type { ItemProperties } from '@common/item';
import { cache } from '@communityox/ox_lib';
import { triggerServerCallback, progressBar, notify } from '@communityox/ox_lib/client';
import { CloseInventory, RequestOpenInventory } from './inventory';

// ============================================================
// PLATE CARRIER / KEVLAR SYSTEM
// ============================================================

interface PlateData {
  itemName: string;
  health: number;
}

interface EquippedVest {
  itemName: string;
  carrierId: string;
  slot: number;
}

// Config
const CONFIG = {
  syncPlatesEveryHit: true,
  useBrokenPlates: true,
  brokenPlateItem: 'brokenplate',
};

// Plate carrier names (items with container category that have plateType)
const PLATE_CARRIERS = ['heavypc', 'lightpc', 'crim_heavypc', 'crim_lightpc'];

// Plate armor values
const PLATE_VALUES: Record<string, number> = {
  heavyplate: 50,
  lightplate: 25,
  brokenplate: 0,
};

// State
let equippedVest: EquippedVest | null = null;
let pedArmor = 0;
let plateMeta: PlateData[] = [];

// ============================================================
// VEST EQUIP/UNEQUIP
// ============================================================

async function playVestAnimation(action: 'equip' | 'remove'): Promise<boolean> {
  const ped = cache.ped;
  const dict = 'clothingtie';
  const anim = 'try_tie_neutral_c';

  RequestAnimDict(dict);
  while (!HasAnimDictLoaded(dict)) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const label = action === 'equip' ? 'Putting on vest...' : 'Removing vest...';
  const duration = 2000;

  TaskPlayAnim(ped, dict, anim, 8.0, -8.0, duration, 49, 0, false, false, false);

  const success = await progressBar({
    duration,
    position: 'bottom',
    label,
    useWhileDead: false,
    canCancel: false,
    disable: { car: true, combat: true },
  });

  ClearPedTasks(ped);
  RemoveAnimDict(dict);

  return success;
}

export async function useVest(item: ItemProperties, slot: number): Promise<boolean> {
  const itemName = item.name;

  // Check if this is a valid plate carrier
  if (!PLATE_CARRIERS.includes(itemName)) {
    return false;
  }

  // If we have a vest equipped
  if (equippedVest) {
    await playVestAnimation('remove');
    SetPedArmour(cache.ped, 0);
    pedArmor = 0;

    // If clicking the same vest, just unequip
    if (equippedVest.slot === slot && equippedVest.itemName === itemName) {
      equippedVest = null;
      plateMeta = [];
      return true;
    }

    equippedVest = null;
    plateMeta = [];
  }

  // Equip the vest
  equippedVest = {
    itemName,
    carrierId: `${item.uniqueId}`,
    slot,
  };

  await playVestAnimation('equip');

  // Request plates from the container inventory on server
  const plates = await triggerServerCallback<PlateData[]>(
    'ox_inventory:getCarrierPlates',
    100,
    item.uniqueId
  );

  // Calculate total armor from plates
  let totalArmor = 0;
  plateMeta = plates || [];

  if (plateMeta.length > 0) {
    for (const plate of plateMeta) {
      if (plate.health > 0) {
        totalArmor += plate.health;
      }
    }
  }

  const armor = Math.min(totalArmor, 100);
  SetPedArmour(cache.ped, armor);
  pedArmor = armor;

  return true;
}

// ============================================================
// PLATE MANAGEMENT (OPEN VEST INVENTORY)
// ============================================================

export async function managePlates(slot: number): Promise<void> {
  CloseInventory();
  emitNet('ox_inventory:openVestStash', slot);
}

// ============================================================
// DAMAGE TRACKING
// ============================================================

function handleArmorDamage() {
  if (!equippedVest || plateMeta.length === 0) return;

  const currentArmor = GetPedArmour(cache.ped);

  // No damage taken
  if (currentArmor >= pedArmor) {
    pedArmor = currentArmor;
    return;
  }

  const armorLost = pedArmor - currentArmor;
  pedArmor = currentArmor;

  let remainingDamage = armorLost;
  let plateBroken = false;

  // Distribute damage across plates
  for (const plate of plateMeta) {
    if (plate.health > 0 && remainingDamage > 0) {
      const absorb = Math.min(plate.health, remainingDamage);
      plate.health -= absorb;
      remainingDamage -= absorb;

      if (plate.health <= 0) {
        plateBroken = true;
      }
    }
  }

  // Sync to server if needed
  if (CONFIG.syncPlatesEveryHit || plateBroken) {
    emitNet('ox_inventory:syncArmor', equippedVest.itemName, equippedVest.carrierId, plateMeta);
  }
}

// Listen for damage events
AddEventHandler('gameEventTriggered', (name: string, args: any[]) => {
  if (name !== 'CEventNetworkEntityDamage') return;
  if (!equippedVest) return;

  const victim = args[0];
  if (victim !== cache.ped) return;

  handleArmorDamage();
});

// ============================================================
// EVENT HANDLERS
// ============================================================

// Called when vest metadata is updated (e.g., plates added/removed)
onNet('ox_inventory:onVestMetadataUpdate', (itemName: string, metadata: { carrierId: string; plates?: PlateData[] }) => {
  if (!equippedVest || equippedVest.carrierId !== metadata.carrierId) return;

  // Recalculate armor from updated plates
  let totalArmor = 0;
  plateMeta = metadata.plates || [];

  for (const plate of plateMeta) {
    if (plate.health > 0) {
      totalArmor += plate.health;
    }
  }

  const armor = Math.min(totalArmor, 100);
  SetPedArmour(cache.ped, armor);
  pedArmor = armor;
});

// Called when vest is dropped/removed from inventory
onNet('ox_inventory:droppedVest', (metadata: { carrierId?: string | number }) => {
  if (!equippedVest || !metadata.carrierId) return;
  if (equippedVest.carrierId !== String(metadata.carrierId)) return;

  SetPedArmour(cache.ped, 0);
  pedArmor = 0;
  equippedVest = null;
  plateMeta = [];
});

// ============================================================
// EXPORTS
// ============================================================

export function getEquippedVest() {
  return equippedVest;
}

export function isWearingVest(): boolean {
  return equippedVest !== null;
}

export function getCurrentArmor(): number {
  return pedArmor;
}

// Reset on player death or respawn
export function resetArmor(): void {
  equippedVest = null;
  plateMeta = [];
  pedArmor = 0;
}

// Export for use by item system
exports('useVest', useVest);
exports('managePlates', managePlates);
exports('isWearingVest', isWearingVest);
exports('getCurrentArmor', getCurrentArmor);
