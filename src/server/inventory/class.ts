import { TriggerEventHooks } from '@common/hooks';
import { BaseInventory } from '@common/inventory/class';
import type { InventoryItem, ItemProperties } from '@common/item';
import type { BridgePlayerData } from '../bridge';
import { syncInventory } from '../bridge';
import db from '../db';
import { CreateItem, GetItemClass } from '../item';

// Account items that need to sync with framework money
const ACCOUNT_ITEMS = ['money', 'bank', 'black_money'];

const drops: string[] = [];

on('playerJoining', () => drops.length && emitNet('ox_inventory:addInventoryGrid', -1, drops));

export interface InventoryPlayerData extends BridgePlayerData {
  ped?: number;
}

export class Inventory extends BaseInventory {
  #openedBy: Map<number, string> = new Map();

  public entityId?: number;

  /** Player-specific data (only for player inventories) */
  public player?: InventoryPlayerData;

  /** Current shop the player has open */
  public currentShop?: string;

  /** Container slot if viewing a container item */
  public containerSlot?: number;

  /** Currently equipped weapon's unique ID */
  public usingItem?: any;

  /** Group restrictions for this inventory (jobs, gangs, etc.) */
  public groups?: Record<string, number>;

  /** Stored/confiscated inventory ID */
  public confiscatedId?: string;

  /** Model for drop objects (weapons display their model) */
  public model?: string;

  constructor(data: Partial<Inventory>) {
    if (data.groups) this.groups = data.groups;
    super(data);
    this.entityId = data.entityId;
    this.model = data.model;

    if (data.type === 'drop') {
      drops.push(this.inventoryId);
      // Include model in the grid data for client-side object spawning
      emitNet('ox_inventory:addInventoryGrid', -1, {
        ...data,
        model: this.model,
      });
    }

    // For player inventories, also check for items stored under legacy source-based IDs
    // Old v3 bug stored items as player:1, player:2 etc. instead of player:citizenid
    // Try to find and migrate those items using the playerId if available
    let alternateId: string | undefined;
    if (data.type === 'player' && data.playerId) {
      alternateId = `player:${data.playerId}`;
    }
    const items = db.getInventoryItems(this.inventoryId, alternateId);

    for (const data of items) {
      try {
        CreateItem(data);
      } catch (e) {
        data.quantity = 0;

        db.updateInventoryItem(data);
        console.error(`Invalid item '${data.name}' in inventory '${this.inventoryId}' was deleted.`);
      }
    }
  }

  /**
   * Get a cached inventory from its unique inventory id.
   */
  static FromId(inventoryId: string) {
    const inventory = BaseInventory.FromId(inventoryId) as Inventory;

    if (!inventory) return;

    if (inventory.entityId) {
      const isValid =
        DoesEntityExist(inventory.entityId) && NetworkGetNetworkIdFromEntity(inventory.entityId) === inventory.netId;

      const state = isValid && Entity(inventory.entityId).state;

      if (!state || state?.inventoryId !== inventory.inventoryId) {
        if (state) state.inventoryId = undefined;

        inventory.remove(true);
        return;
      }
    }

    return inventory;
  }

  static GetInventories(playerId?: number) {
    return Object.values(Inventory.instances as Record<string, Inventory>).filter((inventory) => {
      if (!playerId || inventory.#openedBy.has(playerId)) {
        return inventory;
      }
    });
  }

  /**
   * Emits an event to all players who are using this inventory.
   */
  public emit(event: string, ...args: any) {
    this.#openedBy.forEach((_, playerId) => emitNet(event, playerId, ...args));
  }

  /**
   * Optionally closes this inventory for all players and unloads it from the server.
   */
  public remove(closeAll = true) {
    if (this.type === 'drop') {
      const index = drops.indexOf(this.inventoryId);
      if (index > -1) drops.splice(index, 1);

      emitNet('ox_inventory:removeInventoryGrid', -1, this.inventoryId);
    }

    if (closeAll) this.closeAll();

    Inventory.Remove(this.inventoryId);
  }

  /**
   * Unloads this inventory from the server and optionally deletes its items from the database.
   */
  public delete(removeItems = false) {
    if (removeItems) db.deleteInventory(this.inventoryId);

    Inventory.Remove(this.inventoryId);
  }

  /**
   * Opens this inventory for a player.
   */
  public open(playerId: number) {
    if (this.getOpenState(playerId) === 'open') return false;

    this.#openedBy.set(playerId, 'open');
    emitNet('ox_inventory:openInventory', playerId, { inventory: this, items: this.mapItems() });

    return true;
  }

  /**
   * Opens this inventory for a player in view-only-mode.
   */
  public view(playerId: number) {
    if (this.getOpenState(playerId) === 'view') return false;

    this.#openedBy.set(playerId, 'view');
    emitNet('ox_inventory:openInventory', playerId, { inventory: this, items: this.mapItems(), viewOnly: true });

    return true;
  }

  /**
   * Closes this inventory for a player.
   */
  public close(playerId: number, emit = true) {
    this.#openedBy.delete(playerId);

    if (emit) emitNet('ox_inventory:closeInventory', playerId);

    if (this.type === 'drop' && !this.#openedBy.size && Object.keys(this.items).length === 0) this.remove(false);
  }

  /**
   * Closes this inventory for all players.
   */
  public closeAll() {
    this.emit('ox_inventory:closeInventory');
    this.#openedBy.clear();

    if (this.type === 'drop' && Object.keys(this.items).length === 0) this.remove(false);
  }

  /**
   * Checks if the inventory is open for the given player.
   */
  public getOpenState(playerId: number) {
    return this.#openedBy.get(playerId);
  }

  /**
   * Create an item and add it to this inventory, optionally merging with an existing item if requirements are met.
   */
  public async addItem(data: ItemProperties) {
    const Item = GetItemClass(data.name);

    if (!Item) {
      console.error(`[ox_inventory] Cannot add item - item class not found for '${data.name}'`);
      return null;
    }

    const item = new Item(data);
    item.inventoryId = this.inventoryId;

    const slots = this.canHoldItem(item, -1);

    if (!slots) throw new Error(`Cannot add item '${data.name}' to inventory '${this.inventoryId}'`);

    using hook = await TriggerEventHooks('addItem', {
      item,
      toSlot: slots[0],
      inventoryId: this.inventoryId,
      inventoryType: this.type,
    });

    if (!hook.success) return;

    const success = item.move(this, slots[0]);
    hook.success = !!success;

    // Sync with framework if this is a player inventory and an account item changed
    if (success && this.player && ACCOUNT_ITEMS.includes(data.name)) {
      syncInventory(this);
    }

    return success ? item : null;
  }

  /**
   * Removes an item from this inventory, deleting the data entirely if the quantity reaches 0.
   */
  public removeItem(data: ItemProperties) {
    const items = this.mapItems();
    const matchedItems = [];
    data.quantity = data.quantity || 0;
    let quantity = data.quantity;

    for (const item of items) {
      if (item.match(data, false)) {
        matchedItems.push(item);

        if (quantity) {
          quantity -= item.quantity;

          if (quantity < 1) break;
        } else data.quantity += item.quantity;
      }
    }

    if (quantity > 0) return false;

    quantity = data.quantity;

    for (const item of matchedItems) {
      if (item.quantity > quantity) {
        item.quantity -= quantity;
        quantity = 0;

        item.move(this, item.anchorSlot);
      } else {
        quantity -= item.quantity;

        item.delete();
      }

      if (quantity < 1) break;
    }

    // Sync with framework if this is a player inventory and an account item changed
    if (this.player && ACCOUNT_ITEMS.includes(data.name)) {
      syncInventory(this);
    }

    return true;
  }

  /**
   * Get the amount of an item this inventory can hold.
   */
  public getCarryAmount() {
    return 0;
  }

  /**
   * Clears this inventory of all items that don't match the given itemIds.
   */
  public clear(keepItems?: number[]) {
    super.clear(keepItems);
    this.emit('ox_inventory:clearInventory', { inventoryId: this.inventoryId, keepItems });
  }

  /** Gives an item from one player's inventory to another player's inventory. */
  public giveItem() {
    return true;
  }

  public canHoldItem(item: InventoryItem, startSlot?: number, quantity?: number): false | number[] {
    GetItemClass(item.name);

    return super.canHoldItem(item, startSlot, quantity);
  }

  /**
   * Confiscates all items from this inventory, storing them for later retrieval.
   */
  public async confiscate(): Promise<boolean> {
    if (this.type !== 'player' || !this.playerId) return false;

    const confiscatedId = `confiscated:${this.inventoryId}`;
    const items = this.mapItems();

    if (items.length === 0) return false;

    // Create confiscated inventory with same dimensions
    const confiscatedInv = new Inventory({
      inventoryId: confiscatedId,
      type: 'stash',
      label: `Confiscated - ${this.label}`,
      width: this.width,
      height: this.height,
      maxWeight: this.maxWeight,
      ownerId: this.ownerId,
    });

    // Move all items to confiscated inventory
    for (const item of items) {
      item.move(confiscatedInv, confiscatedInv.findAvailableSlot(item));
    }

    this.confiscatedId = confiscatedId;
    this.invalidateCache();
    confiscatedInv.invalidateCache();

    // Sync changes
    this.emit('ox_inventory:clearInventory', { inventoryId: this.inventoryId });

    console.log(`^3[ox_inventory] Confiscated inventory for ${this.label}^0`);
    return true;
  }

  /**
   * Returns previously confiscated items to this inventory.
   */
  public async returnConfiscated(): Promise<boolean> {
    if (this.type !== 'player' || !this.playerId) return false;

    const confiscatedId = `confiscated:${this.inventoryId}`;
    const confiscatedInv = Inventory.FromId(confiscatedId);

    if (!confiscatedInv) {
      console.warn(`^3[ox_inventory] No confiscated inventory found for ${this.label}^0`);
      return false;
    }

    const items = confiscatedInv.mapItems();

    // Move all items back
    for (const item of items) {
      const slot = this.findAvailableSlot(item);
      if (slot >= 0) {
        item.move(this, slot);
      } else {
        // No space - drop on ground?
        console.warn(`^3[ox_inventory] Could not return item ${item.name} - no space^0`);
      }
    }

    // Remove confiscated inventory
    confiscatedInv.remove(false);
    delete this.confiscatedId;

    this.invalidateCache();

    console.log(`^3[ox_inventory] Returned confiscated inventory to ${this.label}^0`);
    return true;
  }

  /**
   * Checks if a player has access to this inventory based on group restrictions.
   */
  public hasAccess(playerGroups: Record<string, number>): boolean {
    if (!this.groups) return true;

    for (const [group, requiredGrade] of Object.entries(this.groups)) {
      const playerGrade = playerGroups[group];
      if (playerGrade !== undefined && playerGrade >= requiredGrade) {
        return true;
      }
    }

    return false;
  }

  /**
   * Saves all inventories to the database.
   * @param lock If true, prevents further inventory operations until unlocked.
   */
  static async SaveAllInventories(lock = false): Promise<void> {
    console.log(`^3[ox_inventory] Saving all inventories${lock ? ' (locked)' : ''}^0`);

    const inventories = Object.values(Inventory.instances as Record<string, Inventory>);
    let savedCount = 0;

    for (const inventory of inventories) {
      try {
        // Force cache invalidation to trigger save
        inventory.invalidateCache();
        savedCount++;
      } catch (error) {
        console.error(`^1[ox_inventory] Failed to save inventory ${inventory.inventoryId}:^0`, error);
      }
    }

    console.log(`^2[ox_inventory] Saved ${savedCount} inventories^0`);

    if (lock) {
      // Set a global lock flag
      (globalThis as any).__inventoryLocked = true;
      console.log(`^3[ox_inventory] Inventory access locked until restart or save without lock^0`);
    } else {
      (globalThis as any).__inventoryLocked = false;
    }
  }
}
