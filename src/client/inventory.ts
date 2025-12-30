import type { BaseInventory } from '@common/inventory/class';
import type { InventoryItem } from '@common/item/index';
import { cache, requestAnimDict, requestModel, sleep, triggerServerCallback, waitFor } from '@communityox/ox_lib/client';
import './context';
import config from '@common/config';
import { Grid, type GridEntry } from '@common/grid';
import locale from '@common/locale';
import { Vector2, Vector3 } from '@nativewrappers/common';
import vehicleClasses from '@static/vehicleClasses.json';
import { ValidateItemData } from './item';

export enum InventoryState {
  Closed = 0,
  Closing = 1,
  Open = 2,
  Busy = 3,
}

type InventoryGridEntry = GridEntry & { inventoryId: string; type: string; label: string; model?: string };

export let inventoryState: InventoryState = InventoryState.Closed;
export const openInventories = new Map<string, BaseInventory>();

const grid = new Grid<InventoryGridEntry>();
let nearbyInventories: InventoryGridEntry[] = [];

// Track spawned drop objects
const dropObjects: Map<string, number> = new Map();

// Default drop model (medical bag) - same as ox_inventory v2
const DEFAULT_DROP_MODEL = 'prop_med_bag_01b';

async function SpawnDropObject(inventoryId: string, coords: { x: number; y: number; z: number }, model?: string) {
  let actualModel = model || DEFAULT_DROP_MODEL;

  // Try to load the requested model, fall back to default if it fails
  let modelHash = GetHashKey(actualModel);
  let loaded = await requestModel(actualModel);

  if (!loaded && model) {
    // Custom model failed, try the default
    console.warn(`[ox_inventory] Failed to load model '${actualModel}', using default`);
    actualModel = DEFAULT_DROP_MODEL;
    modelHash = GetHashKey(actualModel);
    loaded = await requestModel(actualModel);
  }

  if (!loaded) {
    console.error(`[ox_inventory] Failed to load drop model: ${actualModel}`);
    return;
  }

  // Create the object
  const object = CreateObject(modelHash, coords.x, coords.y, coords.z - 0.5, false, false, false);

  if (object) {
    // Place on ground or object surface properly (includes tables, etc.)
    PlaceObjectOnGroundOrObjectProperly(object);
    // Rotate 90 degrees (only for custom models like weapons, not the default bag)
    if (model) {
      SetEntityRotation(object, -90.0, 0.0, 0.0, 2, true);
    }
    FreezeEntityPosition(object, true);

    // Store reference
    dropObjects.set(inventoryId, object);
  }

  SetModelAsNoLongerNeeded(modelHash);
}

function DeleteDropObject(inventoryId: string) {
  const object = dropObjects.get(inventoryId);

  if (object && DoesEntityExist(object)) {
    DeleteEntity(object);
  }

  dropObjects.delete(inventoryId);
}

function AddGridEntry(data: InventoryGridEntry) {
  data.width = 1;
  data.length = 1;

  grid.addEntry(data, 'inventoryId');

  // Spawn prop object for all drops (uses default bag if no weapon model)
  if (data.coords) {
    SpawnDropObject(data.inventoryId, data.coords, data.model);
  }
}

function RemoveGridEntry(inventoryId: string) {
  const entry = grid.getEntry(inventoryId);

  if (entry) {
    grid.removeEntry(entry, 'inventoryId');
    DeleteDropObject(inventoryId);
  }
}

export function GetClosestInventory(type: string, distance: number = 1) {
  if (nearbyInventories.length === 0) return;

  // Don't return drops if player is in a vehicle
  if (type === 'drop' && cache.vehicle) return null;

  const closest = nearbyInventories.reduce((acc, value) => {
    if (!type || type !== value.type) return acc;

    return value.distance < acc.distance ? value : acc;
  });

  return closest.distance <= distance && (!type || type === closest.type) ? closest.inventoryId : null;
}

export function GetNearbyInventories() {
  if (nearbyInventories.length === 0) return [];

  // Filter out drops if player is in a vehicle
  const isInVehicle = !!cache.vehicle;

  return nearbyInventories
    .filter((entry) => entry.distance <= 1 && (!isInVehicle || entry.type !== 'drop'))
    .map((entry) => entry.inventoryId);
}

export async function OpenInventory(data: { inventory: BaseInventory; items: InventoryItem[]; playerId: number }) {
  data.playerId = cache.serverId;

  await Promise.all(data.items.map(ValidateItemData));

  if (data.inventory.coords) {
    data.inventory.coords = data.inventory.netId ? null : Vector3.fromObject(data.inventory.coords);
  }

  openInventories.set(data.inventory.inventoryId, data.inventory);

  // Set inventory state to Open
  inventoryState = InventoryState.Open;

  // Enable NUI focus with cursor - mouse input goes to NUI only
  SetNuiFocus(true, true);

  SendNUIMessage({
    action: 'openInventory',
    data: data,
  });
}

export function CloseInventory(data?: { inventoryId: string; inventoryCount: number }, cb?: NuiCb) {
  emitNet('ox_inventory:closeInventory', data?.inventoryId);

  if (data?.inventoryId) openInventories.delete(data.inventoryId);
  else openInventories.clear();

  SendNUIMessage({
    action: 'closeInventory',
    data: data?.inventoryId,
  });

  if (!data || !data.inventoryCount) {
    SetNuiFocus(false, false);
    // Set inventory state to Closed when all inventories are closed
    inventoryState = InventoryState.Closed;
  }

  if (cb) cb(1);
}

export async function RequestOpenInventory(inventories: (string | number)[] = []) {
  if (!CanAccessInventory()) return false;

  inventories = [...inventories, ...GetNearbyInventories()];

  const { vehicle, seat } = cache;
  const isInVehicle = vehicle && seat !== false;

  if (isInVehicle && seat < 2) {
    // Inside vehicle (front seats) - open glovebox
    const vehicleClass = vehicleClasses[GetVehicleClass(vehicle)];
    const configKey = `Vehicle_${vehicleClass}_Glovebox_Weight`;
    const hasGlovebox = config[configKey as any];

    if (hasGlovebox) {
      // Use plate-based inventory ID like v2 (glovebox:ABC123)
      let plate = GetVehicleNumberPlateText(vehicle);
      if (config.TrimPlates) {
        plate = plate?.trim();
      }
      inventories.push(`glovebox:${plate}`);
    }
  }

  await triggerServerCallback('ox_inventory:requestOpenInventory', 100, inventories);

  return true;
}

export async function OpenVehicleTrunk({ entity }: { entity: number }) {
  // Use plate-based inventory ID like v2
  let plate = GetVehicleNumberPlateText(entity);
  if (config.TrimPlates) {
    plate = plate?.trim();
  }

  const vehicleClass = vehicleClasses[GetVehicleClass(entity)];
  const configKey = `Vehicle_${vehicleClass}_Trunk_Weight`;
  const hasTrunk = config[configKey as any];

  if (!hasTrunk) return false;

  // Check if vehicle is locked - if so, check if player has keys
  // qbx_vehiclekeys uses entity state 'doorslockstate' which may differ from native
  const nativeLockStatus = GetVehicleDoorLockStatus(entity);
  const stateBagLockStatus = Entity(entity).state.doorslockstate;
  // Use statebag if available, otherwise fall back to native
  const lockStatus = stateBagLockStatus ?? nativeLockStatus;

  if (lockStatus >= 2) {
    // Vehicle is locked - check if player has keys via qbx_vehiclekeys
    let hasKeys = false;

    // Check if qbx_vehiclekeys resource is started
    if (GetResourceState('qbx_vehiclekeys') === 'started') {
      try {
        hasKeys = exports.qbx_vehiclekeys.HasKeys(entity);
      } catch (e) {
        hasKeys = false;
      }
    } else {
      // qbx_vehiclekeys not available, fall back to allowing access
      hasKeys = true;
    }

    if (!hasKeys) {
      // Player doesn't have keys to this locked vehicle - show notification
      if (exports.ox_lib?.notify) {
        exports.ox_lib.notify({
          title: 'Vehicle Locked',
          description: 'You don\'t have keys for this vehicle',
          type: 'error',
          duration: 3000,
        });
      }
      return false;
    }
  }

  const { doorIndex, isRearEngine } = GetVehicleTrunkData(entity) || {};

  if (!doorIndex) return false;

  const vehicleHash = GetEntityModel(entity);
  let [min, max] = GetModelDimensions(vehicleHash) as (number[] | Vector3)[];
  min = Vector3.fromArray(min as number[]);
  max = Vector3.fromArray(max as number[]);

  const offset = max
    .subtract(min)
    .multiply(new Vector3(0.5, isRearEngine ? 1.1 : -0.1, 0.5))
    .add(min);

  const goto = Vector2.fromArray(GetOffsetFromEntityInWorldCoords(entity, offset.x, offset.y, offset.z));

  TaskGotoEntityOffsetXy(cache.ped, entity, 4000, 0, offset.x, offset.y, 1.0, 1);

  const success = await waitFor(
    () => {
      const coords = Vector2.fromArray(GetEntityCoords(cache.ped, true));
      const distance = goto.subtract(coords).Length;

      if (distance <= 0.5) return true;
    },
    '',
    4000,
  ).catch(() => false);

  if (!success) return false;

  const state = Entity(entity).state;
  let inventoryId = state.inventoryId || `trunk:${plate}`;

  await RequestOpenInventory([inventoryId]);

  inventoryId = Entity(entity).state.inventoryId;

  if (!openInventories.has(inventoryId)) return false;

  const anim = await requestAnimDict('anim@heists@prison_heiststation@cop_reactions');
  const anim2 = await requestAnimDict('anim@heists@fleeca_bank@scope_out@return_case');

  RemoveAnimDict(anim);
  TaskPlayAnim(cache.ped, anim, 'cop_b_idle', 3, 3, -1, 49, 0, false, false, false);
  SetVehicleDoorOpen(entity, doorIndex, false, false);

  const interval = setInterval(() => {
    InvalidateIdleCam();
    SetVehicleDoorOpen(entity, doorIndex, false, false);
  }, 500);

  await waitFor(() => (openInventories.has(inventoryId) ? undefined : true), '', false);

  TaskPlayAnim(cache.ped, anim2, 'trevor_action', 2.0, 2.0, 1000, 49, 0.25, false, false, false);

  await sleep(900);

  SetVehicleDoorShut(entity, doorIndex, false);
  clearInterval(interval);
}

RegisterNuiCallback('closeInventory', CloseInventory);

RegisterNuiCallback('getStateKeyValue', ([state, key]: [state: string, key: string], cb: (value: unknown) => void) => {
  const value = state === 'global' ? GlobalState[key] : LocalPlayer.state[key];

  cb(value);
});

RegisterNuiCallback('moveItem', async (data: MoveItem, cb: NuiCb) => {
  if (config.Debug) console.log(`[client moveItem] Received: fromSlot=${data.fromSlot}, toSlot=${data.toSlot}, rotate=${data.rotate}`);

  // Prevent dropping items while in a vehicle (like v2)
  if (data.toType === 'drop' && cache.vehicle) {
    notify({
      id: 'cannot_drop_in_vehicle',
      description: 'Cannot drop items while in a vehicle',
      type: 'error',
    });
    return cb(0);
  }

  if (data.toType === 'drop' && !data.toId) {
    const nearestDrop = GetClosestInventory('drop');

    if (nearestDrop) {
      data.toId = nearestDrop;
      delete data.toSlot;
    } else data.coords = GetEntityCoords(cache.ped, true) as [number, number, number];
  }

  if (config.Debug) console.log(`[client moveItem] Calling server callback...`);
  const response = await triggerServerCallback<boolean>('ox_inventory:requestMoveItem', 50, data);
  if (config.Debug) console.log(`[client moveItem] Server response: ${response}`);
  cb(response ? 1 : 0);
});

RegisterNuiCallback('rotateItem', async (data: { inventoryId: string; uniqueId: number; rotate: boolean }, cb: NuiCb) => {
  const response = await triggerServerCallback<boolean>('ox_inventory:requestRotateItem', 50, data);
  cb(response ? 1 : 0);
});

onNet('ox_inventory:openInventory', OpenInventory);

onNet('ox_inventory:closeInventory', CloseInventory);

onNet('ox_inventory:updateItem', async (...args: InventoryItem[]) => {
  await Promise.all(args.map(ValidateItemData));

  SendNUIMessage({
    action: 'updateItem',
    data: args,
  });
});

onNet('ox_inventory:clearInventory', (data: { inventoryId: string; keepItems?: number[] }) => {
  SendNUIMessage({
    action: 'clearInventory',
    data,
  });
});

onNet('ox_inventory:addInventoryGrid', (data: InventoryGridEntry | InventoryGridEntry[]) => {
  if (!Array.isArray(data)) return AddGridEntry(data);

  for (const inventory of data) AddGridEntry(inventory);
});

onNet('ox_inventory:removeInventoryGrid', RemoveGridEntry);

// Clear all drops (used on resource restart)
onNet('ox_inventory:clearAllDrops', () => {
  // Delete all drop objects and remove from grid
  for (const [inventoryId, object] of dropObjects) {
    if (DoesEntityExist(object)) {
      DeleteEntity(object);
    }

    // Remove from grid
    const entry = grid.getEntry(inventoryId);
    if (entry) {
      grid.removeEntry(entry, 'inventoryId');
    }
  }
  dropObjects.clear();
});

export function CanAccessInventory(inventory?: BaseInventory) {
  // Skip checks if inventory is already open (prevents closing during use)
  if (inventoryState === InventoryState.Open) {
    // Only check fatal conditions when inventory is open
    if (IsPedFatallyInjured(cache.ped)) return false;

    // For player inventories, always allow access (you're always close to yourself)
    if (!inventory || inventory.type === 'player') return true;
  }

  // Full checks for opening inventory
  if (
    IsPedFatallyInjured(cache.ped) ||
    IsPedCuffed(cache.ped) ||
    IsPauseMenuActive() ||
    GetPedConfigFlag(cache.ped, 180, true)
  )
    return false;

  if (!inventory) return true;

  // Player inventories always accessible
  if (inventory.type === 'player') return true;

  const playerCoords = cache.coords as Vector3;
  let distance = 0;

  if (inventory.netId) {
    if (!NetworkDoesEntityExistWithNetworkId(inventory.netId)) {
      distance = 100;
    } else {
      const entityId = NetworkGetEntityFromNetworkId(inventory.netId);
      const coords = Vector3.fromArray(GetEntityCoords(entityId, true));
      distance = playerCoords.distance(coords);
    }
  } else if (inventory.coords) {
    distance = playerCoords.distance(inventory.coords as Vector3);
  }

  if (distance > (inventory.radius || 10)) return false;

  return true;
}

function GetVehicleTrunkData(entity: number) {
  const vehicleClass = vehicleClasses[GetVehicleClass(entity)];
  const configKey = `Vehicle_${vehicleClass}_Trunk_Weight`;

  if (!config[configKey as any]) return null;

  const engineBone = GetEntityBoneIndexByName(entity, 'engine');

  if (engineBone === -1) return null;

  const enginePosition = Vector3.fromArray(GetEntityBonePosition_2(entity, engineBone));
  const rearOffset = Vector3.fromArray(GetOffsetFromEntityInWorldCoords(entity, 0.5, 0, 0.5));
  const frontOffset = Vector3.fromArray(GetOffsetFromEntityInWorldCoords(entity, 0.5, 1, 0.5));
  const isRearEngine = enginePosition.subtract(rearOffset).Length < enginePosition.subtract(frontOffset).Length;
  let bootBone = GetEntityBoneIndexByName(entity, 'boot');

  if (bootBone === -1) {
    bootBone = GetEntityBoneIndexByName(entity, 'bonnet');
    const bootPosition = Vector3.fromArray(GetEntityBonePosition_2(entity, bootBone));
    const isRearBoot = bootPosition.subtract(rearOffset).Length < bootPosition.subtract(frontOffset).Length;

    if (isRearBoot) return null;
  }

  const doorIndex = isRearEngine ? 4 : 5;
  const lockStatus = GetVehicleIndividualDoorLockStatus(entity, doorIndex);

  if ((lockStatus > 1 && lockStatus !== 8) || !GetIsDoorValid(entity, doorIndex)) return null;

  return { doorIndex, isRearEngine };
}

setInterval(() => {
  const playerCoords = cache.coords as Vector3;
  nearbyInventories = grid.getNearbyEntries(playerCoords);

  for (const entry of nearbyInventories) {
    entry.distance = playerCoords.distance(entry.coords);
  }

  for (const inventory of openInventories.values()) {
    if (!CanAccessInventory(inventory)) {
      CloseInventory({ inventoryId: inventory.inventoryId, inventoryCount: openInventories.size - 1 });
    }
  }
}, 500);

// Props are now spawned for all drops - no markers needed

exports('openVehicleTrunk', OpenVehicleTrunk);
exports('requestOpenInventory', RequestOpenInventory);

if (GetResourceState('ox_target') === 'started') {
  exports.ox_target.addGlobalPlayer({
    label: locale('access_inventory'),
    icon: 'fas fa-search',
    onSelect: ({ entity }: { entity: number }) => {
      const targetId = GetPlayerServerId(NetworkGetEntityOwner(entity));

      RequestOpenInventory([targetId]);
    },
  });

  exports.ox_target.addGlobalVehicle({
    label: locale('access_inventory'),
    icon: 'fas fa-truck-ramp-box',
    export: 'openVehicleTrunk',
    canInteract: (entity: number) => {
      // Only check if trunk data exists - lock check happens in OpenVehicleTrunk
      // This way the option is visible but will show an error if locked without keys
      return !!Entity(entity).state.inventoryId || !!GetVehicleTrunkData(entity);
    },
    distance: 3,
  });
}

function SetDisplayMetadata(data: Record<string, string>) {
  SendNUIMessage({
    action: 'displayMetadata',
    data: data,
  });
}

exports('displayMetadata', SetDisplayMetadata);

// ============================================================
// V2 COMPATIBILITY EXPORTS - Full backwards compatibility
// ============================================================

// Player inventory state
let playerInventory: {
  items: Record<number, any>;
  weight: number;
  maxWeight: number;
  slots: number;
} = {
  items: {},
  weight: 0,
  maxWeight: 0,
  slots: 0,
};

// Update player inventory on open
onNet('ox_inventory:setPlayerInventory', (data: any) => {
  if (data) {
    playerInventory = {
      items: data.items || {},
      weight: data.weight || 0,
      maxWeight: data.maxWeight || 0,
      slots: data.slots || (data.width * data.height) || 0,
    };
  }
});

// GetPlayerItems - get all items in player inventory
exports('GetPlayerItems', () => {
  return playerInventory.items;
});

// GetPlayerWeight - get current weight
exports('GetPlayerWeight', () => {
  return playerInventory.weight;
});

// GetPlayerMaxWeight - get max weight capacity
exports('GetPlayerMaxWeight', () => {
  return playerInventory.maxWeight;
});

// Search - search player inventory for items
exports('Search', (itemName: string | string[], metadata?: Record<string, any>, strict?: boolean) => {
  const names = Array.isArray(itemName) ? itemName : [itemName];
  const items = Object.values(playerInventory.items);

  return items.filter((item: any) => {
    if (!item || !names.includes(item.name)) return false;
    if (metadata && strict) {
      return Object.entries(metadata).every(([key, value]) => item[key] === value);
    }
    if (metadata) {
      return Object.entries(metadata).some(([key, value]) => item[key] === value);
    }
    return true;
  });
});

// GetSlotWithItem - find first slot with item
exports('GetSlotWithItem', (itemName: string, metadata?: any, strict?: boolean) => {
  const items = Object.entries(playerInventory.items);

  for (const [slot, item] of items) {
    if (!item || item.name !== itemName) continue;
    if (metadata && strict) {
      if (!Object.entries(metadata).every(([key, value]) => item[key] === value)) continue;
    } else if (metadata) {
      if (!Object.entries(metadata).some(([key, value]) => item[key] === value)) continue;
    }
    return item;
  }
  return null;
});

// GetSlotIdWithItem - find first slot number with item
exports('GetSlotIdWithItem', (itemName: string, metadata?: any, strict?: boolean) => {
  const items = Object.entries(playerInventory.items);

  for (const [slot, item] of items) {
    if (!item || item.name !== itemName) continue;
    if (metadata && strict) {
      if (!Object.entries(metadata).every(([key, value]) => item[key] === value)) continue;
    } else if (metadata) {
      if (!Object.entries(metadata).some(([key, value]) => item[key] === value)) continue;
    }
    return parseInt(slot);
  }
  return null;
});

// GetSlotsWithItem - find all slots with item
exports('GetSlotsWithItem', (itemName: string, metadata?: any, strict?: boolean) => {
  return Object.values(playerInventory.items).filter((item: any) => {
    if (!item || item.name !== itemName) return false;
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
exports('GetItemCount', (itemName: string, metadata?: any, strict?: boolean) => {
  return Object.values(playerInventory.items).reduce((count: number, item: any) => {
    if (!item || item.name !== itemName) return count;
    if (metadata && strict) {
      const matches = Object.entries(metadata).every(([key, value]) => item[key] === value);
      return matches ? count + (item.count || item.quantity || 1) : count;
    }
    if (metadata) {
      const matches = Object.entries(metadata).some(([key, value]) => item[key] === value);
      return matches ? count + (item.count || item.quantity || 1) : count;
    }
    return count + (item.count || item.quantity || 1);
  }, 0);
});

// openInventory - open inventory UI
exports('openInventory', (inv?: string, data?: any) => {
  if (!inv) {
    return RequestOpenInventory();
  }

  // Handle different inventory types
  switch (inv) {
    case 'player':
      return RequestOpenInventory();
    case 'stash':
      return RequestOpenInventory([`stash:${data}`]);
    case 'trunk':
    case 'glovebox':
      if (typeof data === 'number') {
        return RequestOpenInventory([`${inv}:${data}`]);
      }
      return RequestOpenInventory([`${inv}:${data}`]);
    case 'container':
      return RequestOpenInventory([`container:${data}`]);
    case 'drop':
      return RequestOpenInventory([`drop:${data}`]);
    default:
      return RequestOpenInventory([inv]);
  }
});

// closeInventory - close inventory UI
exports('closeInventory', (server?: boolean) => {
  CloseInventory();
  if (server) {
    emitNet('ox_inventory:closeInventory');
  }
});

// useSlot - use item in a specific slot
exports('useSlot', async (slot: number, noAnim?: boolean) => {
  const item = playerInventory.items[slot];
  if (!item) return false;

  // Trigger server callback to use the item
  const response = await triggerServerCallback('ox_inventory:requestUseItem', 100, item.uniqueId || item.slot);
  return !!response;
});

// useItem - use a specific item
exports('useItem', async (data: { slot?: number; name?: string; metadata?: any }, cb?: Function, noAnim?: boolean) => {
  let item: any;

  if (data.slot !== undefined) {
    item = playerInventory.items[data.slot];
  } else if (data.name) {
    item = Object.values(playerInventory.items).find((i: any) => i && i.name === data.name);
  }

  if (!item) {
    if (cb) cb(false);
    return false;
  }

  const response = await triggerServerCallback('ox_inventory:requestUseItem', 100, item.uniqueId || item.slot);

  if (cb) cb(!!response);
  return !!response;
});

// getCurrentWeapon - get current weapon data
let currentWeaponData: any = null;

onNet('ox_inventory:updateCurrentWeapon', (weapon: any) => {
  currentWeaponData = weapon;
});

exports('getCurrentWeapon', () => {
  return currentWeaponData;
});

// setStashTarget - set target stash for keybind
let stashTarget: { id?: string | number; owner?: string | number } = {};

exports('setStashTarget', (id?: string | number, owner?: string | number) => {
  stashTarget = { id, owner };
});

exports('getStashTarget', () => stashTarget);

// openNearbyInventory - open nearest player inventory (for stealing)
exports('openNearbyInventory', async () => {
  const playerPed = cache.ped;
  const playerCoords = GetEntityCoords(playerPed, true);
  let closestPlayer: number | null = null;
  let closestDistance = 2.0;

  // Find closest player
  const players = GetActivePlayers();
  for (const player of players) {
    if (player === cache.playerId) continue;

    const targetPed = GetPlayerPed(player);
    const targetCoords = GetEntityCoords(targetPed, true);
    const distance = Math.sqrt(
      Math.pow(playerCoords[0] - targetCoords[0], 2) +
      Math.pow(playerCoords[1] - targetCoords[1], 2) +
      Math.pow(playerCoords[2] - targetCoords[2], 2)
    );

    if (distance < closestDistance) {
      closestDistance = distance;
      closestPlayer = GetPlayerServerId(player);
    }
  }

  if (closestPlayer) {
    return RequestOpenInventory([closestPlayer]);
  }

  return false;
});

// giveItemToTarget - give item to another player
exports('giveItemToTarget', async (serverId: number, slotId: number, count?: number) => {
  const item = playerInventory.items[slotId];
  if (!item) return false;

  // Move item to target player
  const response = await triggerServerCallback('ox_inventory:requestMoveItem', 100, {
    fromId: `player:${cache.serverId}`,
    toId: `player:${serverId}`,
    fromSlot: slotId,
    toSlot: -1,
    quantity: count || item.count || item.quantity || 1,
  });

  return !!response;
});

// notify - send notification
exports('notify', (data: { title?: string; description?: string; type?: string; duration?: number; icon?: string }) => {
  // Use ox_lib notification if available
  if (exports.ox_lib?.notify) {
    exports.ox_lib.notify({
      title: data.title,
      description: data.description,
      type: data.type || 'info',
      duration: data.duration || 3000,
      icon: data.icon,
    });
  } else {
    // Fallback to NUI message
    SendNUIMessage({
      action: 'notify',
      data: data,
    });
  }
});

// suppressItemNotifications - toggle item notifications
let suppressNotifications = false;

exports('suppressItemNotifications', (value: boolean) => {
  suppressNotifications = value;
});

exports('areNotificationsSuppressed', () => suppressNotifications);

// weaponWheel - enable/disable weapon wheel
exports('weaponWheel', (state?: boolean) => {
  if (state === undefined) {
    // Toggle
    SendNUIMessage({ action: 'toggleWeaponWheel' });
  } else {
    SendNUIMessage({ action: 'setWeaponWheel', data: state });
  }
});

// Keyboard - deprecated wrapper for input dialog
exports('Keyboard', (...args: any[]) => {
  if (exports.ox_lib?.inputDialog) {
    return exports.ox_lib.inputDialog(...args);
  }
  return null;
});

// Progress - deprecated wrapper for progress bar
exports('Progress', (options: any, completed?: Function) => {
  if (exports.ox_lib?.progressBar) {
    const result = exports.ox_lib.progressBar(options);
    if (completed) completed(result);
    return result;
  }
  return false;
});

// CancelProgress - cancel active progress
exports('CancelProgress', () => {
  if (exports.ox_lib?.cancelProgress) {
    exports.ox_lib.cancelProgress();
  }
});

// ProgressActive - check if progress is active
exports('ProgressActive', () => {
  if (exports.ox_lib?.progressActive) {
    return exports.ox_lib.progressActive();
  }
  return false;
});

// Items / ItemList - get item data (client-side)
const clientItemData: Record<string, any> = {};

onNet('ox_inventory:itemData', (items: Record<string, any>) => {
  Object.assign(clientItemData, items);
});

exports('Items', (itemName?: string) => {
  if (itemName) return clientItemData[itemName];
  return clientItemData;
});

exports('ItemList', (itemName?: string) => {
  if (itemName) return clientItemData[itemName];
  return clientItemData;
});

// setContainerProperties - set container item properties
exports('setContainerProperties', (containerName: string, properties: { slots?: number; maxWeight?: number; whitelist?: string[]; blacklist?: string[] }) => {
  // This would need to sync with server - for now just store locally
  SendNUIMessage({
    action: 'setContainerProperties',
    data: { containerName, properties },
  });
});

// Clean up drop objects when resource stops
on('onResourceStop', (resourceName: string) => {
  if (resourceName !== GetCurrentResourceName()) return;

  // Delete all spawned drop objects
  for (const [inventoryId, object] of dropObjects) {
    if (DoesEntityExist(object)) {
      DeleteEntity(object);
    }
  }
  dropObjects.clear();
});
