import Config from '@common/config';

/**
 * Price configuration - loaded from static/config.json
 */
export const PriceConfig = {
  // Price degradation rate per item sold (default 1%)
  get decayRate(): number {
    return Config.Shop_PriceDegradation_DecayRate ?? 0.01;
  },
  // Maximum price reduction (default 25%)
  get maxDecay(): number {
    return Config.Shop_PriceDegradation_MaxDecay ?? 0.25;
  },
  // Price fluctuation range on restart
  get fluctuationMin(): number {
    return Config.Shop_PriceFluctuation_MinMultiplier ?? 0.8;
  },
  get fluctuationMax(): number {
    return Config.Shop_PriceFluctuation_MaxMultiplier ?? 1.2;
  },
  // Whether fluctuation is enabled
  get fluctuationEnabled(): boolean {
    return Config.Shop_PriceFluctuation_Enabled ?? true;
  },
  // Whether degradation is enabled
  get degradationEnabled(): boolean {
    return Config.Shop_PriceDegradation_Enabled ?? true;
  },
};

/**
 * Memory-only price multipliers for buy shops
 * Resets on resource restart
 * Map<shopType, Map<itemName, multiplier>>
 */
const buyShopPriceMultipliers: Map<string, Map<string, number>> = new Map();

/**
 * Initialize price multipliers for a buy shop
 */
export function initializePriceMultipliers(shopType: string, itemNames: string[]): void {
  const itemMultipliers = new Map<string, number>();

  for (const itemName of itemNames) {
    itemMultipliers.set(itemName, 1.0);
  }

  buyShopPriceMultipliers.set(shopType, itemMultipliers);
}

/**
 * Get the current price multiplier for an item
 */
export function getPriceMultiplier(shopType: string, itemName: string): number {
  return buyShopPriceMultipliers.get(shopType)?.get(itemName) ?? 1.0;
}

/**
 * Get the current buy price with degradation applied
 */
export function getBuyPrice(shopType: string, itemName: string, basePrice: number): number {
  const multiplier = getPriceMultiplier(shopType, itemName);
  return Math.floor(basePrice * multiplier);
}

/**
 * Apply price degradation after items are sold
 */
export function applyPriceDegradation(
  shopType: string,
  itemName: string,
  quantity: number
): number {
  // Skip if degradation is disabled
  if (!PriceConfig.degradationEnabled) {
    return 1.0;
  }

  const shopMultipliers = buyShopPriceMultipliers.get(shopType);
  if (!shopMultipliers) {
    initializePriceMultipliers(shopType, [itemName]);
    return applyPriceDegradation(shopType, itemName, quantity);
  }

  let currentMultiplier = shopMultipliers.get(itemName) ?? 1.0;
  const minMultiplier = 1.0 - PriceConfig.maxDecay;

  // Apply decay for each item sold
  for (let i = 0; i < quantity; i++) {
    currentMultiplier = Math.max(minMultiplier, currentMultiplier - PriceConfig.decayRate);
  }

  shopMultipliers.set(itemName, currentMultiplier);

  return currentMultiplier;
}

/**
 * Reset price multiplier for a specific item
 */
export function resetPriceMultiplier(shopType: string, itemName: string): void {
  const shopMultipliers = buyShopPriceMultipliers.get(shopType);
  if (shopMultipliers) {
    shopMultipliers.set(itemName, 1.0);
  }
}

/**
 * Reset all price multipliers for a shop
 */
export function resetShopPriceMultipliers(shopType: string): void {
  const shopMultipliers = buyShopPriceMultipliers.get(shopType);
  if (shopMultipliers) {
    for (const [itemName] of shopMultipliers) {
      shopMultipliers.set(itemName, 1.0);
    }
  }
}

/**
 * Apply random price fluctuation to a price
 */
export function applyPriceFluctuation(basePrice: number): number {
  // Skip if fluctuation is disabled
  if (!PriceConfig.fluctuationEnabled) {
    return basePrice;
  }

  const fluctuation =
    Math.random() * (PriceConfig.fluctuationMax - PriceConfig.fluctuationMin) +
    PriceConfig.fluctuationMin;
  return Math.round(basePrice * fluctuation);
}

/**
 * Get all current price multipliers for a shop (for debugging/admin)
 */
export function getShopPriceMultipliers(shopType: string): Record<string, number> {
  const shopMultipliers = buyShopPriceMultipliers.get(shopType);
  if (!shopMultipliers) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [itemName, multiplier] of shopMultipliers) {
    result[itemName] = multiplier;
  }
  return result;
}

/**
 * Get the degradation percentage for display
 */
export function getDegradationPercent(shopType: string, itemName: string): number {
  const multiplier = getPriceMultiplier(shopType, itemName);
  return Math.round((1 - multiplier) * 100);
}
