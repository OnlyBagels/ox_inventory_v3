import Config from '@common/config';
import { GetInventoryItem, calculateInventoryWeight, type InventoryItem, type ItemProperties } from '@common/item';
import type { Vector3 } from '@nativewrappers/common';

export class BaseInventory {
  static instances: Record<string, BaseInventory> = {};
  /** A unique identifier used to reference the inventory and save it in the database. */
  public inventoryId: string;

  /** The inventory type, such as player, glovebox, trunk, etc. */
  public type: string;

  /** An object where each key-value refers to the grid position and an item's uniqueid in that slot. */
  public items: Record<number, number> = {};

  public label: string;
  public width: number;
  public height: number;
  public weight: number;
  public maxWeight: number;
  public playerId?: number;
  public isTemporary?: boolean;
  public netId?: number;
  public ownerId?: string;
  public coords?: number[] | Vector3;
  public radius?: number;
  public currentWeapon?: number;

  #itemCache: number[] = [];
  #mapCache: InventoryItem[] = [];

  [key: string]: unknown;

  constructor(data: Partial<BaseInventory>) {
    this.inventoryId = data.inventoryId;
    this.type = data.type ?? 'player';
    this.items = data.items ?? {};
    this.label = data.label ?? 'Player inventory';
    this.width = data.width ?? Config.Player_Width;
    this.height = data.height ?? Config.Player_Height;
    this.weight = data.weight ?? 0;
    this.maxWeight = data.maxWeight ?? Config.Player_MaxWeight;
    this.netId = data.netId;
    this.ownerId = data.ownerId;
    this.coords = data.coords;
    this.playerId = data.playerId;
    this.isTemporary = data.isTemporary;
    this.radius = data.radius;

    BaseInventory.instances[this.inventoryId] = this;
  }

  /**
   * Get a cached inventory from its unique inventory id.
   */
  static FromId(inventoryId: string) {
    return BaseInventory.instances[inventoryId];
  }

  static Remove(inventoryId: string) {
    delete BaseInventory.instances[inventoryId];
  }

  /**
   * Sets slot ids in the inventory to reference the unique item id of the item they are holding.
   */
  public setSlotRefs(slots: number[], uniqueId?: number) {
    slots.forEach((slotId) => (uniqueId ? (this.items[slotId] = uniqueId) : delete this.items[slotId]));

    return true;
  }

  /** Clears the itemCache and mapCache, and recalculates weight. */
  public invalidateCache() {
    this.#itemCache.length = 0;
    this.#mapCache.length = 0;
  }

  /**
   * Cleans up orphaned slot references - removes slots that reference non-existent items
   * or items that aren't actually in those slots.
   */
  public cleanupOrphanedSlots() {
    const slotsToRemove: number[] = [];

    for (const [slotIdStr, uniqueId] of Object.entries(this.items)) {
      const slotId = parseInt(slotIdStr, 10);
      const item = GetInventoryItem(uniqueId);

      // Item doesn't exist - orphaned reference
      if (!item) {
        slotsToRemove.push(slotId);
        continue;
      }

      // Item exists but isn't in this inventory
      if (item.inventoryId !== this.inventoryId) {
        slotsToRemove.push(slotId);
        continue;
      }

      // Item exists but this slot isn't part of its occupied slots
      const itemSlots = this.getItemSlots(item);
      if (!itemSlots.includes(slotId)) {
        slotsToRemove.push(slotId);
      }
    }

    // Remove orphaned slots
    for (const slotId of slotsToRemove) {
      console.log(`[ox_inventory] Cleaning up orphaned slot ${slotId} (referenced item ${this.items[slotId]})`);
      delete this.items[slotId];
    }

    if (slotsToRemove.length > 0) {
      this.invalidateCache();
      console.log(`[ox_inventory] Cleaned up ${slotsToRemove.length} orphaned slots in ${this.inventoryId}`);
    }

    return slotsToRemove.length;
  }

  /** Recalculates the total weight of all items in the inventory. */
  public recalculateWeight() {
    // Clear caches first to ensure fresh data
    this.#itemCache.length = 0;
    this.#mapCache.length = 0;
    this.weight = calculateInventoryWeight(this.mapItems());
  }

  /**
   * Get an array containing all unique item ids contained in the inventory.
   */
  public itemIds() {
    if (!this.#itemCache.length) this.#itemCache = [...new Set(Object.values(this.items))];

    return this.#itemCache;
  }

  /**
   * Get an array containing all InventoryItems in the inventory.
   */
  public mapItems() {
    if (!this.#mapCache.length) this.#mapCache = this.itemIds().map((uniqueId) => GetInventoryItem(uniqueId));

    return this.#mapCache;
  }

  public getItemInSlot(slot: number) {
    return GetInventoryItem(this.items[slot]);
  }

  /**
   * Finds the next available slot for the item in the inventory.
   * @returns The next available slot or -1 if no slot is available.
   */
  public findAvailableSlot(item: InventoryItem) {
    for (let slot = 0; slot < this.width * this.height; slot++) {
      if (this.canHoldItem(item, slot)) return slot;

      const existingItem = this.getItemInSlot(slot);

      if (existingItem) {
        slot += existingItem.width - 1;
      }
    }

    return -1;
  }

  /**
   * Determines the slotIds that are occupied by an item.
   * @returns An array containing the slotIds that hold the item, or empty array if item has no anchor.
   */
  public getItemSlots(item: InventoryItem) {
    const slots: number[] = [];

    // Guard against undefined anchorSlot
    if (item.anchorSlot === undefined || item.anchorSlot === null) {
      return slots;
    }

    for (let y = 0; y < item.height; y++) {
      const offset = item.anchorSlot + y * this.width;

      for (let x = 0; x < item.width; x++) {
        slots.push(offset + x);
      }
    }

    return slots;
  }

  /**
   * Determines the slotIds that will be occupied by an item, starting from startSlot.
   * @returns An array containing the slotIds that can can hold the item.
   */
  public getSlotsForItem(item: ItemProperties, startSlot: number) {
    const slots: number[] = [];

    for (let y = 0; y < item.height; y++) {
      const offset = startSlot + y * this.width;

      for (let x = 0; x < item.width; x++) {
        const slotId = offset + x;
        const existingItemId = this.items[slotId];
        // When moving an item within the same inventory, skip overlap check for its own slots
        const isSameItem = existingItemId === item.uniqueId;
        const doesItemOverlap = existingItemId && !isSameItem;
        const doesItemOverflow = Math.floor(slotId / this.width) !== Math.floor(offset / this.width);

        if (doesItemOverlap || doesItemOverflow) {
          if (Config.Debug) console.log(`[getSlotsForItem] FAILED at slot ${slotId}: existingItemId=${existingItemId}, item.uniqueId=${item.uniqueId}, isSameItem=${isSameItem}, overlap=${doesItemOverlap}, overflow=${doesItemOverflow}`);
          return false;
        }

        slots.push(slotId);
      }
    }

    return slots.length ? slots : false;
  }

  /**
   * Determines if item placement is valid based on item size, inventory dimensions, weight, etc.
   */
  public canHoldItem(item: InventoryItem, startSlot = -1, quantity?: number) {
    if (startSlot < 0) {
      startSlot = this.findAvailableSlot(item);

      if (startSlot < 0) return false;
    }

    const existingItem = this.getItemInSlot(startSlot);
    quantity = quantity ? Math.max(1, Math.ceil(quantity)) : item.quantity;

    // Weight check: calculate if the inventory can hold the item's weight
    const itemWeight = item.weight ?? 0;
    const addedWeight = itemWeight * quantity;

    // If the item is already in this inventory, we don't need to add its weight again
    const currentItemWeight = (item.inventoryId === this.inventoryId && item.anchorSlot !== undefined)
      ? (itemWeight * item.quantity)
      : 0;

    const newTotalWeight = this.weight - currentItemWeight + addedWeight;

    if (this.maxWeight > 0 && newTotalWeight > this.maxWeight) {
      return false;
    }

    // todo: totalQuantity > itemLimit

    if (quantity > item.stackSize) return false;

    // Check for stacking with existing item at target slot
    // Skip this check if it's the same item (e.g., rotating in place)
    if (
      existingItem &&
      existingItem.anchorSlot === startSlot &&
      existingItem.uniqueId !== item.uniqueId &&
      this.inventoryId === (existingItem.inventoryId ?? this.inventoryId)
    ) {
      if (existingItem.quantity + quantity > item.stackSize) return false;
      if (!item.match(existingItem)) return false;

      return this.getItemSlots(existingItem);
    }

    const doesItemFit =
      (startSlot % this.width) + item.width <= this.width &&
      Math.floor(startSlot / this.width) + item.height <= this.height;

    if (!doesItemFit) return false;

    return this.getSlotsForItem(item, startSlot);
  }

  /**
   * Returns the uniqueId of the first item matching the given properties.
   * Uses non-strict matching so partial property sets work (e.g., {name: 'money'})
   */
  public findItem(properties: ItemProperties) {
    return this.mapItems().find((item) => item.match(properties, false))?.uniqueId;
  }

  /**
   * Returns all uniqueId's for items matching the given properties.
   * Uses non-strict matching so partial property sets work (e.g., {name: 'money'})
   */
  public findItems(properties: ItemProperties) {
    return this.mapItems().filter((item) => item.match(properties, false) && item.uniqueId);
  }

  /**
   * Returns the total count of all items matching the given properties.
   * Uses non-strict matching so partial property sets work (e.g., {name: 'money'})
   */
  public getItemCount(properties: Partial<ItemProperties>) {
    return this.mapItems().reduce((total, item) => (item.match(properties, false) ? total + item.quantity : total), 0);
  }

  /**
   * Clears this inventory of all items that don't match the given itemIds.
   */
  public clear(keepItems?: number[]) {
    const items = keepItems ? this.mapItems().filter((item) => !keepItems.includes(item.uniqueId)) : this.mapItems();

    for (const item of items) item.delete();
  }
}
