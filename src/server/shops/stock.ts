import { GetItemData } from '@common/item';
import type { RandomStockConfig, ShopItem } from './types';
import { applyPriceFluctuation } from './pricing';

/**
 * Active stock timers
 */
const stockTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

/**
 * Current random stock for each shop
 */
const currentRandomStock: Map<string, ShopItem[]> = new Map();

/**
 * Fenced goods that persist across restocks (for blackmarket)
 */
const fencedGoods: Map<string, ShopItem[]> = new Map();

/**
 * Stock update callback type
 */
type StockUpdateCallback = (shopType: string, items: ShopItem[]) => void;

/**
 * Registered callbacks for stock updates
 */
let stockUpdateCallback: StockUpdateCallback | null = null;

/**
 * Set the callback for stock updates
 */
export function onStockUpdate(callback: StockUpdateCallback): void {
  stockUpdateCallback = callback;
}

/**
 * Generate random stock for a shop
 */
export function generateRandomStock(shopType: string, config: RandomStockConfig): ShopItem[] {
  const stock: ShopItem[] = [];
  const numItems = Math.floor(
    Math.random() * (config.maxItems - config.minItems + 1) + config.minItems
  );
  const selectedItems = new Set<string>();

  // Filter to valid items only
  const validItems = config.availableItems.filter((itemName) => {
    const itemData = GetItemData(itemName);
    return itemData !== undefined;
  });

  if (validItems.length === 0) {
    console.warn(`^3[ox_inventory] Random stock for '${shopType}' has no valid items^0`);
    return stock;
  }

  for (let i = 0; i < numItems && selectedItems.size < validItems.length; i++) {
    // Get items not yet selected
    const available = validItems.filter((item) => !selectedItems.has(item));
    if (available.length === 0) break;

    // Random selection
    const randomItem = available[Math.floor(Math.random() * available.length)];
    selectedItems.add(randomItem);

    // Random quantity
    const quantity = Math.floor(
      Math.random() * (config.maxQuantity - config.minQuantity + 1) + config.minQuantity
    );

    // Get base price and apply fluctuation
    const basePrice = config.basePrices[randomItem] || 100;
    const fluctuatedPrice = applyPriceFluctuation(basePrice);

    const itemData = GetItemData(randomItem);

    stock.push({
      name: randomItem,
      price: fluctuatedPrice,
      slot: stock.length + 1,
      count: quantity,
      currency: 'black_money',
      category: 'Black Market',
    });
  }

  return stock;
}

/**
 * Update random stock for a shop
 */
export function updateRandomStock(shopType: string, config: RandomStockConfig): ShopItem[] {
  const newStock = generateRandomStock(shopType, config);

  // Preserve fenced goods
  const existingFenced = fencedGoods.get(shopType) || [];
  for (const fencedItem of existingFenced) {
    fencedItem.slot = newStock.length + 1;
    newStock.push(fencedItem);
  }

  currentRandomStock.set(shopType, newStock);

  // Notify listeners
  if (stockUpdateCallback) {
    stockUpdateCallback(shopType, newStock);
  }

  console.log(`^2[ox_inventory] Updated random stock for: ${shopType} (${newStock.length} items)^0`);

  return newStock;
}

/**
 * Start random stock timer for a shop
 */
export function startStockTimer(shopType: string, config: RandomStockConfig): void {
  // Stop existing timer if any
  stopStockTimer(shopType);

  // Generate initial stock
  updateRandomStock(shopType, config);

  // Start timer
  const timer = setInterval(() => {
    updateRandomStock(shopType, config);
  }, config.restockIntervalMs);

  stockTimers.set(shopType, timer);

  const intervalMinutes = config.restockIntervalMs / 60000;
  console.log(
    `^2[ox_inventory] Started random stock timer for: ${shopType} (Every ${intervalMinutes} minutes)^0`
  );
}

/**
 * Stop random stock timer for a shop
 */
export function stopStockTimer(shopType: string): void {
  const timer = stockTimers.get(shopType);
  if (timer) {
    clearInterval(timer);
    stockTimers.delete(shopType);
  }
}

/**
 * Stop all stock timers (for resource cleanup)
 */
export function stopAllStockTimers(): void {
  for (const [shopType, timer] of stockTimers) {
    clearInterval(timer);
  }
  stockTimers.clear();
}

/**
 * Get current random stock for a shop
 */
export function getRandomStock(shopType: string): ShopItem[] {
  return currentRandomStock.get(shopType) || [];
}

/**
 * Add item to fenced goods (from fence shop sales)
 */
export function addFencedItem(shopType: string, item: ShopItem): void {
  const existing = fencedGoods.get(shopType) || [];

  // Check if item already exists in fenced goods
  const existingItem = existing.find((i) => i.name === item.name);
  if (existingItem && existingItem.count !== undefined && item.count !== undefined) {
    existingItem.count += item.count;
  } else {
    existing.push({
      ...item,
      category: 'Fenced Goods',
    });
  }

  fencedGoods.set(shopType, existing);
}

/**
 * Remove item from random stock after purchase
 */
export function decrementStockItem(
  shopType: string,
  itemName: string,
  quantity: number
): boolean {
  const stock = currentRandomStock.get(shopType);
  if (!stock) return false;

  const item = stock.find((i) => i.name === itemName);
  if (!item) return false;

  if (item.count !== undefined) {
    item.count -= quantity;
    if (item.count <= 0) {
      // Remove item from stock
      const index = stock.indexOf(item);
      if (index > -1) {
        stock.splice(index, 1);
        // Re-number slots
        stock.forEach((i, idx) => {
          i.slot = idx + 1;
        });
      }
    }
  }

  return true;
}

/**
 * Check if a shop has random stock configuration
 */
export function hasRandomStock(shopType: string): boolean {
  return currentRandomStock.has(shopType);
}
