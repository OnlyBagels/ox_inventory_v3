import Config from '@common/config';
import { TriggerEventHooks } from '@common/hooks';
import { GetItemData, type ItemProperties } from '@common/item';
import { onClientCallback } from '@communityox/ox_lib/server';
import { hasGroup } from '../bridge';
import { GetInventory } from '../inventory';
import { LoadJsonFile } from '@common/utils';
import {
  checkSkillRequirement,
  getPlayerSkills,
  getRelevantSkills,
} from '../bridge/skills';
import {
  processPayment,
  refundPayment,
  getPlayerFunds,
  checkFunds,
} from './payments';
import { applyPriceFluctuation } from './pricing';
import {
  registerBuyShop,
  getSellableItems,
  processSale,
  getBuyShopData,
} from './buyShop';
import {
  startStockTimer,
  stopAllStockTimers,
  getRandomStock,
  hasRandomStock,
  decrementStockItem,
  onStockUpdate,
} from './stock';
import {
  isWeapon,
  isFirearm,
  registerWeaponPurchase,
  createWeaponMetadata,
} from './weapons';
import type {
  ShopItem,
  ShopBlip,
  ShopTarget,
  ShopConfig,
  Shop,
  ClientShopItem,
  PlayerShopData,
  PurchaseRequest,
  SellRequest,
  PaymentMethod,
  ShopOpenResponse,
  BuyShopOpenResponse,
} from './types';

// Re-export types
export type {
  ShopItem,
  ShopBlip,
  ShopTarget,
  ShopConfig,
  Shop,
  ClientShopItem,
  PaymentMethod,
};

// Registered shops
const registeredShops: Map<string, ShopConfig> = new Map();
const shopInstances: Map<string, Shop> = new Map();

/**
 * Loads shops from data/shops.json
 */
export async function loadShops(): Promise<void> {
  try {
    const shopsData = LoadJsonFile('data/shops.json') as Record<string, ShopConfig>;

    console.log(`^3[ox_inventory] Raw shops data type: ${typeof shopsData}^0`);
    console.log(`^3[ox_inventory] Shops data keys: ${Object.keys(shopsData).slice(0, 5).join(', ')}...^0`);

    for (const [shopType, config] of Object.entries(shopsData)) {
      registerShop(shopType, config);
    }

    console.log(`^2[ox_inventory] Loaded ${registeredShops.size} shop types^0`);
  } catch (error) {
    console.error('^1[ox_inventory] Failed to load shops:^0', error);
  }
}

/**
 * Registers a shop type.
 */
export function registerShop(shopType: string, config: ShopConfig): void {
  const shopTypeValue = config.shopType || 'sell';

  // Handle buy shops
  if (shopTypeValue === 'buy' && config.buyItems) {
    registerBuyShop(shopType, config.buyItems);
  }

  // Handle random stock shops
  if (config.randomStock) {
    startStockTimer(shopType, config.randomStock);
  }

  // Validate and setup items for sell shops
  const items: ShopItem[] = [];

  if (shopTypeValue === 'sell' || config.items) {
    for (let i = 0; i < (config.items?.length || 0); i++) {
      const item = config.items![i];
      const itemData = GetItemData(item.name);

      if (!itemData) {
        console.warn(`^3[ox_inventory] Shop '${shopType}' has invalid item '${item.name}'^0`);
        continue;
      }

      // Apply price fluctuation if enabled
      let price = item.price;
      if (config.fluctuatePrices) {
        price = applyPriceFluctuation(item.price);
      }

      items.push({
        ...item,
        price,
        slot: i + 1,
        currency: item.currency || 'money',
        category: item.category || 'General',
      });
    }
  }

  config.items = items;
  registeredShops.set(shopType, config);

  // Create shop instances for each location
  if (config.locations) {
    for (let i = 0; i < config.locations.length; i++) {
      const shopId = `${shopType}:${i + 1}`;
      const location = config.locations[i];
      const coords = Array.isArray(location) ? location : (location as any).coords;
      const target = config.targets?.[i];

      shopInstances.set(shopId, {
        id: shopId,
        label: config.label,
        items: [...items],
        groups: config.groups,
        coords,
        distance: target?.distance || 3.0,
        shopType: shopTypeValue,
        buyItems: config.buyItems,
        serialPrefix: config.serialPrefix,
      });
    }
  } else {
    // Single shop or model-based
    shopInstances.set(shopType, {
      id: shopType,
      label: config.label,
      items: [...items],
      groups: config.groups,
      shopType: shopTypeValue,
      buyItems: config.buyItems,
      serialPrefix: config.serialPrefix,
    });
  }

  console.log(
    `^2[ox_inventory] Registered shop: ${shopType} (${config.locations?.length || 1} locations, type: ${shopTypeValue})^0`
  );
}

/**
 * Gets a shop by its ID.
 */
export function getShop(shopId: string): Shop | undefined {
  return shopInstances.get(shopId);
}

/**
 * Gets a shop config by type.
 */
export function getShopConfig(shopType: string): ShopConfig | undefined {
  return registeredShops.get(shopType);
}

/**
 * Build client shop items with all metadata
 */
function buildClientShopItems(
  items: ShopItem[],
  playerId: number,
  shopType: string
): ClientShopItem[] {
  const relevantSkills = getRelevantSkills(shopType);
  const playerSkills = getPlayerSkills(playerId, relevantSkills);

  return items.map((item, index) => {
    const itemData = GetItemData(item.name);
    let isLocked = false;
    let lockReason: string | undefined;
    let playerSkillLevel: number | undefined;

    // Check skill requirements
    if (item.requiredSkill) {
      const skillCheck = checkSkillRequirement(playerId, item.requiredSkill);
      if (!skillCheck.hasSkill) {
        isLocked = true;
        lockReason = `Requires ${item.requiredSkill.skill} level ${item.requiredSkill.level}`;
        playerSkillLevel = skillCheck.currentLevel;
      }
    }

    return {
      id: index + 1,
      name: item.name,
      label: itemData?.properties?.label || item.name,
      price: item.price,
      weight: itemData?.properties?.weight || 0,
      width: itemData?.properties?.width || 1,
      height: itemData?.properties?.height || 1,
      count: item.count,
      category: item.category || 'General',
      license: item.license,
      jobs: item.jobs,
      imagePath: `nui://ox_inventory/web/images/${item.name}.png`,
      currency: item.currency,
      requiredSkill: item.requiredSkill,
      isLocked,
      lockReason,
      playerSkillLevel,
    };
  });
}

/**
 * Get player shop data
 */
async function getPlayerShopData(
  playerId: number,
  inventory: any,
  shopType: string
): Promise<PlayerShopData> {
  const funds = await getPlayerFunds(playerId, inventory);
  const relevantSkills = getRelevantSkills(shopType);
  const skills = getPlayerSkills(playerId, relevantSkills);

  // Get player job info
  let job = { name: '', grade: 0 };
  try {
    const Player = exports.qbx_core?.GetPlayer?.(playerId);
    if (Player?.PlayerData?.job) {
      job = {
        name: Player.PlayerData.job.name,
        grade: Player.PlayerData.job.grade?.level || 0,
      };
    }
  } catch {}

  // Get licenses
  let licenses: Record<string, boolean> = {};
  try {
    const Player = exports.qbx_core?.GetPlayer?.(playerId);
    if (Player?.PlayerData?.metadata?.licenses) {
      licenses = Player.PlayerData.metadata.licenses;
    }
  } catch {}

  return {
    cash: funds.cash,
    bank: funds.bank,
    dirtyMoney: funds.dirtyMoney,
    weight: inventory.weight,
    maxWeight: inventory.maxWeight,
    licenses,
    job,
    skills,
  };
}

// Client callback to open a shop
onClientCallback(
  'ox_inventory:openShop',
  async (playerId, data: { type: string; id?: number }): Promise<ShopOpenResponse | null> => {
    const inventory = await GetInventory(playerId);
    if (!inventory) return null;

    const shopId = data.id ? `${data.type}:${data.id}` : data.type;
    const shop = shopInstances.get(shopId) || shopInstances.get(data.type);

    if (!shop) {
      console.error(`^1[ox_inventory] Shop '${shopId}' not found^0`);
      return null;
    }

    // Check group restrictions
    if (shop.groups && inventory.player) {
      const [group] = hasGroup(inventory, shop.groups);
      if (!group) {
        return null;
      }
    }

    // Check distance if coords exist
    if (shop.coords) {
      const playerPed = GetPlayerPed(playerId);
      const playerCoords = GetEntityCoords(playerPed);
      const distance = Math.sqrt(
        Math.pow(playerCoords[0] - shop.coords[0], 2) +
          Math.pow(playerCoords[1] - shop.coords[1], 2) +
          Math.pow(playerCoords[2] - shop.coords[2], 2)
      );

      if (distance > (shop.distance || 10)) {
        return null;
      }
    }

    // Trigger hook
    using hook = await TriggerEventHooks('openShop', {
      playerId,
      shopId: shop.id,
      shopType: data.type,
      label: shop.label,
      items: shop.items,
      groups: shop.groups,
    });

    if (!hook.success) return null;

    // Open player inventory and set current shop
    inventory.open(playerId);
    inventory.currentShop = shop.id;

    // Get items - use random stock if available
    let shopItems: ShopItem[];
    if (hasRandomStock(data.type)) {
      shopItems = getRandomStock(data.type);
    } else {
      shopItems = shop.items;
    }

    const clientItems = buildClientShopItems(shopItems, playerId, data.type);
    const playerData = await getPlayerShopData(playerId, inventory, data.type);

    return {
      player: {
        id: inventory.inventoryId,
        weight: inventory.weight,
        maxWeight: inventory.maxWeight,
      },
      shop: {
        id: shop.id,
        label: shop.label,
        items: clientItems,
        isBuyShop: shop.shopType === 'buy',
      },
      playerData,
    };
  }
);

// Client callback to open a buy shop (NPC buys from player)
onClientCallback(
  'ox_inventory:openBuyShop',
  async (playerId, data: { type: string; id?: number }): Promise<BuyShopOpenResponse | null> => {
    const inventory = await GetInventory(playerId);
    if (!inventory) return null;

    const shopId = data.id ? `${data.type}:${data.id}` : data.type;
    const shop = shopInstances.get(shopId) || shopInstances.get(data.type);

    if (!shop || shop.shopType !== 'buy') {
      console.error(`^1[ox_inventory] Buy shop '${shopId}' not found^0`);
      return null;
    }

    // Check group restrictions
    if (shop.groups && inventory.player) {
      const [group] = hasGroup(inventory, shop.groups);
      if (!group) {
        return null;
      }
    }

    // Check distance if coords exist
    if (shop.coords) {
      const playerPed = GetPlayerPed(playerId);
      const playerCoords = GetEntityCoords(playerPed);
      const distance = Math.sqrt(
        Math.pow(playerCoords[0] - shop.coords[0], 2) +
          Math.pow(playerCoords[1] - shop.coords[1], 2) +
          Math.pow(playerCoords[2] - shop.coords[2], 2)
      );

      if (distance > (shop.distance || 10)) {
        return null;
      }
    }

    // Trigger hook
    using hook = await TriggerEventHooks('openShop', {
      playerId,
      shopId: shop.id,
      shopType: data.type,
      label: shop.label,
      items: [],
      groups: shop.groups,
      isBuyShop: true,
    });

    if (!hook.success) return null;

    // Open player inventory and set current shop
    inventory.open(playerId);
    inventory.currentShop = shop.id;

    // Get player's sellable items
    const playerItems = inventory.mapItems();
    const sellableItems = getSellableItems(data.type, playerItems);
    const playerData = await getPlayerShopData(playerId, inventory, data.type);

    return {
      player: {
        id: inventory.inventoryId,
        weight: inventory.weight,
        maxWeight: inventory.maxWeight,
      },
      shop: {
        id: shop.id,
        label: shop.label,
        items: sellableItems,
        isBuyShop: true,
      },
      playerData,
    };
  }
);

// Client callback to buy items
onClientCallback(
  'ox_inventory:buyItem',
  async (
    playerId,
    data: PurchaseRequest
  ): Promise<[boolean, string | { items: any[]; totalSpent: number; message: string }]> => {
    const inventory = await GetInventory(playerId);
    if (!inventory || inventory.currentShop !== data.shopId) {
      return [false, 'invalid_shop'];
    }

    const shopType = data.shopId.split(':')[0];
    const shop = shopInstances.get(data.shopId);
    if (!shop) return [false, 'shop_not_found'];

    // Get shop items (random stock or regular)
    let shopItems: ShopItem[];
    if (hasRandomStock(shopType)) {
      shopItems = getRandomStock(shopType);
    } else {
      shopItems = shop.items;
    }

    const purchasedItems: Array<{ name: string; quantity: number; price: number }> = [];
    let totalPrice = 0;

    // Validate all items first
    for (const purchaseItem of data.items) {
      const shopItem = shopItems.find((item) => item.name === purchaseItem.name);
      if (!shopItem) {
        return [false, `invalid_item_${purchaseItem.name}`];
      }

      // Check stock
      if (shopItem.count !== undefined && shopItem.count < purchaseItem.quantity) {
        return [false, 'out_of_stock'];
      }

      // Check skill requirements
      if (shopItem.requiredSkill) {
        const skillCheck = checkSkillRequirement(playerId, shopItem.requiredSkill);
        if (!skillCheck.hasSkill) {
          return [false, 'insufficient_skill'];
        }
      }

      // Check license
      if (shopItem.license) {
        try {
          const Player = exports.qbx_core?.GetPlayer?.(playerId);
          const licenses = Player?.PlayerData?.metadata?.licenses || {};
          if (!licenses[shopItem.license]) {
            return [false, 'missing_license'];
          }
        } catch {}
      }

      // Check grade
      if (shopItem.grade && inventory.player) {
        const [group, playerGrade] = hasGroup(inventory, shop.groups || {});
        if (group && playerGrade !== undefined) {
          const requiredGrades = Array.isArray(shopItem.grade)
            ? shopItem.grade
            : [shopItem.grade];
          if (!requiredGrades.includes(playerGrade)) {
            return [false, 'insufficient_grade'];
          }
        }
      }

      totalPrice += shopItem.price * purchaseItem.quantity;
    }

    // Check if player can afford
    const fundsCheck = await checkFunds(playerId, totalPrice, data.currency, inventory);
    if (!fundsCheck.hasFunds) {
      return [false, 'insufficient_funds'];
    }

    // Calculate total weight
    let totalWeight = 0;
    for (const purchaseItem of data.items) {
      const itemData = GetItemData(purchaseItem.name);
      if (itemData) {
        totalWeight += (itemData.properties.weight || 0) * purchaseItem.quantity;
      }
    }

    // Check weight capacity
    if (inventory.weight + totalWeight > inventory.maxWeight) {
      return [false, 'inventory_full'];
    }

    // Process payment
    const shopConfig = registeredShops.get(shopType);
    const paymentResult = await processPayment(
      playerId,
      totalPrice,
      data.currency,
      `Purchase from ${shop.label}`,
      inventory
    );

    if (!paymentResult.success) {
      return [false, paymentResult.error || 'payment_failed'];
    }

    // Add items to inventory
    for (const purchaseItem of data.items) {
      const shopItem = shopItems.find((item) => item.name === purchaseItem.name)!;
      const itemData = GetItemData(purchaseItem.name);

      // Trigger buyItem hook
      using hook = await TriggerEventHooks('buyItem', {
        playerId,
        shopId: shop.id,
        itemName: purchaseItem.name,
        count: purchaseItem.quantity,
        price: shopItem.price,
        totalPrice: shopItem.price * purchaseItem.quantity,
        currency: data.currency,
        metadata: shopItem.metadata,
      });

      if (!hook.success) {
        // Refund and skip this item
        await refundPayment(
          playerId,
          shopItem.price * purchaseItem.quantity,
          data.currency,
          `Refund for ${purchaseItem.name}`,
          inventory
        );
        continue;
      }

      // Prepare item properties
      let itemProperties: ItemProperties = {
        name: purchaseItem.name,
        quantity: purchaseItem.quantity,
        ...shopItem.metadata,
      };

      // Handle weapons - generate serial for all weapons
      if (isWeapon(purchaseItem.name)) {
        // Use shop's serialPrefix, or item's metadata.serial as prefix
        itemProperties = {
          ...itemProperties,
          ...createWeaponMetadata(shopItem.metadata, shop.serialPrefix),
        };

        // Only register FIREARMS to MDT (not melee/throwables)
        if (isFirearm(purchaseItem.name)) {
          // Delay registration slightly to ensure transaction completes
          setTimeout(() => {
            try {
              const Player = exports.qbx_core?.GetPlayer?.(playerId);
              const citizenId = Player?.PlayerData?.citizenid;
              registerWeaponPurchase(
                playerId,
                purchaseItem.name,
                (itemProperties as any).serial,
                shop.label,
                citizenId
              );
            } catch (error) {
              console.error('[ox_inventory] Failed to register weapon:', error);
            }
          }, 500);
        }
      }

      const addedItem = await inventory.addItem(itemProperties);
      if (!addedItem) {
        // Refund this item
        await refundPayment(
          playerId,
          shopItem.price * purchaseItem.quantity,
          data.currency,
          `Refund for ${purchaseItem.name}`,
          inventory
        );
        continue;
      }

      // Update stock
      if (shopItem.count !== undefined) {
        shopItem.count -= purchaseItem.quantity;
      }

      // Update random stock if applicable
      if (hasRandomStock(shopType)) {
        decrementStockItem(shopType, purchaseItem.name, purchaseItem.quantity);
      }

      purchasedItems.push({
        name: purchaseItem.name,
        quantity: purchaseItem.quantity,
        price: shopItem.price * purchaseItem.quantity,
      });
    }

    if (purchasedItems.length === 0) {
      return [false, 'no_items_purchased'];
    }

    // Trigger itemPurchased hook
    TriggerEventHooks('itemPurchased', {
      playerId,
      shopId: shop.id,
      items: purchasedItems,
      totalSpent: totalPrice,
      currency: data.currency,
    });

    return [
      true,
      {
        items: purchasedItems,
        totalSpent: totalPrice,
        message: `Purchased ${purchasedItems.length} item(s) for $${totalPrice}`,
      },
    ];
  }
);

// Client callback to sell items (buy shops)
onClientCallback(
  'ox_inventory:sellItems',
  async (
    playerId,
    data: SellRequest
  ): Promise<[boolean, string | { items: any[]; totalEarned: number; message: string }]> => {
    const inventory = await GetInventory(playerId);
    if (!inventory || inventory.currentShop !== data.shopId) {
      return [false, 'invalid_shop'];
    }

    const shopType = data.shopId.split(':')[0];
    const result = await processSale(playerId, shopType, data, inventory);

    if (!result.success) {
      return [false, result.error || 'sale_failed'];
    }

    // Trigger itemSold hook
    TriggerEventHooks('itemSold', {
      playerId,
      shopId: data.shopId,
      items: result.items,
      cashEarned: result.cashEarned,
      dirtyMoneyEarned: result.dirtyMoneyEarned,
    });

    return [
      true,
      {
        items: result.items || [],
        totalEarned: result.totalEarned || 0,
        message: result.message || 'Sale complete',
      },
    ];
  }
);

// Client callback to get current shop stock
onClientCallback(
  'ox_inventory:getShopStock',
  async (playerId, data: { shopId: string }): Promise<ClientShopItem[] | null> => {
    const shopType = data.shopId.split(':')[0];
    const shop = shopInstances.get(data.shopId);
    if (!shop) return null;

    let shopItems: ShopItem[];
    if (hasRandomStock(shopType)) {
      shopItems = getRandomStock(shopType);
    } else {
      shopItems = shop.items;
    }

    return buildClientShopItems(shopItems, playerId, shopType);
  }
);

// Client callback to get updated player data (for live money updates)
onClientCallback(
  'ox_inventory:getShopPlayerData',
  async (playerId, data: { shopId: string }): Promise<PlayerShopData | null> => {
    const inventory = await GetInventory(playerId);
    if (!inventory) return null;

    const shopType = data.shopId.split(':')[0];
    return getPlayerShopData(playerId, inventory, shopType);
  }
);

// Setup stock update notifications
onStockUpdate((shopType, items) => {
  // Notify all players who have this shop open
  for (const [shopId, shop] of shopInstances) {
    if (shopId.startsWith(shopType)) {
      // Broadcast to clients
      emitNet('ox_inventory:shopStockUpdate', -1, {
        shopId,
        items,
      });
    }
  }
});

// Client callback to get shop configs (for blips and targets)
onClientCallback(
  'ox_inventory:getShopConfigs',
  async (_playerId): Promise<Record<string, any>> => {
    const configs: Record<string, any> = {};

    console.log(`^3[ox_inventory] getShopConfigs called, registeredShops size: ${registeredShops.size}^0`);

    for (const [shopType, config] of registeredShops) {
      configs[shopType] = {
        label: config.label,
        blip: config.blip,
        locations: config.locations,
        targets: config.targets,
        models: config.models,
        groups: config.groups,
        shopType: config.shopType || 'sell',
      };

      // Debug: log what we're sending
      if (config.blip) {
        console.log(`^2[ox_inventory] Shop ${shopType}: blip=${JSON.stringify(config.blip)}, locations=${config.locations?.length || 0}^0`);
      }
    }

    return configs;
  }
);

// Initialize shops on resource start
loadShops();

// Cleanup on resource stop
on('onResourceStop', (resourceName: string) => {
  if (resourceName === GetCurrentResourceName()) {
    stopAllStockTimers();
  }
});

// Exports
exports('RegisterShop', registerShop);
exports('GetShop', getShop);
exports('GetShopConfig', getShopConfig);
