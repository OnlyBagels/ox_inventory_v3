// Payment method types
export type PaymentMethod = 'cash' | 'card' | 'dirty_money';

// Shop item interface
export interface ShopItem {
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
  requiredSkill?: { skill: string; level: number };
  isLocked?: boolean;
  lockReason?: string;
  playerSkillLevel?: number;
}

// Shop data interface
export interface ShopData {
  id: string;
  label: string;
  items: ShopItem[];
  isBuyShop: boolean;
}

// Player shop data
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

// Cart item
export interface CartItem {
  id: number;
  name: string;
  label: string;
  quantity: number;
  price: number;
  weight: number;
  maxQuantity?: number;
  isStolen?: boolean;
}

// Crafting interfaces (kept for compatibility)
export interface CraftingRecipe {
  name: string;
  label: string;
  count?: number | [number, number];
  duration?: number;
  ingredients: Record<string, number>;
  description?: string;
  icon?: string;
  width?: number;
  height?: number;
  slot: number;
}

export interface CraftingBenchData {
  id: string;
  label: string;
  items: CraftingRecipe[];
}

// Shop state class
class ShopState {
  // Visibility
  isOpen = $state(false);

  // Shop data
  shop = $state<ShopData | null>(null);
  items = $state<ShopItem[]>([]);
  selectedCategory = $state<string>('All');

  // Cart
  cartItems = $state<CartItem[]>([]);

  // Player data
  playerData = $state<PlayerShopData>({
    cash: 0,
    bank: 0,
    dirtyMoney: 0,
    weight: 0,
    maxWeight: 50000,
    licenses: {},
    job: { name: '', grade: 0 },
    skills: {},
  });

  // Selected payment method
  paymentMethod = $state<PaymentMethod>('cash');

  // Processing state
  isProcessing = $state(false);

  // Get unique categories
  get categories(): string[] {
    const cats = new Set<string>();
    cats.add('All');
    for (const item of this.items) {
      if (item.category) {
        cats.add(item.category);
      }
    }
    return Array.from(cats);
  }

  // Get filtered items by category
  get filteredItems(): ShopItem[] {
    if (this.selectedCategory === 'All') {
      return this.items;
    }
    return this.items.filter((item) => item.category === this.selectedCategory);
  }

  // Get cart total value
  get cartValue(): number {
    return this.cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  // Get cart total weight
  get cartWeight(): number {
    return this.cartItems.reduce((sum, item) => sum + item.weight * item.quantity, 0);
  }

  // Get cart item count
  get cartItemCount(): number {
    return this.cartItems.reduce((sum, item) => sum + item.quantity, 0);
  }

  // Check if player can afford with cash
  get canAffordCash(): boolean {
    return this.cartValue <= this.playerData.cash;
  }

  // Check if player can afford with bank
  get canAffordCard(): boolean {
    return this.cartValue <= this.playerData.bank;
  }

  // Check if player can afford with dirty money
  get canAffordDirty(): boolean {
    return this.cartValue <= this.playerData.dirtyMoney;
  }

  // Check if player would be overweight
  get isOverweight(): boolean {
    return this.playerData.weight + this.cartWeight > this.playerData.maxWeight;
  }

  // Check if cart is empty
  get isCartEmpty(): boolean {
    return this.cartItems.length === 0;
  }

  // Open shop
  open(data: {
    shop: ShopData;
    playerData: PlayerShopData;
  }) {
    this.shop = data.shop;
    this.items = data.shop.items;
    this.playerData = data.playerData;
    this.cartItems = [];
    this.selectedCategory = 'All';
    this.paymentMethod = 'cash';
    this.isOpen = true;
    this.isProcessing = false;
  }

  // Close shop
  close() {
    this.isOpen = false;
    this.shop = null;
    this.items = [];
    this.cartItems = [];
    this.selectedCategory = 'All';
    this.isProcessing = false;
  }

  // Select category
  selectCategory(category: string) {
    this.selectedCategory = category;
  }

  // Set payment method
  setPaymentMethod(method: PaymentMethod) {
    this.paymentMethod = method;
  }

  // Add item to cart
  addToCart(item: ShopItem, quantity: number = 1) {
    if (item.isLocked) return;

    const existingIndex = this.cartItems.findIndex((ci) => ci.id === item.id);

    if (existingIndex >= 0) {
      const existing = this.cartItems[existingIndex];
      const maxQty = item.count ?? item.playerQuantity ?? 999;
      const newQty = Math.min(existing.quantity + quantity, maxQty);
      this.cartItems[existingIndex] = { ...existing, quantity: newQty };
    } else {
      const maxQty = item.count ?? item.playerQuantity ?? 999;
      this.cartItems = [
        ...this.cartItems,
        {
          id: item.id,
          name: item.name,
          label: item.label,
          quantity: Math.min(quantity, maxQty),
          price: this.shop?.isBuyShop ? (item.buyPrice ?? item.price) : item.price,
          weight: item.weight,
          maxQuantity: maxQty,
          isStolen: item.isStolen,
        },
      ];
    }
  }

  // Remove item from cart
  removeFromCart(itemId: number, quantity?: number) {
    const index = this.cartItems.findIndex((ci) => ci.id === itemId);
    if (index < 0) return;

    if (quantity === undefined) {
      // Remove all
      this.cartItems = this.cartItems.filter((ci) => ci.id !== itemId);
    } else {
      const item = this.cartItems[index];
      const newQty = item.quantity - quantity;
      if (newQty <= 0) {
        this.cartItems = this.cartItems.filter((ci) => ci.id !== itemId);
      } else {
        this.cartItems[index] = { ...item, quantity: newQty };
      }
    }
  }

  // Set cart item quantity
  setCartItemQuantity(itemId: number, quantity: number) {
    const index = this.cartItems.findIndex((ci) => ci.id === itemId);
    if (index < 0) return;

    const item = this.cartItems[index];
    const maxQty = item.maxQuantity ?? 999;
    const newQty = Math.max(1, Math.min(quantity, maxQty));

    if (newQty <= 0) {
      this.cartItems = this.cartItems.filter((ci) => ci.id !== itemId);
    } else {
      this.cartItems[index] = { ...item, quantity: newQty };
    }
  }

  // Clear cart
  clearCart() {
    this.cartItems = [];
  }

  // Update items (for stock updates)
  updateItems(items: ShopItem[]) {
    this.items = items;
  }

  // Update player data
  updatePlayerData(data: Partial<PlayerShopData>) {
    this.playerData = { ...this.playerData, ...data };
  }

  // Set processing state
  setProcessing(processing: boolean) {
    this.isProcessing = processing;
  }

  // Get purchase/sell request data
  getRequestData() {
    if (this.shop?.isBuyShop) {
      return {
        shopId: this.shop.id,
        items: this.cartItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
        })),
      };
    } else {
      return {
        shopId: this.shop?.id ?? '',
        items: this.cartItems.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
        })),
        currency: this.paymentMethod,
      };
    }
  }
}

// Crafting state class (kept for compatibility)
class CraftingState {
  isOpen = $state(false);
  bench = $state<CraftingBenchData | null>(null);
  selectedRecipe = $state<CraftingRecipe | null>(null);
  isCrafting = $state(false);
  craftingProgress = $state(0);

  open(data: CraftingBenchData) {
    this.bench = data;
    this.isOpen = true;
    this.selectedRecipe = null;
    this.isCrafting = false;
    this.craftingProgress = 0;
  }

  close() {
    this.isOpen = false;
    this.bench = null;
    this.selectedRecipe = null;
    this.isCrafting = false;
    this.craftingProgress = 0;
  }

  selectRecipe(recipe: CraftingRecipe) {
    this.selectedRecipe = recipe;
  }

  startCrafting() {
    if (!this.selectedRecipe || this.isCrafting) return;
    this.isCrafting = true;
    this.craftingProgress = 0;
  }

  updateProgress(progress: number) {
    this.craftingProgress = Math.min(100, Math.max(0, progress));
  }

  completeCrafting() {
    this.isCrafting = false;
    this.craftingProgress = 0;
  }

  cancelCrafting() {
    this.isCrafting = false;
    this.craftingProgress = 0;
  }
}

export const shopState = new ShopState();
export const craftingState = new CraftingState();
