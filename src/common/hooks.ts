import { cache } from '@communityox/ox_lib';
import type { ItemProperties } from './item';

/**
 * All supported hook event types.
 * - openInventory: Triggered when a player opens an inventory
 * - openShop: Triggered when a player opens a shop
 * - buyItem: Triggered when a player buys an item from a shop
 * - craftItem: Triggered when a player crafts an item
 * - moveItem: Triggered when an item is moved between slots/inventories
 * - swapItems: Triggered when items are swapped between slots
 * - addItem: Triggered when an item is added to an inventory
 * - removeItem: Triggered when an item is removed from an inventory
 * - usingItem: Triggered before an item is used (can be cancelled)
 * - usedItem: Triggered after an item is successfully used
 * - createItem: Triggered when a new item instance is created
 * - dropItem: Triggered when a player drops an item
 */
export type HookEventName =
  | 'openInventory'
  | 'openShop'
  | 'buyItem'
  | 'craftItem'
  | 'moveItem'
  | 'swapItems'
  | 'addItem'
  | 'removeItem'
  | 'usingItem'
  | 'usedItem'
  | 'createItem'
  | 'dropItem';

type EventHooks =
  | OpenInventoryHook
  | OpenShopHook
  | BuyItemHook
  | CraftItemHook
  | MoveItemHook
  | SwapItemsHook
  | AddItemHook
  | RemoveItemHook
  | UsingItemHook
  | UsedItemHook
  | CreateItemHook
  | DropItemHook;

export interface OpenInventoryHook {
  playerId: number;
  inventoryId: string;
  inventoryType: string;
}

export interface OpenShopHook {
  playerId: number;
  shopId: string;
  shopType: string;
}

export interface BuyItemHook {
  playerId: number;
  shopId: string;
  shopType: string;
  itemName: string;
  price: number;
  count: number;
  currency?: string;
  toInventoryId: string;
}

export interface CraftItemHook {
  playerId: number;
  benchId: string;
  benchIndex: number;
  recipe: any; // CraftingRecipe type
  toInventory: string;
  toSlot: number;
}

export interface MoveItemHook {
  playerId: number;
  item: ItemProperties;
  toSlot: number;
  quantity: number;
  splitStack: boolean;
  inventoryId: string;
  inventoryType: string;
  toInventoryId: string;
  toInventoryType: string;
}

export interface SwapItemsHook {
  playerId: number;
  fromInventory: string;
  fromSlot: number;
  fromType: string;
  toInventory: string;
  toSlot: number;
  toType: string;
  count: number;
  action: 'move' | 'swap' | 'stack';
  dropId?: string;
}

export interface AddItemHook {
  item: ItemProperties;
  toSlot: number;
  inventoryId: string;
  inventoryType: string;
}

export interface RemoveItemHook {
  playerId?: number;
  item: ItemProperties;
  fromSlot: number;
  count: number;
  inventoryId: string;
  inventoryType: string;
}

export interface UsingItemHook {
  playerId: number;
  item: ItemProperties;
  slot: number;
  inventoryId: string;
}

export interface UsedItemHook {
  playerId: number;
  item: ItemProperties;
  slot: number;
  inventoryId: string;
  success: boolean;
}

export interface CreateItemHook {
  itemName: string;
  metadata?: Record<string, any>;
  inventoryId: string;
}

export interface DropItemHook {
  playerId: number;
  item: ItemProperties;
  dropId: string;
  coords: [number, number, number];
  instance?: number;
}

export interface EventHookProperties {
  /** Handler function or export name called after successful validation */
  handler?: string | EventHookHandler;
  /** Validator function or export name that can cancel the event */
  validate?: string | EventHookValidator;
  /** Filter by item type (e.g., 'weapon', 'ammo') */
  itemType?: string;
  /** Filter by specific item name(s) */
  itemName?: string | string[];
  /** Filter by inventory ID pattern(s) */
  inventoryId?: string | string[];
  /** Filter by inventory type(s) */
  inventoryType?: string | string[];
  /** Filter by shop type (for shop-related hooks) */
  shopType?: string | string[];
  /** Enable debug printing for this hook */
  print?: boolean;
}

interface EventHook extends EventHookProperties {
  id: number;
  resource: string;
}

type EventHookHandler = (payload: any) => void;
type EventHookValidator = (payload: any) => boolean | Promise<boolean>;

const registeredEventHooks: Map<string, Set<EventHook>> = new Map();
let hookId = 0;

/**
 * Registers a new hook for a specific event, allowing pre-validation and cancellation.
 * @param eventName The event to hook into
 * @param properties Hook configuration including handlers and filters
 * @returns The hook ID for later removal
 *
 * @example
 * // Register a hook to prevent dropping weapons
 * RegisterEventHook('moveItem', {
 *   itemType: 'weapon',
 *   inventoryType: 'drop',
 *   validate: (payload) => {
 *     console.log('Prevented dropping weapon');
 *     return false; // Cancel the action
 *   }
 * });
 *
 * @example
 * // Log all shop purchases
 * RegisterEventHook('buyItem', {
 *   handler: (payload) => {
 *     console.log(`${payload.playerId} bought ${payload.count}x ${payload.itemName}`);
 *   }
 * });
 */
export function RegisterEventHook(eventName: HookEventName, properties: EventHookProperties): number {
  if (!registeredEventHooks.has(eventName)) registeredEventHooks.set(eventName, new Set());

  const hook: EventHook = {
    ...properties,
    id: ++hookId,
    resource: GetInvokingResource(),
  };

  registeredEventHooks.get(eventName)!.add(hook);

  console.log(`[ox_inventory] Registered hook ${hookId} for event '${eventName}' from ${hook.resource}`);

  return hookId;
}

/**
 * Removes an event hook for a specified resource with the given hookId, or all hooks
 * if hookId is not specified.
 */
export function RemoveResourceHooks(resourceName: string, hookId?: number) {
  registeredEventHooks.forEach((hooks) => {
    hooks.forEach((hook) => {
      if (resourceName !== hook.resource || (hookId && hook.id === hookId)) return;

      hooks.delete(hook);
    });
  });
}

/**
 * Checks if a value matches a filter (single value or array).
 */
function matchesFilter(value: string | undefined, filter: string | string[] | undefined): boolean {
  if (!filter) return true;
  if (!value) return false;

  if (Array.isArray(filter)) {
    return filter.some((f) => value.match(f) !== null);
  }

  return value.match(filter) !== null;
}

/**
 * Checks if an item name matches the filter.
 */
function matchesItemFilter(itemName: string | undefined, filter: string | string[] | undefined): boolean {
  if (!filter) return true;
  if (!itemName) return false;

  if (Array.isArray(filter)) {
    return filter.includes(itemName);
  }

  return itemName === filter;
}

/**
 * Iterates over and triggers all registered event hooks with the given name, until false is received.
 */
export async function TriggerEventHooks(eventName: HookEventName, payload: EventHooks) {
  const eventHooks = registeredEventHooks.get(eventName);
  const handlers: EventHookHandler[] = [];
  const startTime = Date.now();

  const hookResource = {
    success: true,
    payload,

    [Symbol.dispose]: () => {
      if (!hookResource.success) return;

      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[ox_inventory] Error in hook handler:`, error);
        }
      }
    },
  };

  if (!eventHooks || eventHooks.size === 0) return hookResource;

  for (const hook of eventHooks) {
    // Item name/type filters
    if ('item' in payload && payload.item) {
      if (hook.itemType && (payload.item as any).type !== hook.itemType) continue;
      if (!matchesItemFilter((payload.item as any).name, hook.itemName)) continue;
    }

    // Also check itemName in payload directly (for hooks like usingItem)
    if ('itemName' in payload && !matchesItemFilter((payload as any).itemName, hook.itemName)) continue;

    // Inventory ID filter (with pattern matching)
    const fromInventory = 'inventoryId' in payload ? (payload as any).inventoryId : undefined;
    const toInventory = 'toInventoryId' in payload ? (payload as any).toInventoryId : undefined;

    if (hook.inventoryId) {
      const matchesFrom = matchesFilter(fromInventory, hook.inventoryId);
      const matchesTo = matchesFilter(toInventory, hook.inventoryId);

      if (!matchesFrom && !matchesTo) continue;
    }

    // Inventory type filter
    const fromType = 'inventoryType' in payload ? (payload as any).inventoryType : undefined;
    const toType = 'toInventoryType' in payload ? (payload as any).toInventoryType : undefined;

    if (hook.inventoryType) {
      const typeFilter = Array.isArray(hook.inventoryType) ? hook.inventoryType : [hook.inventoryType];
      const matchesFromType = fromType && typeFilter.includes(fromType);
      const matchesToType = toType && typeFilter.includes(toType);

      if (!matchesFromType && !matchesToType) continue;
    }

    // Shop type filter
    if (hook.shopType && 'shopType' in payload) {
      const shopTypeFilter = Array.isArray(hook.shopType) ? hook.shopType : [hook.shopType];
      if (!shopTypeFilter.includes((payload as any).shopType)) continue;
    }

    // Debug printing
    if (hook.print) {
      console.log(`[ox_inventory] Triggering hook "${hook.resource}:${eventName}:${hook.id}"`);
    }

    const hookStartTime = Date.now();

    // Run validation
    const validate = (
      typeof hook.validate === 'string' ? exports[hook.resource][hook.validate] : hook.validate
    ) as EventHookValidator;

    let response = true;

    try {
      response = validate ? await validate(payload) : true;
    } catch (error) {
      console.error(`[ox_inventory] Error in hook validator "${hook.resource}:${eventName}":`, error);
      response = false;
    }

    const executionTime = Date.now() - hookStartTime;

    if (executionTime > 100) {
      console.warn(
        `[ox_inventory] Hook "${hook.resource}:${eventName}:${hook.id}" took ${executionTime}ms to execute`
      );
    }

    // Handle special createItem hook (can modify metadata)
    if (eventName === 'createItem' && response && typeof response === 'object') {
      (payload as CreateItemHook).metadata = response as Record<string, any>;
      continue;
    }

    if (!response) {
      hookResource.success = false;
      return hookResource;
    }

    // Queue handler for later execution
    const handler = (
      typeof hook.handler === 'string' ? exports[hook.resource][hook.handler] : hook.handler
    ) as EventHookHandler;

    if (handler) handlers.push(handler);
  }

  return hookResource;
}

on('onResourceStop', RemoveResourceHooks);

// Export functions for other resources
exports('registerHook', RegisterEventHook);
exports('registerEventHook', RegisterEventHook);
exports('removeHooks', (hookId?: number) => RemoveResourceHooks(GetInvokingResource() || cache.resource, hookId));
exports('removeEventHooks', (hookId?: number) => RemoveResourceHooks(GetInvokingResource() || cache.resource, hookId));

/**
 * Gets the count of registered hooks for an event.
 */
export function GetHookCount(eventName?: HookEventName): number {
  if (eventName) {
    return registeredEventHooks.get(eventName)?.size ?? 0;
  }

  let total = 0;
  for (const hooks of registeredEventHooks.values()) {
    total += hooks.size;
  }
  return total;
}

exports('getHookCount', GetHookCount);

// Example hooks (commented out):
// RegisterEventHook('moveItem', {
//   inventoryType: 'player',
//   itemName: 'ammo_9',
//   validate: (payload: MoveItemHook) => {
//     console.log(`Got 'moveItem' event for ${payload.item.name}`);
//     return payload.inventoryType === 'player';
//   },
//   handler: (payload: MoveItemHook) => {
//     console.log(`Moved ${payload.item.name}!`);
//   },
// });

// RegisterEventHook('openInventory', {
//   inventoryType: 'glovebox',
//   handler: (payload: OpenInventoryHook) => {
//     console.log(`Opened ${payload.inventoryId}!`);
//   },
// });

// RegisterEventHook('buyItem', {
//   print: true, // Debug mode
//   handler: (payload: BuyItemHook) => {
//     console.log(`Player ${payload.playerId} bought ${payload.count}x ${payload.itemName} for $${payload.price}`);
//   },
// });

// RegisterEventHook('craftItem', {
//   validate: (payload: CraftItemHook) => {
//     // Prevent crafting certain items
//     if (payload.recipe.name === 'lockpick') {
//       return false;
//     }
//     return true;
//   },
// });
