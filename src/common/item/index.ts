import Config from '@common/config';
import { BaseInventory } from '@common/inventory/class';
import fetch from 'sync-fetch';
import { resourceContext, resourceName } from '..';

export type BaseItemProperties = ClassProperties<BaseItem>;

// Client-side item use properties (similar to v2)
export interface ItemClientProperties {
  /** Status effects to apply (e.g., { hunger: 200000, thirst: 100000 }) */
  status?: Record<string, number>;
  /** Animation to play while using */
  anim?: string | { dict: string; clip: string };
  /** Prop to attach while using */
  prop?: string | { model: string; pos?: [number, number, number]; rot?: [number, number, number] };
  /** Time to use item in ms (shows progress bar) */
  usetime?: number;
  /** Notification to show after use */
  notification?: string;
  /** Export to call: 'resource.functionName' */
  export?: string;
  /** Event to trigger */
  event?: string;
  /** Custom image path */
  image?: string;
  /** Whether item can be cancelled during use */
  cancel?: boolean;
  /** Whether item can be used while dead */
  useWhileDead?: boolean;
  /** Disable controls while using */
  disable?: { move?: boolean; combat?: boolean; car?: boolean };
}

// Context menu button definition for items
export interface ItemContextButton {
  /** Unique identifier for the button action */
  buttonId: string;
  /** Display label for the button */
  label: string;
  /** Iconify icon name (e.g., 'hugeicons:box-01') */
  icon?: string;
  /**
   * Action type:
   * - 'open': Opens the item as a container
   * - 'event': Triggers a client event (uses eventName)
   * - 'export': Calls an export (uses exportName)
   */
  action?: 'open' | 'event' | 'export';
  /** For 'export' action: the export to call (e.g., 'ox_inventory.managePlates') */
  exportName?: string;
  /** For 'event' action: the event name to trigger */
  eventName?: string;
}

export interface WeaponProperties extends BaseItemProperties {
  category: 'weapon';
  ammoName: string;
  ammoCount: number;
  hash: number;
  tint?: number;
  components?: string[];
  damage?: number;    // Damage multiplier (1.0 = normal, 0.5 = half damage, 2.0 = double damage)
  firemode?: string;  // Default firemode for the weapon ('auto', 'semi', 'safety')
}

export interface WeaponAttachmentProperties extends BaseItemProperties {
  category: 'weapon_attachment';
  components: string[];
}

export type ItemProperties = {
  name: string;
} & (Partial<BaseItemProperties> | WeaponProperties | WeaponAttachmentProperties);

export type Item = ReturnType<typeof ItemFactory>;
export type InventoryItem = InstanceType<Item>;
export type Weapon = InventoryItem & WeaponProperties;
export type Clothing = InventoryItem & {
  componentId: number;
  collection: string;
  drawableId: number;
  textureId: number;
  palleteId?: number;
};

const Items: Record<string, Item> = {};
const InventoryItems: Record<string, InventoryItem> = {};

const excludeKeysForComparison: Record<string, true> = {
  uniqueId: true,
  quantity: true,
  anchorSlot: true,
  inventoryId: true,
};

export function GetItemData(name: string) {
  if (!name) return undefined;

  const item = Items[name.toLowerCase()];

  if (item && !item.properties.icon) {
    // Use flat PNG structure (v2 style images in web/images/)
    // Weapons and throwables: weapon_pistol -> WEAPON_PISTOL.png
    // Other items: bandage -> bandage.png
    const category = item.properties.category;
    const isWeaponOrThrowable = category === 'weapon' || category === 'throwable';
    let imageName: string;

    if (isWeaponOrThrowable) {
      // Weapon items are stored as weapon_pistol, weapon_smg, etc.
      // Images are named WEAPON_PISTOL.png, WEAPON_SMG.png, etc.
      // Strip all 'weapon_' prefixes and reconstruct with a single WEAPON_
      let cleanName = item.name.toLowerCase();
      while (cleanName.startsWith('weapon_')) {
        cleanName = cleanName.slice(7);  // Remove 'weapon_' (7 chars)
      }
      imageName = 'WEAPON_' + cleanName.toUpperCase() + '.png';
    } else {
      imageName = `${item.name}.png`;
    }

    item.properties.icon = `nui://${resourceName}/web/images/${imageName}`;
  }

  return item;
}

export function GetInventoryItem(uniqueId: number) {
  return InventoryItems[uniqueId];
}

function clamp(n = Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  return !n && n !== 0 ? max : Math.min(Math.max(n, 0), max);
}

const itemProxy: ProxyHandler<BaseItem> = {
  get: (target, prop: string) => {
    const value = target[prop];
    return value == null ? (target.constructor as Item).properties[prop] : value;
  },
};

export abstract class BaseItem {
  /** A unique name to identify the item type and inherit data. */
  readonly name: string;

  /** The number of items stored in the stack. */
  public quantity: number;

  /** The item's type, defaulting to miscellaneous. */
  public category: 'ammo' | 'weapon' | 'weapon_attachment' | 'throwable' | 'clothing' | 'miscellaneous' | 'container' | 'bag';

  /** A unique identifier used to reference the item and save it in the database. */
  public uniqueId?: number;

  /** The inventoryId of the inventory which holds this item. */
  public inventoryId?: string;

  /** The slotId for the top-left of the item. */
  public anchorSlot?: number;

  public icon?: string;
  public value?: number;
  public label?: string;
  public weight?: number;
  public rarity?: string;
  public decay?: boolean;
  public degrade?: number;
  public tradeable?: boolean;
  public itemLimit?: number;
  public stackSize?: number;
  public description?: string;
  public durability?: number;
  public rotate?: boolean;
  public ammoName?: string;
  public ammoCount?: number;
  public hash?: number;
  public components?: string[];
  public metadataWeight?: number;

  /** How much of the item to consume on use (0 = don't consume, 1 = consume 1, 0.5 = consume half) */
  public consume?: number;

  /** Client-side item use properties */
  public client?: ItemClientProperties;

  /** Whether to close inventory on use */
  public close?: boolean;

  /** Custom context menu buttons for this item */
  public contextButtons?: ItemContextButton[];

  static [key: string]: any;
  [key: string]: any;

  static CreateUniqueId(item: BaseItem): number {
    // Temporary value used in the browser only.
    return (item.uniqueId = -Math.floor(Date.now() / 1000));
  }

  constructor() {
    // biome-ignore lint/correctness/noConstructorReturn: <explanation>
    return new Proxy(this, itemProxy);
  }

  get width(): number {
    const properties = (this.constructor as Item).properties;
    return (Config.Inventory_MultiSlotItems && (this.rotate ? properties.height : properties.width)) || 1;
  }

  get height(): number {
    const properties = (this.constructor as Item).properties;
    return (Config.Inventory_MultiSlotItems && (this.rotate ? properties.width : properties.height)) || 1;
  }

  private addToInventory(inventory: BaseInventory, slots: number[]) {
    // Guard against empty or invalid slots array
    if (!slots || !slots.length || slots[0] === undefined) {
      return false;
    }

    inventory.setSlotRefs(slots, this.uniqueId);

    this.anchorSlot = slots[0];
    this.inventoryId = inventory.inventoryId;

    return true;
  }

  private removeFromInventory(inventory: BaseInventory) {
    if (!inventory || this.inventoryId !== inventory.inventoryId) return false;

    // Use getItemSlots instead of getSlotsForItem to avoid overlap check issues
    // We just need to know which slots this item occupies, not validate placement
    const slots = inventory.getItemSlots(this);

    if (slots.length) {
      inventory.setSlotRefs(slots);
      delete this.anchorSlot;
      delete this.inventoryId;
    }

    return slots.length ? slots : false;
  }

  private swapItems(
    fromInventory: BaseInventory,
    toInventory: BaseInventory,
    toItem: InventoryItem,
    targetSlot: number,
  ) {
    const originalSlot = this.anchorSlot;

    // Guard against items without valid slots
    if (originalSlot === undefined || toItem.anchorSlot === undefined) {
      return false;
    }

    const currentSlots = fromInventory.getItemSlots(this);
    const targetItemSlots = toInventory.getItemSlots(toItem);

    // Guard against empty slot arrays
    if (!currentSlots.length || !targetItemSlots.length) {
      return false;
    }

    // Temporarily remove both items to check if swap is possible
    this.removeFromInventory(fromInventory);
    toItem.removeFromInventory(toInventory);

    // Check if the dragged item can fit at the target slot
    const newTargetSlots = toInventory.canHoldItem(this, targetSlot);

    // Check if the target item can fit at the original slot
    const newItemSlots = fromInventory.canHoldItem(toItem, originalSlot);

    if (!newItemSlots || !newTargetSlots) {
      // Swap not possible - restore both items to original positions
      this.addToInventory(fromInventory, currentSlots);
      toItem.addToInventory(toInventory, targetItemSlots);
      return false;
    }

    // Swap successful - place items in their new positions
    this.addToInventory(toInventory, newTargetSlots);
    toItem.addToInventory(fromInventory, newItemSlots);

    return true;
  }

  public toJSON() {
    const obj = {} as this;

    for (const key in this) {
      if (this[key] != null) obj[key] = this[key];
    }

    return obj;
  }

  public cache() {
    InventoryItems[this.uniqueId] = this;
  }

  public clone(): this {
    const clone = structuredClone(this.toJSON());
    delete clone.uniqueId;
    // @ts-expect-error
    return new this.constructor(clone);
  }

  public delete() {
    this.quantity = 0;

    const inventory = this.inventoryId && BaseInventory.FromId(this.inventoryId);

    if (inventory) {
      this.removeFromInventory(inventory);

      // Safety: Also clear any orphaned slot references to this item
      // This handles cases where anchorSlot might be out of sync
      for (const [slotIdStr, uniqueId] of Object.entries(inventory.items)) {
        if (uniqueId === this.uniqueId) {
          delete inventory.items[parseInt(slotIdStr, 10)];
        }
      }
    }

    delete InventoryItems[this.uniqueId];
  }

  /**
   * Compares the properties of two items and returns `true` if they are similar enough to merge.
   *
   * If strictly matching, both item properties must match exactly; otherwise, missing properties are ignored.
   */
  public match(item: Partial<ItemProperties>, strict = true) {
    if (this.name !== item.name) return false;

    const keysA = Object.keys(this).filter((key) => this[key] !== undefined && !excludeKeysForComparison[key]);
    const keysB = Object.keys(item).filter((key) => item[key] !== undefined && !excludeKeysForComparison[key]);

    if (strict) if (keysA.length !== keysB.length) return false;

    for (const key of keysB) {
      if (this[key] !== item[key]) return false;
    }

    return true;
  }

  public move(inventory: BaseInventory, startSlot?: number, tempRotate?: boolean): boolean {
    startSlot = startSlot ?? inventory.findAvailableSlot(this);
    const existingItem = inventory.getItemInSlot(startSlot);
    const currentInventory = this.inventoryId && BaseInventory.FromId(this.inventoryId);

    // Check if dropping onto another item (potential swap or merge)
    if (existingItem && existingItem !== this && existingItem.anchorSlot === startSlot) {
      const canMerge = this.match(existingItem);

      if (canMerge) {
        // Merge stackable items
        existingItem.quantity += this.quantity;

        this.delete();
        existingItem.move(inventory, existingItem.anchorSlot);

        return true;
      }

      // Cannot swap if item has no current inventory
      if (!currentInventory) return false;

      // Try to swap items (works for any size items as long as they fit)
      return this.swapItems(currentInventory, inventory, existingItem, startSlot);
    }

    if (Config.Debug) console.log(`[move] BEFORE remove - Item ${this.name}: rotate=${this.rotate}, width=${this.width}, height=${this.height}, anchorSlot=${this.anchorSlot}`);
    const currentSlots = currentInventory && this.removeFromInventory(currentInventory);
    if (Config.Debug) console.log(`[move] AFTER remove - currentSlots=${JSON.stringify(currentSlots)}, inventory.items=${JSON.stringify(currentInventory?.items)}`);

    const quantity = existingItem === this ? this.quantity : this.quantity + (existingItem?.quantity ?? 0);

    // Store old rotate value before applying new one
    const oldRotate = this.rotate;
    if (tempRotate !== undefined) {
      this.rotate = tempRotate;
    }

    if (Config.Debug) console.log(`[move] AFTER rotate - Item ${this.name}: rotate=${this.rotate}, oldRotate=${oldRotate}, tempRotate=${tempRotate}, width=${this.width}, height=${this.height}, startSlot=${startSlot}`);

    const slots = inventory.canHoldItem(this, startSlot, quantity);

    if (!slots) {
      if (Config.Debug) console.log(`[move] canHoldItem FAILED for ${this.name} at slot ${startSlot} with dimensions ${this.width}x${this.height} in inventory ${inventory.width}x${inventory.height}`);
      // Restore old rotation state on failure
      if (oldRotate) {
        this.rotate = true;
      } else {
        delete this.rotate;
      }

      if (currentSlots) this.addToInventory(currentInventory, currentSlots);

      return false;
    }

    // Keep the rotation state (clean up undefined)
    this.rotate ? (this.rotate = true) : delete this.rotate;

    return this.addToInventory(inventory, slots);
  }

  public split(
    inventory: BaseInventory,
    quantity: number,
    startSlot?: number,
    tempRotate?: boolean,
  ): InventoryItem | null {
    const existingItem = inventory.getItemInSlot(startSlot);
    const currentInventory = BaseInventory.FromId(this.inventoryId);
    quantity = Math.max(1, Math.ceil(quantity));
    startSlot = startSlot ?? inventory.findAvailableSlot(this);

    if (existingItem?.anchorSlot === startSlot && currentInventory?.inventoryId === inventory.inventoryId) {
      tempRotate ? (this.rotate = true) : delete this.rotate;
      const canHoldItem = inventory.canHoldItem(this, startSlot, this.quantity + (existingItem?.quantity ?? 0));

      if (!canHoldItem) return null;

      existingItem.quantity += quantity;
      this.quantity -= quantity;

      return existingItem;
    }

    const clone = this.clone();
    clone.quantity = quantity;

    if (!clone.rotate) delete clone.rotate;

    const slots = inventory.canHoldItem(clone, startSlot);

    if (!slots) return null;

    this.quantity -= clone.quantity;

    return clone.addToInventory(inventory, slots) && clone;
  }
}

/**
 * Calculates the total weight of an item including:
 * - Base item weight × quantity
 * - Ammo weight (for weapons with loaded ammo)
 * - Component weight (for weapons with attachments)
 * - Metadata weight (for items with custom weight like containers)
 * This matches v2's Inventory.SlotWeight function.
 */
export function calculateItemWeight(item: InventoryItem, ignoreCount = false): number {
  const baseWeight = item.weight ?? 0;
  let weight = ignoreCount ? baseWeight : baseWeight * (item.quantity || 1);

  // Add ammo weight for weapons
  if (item.ammoName && item.ammoCount) {
    const ammoItem = GetItemData(item.ammoName);
    if (ammoItem?.properties?.weight) {
      weight += ammoItem.properties.weight * item.ammoCount;
    }
  }

  // Add component weight for weapons with attachments
  if (item.components && Array.isArray(item.components)) {
    for (const componentName of item.components) {
      const componentItem = GetItemData(componentName);
      if (componentItem?.properties?.weight) {
        weight += componentItem.properties.weight;
      }
    }
  }

  // Add metadata weight (for containers, special items, etc.)
  if (item.metadataWeight) {
    weight += ignoreCount ? item.metadataWeight : item.metadataWeight * (item.quantity || 1);
  }

  return weight;
}

/**
 * Calculates the total weight of all items in an inventory.
 * This matches v2's Inventory.CalculateWeight function.
 */
export function calculateInventoryWeight(items: InventoryItem[]): number {
  let totalWeight = 0;
  for (const item of items) {
    if (item) {
      totalWeight += calculateItemWeight(item);
    }
  }
  return totalWeight;
}

export function ItemFactory(item: ItemProperties) {
  if (!item) return;

  item.category = item.category ?? 'miscellaneous';
  item.itemLimit = clamp(item.itemLimit);
  item.stackSize = item.category === 'weapon' || item.category === 'container' || item.category === 'bag' ? 1 : clamp(item.stackSize);
  item.durability = (item.durability || item.decay || item.degrade) && 100;
  item.rarity = item.rarity ?? 'common';
  item.decay = item.decay ?? false;
  item.label = item.label ?? item.name;
  item.tradeable = item.tradeable ?? false;
  item.value = item.value ?? 0;

  if (item.category === 'weapon') {
    item.ammoName = item.ammoName || 'ammo-9';
  }

  const Item = class extends BaseItem {
    static properties = item;
    static descriptors = Object.getOwnPropertyDescriptors(this.prototype);

    readonly name = item.name;

    constructor(metadata?: Partial<ItemProperties>) {
      super();

      if (metadata) {
        Object.assign(this, metadata);
      }

      if (!this.uniqueId) Item.CreateUniqueId(this);
      if (this.uniqueId !== 0) this.cache();

      if (item.category === 'weapon') {
        this.durability = this.durability ?? Math.floor(Math.random() * 90) + 1;

        if (item.ammoName) this.ammoCount = this.ammoCount ?? 0;
      }
    }
  };

  Object.defineProperty(Item, 'name', { value: item.name });
  Items[item.name.toLowerCase()] = Item;

  return Item;
}
