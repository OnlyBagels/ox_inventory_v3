// ============================================================
// CRITICAL: Pre-migration must run BEFORE any database imports!
// This deletes old sqlite files if migration is needed.
// ============================================================
import { preMigrationCleanup } from './migration';
preMigrationCleanup();

// Now safe to import database-dependent modules
import { GetInventoryItem, GetItemData, calculateInventoryWeight, type ItemProperties, type Weapon } from '@common/item';
import { onClientCallback } from '@communityox/ox_lib/server';
import { GetInventory } from './inventory';
import { Inventory } from './inventory/class';
import './commands';
import Config from '@common/config';
import { TriggerEventHooks } from '@common/hooks';
import { GetItemClass } from './item';
import { initBridge, getBridge, hasGroup, syncInventory } from './bridge';
import { canPlaceItemInHotbarSlot } from '@common/hotbar';
import { runMigration, migrateItemsLua, checkMigrationNeeded } from './migration';
import './shops';
// import './crafting'; // Uncomment when crafting system is needed
import './drops';

/**
 * Updates the metadataWeight of a container or bag item based on its contents.
 * This ensures the item's weight is reflected in the player's total weight.
 * Works for both 'container:' and 'bag:' inventory types.
 */
function updateContainerItemWeight(inventoryId: string) {
  // container:12345 or bag:12345 -> 12345
  const itemId = +inventoryId.slice(inventoryId.indexOf(':') + 1);
  const containerItem = GetInventoryItem(itemId);

  if (!containerItem) return;

  const containerInventory = Inventory.FromId(inventoryId);

  if (!containerInventory) return;

  // Calculate total weight of items inside the container/bag
  const contentsWeight = calculateInventoryWeight(containerInventory.mapItems());

  // Update the container item's metadataWeight (this is added to the item's weight in calculateItemWeight)
  containerItem.metadataWeight = contentsWeight;

  // Find the player inventory that contains the container and recalculate its weight
  if (containerItem.inventoryId) {
    const playerInventory = Inventory.FromId(containerItem.inventoryId);
    if (playerInventory) {
      playerInventory.recalculateWeight();

      // Emit update to clients
      playerInventory.emit('ox_inventory:updateItem', containerItem);
    }
  }
}

// Run database migration after 30 second delay (if needed)
(async () => {
  const migrationNeeded = checkMigrationNeeded();
  console.log(`[ox_inventory] Migration needed: ${migrationNeeded}`);

  if (!migrationNeeded) {
    console.log('[ox_inventory] ^2Migration already completed - database ready.^0');
    return;
  }

  // Migration is needed - wait 30 seconds with countdown
  console.log('[ox_inventory] ^3Migration required - waiting 30 seconds before starting...^0');
  for (let i = 30; i > 0; i--) {
    console.log(`[ox_inventory] ^3Starting migration in ${i} seconds...^0`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log('[ox_inventory] ^2Starting migration process NOW!^0');

  try {
    // Step 1: Migrate items.lua to items.json (if it exists)
    console.log('[ox_inventory] Step 1: Checking items.lua migration...');
    const itemsMigrated = migrateItemsLua();
    console.log(`[ox_inventory] Step 1 complete: itemsMigrated = ${itemsMigrated}`);

    // Step 2: Run v2 to v3 database migration (copies MySQL data to fresh sqlite)
    console.log('[ox_inventory] Step 2: Running database migration...');
    const success = await runMigration(itemsMigrated);
    if (success) {
      console.log('[ox_inventory] ^2Database ready.^0');
    }
  } catch (error) {
    console.error('^1[ox_inventory] Migration error:^0', error);
  }
})();

// Initialize the framework bridge
initBridge().catch((error) => {
  console.error('^1[ox_inventory] Failed to initialize bridge:^0', error);
});

onClientCallback('ox_inventory:requestOpenInventory', async (playerId, inventories?: string[]) => {
  const inventory = await GetInventory(playerId);

  if (!inventory) return false;

  using hook = await TriggerEventHooks('openInventory', {
    playerId,
    inventoryId: inventory.inventoryId,
    inventoryType: inventory.type,
  });

  if (!hook.success) return console.error('Cannot open inventory');

  inventory.open(playerId);

  if (!inventories || !inventories.length) return true;

  if (inventories.length > 5) inventories.length = 5;

  for (const inventoryId of inventories) {
    const secondary = await GetInventory(inventoryId);

    // todo: validation
    if (secondary) {
      using secondaryHook = await TriggerEventHooks('openInventory', {
        playerId,
        inventoryId: secondary.inventoryId,
        inventoryType: secondary.type,
      });

      if (secondaryHook.success) secondary.open(playerId);
    }
  }

  return true;
});

onNet('ox_inventory:closeInventory', async (inventoryId?: string) => {
  const playerId = source;

  if (inventoryId) return Inventory.FromId(inventoryId)?.close(playerId, false);

  Inventory.GetInventories(playerId).forEach((inventory) => inventory.close(playerId, false));
});

onClientCallback('ox_inventory:requestMoveItem', async (playerId, data: MoveItem) => {
  if (Config.Debug) console.log(`[SERVER] requestMoveItem: fromSlot=${data.fromSlot}, toSlot=${data.toSlot}, rotate=${data.rotate}`);

  const fromInventory = await GetInventory(data.fromId);
  const isNewDrop = !data.toId && data.coords;
  const toId = data.toId ?? `drop:${Date.now()}`;

  // Check if the item being dropped has a custom drop model
  let dropModel: string | undefined;
  if (isNewDrop && fromInventory) {
    const droppedItem = GetInventoryItem(fromInventory.items[data.fromSlot]);
    if (droppedItem) {
      // Get drop model from DropModels (works for all items - weapons, regular items, etc.)
      const { DropModels } = await import('./item');
      dropModel = DropModels[droppedItem.name];
    }
  }

  const toInventory =
    data.fromId === data.toId
      ? fromInventory
      : await GetInventory(toId, { coords: data.coords, model: dropModel });

  // For new drops, open the inventory for the player before validation
  if (isNewDrop && toInventory) {
    toInventory.open(playerId);
  }

  const isValidInventory =
    fromInventory &&
    toInventory &&
    fromInventory.getOpenState(playerId) === 'open' &&
    toInventory.getOpenState(playerId) === 'open';

  if (!isValidInventory) {
    console.error('Invalid inventory');
    return false;
  }

  const item = GetInventoryItem(fromInventory.items[data.fromSlot]);

  if (!item) {
    console.error(`Invalid item in ${fromInventory.inventoryId}<${data.fromSlot}>`);
    return false;
  }

  // no nested containers or bags inside bags (vest is a container subtype)
  const isContainer = item.category === 'container' || item.category === 'vest';
  if (toInventory.type === 'container' && isContainer) return false;
  if (toInventory.type === 'bag' && item.category === 'bag') return false;
  // bags cannot go inside containers either
  if (toInventory.type === 'container' && item.category === 'bag') return false;
  if (toInventory.type === 'bag' && isContainer) return false;

  data.quantity = Math.max(1, Math.min(item.quantity, data.quantity));

  if (data.quantity > item.quantity) {
    console.error('Invalid item or item count');
    return false;
  }

  // Special handling for moving items FROM a container/bag TO the inventory that holds the container
  // The container's metadataWeight includes the item's weight, so we need to temporarily adjust
  // the target inventory's weight for the canHoldItem check
  let weightAdjustment = 0;
  if ((fromInventory.type === 'container' || fromInventory.type === 'bag') && toInventory.type === 'player') {
    // Check if the container item exists in the target (player) inventory
    const containerItemId = +fromInventory.inventoryId.slice(fromInventory.inventoryId.indexOf(':') + 1);
    const containerItem = GetInventoryItem(containerItemId);

    if (containerItem && containerItem.inventoryId === toInventory.inventoryId) {
      // The container is in the player's inventory - the item's weight is already counted
      // in the container's metadataWeight, so we need to subtract it for the weight check
      const itemWeight = item.weight ?? 0;
      weightAdjustment = itemWeight * data.quantity;
      toInventory.weight -= weightAdjustment;
    }
  }

  // Temporarily apply rotation for canHoldItem check if rotation is changing
  const originalRotate = item.rotate;
  if (data.rotate !== undefined) {
    item.rotate = data.rotate;
  }

  if (Config.Debug) {
    console.log(`[SERVER] Before canHoldItem: item.rotate=${item.rotate}, width=${item.width}, height=${item.height}, toSlot=${data.toSlot}`);
    console.log(`[SERVER] Inventory: ${toInventory.width}x${toInventory.height}, slot at row=${Math.floor(data.toSlot / toInventory.width)}, col=${data.toSlot % toInventory.width}`);
    console.log(`[SERVER] Item needs rows ${Math.floor(data.toSlot / toInventory.width)} to ${Math.floor(data.toSlot / toInventory.width) + item.height - 1} (max row: ${toInventory.height - 1})`);
  }

  const canHoldItem = toInventory.canHoldItem(item, data.toSlot, data.quantity);

  if (Config.Debug) console.log(`[SERVER] canHoldItem result: ${canHoldItem}`);

  // Restore original rotation (move() will apply the final rotation)
  if (originalRotate) {
    item.rotate = true;
  } else {
    delete item.rotate;
  }

  // Restore the weight if we adjusted it
  if (weightAdjustment > 0) {
    toInventory.weight += weightAdjustment;
  }

  if (!canHoldItem) {
    if (Config.Debug) console.log(`[SERVER] canHoldItem FAILED - returning false`);
    return false;
  }

  // Validate hotbar slot restrictions for player inventory
  if (toInventory.type === 'player' && data.toSlot !== undefined) {
    const hotbarValidation = canPlaceItemInHotbarSlot(item.name, item.category, data.toSlot);

    if (!hotbarValidation.allowed) {
      console.error(`Hotbar restriction: ${hotbarValidation.reason}`);
      return false;
    }
  }

  const splitStack = data.quantity !== item.quantity;

  using hook = await TriggerEventHooks('moveItem', {
    item,
    playerId,
    splitStack,
    toSlot: data.toSlot,
    quantity: data.quantity,
    inventoryId: fromInventory.inventoryId,
    inventoryType: fromInventory.type,
    toInventoryId: toInventory.inventoryId,
    toInventoryType: toInventory.type,
  });

  if (!hook.success) {
    console.error('Cannot move item');
    return false;
  }

  if (Config.Debug) console.log(`[requestMoveItem] data.rotate=${data.rotate}, typeof=${typeof data.rotate}, item.rotate=${item.rotate}`);

  const success = splitStack
    ? item.split(toInventory, data.quantity, data.toSlot, data.rotate)
    : item.move(toInventory, data.toSlot, data.rotate);

  hook.success = !!success;

  // Update container/bag item weight if moving to/from a container or bag inventory
  if (success) {
    if (fromInventory.type === 'bag' || fromInventory.type === 'container') {
      updateContainerItemWeight(fromInventory.inventoryId);
    }
    if ((toInventory.type === 'bag' || toInventory.type === 'container') && toInventory.inventoryId !== fromInventory.inventoryId) {
      updateContainerItemWeight(toInventory.inventoryId);
    }
  }

  return !!success;
});

onClientCallback('ox_inventory:requestRotateItem', async (playerId, data: { inventoryId: string; uniqueId: number; rotate: boolean }) => {
  const inventory = await GetInventory(data.inventoryId);

  if (!inventory || inventory.getOpenState(playerId) !== 'open') {
    console.error('Invalid inventory for rotation');
    return false;
  }

  const item = GetInventoryItem(data.uniqueId);

  if (!item || item.inventoryId !== data.inventoryId) {
    console.error('Invalid item for rotation');
    return false;
  }

  // Can't rotate square items
  if (item.width === item.height) return false;

  // Check if the item can fit when rotated
  const currentSlots = inventory.getItemSlots(item);

  // Remove item temporarily to check if rotated version fits
  inventory.setSlotRefs(currentSlots);

  // Toggle rotation
  item.rotate = data.rotate;

  // Check if rotated item fits at same position
  const newSlots = inventory.canHoldItem(item, item.anchorSlot);

  if (!newSlots) {
    // Rotation doesn't fit - restore original state
    item.rotate = !data.rotate;
    inventory.setSlotRefs(currentSlots, item.uniqueId);
    return false;
  }

  // Rotation fits - update slot refs
  inventory.setSlotRefs(newSlots, item.uniqueId);
  inventory.invalidateCache();

  // Update all players viewing this inventory
  inventory.emit('ox_inventory:updateItem', item);

  return true;
});

onClientCallback('ox_inventory:requestUseItem', async (playerId, itemId: number) => {
  const inventory = await GetInventory(playerId);
  const item = inventory && GetInventoryItem(itemId);

  if (!item) return ['invalid_item'];
  if (!inventory || inventory.inventoryId !== item.inventoryId) return ['invalid_inventory'];

  switch (item.category) {
    case 'weapon':
      inventory.currentWeapon = item.uniqueId;
      break;
    case 'ammo':
      if (!GetInventoryItem(inventory.currentWeapon)) return;

      break;
  }

  return item;
});

onClientCallback('ox_inventory:getInventoryItem', async (playerId, itemId: number) => {
  return GetInventoryItem(itemId);
});

// Get item in a specific hotbar slot for the player
onClientCallback('ox_inventory:getHotbarItem', async (playerId, slotIndex: number) => {
  const inventory = await GetInventory(playerId);

  if (!inventory) return null;

  const item = inventory.getItemInSlot(slotIndex);

  return item || null;
});

onClientCallback('ox_inventory:findInventoryItem', async (playerId, data: ItemProperties) => {
  const inventory = await GetInventory(playerId);

  if (!inventory) return;

  return inventory.mapItems().find((item) => item.match(data, false));
});

// Handle item consumption after client-side use
onNet('ox_inventory:itemUsed', async (slot: number) => {
  const playerId = source;
  const inventory = await GetInventory(playerId);

  if (!inventory) return;

  const item = inventory.getItemInSlot(slot);

  if (!item) return;

  // Get the consume amount from item properties
  const itemData = GetItemData(item.name);
  const consume = item.consume ?? itemData?.properties?.consume ?? 1;

  if (consume === 0) {
    // Item is not consumed on use
    return;
  }

  // Consume the item
  if (consume >= 1) {
    // Remove whole items
    const removeCount = Math.floor(consume);
    inventory.removeItem({
      name: item.name,
      quantity: removeCount,
      anchorSlot: slot,
    });
  } else if (consume > 0 && consume < 1) {
    // Partial consumption - reduce durability instead
    if (item.durability !== undefined) {
      item.durability = Math.max(0, item.durability - (consume * 100));

      // If durability reaches 0, remove the item
      if (item.durability <= 0) {
        inventory.removeItem({
          name: item.name,
          quantity: 1,
          anchorSlot: slot,
        });
      } else {
        // Update the item in place
        item.move(inventory, item.anchorSlot);
      }
    }
  }

  // Emit event for other resources to hook into
  emit('ox_inventory:usedItem', playerId, item.name, slot, item);
});

// V2-compatible weapon update handler with action types
// Actions: 'load', 'ammo', 'melee', 'throw', 'component', or undefined (disarm)
onNet('ox_inventory:updateWeapon', async (action?: string, value?: any, slot?: number, specialAmmo?: string) => {
  const playerId = source;
  const inventory = await GetInventory(playerId);

  if (!inventory) return;

  // No action = disarm (clear weapon reference)
  if (!action) {
    inventory.currentWeapon = undefined;
    return;
  }

  // Get weapon from slot or current weapon
  const weaponSlot = slot ?? inventory.currentWeapon;
  const weapon = weaponSlot !== undefined ? (GetInventoryItem(weaponSlot) as Weapon) : undefined;

  if (!weapon) return;

  const durabilityDrain = Config.Weapon_DurabilityPerShot || 0.03;

  switch (action) {
    case 'load': {
      // Load ammo into weapon
      if (!weapon.ammoName || weapon.durability <= 0) return;

      const newAmmo = value as number;
      const currentAmmo = weapon.ammoCount || 0;
      const diff = newAmmo - currentAmmo;

      if (diff <= 0) return;

      // Remove ammo from inventory
      const success = inventory.removeItem({
        name: weapon.ammoName,
        quantity: diff,
        ...(specialAmmo ? { type: specialAmmo } : {}),
      });

      if (!success) return;

      weapon.ammoCount = newAmmo;
      if (specialAmmo) (weapon as any).specialAmmo = specialAmmo;

      weapon.move(inventory, weapon.anchorSlot);
      emitNet('ox_inventory:updateCurrentWeapon', playerId, weapon);
      return true;
    }

    case 'ammo': {
      // Update ammo count and durability after shooting
      const ammoCount = value as number;

      if (ammoCount > (weapon.ammoCount || 0)) return;

      // Calculate durability loss
      const shotsFired = (weapon.ammoCount || 0) - ammoCount;
      const durabilityLoss = durabilityDrain * shotsFired * 100;

      weapon.ammoCount = ammoCount;
      weapon.durability = Math.max(0, (weapon.durability || 100) - durabilityLoss);

      weapon.move(inventory, weapon.anchorSlot);
      emitNet('ox_inventory:updateCurrentWeapon', playerId, weapon);

      // Auto-reload if enabled and out of ammo
      if (Config.Weapon_AutoReload && ammoCount === 0 && weapon.ammoName) {
        const ammoItem = inventory.mapItems().find((item) => item.name === weapon.ammoName);
        if (ammoItem) emitNet('ox_inventory:useItem', playerId, ammoItem.uniqueId);
      }
      return true;
    }

    case 'melee': {
      // Update durability after melee hits
      const meleeHits = value as number;

      if (meleeHits <= 0) return;

      const durabilityLoss = (durabilityDrain || 1) * meleeHits;
      weapon.durability = Math.max(0, (weapon.durability || 100) - durabilityLoss);

      weapon.move(inventory, weapon.anchorSlot);
      emitNet('ox_inventory:updateCurrentWeapon', playerId, weapon);
      return true;
    }

    case 'throw': {
      // Remove throwable weapon after throwing
      const throwSlot = slot ?? inventory.currentWeapon;

      if (throwSlot === undefined) return;

      const throwable = GetInventoryItem(throwSlot);

      if (!throwable) return;

      inventory.removeItem({ name: throwable.name, quantity: 1 });
      inventory.currentWeapon = undefined;
      return true;
    }

    case 'component': {
      // Handle weapon component add/remove
      const componentValue = value;

      if (typeof componentValue === 'object' && componentValue.slot !== undefined && componentValue.component) {
        // Remove component from weapon
        const weaponItem = GetInventoryItem(componentValue.slot) as Weapon;

        if (!weaponItem || !weaponItem.components) return;

        const componentIndex = weaponItem.components.indexOf(componentValue.component);

        if (componentIndex === -1) return;

        // Add component back to inventory
        const addSuccess = inventory.addItem({ name: componentValue.component, quantity: 1 });

        if (!addSuccess) return;

        weaponItem.components.splice(componentIndex, 1);
        weaponItem.move(inventory, weaponItem.anchorSlot);

        return true;
      } else if (typeof componentValue === 'number') {
        // Remove component by index
        if (!weapon.components || !weapon.components[componentValue]) return;

        const componentName = weapon.components[componentValue];
        const addSuccess = inventory.addItem({ name: componentName, quantity: 1 });

        if (!addSuccess) return false;

        weapon.components.splice(componentValue, 1);
        weapon.move(inventory, weapon.anchorSlot);

        return true;
      } else if (typeof componentValue === 'string') {
        // Add component to weapon
        const componentSlot = parseInt(componentValue, 10);
        const component = GetInventoryItem(componentSlot);

        if (!component) return false;

        const removeSuccess = inventory.removeItem({ name: component.name, quantity: 1 });

        if (!removeSuccess) return false;

        if (!weapon.components) weapon.components = [];
        weapon.components.push(component.name);
        weapon.move(inventory, weapon.anchorSlot);

        return true;
      }
      return false;
    }

    default:
      return false;
  }
});

// V2-compatible ammo loading handler
onNet('ox_inventory:loadWeaponAmmo', async (newAmmo: number, specialAmmo?: string) => {
  const playerId = source;
  const inventory = await GetInventory(playerId);

  if (!inventory || inventory.currentWeapon === undefined) return;

  const weapon = GetInventoryItem(inventory.currentWeapon) as Weapon;

  if (!weapon || typeof weapon.ammoName !== 'string') return;

  const currentAmmo = weapon.ammoCount || 0;
  const diff = newAmmo - currentAmmo;

  if (diff <= 0) return;

  // Remove ammo from inventory
  const success = inventory.removeItem({
    name: weapon.ammoName,
    quantity: diff,
    ...(specialAmmo ? { type: specialAmmo } : {}),
  });

  if (!success) return;

  weapon.ammoCount = newAmmo;
  if (specialAmmo) (weapon as any).specialAmmo = specialAmmo;

  weapon.move(inventory, weapon.anchorSlot);
  emitNet('ox_inventory:updateCurrentWeapon', playerId, weapon);
});

// Callback to remove ammo from a weapon and add it back to inventory
onClientCallback('ox_inventory:removeAmmoFromWeapon', async (playerId, slot: number) => {
  const inventory = await GetInventory(playerId);

  if (!inventory) return false;

  const weapon = inventory.getItemInSlot(slot) as Weapon;

  if (!weapon || !weapon.ammoName || !weapon.ammoCount || weapon.ammoCount < 1) return false;

  const ammoCount = weapon.ammoCount;
  const specialAmmo = (weapon as any).specialAmmo as string | undefined;

  // Add ammo back to inventory
  const success = inventory.addItem({
    name: weapon.ammoName,
    quantity: ammoCount,
    ...(specialAmmo ? { type: specialAmmo } : {}),
  });

  if (!success) return false;

  // Clear ammo from weapon
  weapon.ammoCount = 0;
  delete (weapon as any).specialAmmo;

  weapon.move(inventory, weapon.anchorSlot);

  return true;
});

exports('getInventory', (id: string) => Inventory.FromId(id));
exports('getInventoryItems', (id: string) => Inventory.FromId(id)?.mapItems());
exports('getInventoryItemIds', (id: string) => Inventory.FromId(id)?.itemIds());
exports('removeInventory', (id: string) => Inventory.FromId(id)?.remove(true));
exports('getItemInSlot', (id: string, slot: number) => Inventory.FromId(id)?.getItemInSlot(slot));
exports('getCurrentWeapon', (id: string) => Inventory.FromId(id)?.currentWeapon);
exports('setInventoryMetadata', (id: string, key: string, value: any) => {
  const inventory = Inventory.FromId(id);

  if (inventory) inventory[key] = value;
});
exports('addItem', (id: string, data: ItemProperties) => Inventory.FromId(id)?.addItem(data));
exports('removeItem', (id: string, data: ItemProperties) => Inventory.FromId(id)?.removeItem(data));
exports('clearInventory', (id: string, keepItems?: number[]) => Inventory.FromId(id)?.clear(keepItems));

// V2 Compatibility - PascalCase aliases for QB-Core/QBX
exports('AddItem', async (id: string | number, itemName: string, count: number, metadata?: Record<string, any>, slot?: number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) {
    console.error(`[ox_inventory] AddItem failed - inventory not found for id: ${invId}`);
    return false;
  }
  const result = await inventory.addItem({ name: itemName, quantity: count, ...metadata });
  return !!result;
});

exports('RemoveItem', (id: string | number, itemName: string, count: number, metadata?: Record<string, any>, slot?: number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;
  return inventory.removeItem({ name: itemName, quantity: count });
});

exports('ClearInventory', (id: string | number, keepItems?: string[]) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;
  inventory.clear();
  return true;
});

exports('doesItemExist', (itemName: string) => !!GetItemClass(itemName));
exports('getItemData', (itemName: string) => GetItemData(itemName));
exports('getItem', (id: number) => GetInventoryItem(id));
exports('setItemMetadata', (id: number, key: string, value: any) => {
  const item = GetInventoryItem(id);

  if (item) item[key] = value;
});

// Bridge exports
exports('hasGroup', (inventoryId: string, group: string | Record<string, number>) => {
  const inventory = Inventory.FromId(inventoryId);
  if (!inventory) return [undefined, undefined];
  return hasGroup(inventory, group);
});

exports('syncInventory', (inventoryId: string) => {
  const inventory = Inventory.FromId(inventoryId);
  if (inventory) syncInventory(inventory);
});

exports('getBridge', () => getBridge());

// ============================================================
// V2 COMPATIBILITY EXPORTS - Full backwards compatibility
// ============================================================

// Inventory alias (v2 used 'Inventory' export)
exports('Inventory', (id: string | number, owner?: string) => {
  if (typeof id === 'number') {
    return Inventory.FromId(`player:${id}`);
  }
  return Inventory.FromId(id);
});

// GetInventoryItems with owner support
exports('GetInventoryItems', (id: string | number, owner?: string) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  return Inventory.FromId(invId)?.mapItems();
});

// Search - search for items in an inventory
exports('Search', (id: string | number, itemName: string | string[], metadata?: Record<string, any>, strict?: boolean) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return [];

  const items = inventory.mapItems();
  const names = Array.isArray(itemName) ? itemName : [itemName];

  return items.filter(item => {
    if (!names.includes(item.name)) return false;
    if (metadata && strict) {
      return Object.entries(metadata).every(([key, value]) => item[key] === value);
    }
    if (metadata) {
      return Object.entries(metadata).some(([key, value]) => item[key] === value);
    }
    return true;
  });
});

// GetItemCount - get total count of an item
exports('GetItemCount', (id: string | number, itemName: string, metadata?: Record<string, any>, strict?: boolean) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return 0;

  return inventory.mapItems().reduce((count, item) => {
    if (item.name !== itemName) return count;
    if (metadata && strict) {
      const matches = Object.entries(metadata).every(([key, value]) => item[key] === value);
      return matches ? count + item.quantity : count;
    }
    if (metadata) {
      const matches = Object.entries(metadata).some(([key, value]) => item[key] === value);
      return matches ? count + item.quantity : count;
    }
    return count + item.quantity;
  }, 0);
});

// GetSlot - get item in a specific slot
exports('GetSlot', (id: string | number, slot: number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  return Inventory.FromId(invId)?.getItemInSlot(slot);
});

// GetSlotWithItem - find first slot containing an item
exports('GetSlotWithItem', (id: string | number, itemName: string, metadata?: Record<string, any>, strict?: boolean) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return null;

  const items = inventory.mapItems();
  for (const item of items) {
    if (item.name !== itemName) continue;
    if (metadata && strict) {
      if (!Object.entries(metadata).every(([key, value]) => item[key] === value)) continue;
    } else if (metadata) {
      if (!Object.entries(metadata).some(([key, value]) => item[key] === value)) continue;
    }
    return item;
  }
  return null;
});

// GetSlotIdWithItem - find first slot number containing an item
exports('GetSlotIdWithItem', (id: string | number, itemName: string, metadata?: Record<string, any>, strict?: boolean) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return null;

  const items = inventory.mapItems();
  for (const item of items) {
    if (item.name !== itemName) continue;
    if (metadata && strict) {
      if (!Object.entries(metadata).every(([key, value]) => item[key] === value)) continue;
    } else if (metadata) {
      if (!Object.entries(metadata).some(([key, value]) => item[key] === value)) continue;
    }
    return item.anchorSlot;
  }
  return null;
});

// GetSlotsWithItem - find all slots containing an item
exports('GetSlotsWithItem', (id: string | number, itemName: string, metadata?: Record<string, any>, strict?: boolean) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return [];

  return inventory.mapItems().filter(item => {
    if (item.name !== itemName) return false;
    if (metadata && strict) {
      return Object.entries(metadata).every(([key, value]) => item[key] === value);
    }
    if (metadata) {
      return Object.entries(metadata).some(([key, value]) => item[key] === value);
    }
    return true;
  });
});

// GetSlotIdsWithItem - find all slot numbers containing an item
exports('GetSlotIdsWithItem', (id: string | number, itemName: string, metadata?: Record<string, any>, strict?: boolean) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return [];

  return inventory.mapItems()
    .filter(item => {
      if (item.name !== itemName) return false;
      if (metadata && strict) {
        return Object.entries(metadata).every(([key, value]) => item[key] === value);
      }
      if (metadata) {
        return Object.entries(metadata).some(([key, value]) => item[key] === value);
      }
      return true;
    })
    .map(item => item.anchorSlot);
});

// GetEmptySlot - find first empty slot
exports('GetEmptySlot', (id: string | number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return -1;

  const totalSlots = inventory.width * inventory.height;
  for (let i = 0; i < totalSlots; i++) {
    if (!inventory.items[i]) return i;
  }
  return -1;
});

// CanCarryItem - check if inventory can carry an item
exports('CanCarryItem', (id: string | number, itemName: string, count?: number, metadata?: Record<string, any>) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;

  const itemData = GetItemData(itemName);
  if (!itemData) return false;

  const mockItem = {
    name: itemName,
    width: itemData.width || 1,
    height: itemData.height || 1,
    weight: itemData.weight || 0,
    quantity: count || 1,
    stackSize: itemData.stackSize || 1,
    ...metadata,
  };

  return !!inventory.canHoldItem(mockItem as any, -1, count);
});

// CanCarryAmount - check if inventory can carry a specific amount
exports('CanCarryAmount', (id: string | number, itemName: string, count: number, metadata?: Record<string, any>) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;

  const itemData = GetItemData(itemName);
  if (!itemData) return false;

  const mockItem = {
    name: itemName,
    width: itemData.width || 1,
    height: itemData.height || 1,
    weight: itemData.weight || 0,
    quantity: count,
    stackSize: itemData.stackSize || 1,
    ...metadata,
  };

  return !!inventory.canHoldItem(mockItem as any, -1, count);
});

// CanCarryWeight - check if inventory can carry additional weight
exports('CanCarryWeight', (id: string | number, weight: number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;

  return (inventory.weight + weight) <= inventory.maxWeight;
});

// SetDurability - set item durability
exports('SetDurability', (id: string | number, slot: number, durability: number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;

  const item = inventory.getItemInSlot(slot);
  if (!item) return false;

  item.durability = durability;
  return true;
});

// SetMetadata - set item metadata
exports('SetMetadata', (id: string | number, slot: number, metadata: Record<string, any>) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;

  const item = inventory.getItemInSlot(slot);
  if (!item) return false;

  Object.assign(item, metadata);
  return true;
});

// SetSlotCount - update item count in a slot
exports('SetSlotCount', (id: string | number, slot: number, count: number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;

  const item = inventory.getItemInSlot(slot);
  if (!item) return false;

  if (count <= 0) {
    item.delete();
  } else {
    item.quantity = count;
  }
  return true;
});

// SetMaxWeight - set max weight for an inventory
exports('SetMaxWeight', (id: string | number, maxWeight: number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;

  inventory.maxWeight = maxWeight;
  return true;
});

// SwapSlots - swap items between slots
exports('SwapSlots', (id: string | number, fromSlot: number, toSlot: number, count?: number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;

  const fromItem = inventory.getItemInSlot(fromSlot);
  if (!fromItem) return false;

  const toItem = inventory.getItemInSlot(toSlot);

  // Simple swap - move fromItem to toSlot
  fromItem.move(inventory, toSlot);

  // If there was an item in toSlot, move it to fromSlot
  if (toItem && toItem.uniqueId !== fromItem.uniqueId) {
    toItem.move(inventory, fromSlot);
  }

  return true;
});

// SetItem - set item count (add or remove as needed)
exports('SetItem', (id: string | number, itemName: string, count: number, metadata?: Record<string, any>) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return false;

  const currentCount = inventory.getItemCount({ name: itemName });
  const diff = count - currentCount;

  if (diff > 0) {
    return inventory.addItem({ name: itemName, quantity: diff, ...metadata });
  } else if (diff < 0) {
    return inventory.removeItem({ name: itemName, quantity: Math.abs(diff) });
  }

  return true;
});

// ConfiscateInventory - confiscate player's inventory
exports('ConfiscateInventory', async (playerId: number) => {
  const inventory = Inventory.FromId(`player:${playerId}`);
  if (!inventory) return false;

  return inventory.confiscate();
});

// ReturnInventory - return confiscated inventory
exports('ReturnInventory', async (playerId: number) => {
  const inventory = Inventory.FromId(`player:${playerId}`);
  if (!inventory) return false;

  return inventory.returnConfiscated();
});

// forceOpenInventory - force open an inventory for a player
exports('forceOpenInventory', async (playerId: number, invType: string, data: string | number | Record<string, any>) => {
  let inventoryId: string;

  if (typeof data === 'string') {
    inventoryId = data;
  } else if (typeof data === 'number') {
    inventoryId = `${invType}:${data}`;
  } else {
    inventoryId = data.id || `${invType}:${Date.now()}`;
  }

  const inventory = await GetInventory(inventoryId);
  if (!inventory) return false;

  inventory.open(playerId);
  return inventoryId;
});

// CreateTemporaryStash - create a temporary stash
exports('CreateTemporaryStash', (stashId: string, label: string, slots: number, maxWeight: number, owner?: string, groups?: Record<string, number>) => {
  const inventory = new Inventory({
    inventoryId: `stash:${stashId}`,
    type: 'stash',
    label: label,
    width: Math.min(slots, 8),
    height: Math.ceil(slots / 8),
    maxWeight: maxWeight,
    ownerId: owner,
    groups: groups,
    isTemporary: true,
  });

  return inventory;
});

// UpdateVehicle - update vehicle plate references
exports('UpdateVehicle', (oldPlate: string, newPlate: string) => {
  // Update trunk inventory
  const trunkOld = Inventory.FromId(`trunk:${oldPlate}`);
  if (trunkOld) {
    const items = trunkOld.mapItems();
    trunkOld.remove(false);

    const trunkNew = new Inventory({
      inventoryId: `trunk:${newPlate}`,
      type: 'trunk',
      label: `Trunk - ${newPlate}`,
      width: trunkOld.width,
      height: trunkOld.height,
      maxWeight: trunkOld.maxWeight,
    });

    for (const item of items) {
      item.move(trunkNew, item.anchorSlot);
    }
  }

  // Update glovebox inventory
  const gloveboxOld = Inventory.FromId(`glovebox:${oldPlate}`);
  if (gloveboxOld) {
    const items = gloveboxOld.mapItems();
    gloveboxOld.remove(false);

    const gloveboxNew = new Inventory({
      inventoryId: `glovebox:${newPlate}`,
      type: 'glovebox',
      label: `Glovebox - ${newPlate}`,
      width: gloveboxOld.width,
      height: gloveboxOld.height,
      maxWeight: gloveboxOld.maxWeight,
    });

    for (const item of items) {
      item.move(gloveboxNew, item.anchorSlot);
    }
  }

  return true;
});

// InspectInventory - open inventory in view mode for admin
exports('InspectInventory', (playerId: number, inventoryId: string) => {
  const inventory = Inventory.FromId(inventoryId);
  if (!inventory) return false;

  inventory.view(playerId);
  return true;
});

// Items / ItemList - get item data
exports('Items', (itemName?: string) => {
  if (itemName) return GetItemData(itemName);
  // Return all items - would need access to the items registry
  return {};
});

exports('ItemList', (itemName?: string) => {
  if (itemName) return GetItemData(itemName);
  return {};
});

// GetContainerFromSlot - get container inventory from a slot
exports('GetContainerFromSlot', (id: string | number, slotId: number) => {
  const invId = typeof id === 'number' ? `player:${id}` : id;
  const inventory = Inventory.FromId(invId);
  if (!inventory) return null;

  const item = inventory.getItemInSlot(slotId);
  if (!item || (item.category !== 'container' && item.category !== 'vest')) return null;

  return Inventory.FromId(`container:${item.uniqueId}`);
});

// setPlayerInventory - initialize player inventory (for bridge)
exports('setPlayerInventory', async (player: { source: number; identifier: string; name: string }, data?: any) => {
  const bridge = getBridge();
  return bridge.setPlayerInventory(player);
});

// SaveInventories / SaveAllInventories - save all inventories
exports('SaveInventories', (lock?: boolean) => Inventory.SaveAllInventories(lock));
exports('SaveAllInventories', (lock?: boolean) => Inventory.SaveAllInventories(lock));

// ============================================================
// PLATE CARRIER / KEVLAR SYSTEM
// ============================================================

interface PlateData {
  itemName: string;
  health: number;
}

// Config for kevlar system
const KEVLAR_CONFIG = {
  syncPlatesEveryHit: true,
  useBrokenPlates: true,
  brokenPlateItem: 'brokenplate',
};

// Plate carrier item names (now they are containers)
const PLATE_CARRIER_NAMES = ['heavypc', 'lightpc', 'crim_heavypc', 'crim_lightpc'];

// Plate armor values
const PLATE_VALUES: Record<string, number> = {
  heavyplate: 50,
  lightplate: 25,
  brokenplate: 0,
};

// Get plates from a plate carrier container (uses container inventory)
onClientCallback('ox_inventory:getCarrierPlates', async (playerId, itemId: number) => {
  // Get the container inventory for this plate carrier
  const containerId = `container:${itemId}`;
  const containerInv = Inventory.FromId(containerId) || await GetInventory(containerId);

  if (!containerInv) return [];

  // Get all plate items in the container and calculate their armor values
  const plates: PlateData[] = [];
  const items = containerInv.mapItems();

  for (const item of items) {
    if (PLATE_VALUES[item.name] !== undefined) {
      // Get health from metadata or use default armor value
      const health = (item.metadata as any)?.health ?? PLATE_VALUES[item.name];
      plates.push({
        itemName: item.name,
        health: health,
      });
    }
  }

  return plates;
});

// Open vest container to manage plates (opens the container inventory)
onNet('ox_inventory:openVestStash', async (slot: number) => {
  const playerId = source;
  const inventory = await GetInventory(playerId);
  if (!inventory) return;

  const item = inventory.getItemInSlot(slot);
  if (!item || !PLATE_CARRIER_NAMES.includes(item.name)) return;

  // Open the container inventory for this plate carrier
  const containerId = `container:${item.uniqueId}`;
  const containerInv = await GetInventory(containerId);

  if (containerInv) {
    containerInv.open(playerId);
  }
});

// Sync armor damage from client - updates plate health in container
onNet('ox_inventory:syncArmor', async (itemName: string, carrierId: string, plates: PlateData[]) => {
  const playerId = source;
  const itemId = parseInt(carrierId, 10);

  if (isNaN(itemId)) return;

  // Get the container inventory for this plate carrier
  const containerId = `container:${itemId}`;
  const containerInv = Inventory.FromId(containerId);

  if (!containerInv) return;

  // Get all plate items in the container
  const containerItems = containerInv.mapItems();

  // Update plate health based on the plates data from client
  for (let i = 0; i < plates.length && i < containerItems.length; i++) {
    const plateData = plates[i];
    const plateItem = containerItems[i];

    if (PLATE_VALUES[plateItem.name] !== undefined) {
      if (plateData.health <= 0) {
        // Plate is broken - either replace with broken plate or remove
        if (KEVLAR_CONFIG.useBrokenPlates && plateItem.name !== KEVLAR_CONFIG.brokenPlateItem) {
          // Remove the plate and add a broken plate
          containerInv.removeItem({ name: plateItem.name, quantity: 1 });
          containerInv.addItem({ name: KEVLAR_CONFIG.brokenPlateItem, quantity: 1 });
        } else if (!KEVLAR_CONFIG.useBrokenPlates) {
          // Just remove the plate
          containerInv.removeItem({ name: plateItem.name, quantity: 1 });
        }
      } else {
        // Update the plate health in metadata
        if (!plateItem.metadata) plateItem.metadata = {};
        (plateItem.metadata as any).health = plateData.health;
        plateItem.move(containerInv, plateItem.anchorSlot);
      }
    }
  }
});

// Handle vest being dropped/moved out of player inventory
TriggerEventHooks('moveItem', {
  filter: (data) => PLATE_CARRIER_NAMES.includes(data.item?.name) && data.inventoryType === 'player' && data.toInventoryType !== 'player',
  after: (data) => {
    // Notify client that vest was dropped so they reset armor
    emitNet('ox_inventory:droppedVest', data.playerId, { carrierId: data.item.uniqueId });
  },
});

// Display plate health in item tooltip
exports('displayMetadata', (key: string, label: string) => {
  // This would need UI integration - for now just log
  console.log(`[ox_inventory] Registered metadata display: ${key} = ${label}`);
});

// ============================================================
// MONEY API - For QBX/Framework Integration
// These exports allow frameworks to get/set money through ox_inventory
// ============================================================

/**
 * Helper to get player inventory by source ID
 * Looks up citizenid from QBX and uses that for inventory lookup
 */
function getPlayerInventoryBySource(playerId: number): typeof Inventory.prototype | undefined {
  // Try to get QBX player to find citizenid
  try {
    if (GetResourceState('qbx_core') === 'started') {
      const player = exports.qbx_core.GetPlayer(playerId);
      if (player?.PlayerData?.citizenid) {
        const inv = Inventory.FromId(`player:${player.PlayerData.citizenid}`);
        if (inv) return inv;
      }
    }
  } catch {}

  // Fallback: search all inventories for one with this playerId
  const inventories = Inventory.GetInventories(playerId);
  for (const inv of inventories) {
    if (inv.playerId === playerId && inv.type === 'player') {
      return inv;
    }
  }

  // Last resort: try direct lookup (legacy format)
  return Inventory.FromId(`player:${playerId}`);
}

/**
 * Get player's money (cash) from inventory
 * @param playerId - Server player ID
 * @returns number - Amount of money item in inventory
 */
exports('GetMoney', (playerId: number, moneyType?: string) => {
  const inventory = getPlayerInventoryBySource(playerId);
  if (!inventory) {
    console.log(`^1[ox_inventory:GetMoney] No inventory found for player:${playerId}^0`);
    return 0;
  }

  // Map framework money types to inventory item names
  const itemName = moneyType === 'cash' ? 'money' : (moneyType || 'money');
  const count = inventory.getItemCount({ name: itemName });

  // Debug: list all items in inventory
  const items = inventory.mapItems();
  console.log(`^3[ox_inventory:GetMoney] ${inventory.inventoryId} ${itemName} = ${count}, total items: ${items.length}^0`);
  for (const item of items) {
    console.log(`^3[ox_inventory:GetMoney]   - ${item.name} x${item.quantity} (slot ${item.anchorSlot})^0`);
  }

  return count;
});

/**
 * Set player's money in inventory (replaces existing amount)
 * @param playerId - Server player ID
 * @param amount - Amount to set
 * @param moneyType - 'cash', 'bank', or item name (default: 'cash')
 */
exports('SetMoney', async (playerId: number, moneyType: string, amount: number) => {
  const inventory = getPlayerInventoryBySource(playerId);
  if (!inventory) return false;

  // Map framework money types to inventory item names
  const itemName = moneyType === 'cash' ? 'money' : moneyType;
  const currentAmount = inventory.getItemCount({ name: itemName });
  const diff = amount - currentAmount;

  if (diff > 0) {
    return !!inventory.addItem({ name: itemName, quantity: diff });
  } else if (diff < 0) {
    return inventory.removeItem({ name: itemName, quantity: Math.abs(diff) });
  }
  return true;
});

/**
 * Add money to player's inventory
 * @param playerId - Server player ID
 * @param moneyType - 'cash', 'bank', or item name
 * @param amount - Amount to add
 */
exports('AddMoney', async (playerId: number, moneyType: string, amount: number) => {
  const inventory = getPlayerInventoryBySource(playerId);
  if (!inventory || amount <= 0) return false;

  const itemName = moneyType === 'cash' ? 'money' : moneyType;
  return !!inventory.addItem({ name: itemName, quantity: amount });
});

/**
 * Remove money from player's inventory
 * @param playerId - Server player ID
 * @param moneyType - 'cash', 'bank', or item name
 * @param amount - Amount to remove
 */
exports('RemoveMoney', (playerId: number, moneyType: string, amount: number) => {
  const inventory = getPlayerInventoryBySource(playerId);
  if (!inventory || amount <= 0) return false;

  const itemName = moneyType === 'cash' ? 'money' : moneyType;
  return inventory.removeItem({ name: itemName, quantity: amount });
});

/**
 * Get all player money types
 * @param playerId - Server player ID
 * @returns Object with cash, bank, and other money types
 */
exports('GetPlayerMoney', (playerId: number) => {
  const inventory = getPlayerInventoryBySource(playerId);
  if (!inventory) return { cash: 0, bank: 0, crypto: 0 };

  return {
    cash: inventory.getItemCount({ name: 'money' }),
    bank: inventory.getItemCount({ name: 'bank' }),
    crypto: inventory.getItemCount({ name: 'crypto' }),
  };
});
