import { Command } from '@nativewrappers/server';
import { GetInventory } from './inventory';
import { Inventory } from './inventory/class';
import { GetItemClass } from './item';
import { hasGroup, isPlayerBoss } from './bridge';
import Config from '@common/config';

/**
 * Check if a player has admin permissions.
 * Checks for group.admin (like v2) or command.additem ACE permission.
 */
function isAdmin(playerId: number): boolean {
  const playerIdStr = String(playerId);
  return (
    (IsPlayerAceAllowed(playerIdStr, 'group.admin') as unknown as boolean) ||
    (IsPlayerAceAllowed(playerIdStr, 'command.additem') as unknown as boolean)
  );
}

/**
 * Check if a player is a police boss (for evidence management).
 */
async function isPoliceBoss(playerId: number): Promise<boolean> {
  const inventory = await GetInventory(playerId);
  if (!inventory) return false;

  const policeGroups = Config.Police || ['police', 'sheriff'];
  for (const group of policeGroups) {
    const [matchedGroup, grade] = hasGroup(inventory, group);
    if (matchedGroup && grade !== undefined) {
      return isPlayerBoss(playerId, matchedGroup, grade);
    }
  }
  return false;
}

// Handler function for adding items (used by both additem and giveitem)
async function handleAddItem(args: { target: number; item: string; quantity?: number; type?: string; source: number }) {
  if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use item command without permission`);

  const item = GetItemClass(args.item);
  if (!item) return console.log(`[ox_inventory] Invalid item: ${args.item}`);

  const inventory = await GetInventory(args.target);
  if (!inventory) return console.log(`[ox_inventory] Invalid inventory for player ${args.target}`);

  const metadata: Record<string, any> = {};
  if (args.type) metadata.type = args.type;

  const success = await inventory.addItem({
    name: args.item,
    quantity: args.quantity || 1,
    ...metadata,
  });

  if (success) {
    console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} gave ${args.quantity || 1}x ${args.item} to player ${args.target}`);
  }
}

const addItemArgs = [
  {
    name: 'target',
    type: 'playerId',
  },
  {
    name: 'item',
    type: 'string',
  },
  {
    name: 'quantity',
    type: 'number',
    optional: true,
  },
  {
    name: 'type',
    type: 'string',
    optional: true,
  },
] as const;

new Command('additem', 'Create a new item and grant it to the target player.', handleAddItem, addItemArgs);

// Alias for QB-Core compatibility
new Command('giveitem', 'Create a new item and grant it to the target player.', handleAddItem, addItemArgs);

new Command(
  'removeitem',
  'Reduce the quantity of an item from the target player.',
  async (args: { target: number; item: string; quantity?: number; type?: string; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /removeitem without permission`);

    const item = GetItemClass(args.item);
    if (!item) return console.log(`[ox_inventory] Invalid item: ${args.item}`);

    const inventory = await GetInventory(args.target);
    if (!inventory) return console.log(`[ox_inventory] Invalid inventory for player ${args.target}`);

    const metadata: Record<string, any> = {};
    if (args.type) metadata.type = args.type;

    const success = inventory.removeItem({
      name: args.item,
      quantity: args.quantity || 1,
      ...metadata,
    });

    if (success) {
      console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} removed ${args.quantity || 1}x ${args.item} from player ${args.target}`);
    }
  },
  [
    {
      name: 'target',
      type: 'playerId',
    },
    {
      name: 'item',
      type: 'string',
    },
    {
      name: 'quantity',
      type: 'number',
      optional: true,
    },
    {
      name: 'type',
      type: 'string',
      optional: true,
    },
  ] as const,
);

new Command(
  'setitem',
  'Sets the item count for a player, removing or adding as needed.',
  async (args: { target: number; item: string; count?: number; type?: string; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /setitem without permission`);

    const item = GetItemClass(args.item);
    if (!item) return console.log(`[ox_inventory] Invalid item: ${args.item}`);

    const inventory = await GetInventory(args.target);
    if (!inventory) return console.log(`[ox_inventory] Invalid inventory for player ${args.target}`);

    const metadata: Record<string, any> = {};
    if (args.type) metadata.type = args.type;

    const currentCount = inventory.getItemCount({ name: args.item, ...metadata });
    const targetCount = args.count || 0;
    const diff = targetCount - currentCount;

    if (diff > 0) {
      await inventory.addItem({ name: args.item, quantity: diff, ...metadata });
    } else if (diff < 0) {
      inventory.removeItem({ name: args.item, quantity: Math.abs(diff), ...metadata });
    }

    console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} set ${args.item} count to ${targetCount} for player ${args.target}`);
  },
  [
    {
      name: 'target',
      type: 'playerId',
    },
    {
      name: 'item',
      type: 'string',
    },
    {
      name: 'count',
      type: 'number',
      optional: true,
    },
    {
      name: 'type',
      type: 'string',
      optional: true,
    },
  ] as const,
);

new Command(
  'clearitems',
  "Clears all items from the target player's inventory.",
  async (args: { target: number; keep?: string; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /clearitems without permission`);

    const inventory = await GetInventory(args.target);
    if (!inventory) return console.log(`[ox_inventory] Invalid inventory for player ${args.target}`);

    if (args.keep) {
      const keepItems = inventory
        .mapItems()
        .filter((item) => args.keep.includes(item.name))
        .map((item) => item.uniqueId);

      inventory.clear(keepItems);
    } else {
      inventory.clear();
    }

    console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} cleared inventory for player ${args.target}`);
  },
  [
    {
      name: 'target',
      type: 'playerId',
    },
    {
      name: 'keep',
      type: 'longString',
      optional: true,
    },
  ] as const,
);

new Command(
  'clearinv',
  'Wipes all items from the target inventory.',
  async (args: { invId: string; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /clearinv without permission`);

    let inventoryId: string | number = args.invId;

    // Handle 'me' keyword to refer to source player
    if (args.invId === 'me') {
      inventoryId = args.source;
    } else {
      const parsed = Number.parseInt(args.invId, 10);
      if (!Number.isNaN(parsed)) inventoryId = parsed;
    }

    const inventory = await GetInventory(inventoryId);
    if (!inventory) return console.log(`[ox_inventory] Invalid inventory: ${args.invId}`);

    inventory.clear();
    console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} cleared inventory: ${args.invId}`);
  },
  [
    {
      name: 'invId',
      type: 'string',
    },
  ] as const,
);

new Command(
  'takeinv',
  'Confiscates the target inventory, to restore with /restoreinv.',
  async (args: { target: number; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /takeinv without permission`);

    const inventory = await GetInventory(args.target);
    if (!inventory) return console.log(`[ox_inventory] Invalid inventory for player ${args.target}`);

    const confiscatedId = await inventory.confiscate();
    if (confiscatedId) {
      console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} confiscated inventory from player ${args.target} (stash: ${confiscatedId})`);
    }
  },
  [
    {
      name: 'target',
      type: 'playerId',
    },
  ] as const,
);

new Command(
  'restoreinv',
  'Restores a previously confiscated inventory for the target.',
  async (args: { target: number; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /restoreinv without permission`);

    const inventory = await GetInventory(args.target);
    if (!inventory) return console.log(`[ox_inventory] Invalid inventory for player ${args.target}`);

    const success = await inventory.returnConfiscated();
    if (success) {
      console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} restored confiscated inventory for player ${args.target}`);
    } else {
      console.log(`[ox_inventory] No confiscated inventory found for player ${args.target}`);
    }
  },
  [
    {
      name: 'target',
      type: 'playerId',
    },
  ] as const,
);

new Command(
  'viewinv',
  'Inspect the target inventory without allowing interactions.',
  async (args: { invId: string; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /viewinv without permission`);

    let inventoryId: string | number = args.invId;
    const parsed = Number.parseInt(args.invId, 10);
    if (!Number.isNaN(parsed)) inventoryId = parsed;

    const inventory = await GetInventory(inventoryId);
    if (!inventory) return console.log(`[ox_inventory] Invalid inventory: ${args.invId}`);

    // Open inventory in view-only mode
    inventory.open(args.source, 'locked');

    console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} is viewing inventory: ${args.invId}`);
  },
  [
    {
      name: 'invId',
      type: 'string',
    },
  ] as const,
);

new Command(
  'saveinv',
  'Save all pending inventory changes to the database.',
  async (args: { lock?: string; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /saveinv without permission`);

    const lock = args.lock === 'true';
    await Inventory.SaveAllInventories(lock);

    console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} triggered inventory save${lock ? ' (locked)' : ''}`);
  },
  [
    {
      name: 'lock',
      type: 'string',
      optional: true,
    },
  ] as const,
);

new Command(
  'clearevidence',
  'Clears a police evidence locker with the given id.',
  async (args: { locker: number; source: number }) => {
    const isBoss = await isPoliceBoss(args.source);
    if (!isBoss) return console.log(`[ox_inventory] Player ${args.source} tried to use /clearevidence without being a police boss`);

    const inventory = await GetInventory(args.source);
    if (!inventory) return;

    // Get the player's police group
    const policeGroups = Config.Police || ['police', 'sheriff'];
    let playerGroup: string | undefined;

    for (const group of policeGroups) {
      const [matchedGroup] = hasGroup(inventory, group);
      if (matchedGroup) {
        playerGroup = matchedGroup;
        break;
      }
    }

    if (!playerGroup) return console.log(`[ox_inventory] Player ${args.source} is not in a police group`);

    const evidenceId = `evidence-${playerGroup}-${args.locker}`;
    const evidenceInv = Inventory.FromId(evidenceId);

    if (!evidenceInv) return console.log(`[ox_inventory] Evidence locker not found: ${evidenceId}`);

    evidenceInv.clear();
    console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} cleared evidence locker: ${evidenceId}`);
  },
  [
    {
      name: 'locker',
      type: 'number',
    },
  ] as const,
);

new Command(
  'cleanupinv',
  'Cleans up orphaned slot references in the target inventory.',
  async (args: { target?: number; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /cleanupinv without permission`);

    const targetId = args.target ?? args.source;
    const inventory = await GetInventory(targetId);
    if (!inventory) return console.log(`[ox_inventory] Invalid inventory for player ${targetId}`);

    const cleaned = inventory.cleanupOrphanedSlots();

    if (cleaned > 0) {
      // Emit update to refresh client state
      inventory.emit('ox_inventory:refreshInventory', {
        inventory,
        items: inventory.mapItems(),
      });
      console.log(`[ox_inventory] ${GetPlayerName(String(args.source))} cleaned up ${cleaned} orphaned slots for player ${targetId}`);
    } else {
      console.log(`[ox_inventory] No orphaned slots found for player ${targetId}`);
    }
  },
  [
    {
      name: 'target',
      type: 'playerId',
      optional: true,
    },
  ] as const,
);

new Command(
  'testclothing',
  'Adds some clothing items to the target.',
  async (args: { target: number; source: number }) => {
    const inventory = await GetInventory(args.target);

    if (!inventory) return;

    inventory.addItem({
      name: 'ped_prop',
      quantity: 1,
      componentId: 0,
      collection: 'mp_m_bikerdlc_01',
      drawableId: 0,
      textureId: 0,
    });

    inventory.addItem({
      name: 'ped_prop',
      quantity: 1,
      componentId: 0,
      collection: 'mp_m_bikerdlc_01',
      drawableId: 2,
      textureId: 0,
    });

    inventory.addItem({
      name: 'ped_prop',
      quantity: 1,
      componentId: 0,
      collection: 'mp_f_bikerdlc_01',
      drawableId: 0,
      textureId: 0,
    });

    inventory.addItem({
      name: 'ped_component',
      quantity: 1,
      componentId: 11,
      collection: '',
      drawableId: 0,
      textureId: 0,
    });

    inventory.addItem({
      name: 'ped_component',
      quantity: 1,
      componentId: 11,
      collection: '',
      drawableId: 4,
      textureId: 0,
    });

    inventory.addItem({
      name: 'ped_component',
      quantity: 1,
      componentId: 11,
      collection: 'mp_m_bikerdlc_01',
      drawableId: 0,
      textureId: 0,
    });
  },
  [
    {
      name: 'target',
      type: 'playerId',
    },
  ] as const,
);

// Debug command to dump inventory state
new Command(
  'debuginv',
  'Debug: Show inventory internal state and database items.',
  async (args: { target?: number; source: number }) => {
    if (!isAdmin(args.source)) return console.log(`[ox_inventory] Player ${args.source} tried to use /debuginv without permission`);

    const targetId = args.target ?? args.source;
    const inventory = await GetInventory(targetId);

    if (!inventory) {
      console.log(`^1[ox_inventory:debug] No inventory found for player ${targetId}^0`);
      return;
    }

    console.log(`^3[ox_inventory:debug] === Inventory Debug for ${inventory.inventoryId} ===^0`);
    console.log(`^3[ox_inventory:debug] Label: ${inventory.label}^0`);
    console.log(`^3[ox_inventory:debug] Size: ${inventory.width}x${inventory.height}^0`);
    console.log(`^3[ox_inventory:debug] Weight: ${inventory.weight}/${inventory.maxWeight}^0`);
    console.log(`^3[ox_inventory:debug] OwnerId: ${inventory.ownerId}^0`);
    console.log(`^3[ox_inventory:debug] PlayerId: ${inventory.playerId}^0`);

    console.log(`^3[ox_inventory:debug] === Items Record (slots -> uniqueIds) ===^0`);
    const itemSlots = Object.entries(inventory.items);
    if (itemSlots.length === 0) {
      console.log(`^1[ox_inventory:debug] items record is EMPTY!^0`);
    } else {
      for (const [slot, uniqueId] of itemSlots) {
        console.log(`^3[ox_inventory:debug]   slot ${slot} -> uniqueId ${uniqueId}^0`);
      }
    }

    console.log(`^3[ox_inventory:debug] === Mapped Items (from itemIds/GetInventoryItem) ===^0`);
    const items = inventory.mapItems();
    if (items.length === 0) {
      console.log(`^1[ox_inventory:debug] mapItems() returned EMPTY!^0`);
    } else {
      for (const item of items) {
        console.log(`^3[ox_inventory:debug]   - ${item.name} x${item.quantity} (uniqueId=${item.uniqueId}, slot=${item.anchorSlot}, invId=${item.inventoryId})^0`);
      }
    }

    // Check getItemCount for money specifically
    const moneyCount = inventory.getItemCount({ name: 'money' });
    console.log(`^3[ox_inventory:debug] getItemCount({name: 'money'}) = ${moneyCount}^0`);

    // Also try to get citizenid from QBX to show what ID we should be using
    try {
      if (GetResourceState('qbx_core') === 'started') {
        const player = exports.qbx_core.GetPlayer(targetId);
        if (player?.PlayerData?.citizenid) {
          console.log(`^3[ox_inventory:debug] QBX citizenid: ${player.PlayerData.citizenid}^0`);
          console.log(`^3[ox_inventory:debug] Expected inventoryId: player:${player.PlayerData.citizenid}^0`);
        }
      }
    } catch {}
  },
  [
    {
      name: 'target',
      type: 'playerId',
      optional: true,
    },
  ] as const,
);
