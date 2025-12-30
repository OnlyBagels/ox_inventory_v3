import type { Clothing, ItemClientProperties, ItemProperties, Weapon } from '@common/item/index';
import { cache, sleep } from '@communityox/ox_lib';
import { triggerServerCallback, notify, progressBar } from '@communityox/ox_lib/client';
import { GetClothingLabel, UseClothing } from './clothing';
import { RequestOpenInventory, CloseInventory } from './inventory';
import { DisarmWeapon, EquipWeapon, LoadAmmo, currentWeapon } from './weapon';

// ============================================================
// ITEM DATA & EFFECTS SYSTEM
// ============================================================

// Registry for custom item effects (like v2's Item() function)
type ItemEffectCallback = (item: ItemProperties, slotData: { name: string; slot: number }) => void | boolean | Promise<void | boolean>;
const itemEffects: Map<string, ItemEffectCallback> = new Map();

/**
 * Register a custom effect for an item (like v2's Item() function)
 * @example
 * registerItemEffect('bandage', async (item, slot) => {
 *   const maxHealth = GetEntityMaxHealth(cache.ped);
 *   const health = GetEntityHealth(cache.ped);
 *   SetEntityHealth(cache.ped, Math.min(maxHealth, health + maxHealth / 16));
 *   notify({ description: 'You feel better already' });
 *   return true; // Return true to consume the item
 * });
 */
export function registerItemEffect(itemName: string, callback: ItemEffectCallback) {
  itemEffects.set(itemName.toLowerCase(), callback);
}

function GetItemData(item: ItemProperties): ItemProperties {
  const baseData = GlobalState[`Item:${item.name}`];
  if (!baseData) {
    console.warn(`Item data not found in GlobalState for: ${item.name}`);
    return item;
  }
  return Object.assign({}, baseData, item);
}

export async function ValidateItemData(item: ItemProperties) {
  if (item.category === 'clothing') {
    if (item.name === item.label) {
      const label = await GetClothingLabel(item as Clothing);
      item.label = label || item.name;
    }
    return;
  }
}

export let isUsingItem = false;

export async function GetInventoryItem(itemId: number) {
  const response = await triggerServerCallback<ItemProperties | [string]>(
    'ox_inventory:getInventoryItem',
    null,
    itemId,
  );

  if (!response) return;

  if (Array.isArray(response)) throw new Error(`requestUseItem failed: ${response}`);

  return GetItemData(response);
}

// ============================================================
// CONSUMABLE ITEM HANDLING
// ============================================================

/**
 * Handle using an item with client properties (progress bar, animations, etc.)
 */
async function useConsumableItem(item: ItemProperties, clientProps: ItemClientProperties, noAnim: boolean): Promise<boolean> {
  // If there's a custom export, call it
  if (clientProps.export) {
    const [resourceName, exportName] = clientProps.export.split('.');
    try {
      const result = exports[resourceName][exportName](item, { name: item.name, slot: item.anchorSlot });
      return result === true;
    } catch (err) {
      console.error(`Failed to call export ${clientProps.export}:`, err);
      return false;
    }
  }

  // If there's a custom event, trigger it
  if (clientProps.event) {
    emit(clientProps.event, item, { name: item.name, slot: item.anchorSlot });
    return true;
  }

  // Show progress bar if usetime is set
  if (clientProps.usetime && !noAnim) {
    const success = await progressBar({
      duration: clientProps.usetime,
      label: `Using ${item.label || item.name}`,
      useWhileDead: clientProps.useWhileDead || false,
      canCancel: clientProps.cancel !== false,
      disable: clientProps.disable || { combat: true },
      anim: clientProps.anim as any,
      prop: clientProps.prop as any,
    });

    if (!success) {
      return false;
    }
  }

  // Show notification if set
  if (clientProps.notification) {
    notify({ description: clientProps.notification });
  }

  // Apply status effects if set (requires framework integration)
  if (clientProps.status) {
    // Emit event for framework to handle status effects
    emit('ox_inventory:applyStatus', clientProps.status);
  }

  return true;
}

// ============================================================
// MAIN USE ITEM FUNCTION
// ============================================================

export async function UseItem(itemId: number, noAnim = false) {
  try {
    isUsingItem = true;
    const response = await triggerServerCallback<ItemProperties | [string]>('ox_inventory:requestUseItem', 50, itemId);

    if (!response) return;

    if (Array.isArray(response)) throw new Error(`requestUseItem failed: ${response}`);

    const item = GetItemData(response);

    // Close inventory if item.close is true (default for most items)
    if (item.close !== false) {
      CloseInventory();
    }

    // Check for registered custom effect first
    const customEffect = itemEffects.get(item.name.toLowerCase());
    if (customEffect) {
      const result = await customEffect(item, { name: item.name, slot: item.anchorSlot || 0 });
      if (result === true) {
        // Tell server to consume the item
        emitNet('ox_inventory:itemUsed', item.anchorSlot);
      }
      return result;
    }

    // Handle by category
    switch (item.category) {
      case 'ammo':
        return await LoadAmmo(item);

      case 'weapon': {
        // Check if already holding this weapon (toggle off)
        if (currentWeapon.uniqueId === item.uniqueId) {
          return await DisarmWeapon(noAnim);
        }

        // Disarm current weapon first if equipped
        if (currentWeapon.name) {
          const previousSlot = currentWeapon.anchorSlot;
          await DisarmWeapon(noAnim);

          // If same slot, we just wanted to holster
          if (previousSlot === (item as Weapon).anchorSlot) {
            return;
          }
        }

        // Check if weapon can be equipped (test by temporarily giving it)
        GiveWeaponToPed(cache.ped, (item as Weapon).hash, 0, false, true);
        SetCurrentPedWeapon(cache.ped, (item as Weapon).hash, false);

        if ((item as Weapon).hash !== GetSelectedPedWeapon(cache.ped)) {
          notify({
            id: 'cannot_use',
            description: `Cannot equip ${item.label || item.name}`,
            type: 'error',
          });
          RemoveWeaponFromPed(cache.ped, (item as Weapon).hash);
          return false;
        }

        RemoveWeaponFromPed(cache.ped, (item as Weapon).hash);

        // Equip the weapon with animations
        const animSleep = await EquipWeapon(item as Weapon, noAnim);

        if (animSleep) {
          await sleep(animSleep);
        }

        return true;
      }

      case 'clothing':
        return await UseClothing(item as Clothing);

      case 'container':
      case 'vest':
        return await RequestOpenInventory([`container:${item.uniqueId}`]);

      case 'bag':
        return await RequestOpenInventory([`bag:${item.uniqueId}`]);

      default: {
        // Handle items with client properties (consumables, usable items)
        if (item.client) {
          const success = await useConsumableItem(item, item.client, noAnim);
          if (success) {
            // Tell server to consume the item
            emitNet('ox_inventory:itemUsed', item.anchorSlot);
          }
          return success;
        }

        // No special handling - just emit used event for server to handle
        if (item.consume !== undefined && item.consume !== 0) {
          emitNet('ox_inventory:itemUsed', item.anchorSlot);
          return true;
        }

        return false;
      }
    }
  } catch (err) {
    console.error(err);
    return false;
  } finally {
    isUsingItem = false;
  }
}

// ============================================================
// BUILT-IN ITEM EFFECTS
// ============================================================

// Bandage - heals player
registerItemEffect('bandage', async (item) => {
  const maxHealth = GetEntityMaxHealth(cache.ped);
  const health = GetEntityHealth(cache.ped);
  SetEntityHealth(cache.ped, Math.min(maxHealth, Math.floor(health + maxHealth / 16)));
  notify({ description: 'You feel better already' });
  return true;
});

// Armour - sets player armour to 100
registerItemEffect('armour', async (item) => {
  if (GetPedArmour(cache.ped) >= 100) {
    notify({ description: 'You already have full armour', type: 'error' });
    return false;
  }
  SetPedArmour(cache.ped, 100);
  notify({ description: 'You put on the armour' });
  return true;
});

// Medikit / First Aid - heals player to full
registerItemEffect('medikit', async (item) => {
  const maxHealth = GetEntityMaxHealth(cache.ped);
  SetEntityHealth(cache.ped, maxHealth);
  notify({ description: 'You used a first aid kit' });
  return true;
});

registerItemEffect('firstaid', async (item) => {
  const maxHealth = GetEntityMaxHealth(cache.ped);
  SetEntityHealth(cache.ped, maxHealth);
  notify({ description: 'You used a first aid kit' });
  return true;
});

// Export for other resources to register effects
exports('registerItemEffect', registerItemEffect);

onNet('ox_inventory:useItem', UseItem);
