import { BaseItem, GetItemData, type InventoryItem, ItemFactory, type ItemProperties } from '@common/item';
import { LoadJsonFile } from '@common/utils';
import db from '../db';
import { Inventory } from '../inventory/class';

// Store drop models for all items (weapons use their model, items can specify dropModel)
export const DropModels: Record<string, string> = {};

// Extended item properties with dropModel support
type ItemPropertiesWithDrop = ItemProperties & {
  dropModel?: string;
};

// Load regular items
Object.entries(LoadJsonFile<Record<string, ItemPropertiesWithDrop>>('data/items.json')).forEach(([name, data]) => {
  const itemName = name.toLowerCase();

  // Store the drop model if specified
  if (data.dropModel) {
    DropModels[itemName] = data.dropModel;
  }

  CreateItemClass({ ...data, name: itemName });
});

// Load weapons, components, and ammo from weapons.json
// Works exactly like items.json - just spread the data and add the name
type WeaponJsonData = ItemPropertiesWithDrop & {
  model?: string;
  throwable?: boolean;
  ammoname?: string;  // lowercase in JSON, converted to ammoName
  durability?: number;
  damage?: number;    // Damage multiplier (1.0 = normal, 0.5 = half damage, 2.0 = double damage)
};

interface WeaponsData {
  Weapons: Record<string, WeaponJsonData>;
  Components: Record<string, ItemPropertiesWithDrop>;
  Ammo: Record<string, ItemPropertiesWithDrop>;
}

const weaponsData = LoadJsonFile<WeaponsData>('data/weapons.json');

// Helper to determine weapon grid size based on weapon name/type (if not specified in JSON)
function getWeaponSize(name: string, data: { width?: number; height?: number; throwable?: boolean }): { width: number; height: number } {
  // If explicitly set in JSON, use those values
  if (data.width && data.height) {
    return { width: data.width, height: data.height };
  }

  const upperName = name.toUpperCase();

  // Throwables - 1x1
  if (data.throwable) {
    return { width: 1, height: 1 };
  }

  // Heavy weapons (miniguns, RPGs, launchers) - 5x2
  if (upperName.includes('MINIGUN') || upperName.includes('RPG') || upperName.includes('HOMING') ||
      upperName.includes('RAILGUN') || upperName.includes('GRENADELAUNCHER')) {
    return { width: 5, height: 2 };
  }

  // Rifles and Shotguns - 4x2
  if (upperName.includes('RIFLE') || upperName.includes('SHOTGUN') || upperName.includes('CARBINE') ||
      upperName.includes('MUSKET') || upperName.includes('MG') || upperName.includes('SNIPER')) {
    return { width: 4, height: 2 };
  }

  // SMGs - 3x2
  if (upperName.includes('SMG') || upperName.includes('PDW') || upperName.includes('GUSENBERG')) {
    return { width: 3, height: 2 };
  }

  // Pistols - 2x1
  if (upperName.includes('PISTOL') || upperName.includes('REVOLVER') || upperName.includes('FLAREGUN') ||
      upperName.includes('STUNGUN') || upperName.includes('RAYPISTOL') || upperName.includes('DOUBLEACTION') ||
      upperName.includes('NAVYREVOLVER')) {
    return { width: 2, height: 1 };
  }

  // Melee weapons - 2x1 for small, 3x1 for medium
  if (upperName.includes('KNIFE') || upperName.includes('SWITCHBLADE') || upperName.includes('DAGGER') ||
      upperName.includes('BOTTLE') || upperName.includes('KNUCKLE') || upperName.includes('FLASHLIGHT')) {
    return { width: 2, height: 1 };
  }

  if (upperName.includes('BAT') || upperName.includes('CROWBAR') || upperName.includes('HAMMER') ||
      upperName.includes('WRENCH') || upperName.includes('POOLCUE') || upperName.includes('GOLFCLUB') ||
      upperName.includes('NIGHTSTICK') || upperName.includes('MACHETE') || upperName.includes('HATCHET') ||
      upperName.includes('BATTLEAXE')) {
    return { width: 3, height: 1 };
  }

  // Default for unknown weapons - 2x1
  return { width: 2, height: 1 };
}

// Register weapons - same pattern as items.json, but with auto grid size and category
Object.entries(weaponsData.Weapons).forEach(([name, data]) => {
  const itemName = name.toLowerCase();

  // Store the weapon model for drops
  if (data.model) {
    DropModels[itemName] = data.model;
  }
  if (data.dropModel) {
    DropModels[itemName] = data.dropModel;
  }

  // Get weapon size (uses JSON values if set, otherwise auto-calculates)
  const { width, height } = getWeaponSize(name, data);

  // Set category based on throwable flag (needed for icon logic)
  const category = data.throwable ? 'throwable' : 'weapon';

  // Convert ammoname (lowercase from JSON) to ammoName (camelCase for TypeScript)
  // Also compute the weapon hash from the uppercase weapon name
  const ammoName = data.ammoname;
  const hash = GetHashKey(name.toUpperCase());

  // Spread the data, but override ammoname with ammoName and add hash
  const { ammoname: _, ...restData } = data;
  CreateItemClass({ ...restData, name: itemName, width, height, category, ammoName, hash });
});

// Register weapon components/attachments - same pattern as items.json
Object.entries(weaponsData.Components).forEach(([name, data]) => {
  const itemName = name.toLowerCase();

  if (data.dropModel) {
    DropModels[itemName] = data.dropModel;
  }

  CreateItemClass({ ...data, name: itemName });
});

// Register ammo types - same pattern as items.json, with category 'ammo'
Object.entries(weaponsData.Ammo).forEach(([name, data]) => {
  const itemName = name.toLowerCase();

  if (data.dropModel) {
    DropModels[itemName] = data.dropModel;
  }

  CreateItemClass({ ...data, name: itemName, category: 'ammo' });
});

// Keep WeaponModels as alias for backwards compatibility
export const WeaponModels = DropModels;

const itemMove = BaseItem.prototype.move;
const itemSplit = BaseItem.prototype.split;
const itemDelete = BaseItem.prototype.delete;

BaseItem.CreateUniqueId = (item: InventoryItem): number => db.updateInventoryItem(item);

BaseItem.prototype.move = function (inventory: Inventory) {
  if (!this.uniqueId) {
    db.updateInventoryItem(this);
    this.cache();
  }

  const currentInventory = Inventory.FromId(this.inventoryId);
  const targetInventory = Inventory.FromId(inventory.inventoryId);
  const originalQuantity = this.quantity;

  const success = itemMove.apply(this, arguments) as ReturnType<typeof itemMove>;

  if (success) {
    // Check if item was merged (deleted during move - quantity went to 0)
    const wasMerged = originalQuantity > 0 && this.quantity === 0;

    db.updateInventoryItem(this);
    currentInventory.emit('ox_inventory:updateItem', this);
    currentInventory.invalidateCache();

    // Only emit to target inventory if item wasn't merged
    // When merged, the inner existingItem.move() already emitted the updated target item
    // Emitting the deleted source item to target would corrupt the data
    if (currentInventory !== targetInventory && !wasMerged) {
      targetInventory.emit('ox_inventory:updateItem', this);
      targetInventory.invalidateCache();
    } else if (wasMerged) {
      // Still need to invalidate cache even if not emitting
      targetInventory.invalidateCache();
    }
  }

  return success;
};

BaseItem.prototype.split = function (inventory: Inventory) {
  const currentInventory = Inventory.FromId(this.inventoryId);
  const targetInventory = Inventory.FromId(inventory.inventoryId);
  const newItem = itemSplit.apply(this, arguments) as ReturnType<typeof itemSplit>;

  if (newItem) {
    db.updateInventoryItem(this);
    db.updateInventoryItem(newItem);
    newItem.cache();
    currentInventory.emit('ox_inventory:updateItem', this, newItem);
    currentInventory.invalidateCache();

    if (currentInventory !== targetInventory) {
      targetInventory.emit('ox_inventory:updateItem', this, newItem);
      targetInventory.invalidateCache();
    }
  }

  return newItem;
};

BaseItem.prototype.delete = function () {
  const currentInventory = Inventory.FromId(this.inventoryId);

  itemDelete.apply(this);
  db.updateInventoryItem(this);

  currentInventory.emit('ox_inventory:updateItem', this);
  currentInventory.invalidateCache();
};

function CreateItemClass(data: ItemProperties) {
  const Item = ItemFactory(data);

  if (!Item) return;

  // Set the icon before storing in GlobalState so clients receive it
  if (!Item.properties.icon) {
    const category = Item.properties.category;
    const isWeaponOrThrowable = category === 'weapon' || category === 'throwable';
    let imageName: string;

    if (isWeaponOrThrowable) {
      // Weapon items are stored as weapon_pistol, weapon_smg, etc.
      // Images are named WEAPON_PISTOL.png (keep original uppercase naming for weapons)
      // Strip all 'weapon_' prefixes and reconstruct with a single WEAPON_
      let cleanName = Item.name.toLowerCase();
      while (cleanName.startsWith('weapon_')) {
        cleanName = cleanName.slice(7);  // Remove 'weapon_' (7 chars)
      }
      imageName = 'WEAPON_' + cleanName.toUpperCase() + '.png';
    } else {
      // Regular items use lowercase: bandage.png, ammo-9.png
      imageName = `${Item.name}.png`;
    }

    Item.properties.icon = `nui://ox_inventory/web/images/${imageName}`;
  }

  GlobalState.set(`Item:${Item.name.toLowerCase()}`, Item.properties, true);

  return Item;
}

export function GetItemClass(name: string) {
  return GetItemData(name) ?? CreateItemClass(db.getItem(name));
}

export function CreateItem(data: ItemProperties) {
  const Item = GetItemClass(data.name);

  if (!Item) throw new Error(`Attempted to create invalid item ${data.name}`);

  if (!data.uniqueId) db.updateInventoryItem(data);

  const item = new Item(data);
  const inventory = Inventory.FromId(data.inventoryId);

  console.log(`^3[ox_inventory:CreateItem] ${data.name} x${data.quantity || 1} - uniqueId=${data.uniqueId}, inventoryId=${data.inventoryId}, anchorSlot=${data.anchorSlot}, inventoryFound=${!!inventory}^0`);

  if (inventory) {
    // For items loaded from database that already have valid slot data,
    // directly set up slot references without going through move() validation
    // This prevents issues where move() tries to removeFromInventory first
    if (data.uniqueId && data.anchorSlot !== undefined) {
      // Item is being loaded from database - directly assign slots
      const slots = inventory.getItemSlots(item);
      console.log(`^3[ox_inventory:CreateItem]   -> Loaded from DB, setting slot refs: ${slots.join(', ')}^0`);
      if (slots.length) {
        inventory.setSlotRefs(slots, item.uniqueId);
      }
    } else {
      // New item - use move() to find a valid slot
      console.log(`^3[ox_inventory:CreateItem]   -> New item, using move()^0`);
      item.move(inventory, item.anchorSlot);
    }
  } else {
    console.log(`^1[ox_inventory:CreateItem]   -> WARNING: No inventory found for ${data.inventoryId}!^0`);
  }

  return item;
}
