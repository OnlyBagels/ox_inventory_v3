/**
 * Client-side shop handling for ox_inventory
 * Handles NUI communication, shop targets, blips, ped spawning, and model-based interactions
 */

import { triggerServerCallback } from '@communityox/ox_lib/client';

// Shop state
let currentShop: string | null = null;
let isShopOpen = false;

// Blips tracking
const shopBlips: Map<string, number> = new Map();

// Target zones tracking
const shopTargets: Map<string, any> = new Map();

// Spawned peds tracking
const shopPeds: Map<string, number> = new Map();

// Types
interface ShopOpenResponse {
  player: {
    id: string;
    weight: number;
    maxWeight: number;
  };
  shop: {
    id: string;
    label: string;
    items: any[];
    isBuyShop: boolean;
  };
  playerData: {
    cash: number;
    bank: number;
    dirtyMoney: number;
    weight: number;
    maxWeight: number;
    licenses: Record<string, boolean>;
    job: { name: string; grade: number };
    skills: Record<string, number>;
  };
}

interface PurchaseRequest {
  shopId: string;
  items: Array<{ id: number; name: string; quantity: number }>;
  currency: 'cash' | 'card' | 'dirty_money';
}

interface SellRequest {
  shopId: string;
  items: Array<{ name: string; quantity: number }>;
}

interface ShopBlip {
  id: number;
  colour: number;
  scale: number;
}

interface ShopTarget {
  coords: [number, number, number];
  length: number;
  width: number;
  heading: number;
  minZ: number;
  maxZ: number;
  distance: number;
}

interface ShopConfig {
  label: string;
  blip?: ShopBlip;
  locations?: number[][];
  targets?: ShopTarget[];
  models?: string[];
  groups?: Record<string, number>;
  shopType?: 'sell' | 'buy';
}

/**
 * Open a regular shop (player buys from NPC)
 */
export async function openShop(shopType: string, shopId?: number): Promise<boolean> {
  if (isShopOpen) return false;

  const response = await triggerServerCallback<ShopOpenResponse | null>(
    'ox_inventory:openShop',
    100,
    { type: shopType, id: shopId }
  );

  if (!response) {
    console.warn('[ox_inventory] Failed to open shop:', shopType);
    return false;
  }

  currentShop = response.shop.id;
  isShopOpen = true;

  // Send NUI message to open shop UI
  SendNUIMessage({
    action: 'openShop',
    data: {
      shop: response.shop,
      playerData: response.playerData,
    },
  });

  SetNuiFocus(true, true);
  return true;
}

/**
 * Open a buy shop (player sells to NPC)
 */
export async function openBuyShop(shopType: string, shopId?: number): Promise<boolean> {
  if (isShopOpen) return false;

  const response = await triggerServerCallback<ShopOpenResponse | null>(
    'ox_inventory:openBuyShop',
    100,
    { type: shopType, id: shopId }
  );

  if (!response) {
    console.warn('[ox_inventory] Failed to open buy shop:', shopType);
    return false;
  }

  currentShop = response.shop.id;
  isShopOpen = true;

  // Send NUI message to open shop UI
  SendNUIMessage({
    action: 'openShop',
    data: {
      shop: response.shop,
      playerData: response.playerData,
    },
  });

  SetNuiFocus(true, true);
  return true;
}

/**
 * Close the current shop
 */
export function closeShop(): void {
  if (!isShopOpen) return;

  currentShop = null;
  isShopOpen = false;

  SendNUIMessage({
    action: 'closeShop',
  });

  SetNuiFocus(false, false);
}

/**
 * Purchase items from the current shop
 */
export async function purchaseItems(
  items: Array<{ id: number; name: string; quantity: number }>,
  currency: 'cash' | 'card' | 'dirty_money'
): Promise<{ success: boolean; message?: string }> {
  if (!currentShop || !isShopOpen) {
    return { success: false, message: 'No shop open' };
  }

  const request: PurchaseRequest = {
    shopId: currentShop,
    items,
    currency,
  };

  const [success, result] = await triggerServerCallback<[boolean, any]>(
    'ox_inventory:buyItem',
    100,
    request
  );

  if (!success) {
    return { success: false, message: typeof result === 'string' ? result : 'Purchase failed' };
  }

  // Update player data after purchase
  refreshPlayerData();

  return {
    success: true,
    message: result.message || `Purchased ${result.items?.length || 0} item(s)`,
  };
}

/**
 * Sell items to a buy shop
 */
export async function sellItems(
  items: Array<{ name: string; quantity: number }>
): Promise<{ success: boolean; message?: string }> {
  if (!currentShop || !isShopOpen) {
    return { success: false, message: 'No shop open' };
  }

  const request: SellRequest = {
    shopId: currentShop,
    items,
  };

  const [success, result] = await triggerServerCallback<[boolean, any]>(
    'ox_inventory:sellItems',
    100,
    request
  );

  if (!success) {
    return { success: false, message: typeof result === 'string' ? result : 'Sale failed' };
  }

  // Update player data after sale
  refreshPlayerData();

  return {
    success: true,
    message: result.message || `Sold items for $${result.totalEarned || 0}`,
  };
}

/**
 * Refresh current shop stock
 */
export async function refreshShopStock(): Promise<void> {
  if (!currentShop) return;

  const items = await triggerServerCallback<any[] | null>(
    'ox_inventory:getShopStock',
    100,
    { shopId: currentShop }
  );

  if (items) {
    SendNUIMessage({
      action: 'updateShopItems',
      data: items,
    });
  }
}

/**
 * Refresh player data (funds, weight, etc.)
 */
async function refreshPlayerData(): Promise<void> {
  if (!currentShop) return;

  const playerData = await triggerServerCallback<any>(
    'ox_inventory:getShopPlayerData',
    100,
    { shopId: currentShop }
  );

  if (playerData) {
    SendNUIMessage({
      action: 'updateShopPlayerData',
      data: playerData,
    });
  }
}

/**
 * Check if a shop is currently open
 */
export function isShopCurrentlyOpen(): boolean {
  return isShopOpen;
}

/**
 * Get the current shop ID
 */
export function getCurrentShopId(): string | null {
  return currentShop;
}

// ============================================================
// BLIP MANAGEMENT
// ============================================================

/**
 * Create a blip for a shop location
 */
function createShopBlip(
  shopType: string,
  index: number,
  coords: [number, number, number],
  blipConfig: ShopBlip,
  label: string
): number {
  const blip = AddBlipForCoord(coords[0], coords[1], coords[2]);

  SetBlipSprite(blip, blipConfig.id);
  SetBlipColour(blip, blipConfig.colour);
  SetBlipScale(blip, blipConfig.scale);
  SetBlipAsShortRange(blip, true);

  BeginTextCommandSetBlipName('STRING');
  AddTextComponentSubstringPlayerName(label);
  EndTextCommandSetBlipName(blip);

  const blipKey = `${shopType}:${index}`;
  shopBlips.set(blipKey, blip);

  return blip;
}

/**
 * Remove all shop blips
 */
function removeAllBlips(): void {
  for (const [key, blip] of shopBlips) {
    if (DoesBlipExist(blip)) {
      RemoveBlip(blip);
    }
  }
  shopBlips.clear();
}

// ============================================================
// TARGET MANAGEMENT (ox_target)
// ============================================================

/**
 * Create shop targets using ox_target
 */
function createShopTargets(
  shopType: string,
  targets: ShopTarget[],
  label: string,
  isBuyShop: boolean,
  groups?: Record<string, number>
): void {
  if (GetResourceState('ox_target') !== 'started') return;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const targetId = `shop_${shopType}_${i}`;

    // ox_target expects coords as vec3
    const coords = Array.isArray(target.coords)
      ? vector3(target.coords[0], target.coords[1], target.coords[2])
      : target.coords;

    // Build option object - only include groups if they exist
    const optionConfig: any = {
      name: `${targetId}_interact`,
      label: isBuyShop ? `Sell to ${label}` : `Browse ${label}`,
      icon: isBuyShop ? 'fas fa-hand-holding-usd' : 'fas fa-shopping-cart',
      onSelect: () => {
        if (isBuyShop) {
          openBuyShop(shopType, i + 1);
        } else {
          openShop(shopType, i + 1);
        }
      },
    };

    // Only add groups if specified (ox_target uses job-based restrictions)
    if (groups && Object.keys(groups).length > 0) {
      optionConfig.groups = groups;
    }

    const zoneOptions: any = {
      name: targetId,
      coords: coords,
      size: vector3(target.length, target.width, (target.maxZ || 1) - (target.minZ || 0)),
      rotation: target.heading,
      debug: false,
      distance: target.distance || 2.0,
      options: [optionConfig],
    };

    exports.ox_target.addBoxZone(zoneOptions);
    shopTargets.set(targetId, zoneOptions);
  }
}

/**
 * Create model-based shop targets (for vending machines, etc.)
 */
function createModelTargets(
  shopType: string,
  models: string[],
  label: string,
  isBuyShop: boolean
): void {
  if (GetResourceState('ox_target') !== 'started') return;

  // ox_target addModel expects model names as strings, not hashes
  const options = {
    name: `shop_model_${shopType}`,
    label: isBuyShop ? `Sell to ${label}` : `Browse ${label}`,
    icon: isBuyShop ? 'fas fa-hand-holding-usd' : 'fas fa-shopping-cart',
    distance: 2.0,
    onSelect: () => {
      if (isBuyShop) {
        openBuyShop(shopType);
      } else {
        openShop(shopType);
      }
    },
  };

  // Add each model separately
  for (const model of models) {
    try {
      exports.ox_target.addModel(model, options);
    } catch (e) {
      console.warn(`[ox_inventory] Failed to add model target for ${model}:`, e);
    }
  }
}

/**
 * Remove all shop targets
 */
function removeAllTargets(): void {
  if (GetResourceState('ox_target') !== 'started') return;

  for (const [targetId] of shopTargets) {
    exports.ox_target.removeZone(targetId);
  }
  shopTargets.clear();
}

// ============================================================
// PED SPAWNING
// ============================================================

/**
 * Spawn a shop ped at a location
 */
async function spawnShopPed(
  shopType: string,
  index: number,
  coords: number[],
  model: string,
  label: string,
  isBuyShop: boolean,
  groups?: Record<string, number>
): Promise<void> {
  const pedKey = `${shopType}:${index}`;

  // Don't spawn if already exists
  if (shopPeds.has(pedKey)) return;

  // Request model
  const modelHash = GetHashKey(model);
  RequestModel(modelHash);

  let attempts = 0;
  while (!HasModelLoaded(modelHash) && attempts < 100) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    attempts++;
  }

  if (!HasModelLoaded(modelHash)) {
    console.warn(`[ox_inventory] Failed to load model ${model} for shop ${shopType}`);
    return;
  }

  // Get heading from coords (4th element) or default to 0
  const heading = coords[3] ?? 0;

  // Create ped
  const ped = CreatePed(0, modelHash, coords[0], coords[1], coords[2] - 1.0, heading, false, false);

  SetModelAsNoLongerNeeded(modelHash);

  if (!DoesEntityExist(ped)) {
    console.warn(`[ox_inventory] Failed to create ped for shop ${shopType}`);
    return;
  }

  // Configure ped
  SetEntityInvincible(ped, true);
  SetBlockingOfNonTemporaryEvents(ped, true);
  FreezeEntityPosition(ped, true);
  SetPedCanBeTargetted(ped, false);
  SetPedCanBeKnockedOffVehicle(ped, 1);
  SetPedCanRagdoll(ped, false);
  SetPedDiesWhenInjured(ped, false);

  // Store ped reference
  shopPeds.set(pedKey, ped);

  // Add ox_target to the ped
  if (GetResourceState('ox_target') === 'started') {
    const optionConfig: any = {
      name: `shop_ped_${shopType}_${index}`,
      label: isBuyShop ? `Sell to ${label}` : `Browse ${label}`,
      icon: isBuyShop ? 'fas fa-hand-holding-usd' : 'fas fa-shopping-cart',
      distance: 2.5,
      onSelect: () => {
        if (isBuyShop) {
          openBuyShop(shopType, index + 1);
        } else {
          openShop(shopType, index + 1);
        }
      },
    };

    // Add groups restriction if specified
    if (groups && Object.keys(groups).length > 0) {
      optionConfig.groups = groups;
    }

    exports.ox_target.addLocalEntity(ped, optionConfig);
  }
}

/**
 * Remove all spawned shop peds
 */
function removeAllPeds(): void {
  for (const [key, ped] of shopPeds) {
    if (DoesEntityExist(ped)) {
      // Remove ox_target from ped
      if (GetResourceState('ox_target') === 'started') {
        exports.ox_target.removeLocalEntity(ped);
      }
      DeleteEntity(ped);
    }
  }
  shopPeds.clear();
}

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Initialize shops from server config
 */
async function initializeShops(): Promise<void> {
  console.log('[ox_inventory] Client: Requesting shop configs from server...');

  // Request shop configs from server
  const shopConfigs = await triggerServerCallback<Record<string, ShopConfig> | null>(
    'ox_inventory:getShopConfigs',
    100,
    {}
  );

  if (!shopConfigs) {
    console.warn('[ox_inventory] Client: Failed to get shop configs (null response)');
    return;
  }

  const shopTypes = Object.keys(shopConfigs);
  console.log(`[ox_inventory] Client: Received ${shopTypes.length} shop types: ${shopTypes.join(', ')}`);

  let blipCount = 0;
  let targetCount = 0;

  let pedCount = 0;

  for (const [shopType, config] of Object.entries(shopConfigs)) {
    const isBuyShop = config.shopType === 'buy';

    // Create blips for location-based shops
    if (config.blip && config.locations && config.locations.length > 0) {
      for (let i = 0; i < config.locations.length; i++) {
        const location = config.locations[i];
        // Handle both [x,y,z] and [x,y,z,h] formats
        const coords: [number, number, number] = [location[0], location[1], location[2]];
        createShopBlip(shopType, i, coords, config.blip, config.label);
        blipCount++;
      }
    }

    // Spawn peds at shop locations (if models are defined)
    if (config.models && config.models.length > 0 && config.locations && config.locations.length > 0) {
      for (let i = 0; i < config.locations.length; i++) {
        const location = config.locations[i];
        // Use first model or cycle through models
        const model = config.models[i % config.models.length];
        spawnShopPed(shopType, i, location, model, config.label, isBuyShop, config.groups);
        pedCount++;
      }
    }

    // Create targets for location-based shops (without peds)
    if (config.targets && config.targets.length > 0) {
      createShopTargets(shopType, config.targets, config.label, isBuyShop, config.groups);
      targetCount += config.targets.length;
    }

    // Create model-based targets for existing world peds/objects (vending machines, etc.)
    // Only if no locations are defined (otherwise we spawn our own peds)
    if (config.models && config.models.length > 0 && (!config.locations || config.locations.length === 0)) {
      createModelTargets(shopType, config.models, config.label, isBuyShop);
    }
  }

  console.log(`[ox_inventory] Client: Spawning ${pedCount} shop peds...`);

  console.log(`[ox_inventory] Client: Created ${blipCount} blips and ${targetCount} target zones`);
  console.log(`[ox_inventory] Client: Blips map size: ${shopBlips.size}, Targets map size: ${shopTargets.size}`);
}

// Initialize when player spawns
onNet('QBCore:Client:OnPlayerLoaded', () => {
  setTimeout(() => {
    initializeShops();
  }, 2000);
});

// Also initialize on resource start (in case player already loaded)
setTimeout(() => {
  if (LocalPlayer.state.isLoggedIn) {
    initializeShops();
  }
}, 1000);

// Cleanup on resource stop
on('onResourceStop', (resourceName: string) => {
  if (resourceName === GetCurrentResourceName()) {
    removeAllBlips();
    removeAllTargets();
    removeAllPeds();
  }
});

// ============================================================
// NUI CALLBACKS
// ============================================================

RegisterNuiCallback('shop:purchase', async (data: any, cb: (response: any) => void) => {
  const result = await purchaseItems(data.items, data.currency);
  cb(result);
});

RegisterNuiCallback('shop:sell', async (data: any, cb: (response: any) => void) => {
  const result = await sellItems(data.items);
  cb(result);
});

RegisterNuiCallback('shop:close', (_data: any, cb: (response: any) => void) => {
  closeShop();
  cb({ success: true });
});

RegisterNuiCallback('shop:refreshStock', async (_data: any, cb: (response: any) => void) => {
  await refreshShopStock();
  cb({ success: true });
});

// Listen for stock updates from server
onNet('ox_inventory:shopStockUpdate', (data: { shopId: string; items: any[] }) => {
  if (currentShop === data.shopId) {
    SendNUIMessage({
      action: 'updateShopItems',
      data: data.items,
    });
  }
});

// ============================================================
// EXPORTS
// ============================================================

exports('OpenShop', openShop);
exports('OpenBuyShop', openBuyShop);
exports('CloseShop', closeShop);
exports('IsShopOpen', isShopCurrentlyOpen);
exports('RefreshShopBlips', initializeShops);
