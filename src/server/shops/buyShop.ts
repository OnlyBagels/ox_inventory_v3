import { GetItemData } from '@common/item';
import type { BuyShopItem, ClientShopItem, SellRequest, SellResult } from './types';
import { getBuyPrice, applyPriceDegradation, initializePriceMultipliers } from './pricing';
import { payPlayer } from './payments';

/**
 * Buy shop data storage
 * Map<shopType, Map<itemName, BuyShopItem>>
 */
const buyShopData: Map<string, Map<string, BuyShopItem>> = new Map();

/**
 * Register a buy shop's items
 */
export function registerBuyShop(shopType: string, items: BuyShopItem[]): void {
  const itemMap = new Map<string, BuyShopItem>();

  for (const item of items) {
    const itemData = GetItemData(item.name);
    if (!itemData) {
      console.warn(`^3[ox_inventory] Buy shop '${shopType}' has invalid item '${item.name}'^0`);
      continue;
    }

    itemMap.set(item.name, {
      ...item,
      category: item.category || 'General',
      isStolen: item.isStolen ?? false,
    });
  }

  buyShopData.set(shopType, itemMap);

  // Initialize price multipliers
  initializePriceMultipliers(shopType, Array.from(itemMap.keys()));

  console.log(`^2[ox_inventory] Registered buy shop: ${shopType} (${itemMap.size} items)^0`);
}

/**
 * Get buy shop data
 */
export function getBuyShopData(shopType: string): Map<string, BuyShopItem> | undefined {
  return buyShopData.get(shopType);
}

/**
 * Check if an item is accepted by a buy shop
 */
export function isItemAccepted(shopType: string, itemName: string): boolean {
  return buyShopData.get(shopType)?.has(itemName) ?? false;
}

/**
 * Get sellable items from player inventory for a buy shop
 */
export function getSellableItems(
  shopType: string,
  playerInventoryItems: any[]
): ClientShopItem[] {
  const shopItems = buyShopData.get(shopType);
  if (!shopItems) return [];

  // Group items by name and calculate totals
  const itemGroups: Map<
    string,
    { totalQuantity: number; slots: number[]; shopItem: BuyShopItem }
  > = new Map();

  for (const invItem of playerInventoryItems) {
    if (!invItem || !invItem.name) continue;

    const shopItem = shopItems.get(invItem.name);
    if (!shopItem) continue;

    const existing = itemGroups.get(invItem.name);
    if (existing) {
      existing.totalQuantity += invItem.quantity || 1;
      existing.slots.push(invItem.anchorSlot);
    } else {
      itemGroups.set(invItem.name, {
        totalQuantity: invItem.quantity || 1,
        slots: [invItem.anchorSlot],
        shopItem,
      });
    }
  }

  // Build client shop items
  const result: ClientShopItem[] = [];
  let id = 1;

  for (const [itemName, group] of itemGroups) {
    const itemData = GetItemData(itemName);
    if (!itemData) continue;

    const currentPrice = getBuyPrice(shopType, itemName, group.shopItem.buyPrice);

    result.push({
      id: id++,
      name: itemName,
      label: itemData.properties.label || itemName,
      price: currentPrice,
      weight: itemData.properties.weight || 0,
      category: group.shopItem.category || 'General',
      imagePath: `nui://ox_inventory/web/images/${itemName}.png`,
      buyPrice: currentPrice,
      basePrice: group.shopItem.buyPrice,
      isStolen: group.shopItem.isStolen,
      playerQuantity: group.totalQuantity,
    });
  }

  return result;
}

/**
 * Process a sale from player to buy shop
 */
export async function processSale(
  playerId: number,
  shopType: string,
  request: SellRequest,
  inventory: any
): Promise<SellResult> {
  const shopItems = buyShopData.get(shopType);
  if (!shopItems) {
    return { success: false, error: 'shop_not_found' };
  }

  let totalCashPayout = 0;
  let totalDirtyPayout = 0;
  const soldItems: Array<{ name: string; quantity: number; price: number }> = [];
  const errors: string[] = [];

  for (const sellItem of request.items) {
    const shopItem = shopItems.get(sellItem.name);
    if (!shopItem) {
      errors.push(`Item '${sellItem.name}' not accepted by this shop`);
      continue;
    }

    // Check if player has enough of the item
    const playerItemCount = inventory.getItemCount({ name: sellItem.name });
    if (playerItemCount < sellItem.quantity) {
      errors.push(`Insufficient quantity of '${sellItem.name}'`);
      continue;
    }

    // Calculate price with degradation
    const pricePerItem = getBuyPrice(shopType, sellItem.name, shopItem.buyPrice);
    const totalItemPrice = pricePerItem * sellItem.quantity;

    // Remove items from player inventory
    const removed = inventory.removeItem({
      name: sellItem.name,
      quantity: sellItem.quantity,
    });

    if (!removed) {
      errors.push(`Failed to remove '${sellItem.name}' from inventory`);
      continue;
    }

    // Apply price degradation
    applyPriceDegradation(shopType, sellItem.name, sellItem.quantity);

    // Track payout
    if (shopItem.isStolen) {
      totalDirtyPayout += totalItemPrice;
    } else {
      totalCashPayout += totalItemPrice;
    }

    soldItems.push({
      name: sellItem.name,
      quantity: sellItem.quantity,
      price: totalItemPrice,
    });
  }

  if (soldItems.length === 0) {
    return {
      success: false,
      error: errors[0] || 'no_items_sold',
    };
  }

  // Pay the player
  const paymentResult = await payPlayer(
    playerId,
    totalCashPayout,
    totalDirtyPayout,
    inventory
  );

  if (!paymentResult.success) {
    // Attempt to refund items (best effort)
    for (const item of soldItems) {
      await inventory.addItem({ name: item.name, quantity: item.quantity });
    }
    return { success: false, error: paymentResult.error || 'payment_failed' };
  }

  return {
    success: true,
    items: soldItems,
    totalEarned: totalCashPayout + totalDirtyPayout,
    cashEarned: totalCashPayout,
    dirtyMoneyEarned: totalDirtyPayout,
    message: `Sold ${soldItems.length} item type(s) for $${totalCashPayout + totalDirtyPayout}`,
  };
}

/**
 * Get all registered buy shop types
 */
export function getBuyShopTypes(): string[] {
  return Array.from(buyShopData.keys());
}
