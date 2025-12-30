import Config from '@common/config';
import type { ItemProperties } from '@common/item';
import { Inventory } from '../inventory/class';
import { GetInventory } from '../inventory';

// Get drop config with defaults
const DropConfig = {
  Width: Config.Drop?.Width || 8,
  Height: Config.Drop?.Height || 4,
  MaxWeight: Config.Drop?.MaxWeight || 50000,
  Model: Config.Drop?.Model || 'prop_med_bag_01b',
  UseProps: Config.Drop?.UseProps ?? true,
  CleanupInterval: Config.Drop?.CleanupInterval || 60000,
};

// Track active drops
const activeDrops: Map<string, DropData> = new Map();

export interface DropData {
  coords: [number, number, number];
  instance?: number;
  model?: string | number;
}

/**
 * Generates a unique drop ID.
 */
function generateDropId(prefix = 'drop'): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 100000);
  return `${prefix}:${timestamp}-${random}`;
}

/**
 * Creates a custom drop with specified items at a location.
 */
export async function CustomDrop(
  prefix: string,
  items: ItemProperties[],
  coords: [number, number, number],
  slots?: number,
  maxWeight?: number,
  instance?: number,
  model?: string | number
): Promise<string | null> {
  const dropId = generateDropId(prefix);

  // Create the drop inventory
  const inventory = new Inventory({
    inventoryId: dropId,
    type: 'drop',
    label: `${prefix} ${dropId.split(':')[1]?.substring(0, 6) ?? ''}`,
    width: DropConfig.Width,
    height: slots ? Math.ceil(slots / DropConfig.Width) : DropConfig.Height,
    maxWeight: maxWeight || DropConfig.MaxWeight,
    coords: coords,
  });

  // Add items to the drop
  for (const item of items) {
    try {
      await inventory.addItem(item);
    } catch (error) {
      console.error(`^1[ox_inventory] Failed to add item ${item.name} to drop:^0`, error);
    }
  }

  // Store drop data
  const dropData: DropData = {
    coords,
    instance,
    model: model || (DropConfig.UseProps ? DropConfig.Model : undefined),
  };

  activeDrops.set(dropId, dropData);

  // Emit to clients
  emitNet('ox_inventory:createDrop', -1, {
    inventoryId: dropId,
    ...dropData,
  });

  console.log(`^2[ox_inventory] Created drop: ${dropId}^0`);
  return dropId;
}

/**
 * Creates a drop containing all items from a player's inventory.
 */
export async function CreateDropFromPlayer(playerId: number): Promise<string | null> {
  const playerInventory = await GetInventory(playerId);

  if (!playerInventory) {
    console.error(`^1[ox_inventory] Cannot create drop - player ${playerId} has no inventory^0`);
    return null;
  }

  const items = playerInventory.mapItems();

  if (items.length === 0) {
    console.log(`^3[ox_inventory] Player ${playerId} has no items to drop^0`);
    return null;
  }

  // Get player coords
  const playerPed = GetPlayerPed(String(playerId));
  const coords = GetEntityCoords(playerPed) as [number, number, number];
  coords[2] -= 0.2; // Slightly below player

  // Get player's instance
  const instance = Player(playerId).state?.instance;

  const dropId = generateDropId('playerdrop');

  // Create the drop inventory with same dimensions as player
  const inventory = new Inventory({
    inventoryId: dropId,
    type: 'drop',
    label: `Drop from Player ${playerId}`,
    width: playerInventory.width,
    height: playerInventory.height,
    maxWeight: playerInventory.maxWeight,
    coords: coords,
  });

  // Move all items from player to drop
  for (const item of items) {
    const slot = inventory.findAvailableSlot(item);
    if (slot >= 0) {
      item.move(inventory, slot);
    }
  }

  // Store drop data
  const dropData: DropData = {
    coords,
    instance,
    model: DropConfig.UseProps ? DropConfig.Model : undefined,
  };

  activeDrops.set(dropId, dropData);

  // Clear player inventory
  playerInventory.clear();

  // Emit to clients
  emitNet('ox_inventory:createDrop', -1, {
    inventoryId: dropId,
    ...dropData,
  });

  console.log(`^2[ox_inventory] Created drop from player ${playerId}: ${dropId}^0`);
  return dropId;
}

/**
 * Removes a drop from the world.
 */
export function RemoveDrop(dropId: string): boolean {
  const inventory = Inventory.FromId(dropId);

  if (!inventory || inventory.type !== 'drop') {
    return false;
  }

  activeDrops.delete(dropId);
  inventory.remove(true);

  // Emit removal to clients
  emitNet('ox_inventory:removeDrop', -1, dropId);

  console.log(`^3[ox_inventory] Removed drop: ${dropId}^0`);
  return true;
}

/**
 * Gets active drop data.
 */
export function GetDrop(dropId: string): DropData | undefined {
  return activeDrops.get(dropId);
}

/**
 * Gets all active drops.
 */
export function GetAllDrops(): Map<string, DropData> {
  return new Map(activeDrops);
}

/**
 * Gets all drops in a specific instance.
 */
export function GetDropsInInstance(instance: number): string[] {
  const drops: string[] = [];

  for (const [dropId, data] of activeDrops) {
    if (data.instance === instance) {
      drops.push(dropId);
    }
  }

  return drops;
}

/**
 * Clears all drops in a specific instance.
 */
export function ClearDropsInInstance(instance: number): number {
  const drops = GetDropsInInstance(instance);
  let cleared = 0;

  for (const dropId of drops) {
    if (RemoveDrop(dropId)) {
      cleared++;
    }
  }

  console.log(`^3[ox_inventory] Cleared ${cleared} drops in instance ${instance}^0`);
  return cleared;
}

/**
 * Creates a drop when a player dies (if configured).
 */
export async function CreateDeathDrop(playerId: number): Promise<string | null> {
  if (!Config.Death_DropItems) return null;

  return CreateDropFromPlayer(playerId);
}

// Cleanup empty drops periodically
setInterval(() => {
  for (const [dropId] of activeDrops) {
    const inventory = Inventory.FromId(dropId);

    if (!inventory) {
      activeDrops.delete(dropId);
      emitNet('ox_inventory:removeDrop', -1, dropId);
      continue;
    }

    // Check if drop is empty and has no players viewing it
    const items = inventory.mapItems();
    if (items.length === 0) {
      RemoveDrop(dropId);
    }
  }
}, DropConfig.CleanupInterval);

// Exports
exports('CustomDrop', CustomDrop);
exports('CreateDropFromPlayer', CreateDropFromPlayer);
exports('RemoveDrop', RemoveDrop);
exports('GetDrop', GetDrop);
exports('GetAllDrops', () => Object.fromEntries(activeDrops));
exports('ClearDropsInInstance', ClearDropsInInstance);

// Handle player death
on('playerDeath', (playerId: number) => {
  CreateDeathDrop(playerId);
});

// Event handler for custom drops via events
onNet('ox_inventory:customDrop', (prefix: string, items: ItemProperties[], coords: [number, number, number]) => {
  CustomDrop(prefix, items, coords);
});

// Clean up all drops when resource stops
on('onResourceStop', (resourceName: string) => {
  if (resourceName !== GetCurrentResourceName()) return;

  console.log(`^3[ox_inventory] Cleaning up ${activeDrops.size} drops on resource stop...^0`);

  // Remove all active drops
  for (const [dropId] of activeDrops) {
    const inventory = Inventory.FromId(dropId);
    if (inventory) {
      inventory.remove(false);
    }
  }

  activeDrops.clear();

  // Notify all clients to remove drop props
  emitNet('ox_inventory:clearAllDrops', -1);
});
