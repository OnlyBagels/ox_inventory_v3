// Payment method types
export type PaymentMethod = 'cash' | 'card' | 'dirty_money';

// Skill requirement for shop items
export interface SkillRequirement {
  skill: string;
  level: number;
}

// Shop blip configuration
export interface ShopBlip {
  id: number;
  colour: number;
  scale: number;
}

// Shop target zone for interactions
export interface ShopTarget {
  coords: number[];
  length: number;
  width: number;
  heading: number;
  minZ: number;
  maxZ: number;
  distance: number;
}

// Shop location with optional blip override
export interface ShopLocation {
  coords: [number, number, number] | [number, number, number, number];
  blip?: boolean;
}

// Shop item for regular shops (player buys from NPC)
export interface ShopItem {
  name: string;
  price: number;
  slot?: number;
  count?: number;
  currency?: string;
  license?: string;
  grade?: number | number[];
  metadata?: Record<string, any>;
  category?: string;
  jobs?: Record<string, number>;
  requiredSkill?: SkillRequirement;
  metadataRequired?: string;
}

// Buy shop item (NPC buys from player)
export interface BuyShopItem {
  name: string;
  buyPrice: number;
  category?: string;
  isStolen?: boolean;
}

// Random stock configuration for blackmarket-style shops
export interface RandomStockConfig {
  availableItems: string[];
  minItems: number;
  maxItems: number;
  minQuantity: number;
  maxQuantity: number;
  restockIntervalMs: number;
  basePrices: Record<string, number>;
}

// Extended shop configuration
export interface ShopConfig {
  label: string;
  items: ShopItem[];
  locations?: number[][] | ShopLocation[];
  targets?: ShopTarget[];
  groups?: Record<string, number>;
  blip?: ShopBlip;
  models?: string[];
  shopType?: 'sell' | 'buy';
  buyItems?: BuyShopItem[];
  randomStock?: RandomStockConfig;
  fluctuatePrices?: boolean;
  /** Serial prefix for weapons purchased from this shop (e.g., "LSPD", "DHS", "SAFR") */
  serialPrefix?: string;
}

// Shop instance (runtime)
export interface Shop {
  id: string;
  label: string;
  items: ShopItem[];
  groups?: Record<string, number>;
  coords?: number[];
  distance?: number;
  shopType: 'sell' | 'buy';
  buyItems?: BuyShopItem[];
  /** Serial prefix for weapons purchased from this shop (e.g., "LSPD", "DHS", "SAFR") */
  serialPrefix?: string;
}

// Client-side shop item (includes computed fields for UI)
export interface ClientShopItem {
  id: number;
  name: string;
  label: string;
  price: number;
  weight: number;
  width?: number;
  height?: number;
  count?: number;
  category?: string;
  license?: string;
  jobs?: Record<string, number>;
  imagePath: string;
  currency?: string;
  // Buy shop fields
  buyPrice?: number;
  basePrice?: number;
  isStolen?: boolean;
  playerQuantity?: number;
  // Skill requirement fields
  requiredSkill?: SkillRequirement;
  isLocked?: boolean;
  lockReason?: string;
  playerSkillLevel?: number;
}

// Player data sent to shop UI
export interface PlayerShopData {
  cash: number;
  bank: number;
  dirtyMoney: number;
  weight: number;
  maxWeight: number;
  licenses: Record<string, boolean>;
  job: { name: string; grade: number };
  skills: Record<string, number>;
}

// Purchase request from client
export interface PurchaseRequest {
  shopId: string;
  location?: number;
  items: Array<{
    id: number;
    name: string;
    quantity: number;
  }>;
  currency: PaymentMethod;
}

// Sell request from client (buy shops)
export interface SellRequest {
  shopId: string;
  items: Array<{
    name: string;
    quantity: number;
    slot?: number;
  }>;
}

// Shop open response to client
export interface ShopOpenResponse {
  player: {
    id: string;
    weight: number;
    maxWeight: number;
  };
  shop: {
    id: string;
    label: string;
    items: ClientShopItem[];
    isBuyShop: boolean;
  };
  playerData: PlayerShopData;
}

// Buy shop open response
export interface BuyShopOpenResponse {
  player: {
    id: string;
    weight: number;
    maxWeight: number;
  };
  shop: {
    id: string;
    label: string;
    items: ClientShopItem[];
    isBuyShop: true;
  };
  playerData: PlayerShopData;
}

// Purchase result
export interface PurchaseResult {
  success: boolean;
  items?: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  totalSpent?: number;
  message?: string;
  error?: string;
}

// Sell result
export interface SellResult {
  success: boolean;
  items?: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  totalEarned?: number;
  cashEarned?: number;
  dirtyMoneyEarned?: number;
  message?: string;
  error?: string;
}

// Hook data for buyItem
export interface BuyItemHookData {
  playerId: number;
  shopId: string;
  itemName: string;
  count: number;
  price: number;
  totalPrice: number;
  currency: PaymentMethod;
  metadata?: Record<string, any>;
}

// Hook data for sellItem
export interface SellItemHookData {
  playerId: number;
  shopId: string;
  itemName: string;
  count: number;
  pricePerItem: number;
  totalPrice: number;
  isStolen: boolean;
}

// Hook data for itemPurchased (post-purchase)
export interface ItemPurchasedHookData {
  playerId: number;
  shopId: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  totalSpent: number;
  currency: PaymentMethod;
}

// Hook data for itemSold (post-sale)
export interface ItemSoldHookData {
  playerId: number;
  shopId: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  cashEarned: number;
  dirtyMoneyEarned: number;
}
