import Config from '@common/config';
import { GetInventoryItem } from '@common/item';
import { triggerClientCallback } from '@communityox/ox_lib/server';
import vehicleClasses from '@static/vehicleClasses.json';
import { GetPlayerInventoryId, GetVehicleFromInventoryId } from '../bridge';
import { Inventory } from './class';
import type { Vector3 } from '@nativewrappers/common';

// Registered stashes
const registeredStashes: Map<string, StashConfig> = new Map();

export interface StashConfig {
  id: string;
  label: string;
  width?: number;
  height?: number;
  maxWeight?: number;
  owner?: string | boolean;
  groups?: Record<string, number>;
  coords?: Vector3 | Vector3[];
  distance?: number;
}

/**
 * Registers a stash configuration. Call this on resource start.
 */
export function RegisterStash(config: StashConfig): void {
  if (registeredStashes.has(config.id)) {
    console.warn(`^3[ox_inventory] Stash '${config.id}' already registered, overwriting^0`);
  }

  registeredStashes.set(config.id, {
    width: Config.Player_Width,
    height: Config.Player_Height,
    maxWeight: Config.Player_MaxWeight,
    ...config,
  });

  console.log(`^2[ox_inventory] Registered stash: ${config.id}^0`);
}

/**
 * Gets a registered stash configuration.
 */
export function GetStashConfig(stashId: string): StashConfig | undefined {
  return registeredStashes.get(stashId);
}

/**
 * Gets or creates an inventory by its ID.
 */
export async function GetInventory(inventoryId: string | number, data: Partial<Inventory> = {}) {
  // Handle numeric IDs (player source) first
  if (typeof inventoryId === 'number') {
    inventoryId = GetPlayerInventoryId(inventoryId);
  }

  // Now inventoryId is guaranteed to be a string
  const inventoryType = inventoryId.slice(0, inventoryId.indexOf(':'));

  const inventory = Inventory.FromId(inventoryId);

  if (inventory) return inventory;

  switch (inventoryType) {
    case 'player':
      break;

    case 'container': {
      const itemId = +inventoryId.slice(inventoryId.indexOf(':') + 1);
      const item = GetInventoryItem(itemId);

      if (!item?.inventory) {
        throw new Error(`Invalid container item ${itemId}`);
      }

      data.width = item.inventory.width;
      data.height = item.inventory.height;
      data.maxWeight = item.inventory.weight;
      data.label = `${item.label} - ${item.uniqueId}`;

      break;
    }

    case 'bag': {
      const itemId = +inventoryId.slice(inventoryId.indexOf(':') + 1);
      const item = GetInventoryItem(itemId);

      if (!item?.inventory) {
        throw new Error(`Invalid bag item ${itemId}`);
      }

      data.width = item.inventory.width;
      data.height = item.inventory.height;
      data.maxWeight = item.inventory.weight;
      data.label = `${item.label} - ${item.uniqueId}`;

      break;
    }

    case 'stash': {
      const stashId = inventoryId.slice(inventoryId.indexOf(':') + 1);
      const stashConfig = registeredStashes.get(stashId);

      if (!stashConfig) {
        throw new Error(`Stash '${stashId}' is not registered`);
      }

      // Handle owned stashes (e.g., stash:police:officer123)
      const parts = stashId.split(':');
      let owner: string | undefined;

      if (parts.length > 1 && stashConfig.owner === true) {
        owner = parts.slice(1).join(':');
        data.ownerId = owner;
      } else if (typeof stashConfig.owner === 'string') {
        data.ownerId = stashConfig.owner;
      }

      data.label = stashConfig.label;
      data.width = stashConfig.width;
      data.height = stashConfig.height;
      data.maxWeight = stashConfig.maxWeight;
      data.coords = stashConfig.coords as any;
      data.radius = stashConfig.distance;

      // Store groups for access control
      if (stashConfig.groups) {
        (data as any).groups = stashConfig.groups;
      }

      break;
    }

    case 'trunk':
    case 'glovebox': {
      const [netId, entityId, plate, isTemporary] = GetVehicleFromInventoryId(inventoryId);

      // Use plate-based inventory ID (like v2: trunk:ABC123)
      let plateId = plate;
      if (Config.TrimPlates && typeof plate === 'string') {
        plateId = plate.trim();
      }

      inventoryId = `${inventoryType}:${plateId}`;
      const existingInventory = Inventory.FromId(inventoryId);

      if (existingInventory) return existingInventory;

      // No entity exists - can't create inventory without vehicle data
      if (!netId || !entityId) {
        console.warn(`[ox_inventory] Cannot create ${inventoryType} inventory - no vehicle entity found for plate: ${plateId}`);
        return;
      }

      const playerId = NetworkGetEntityOwner(entityId);

      if (!playerId) {
        console.warn(`[ox_inventory] Cannot create ${inventoryType} inventory - vehicle has no owner`);
        return;
      }

      const vClass = (await triggerClientCallback('ox_inventory:getVehicleClass', playerId, netId)) as number;
      const vehicleClass = vehicleClasses[vClass];
      const label = inventoryType === 'trunk' ? 'Trunk' : 'Glovebox';
      const configKey = `Vehicle_${vehicleClass}_${label}`;

      data.height = Config[`${configKey}_Height` as any];
      data.width = Config[`${configKey}_Width` as any];
      data.weight = Config[`${configKey}_Weight` as any];

      // Fallback to default if vehicle class not configured
      if (!data.height) {
        data.height = inventoryType === 'glovebox' ? 2 : 8;
        data.width = inventoryType === 'glovebox' ? 4 : 10;
        data.weight = inventoryType === 'glovebox' ? 10000 : 100000;
      }

      data.label = `${label} - ${plateId}`;
      data.netId = netId;
      data.entityId = entityId;

      if (isTemporary) data.isTemporary = true;

      break;
    }

    case 'drop':
      data.label = `Drop ${+GetHashKey(inventoryId)}`;
      data.width = Config.Drop_Width;
      data.height = Config.Drop_Height;
      data.maxWeight = Config.Drop_MaxWeight;
      data.isTemporary = true;

      break;

    case 'evidence': {
      // Police evidence locker
      const lockerId = inventoryId.slice(inventoryId.indexOf(':') + 1);
      data.label = `Evidence Locker #${lockerId}`;
      data.width = 10;
      data.height = 10;
      data.maxWeight = 1000000;
      (data as any).groups = Config.Police?.reduce((acc: Record<string, number>, g: string) => {
        acc[g] = 0;
        return acc;
      }, {});

      break;
    }

    case 'dumpster': {
      // Searchable dumpster
      const dumpsterId = inventoryId.slice(inventoryId.indexOf(':') + 1);
      data.label = 'Dumpster';
      data.width = 4;
      data.height = 4;
      data.maxWeight = 100000;
      data.isTemporary = true;

      break;
    }

    default:
      throw new Error(`Invalid inventory type '${inventoryType}' for id '${inventoryId}'`);
  }

  data.inventoryId = inventoryId;
  data.type = inventoryType;

  if (data.entityId) {
    Entity(data.entityId).state.inventoryId = data.inventoryId;
  }

  return new Inventory(data);
}

// Export RegisterStash for external use
exports('RegisterStash', RegisterStash);
exports('GetStashConfig', GetStashConfig);
