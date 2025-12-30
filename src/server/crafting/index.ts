import Config from '@common/config';
import { TriggerEventHooks } from '@common/hooks';
import { GetItemData, type ItemProperties } from '@common/item';
import { onClientCallback, triggerClientCallback } from '@communityox/ox_lib/server';
import { hasGroup } from '../bridge';
import { GetInventory } from '../inventory';
import { Inventory } from '../inventory/class';
import { LoadJsonFile } from '@common/utils';

export interface CraftingRecipe {
  name: string;
  count?: number | [number, number];
  duration?: number;
  ingredients: Record<string, number>;
  metadata?: Record<string, any>;
  slot?: number;
}

export interface CraftingZone {
  coords: number[];
  size: number[];
  distance: number;
  rotation: number;
}

export interface CraftingBlip {
  id: number;
  colour: number;
  scale: number;
}

export interface CraftingBenchConfig {
  label: string;
  items: CraftingRecipe[];
  points?: number[][];
  zones?: CraftingZone[];
  groups?: Record<string, number>;
  blip?: CraftingBlip;
}

export interface CraftingBench {
  id: string;
  label: string;
  items: CraftingRecipe[];
  groups?: Record<string, number>;
  coords?: number[];
}

// Registered crafting benches
const craftingBenches: Map<string, CraftingBenchConfig> = new Map();

/**
 * Loads crafting benches from data/crafting.json
 */
export async function loadCraftingBenches(): Promise<void> {
  try {
    const craftingData = await LoadJsonFile('data/crafting.json') as Record<string, CraftingBenchConfig>;

    for (const [benchId, config] of Object.entries(craftingData)) {
      registerCraftingBench(benchId, config);
    }

    console.log(`^2[ox_inventory] Loaded ${craftingBenches.size} crafting benches^0`);
  } catch (error) {
    console.error('^1[ox_inventory] Failed to load crafting benches:^0', error);
  }
}

/**
 * Registers a crafting bench.
 */
export function registerCraftingBench(benchId: string, config: CraftingBenchConfig): void {
  // Validate and setup recipes
  const items: CraftingRecipe[] = [];

  for (let i = 0; i < config.items.length; i++) {
    const recipe = config.items[i];
    const itemData = GetItemData(recipe.name);

    if (!itemData) {
      console.warn(`^3[ox_inventory] Crafting bench '${benchId}' has invalid recipe for '${recipe.name}'^0`);
      continue;
    }

    // Validate ingredients
    for (const ingredientName of Object.keys(recipe.ingredients)) {
      const ingredientData = GetItemData(ingredientName);
      if (!ingredientData) {
        console.warn(`^3[ox_inventory] Recipe '${recipe.name}' has invalid ingredient '${ingredientName}'^0`);
      }
    }

    items.push({
      ...recipe,
      slot: i + 1,
      duration: recipe.duration || 5000,
      count: recipe.count || 1,
    });
  }

  config.items = items;
  craftingBenches.set(benchId, config);

  console.log(`^2[ox_inventory] Registered crafting bench: ${benchId} (${items.length} recipes)^0`);
}

/**
 * Gets a crafting bench config by ID.
 */
export function getCraftingBench(benchId: string): CraftingBenchConfig | undefined {
  return craftingBenches.get(benchId);
}

/**
 * Gets the crafting coordinates for a bench.
 */
function getCraftingCoords(playerId: number, bench: CraftingBenchConfig, index: number): number[] | null {
  if (bench.zones?.[index]) {
    return bench.zones[index].coords;
  }

  if (bench.points?.[index]) {
    return bench.points[index];
  }

  // Fallback to player coords
  const playerPed = GetPlayerPed(playerId);
  return GetEntityCoords(playerPed) as number[];
}

/**
 * Checks if player has required ingredients for a recipe.
 */
function hasIngredients(inventory: Inventory, recipe: CraftingRecipe): boolean {
  for (const [ingredientName, required] of Object.entries(recipe.ingredients)) {
    if (required <= 0) continue; // Durability-based ingredients

    const count = inventory.getItemCount({ name: ingredientName });
    if (count < required) {
      return false;
    }
  }
  return true;
}

// Client callback to open crafting bench
onClientCallback('ox_inventory:openCraftingBench', async (playerId, data: { id: string; index: number }) => {
  const inventory = await GetInventory(playerId);
  if (!inventory) return;

  const bench = craftingBenches.get(data.id);
  if (!bench) {
    console.error(`^1[ox_inventory] Crafting bench '${data.id}' not found^0`);
    return;
  }

  // Check group restrictions
  if (bench.groups && inventory.player) {
    const [group] = hasGroup(inventory, bench.groups);
    if (!group) {
      return;
    }
  }

  // Check distance
  const coords = getCraftingCoords(playerId, bench, data.index);
  if (coords) {
    const playerPed = GetPlayerPed(playerId);
    const playerCoords = GetEntityCoords(playerPed);
    const distance = Math.sqrt(
      Math.pow(playerCoords[0] - coords[0], 2) +
      Math.pow(playerCoords[1] - coords[1], 2) +
      Math.pow(playerCoords[2] - coords[2], 2)
    );

    if (distance > 10) {
      return;
    }
  }

  // Open player inventory
  inventory.open(playerId);

  return {
    player: {
      id: inventory.inventoryId,
      label: inventory.label,
      type: inventory.type,
      weight: inventory.weight,
      maxWeight: inventory.maxWeight,
    },
    bench: {
      id: data.id,
      label: bench.label,
      items: bench.items,
    },
  };
});

// Client callback to craft an item
onClientCallback('ox_inventory:craftItem', async (playerId, data: {
  benchId: string;
  index: number;
  recipeSlot: number;
  toSlot: number;
}) => {
  const inventory = await GetInventory(playerId);
  if (!inventory) return [false, 'invalid_inventory'];

  const bench = craftingBenches.get(data.benchId);
  if (!bench) return [false, 'bench_not_found'];

  // Check group restrictions
  if (bench.groups && inventory.player) {
    const [group] = hasGroup(inventory, bench.groups);
    if (!group) {
      return [false, 'no_access'];
    }
  }

  // Check distance
  const coords = getCraftingCoords(playerId, bench, data.index);
  if (coords) {
    const playerPed = GetPlayerPed(playerId);
    const playerCoords = GetEntityCoords(playerPed);
    const distance = Math.sqrt(
      Math.pow(playerCoords[0] - coords[0], 2) +
      Math.pow(playerCoords[1] - coords[1], 2) +
      Math.pow(playerCoords[2] - coords[2], 2)
    );

    if (distance > 10) {
      return [false, 'too_far'];
    }
  }

  const recipe = bench.items.find((item) => item.slot === data.recipeSlot);
  if (!recipe) return [false, 'invalid_recipe'];

  // Check ingredients
  if (!hasIngredients(inventory, recipe)) {
    return [false, 'missing_ingredients'];
  }

  const itemData = GetItemData(recipe.name);
  if (!itemData) return [false, 'invalid_item'];

  // Calculate output count
  let craftCount = 1;
  if (typeof recipe.count === 'number') {
    craftCount = recipe.count;
  } else if (Array.isArray(recipe.count)) {
    craftCount = Math.floor(Math.random() * (recipe.count[1] - recipe.count[0] + 1)) + recipe.count[0];
  }

  // Trigger hook
  using hook = await TriggerEventHooks('craftItem', {
    playerId,
    benchId: data.benchId,
    benchIndex: data.index,
    recipe,
    toInventory: inventory.inventoryId,
    toSlot: data.toSlot,
  });

  if (!hook.success) return [false, 'hook_cancelled'];

  // Start crafting on client (progress bar)
  const success = await triggerClientCallback('ox_inventory:startCrafting', playerId, data.benchId, data.recipeSlot);

  if (!success) return [false, 'crafting_cancelled'];

  // Verify ingredients still exist after crafting delay
  if (!hasIngredients(inventory, recipe)) {
    return [false, 'missing_ingredients'];
  }

  // Remove ingredients
  for (const [ingredientName, required] of Object.entries(recipe.ingredients)) {
    if (required >= 1) {
      // Remove whole items
      const removed = inventory.removeItem({ name: ingredientName, quantity: required });
      if (!removed) return [false, 'failed_to_remove_ingredients'];
    } else if (required > 0) {
      // Durability-based consumption (0.05 = 5% durability)
      // TODO: Handle durability reduction
    }
  }

  // Add crafted item
  const itemProperties: ItemProperties = {
    name: recipe.name,
    quantity: craftCount,
    ...recipe.metadata,
  };

  const addedItem = await inventory.addItem(itemProperties);
  if (!addedItem) {
    return [false, 'failed_to_add_item'];
  }

  return [true, {
    item: addedItem,
    message: `Crafted ${craftCount}x ${itemData.properties.label}`,
  }];
});

// Initialize crafting benches on resource start
loadCraftingBenches();

// Exports
exports('RegisterCraftingBench', registerCraftingBench);
exports('GetCraftingBench', getCraftingBench);
