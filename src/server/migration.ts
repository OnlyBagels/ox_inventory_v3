/**
 * ox_inventory v2 (MySQL) to v3 (SQLite) Auto-Migration
 *
 * Runs automatically on first start. COPIES all inventory data from
 * v2's MySQL tables to v3's SQLite database.
 *
 * IMPORTANT: This does NOT delete or modify MySQL data!
 * Your MySQL database remains completely intact as a backup.
 * Data is only READ from MySQL and WRITTEN to SQLite.
 *
 * Creates a migration.json file to track migration status.
 * To re-run migration: set "migrated": false in migration.json
 */

import { cache } from '@communityox/ox_lib';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

interface MigrationState {
  migrated: boolean;
  migratedAt?: string;
  itemsMigrated?: number;
  inventoriesMigrated?: number;
  errors?: string[];
  itemsLuaMigrated?: boolean;
  itemsLuaMigratedAt?: string;
  itemsLuaCount?: number;
}

interface V2InventoryItem {
  name: string;
  count?: number;
  amount?: number;
  quantity?: number;
  slot?: number;
  weight?: number;
  durability?: number;
  metadata?: Record<string, any>;
  ammotype?: string;
  ammoName?: string;
  ammo?: number;
  ammoCount?: number;
  info?: Record<string, any>;
}

const MIGRATION_FILE = `${GetResourcePath(cache.resource)}/migration.json`;
const SQLITE_PATH = `${GetResourcePath(cache.resource)}/db.sqlite`;
const ITEMS_LUA_PATH = `${GetResourcePath(cache.resource)}/items.lua`;
const ITEMS_JSON_PATH = `${GetResourcePath(cache.resource)}/data/items.json`;

interface LuaItemDef {
  label?: string;
  weight?: number;
  stack?: boolean;
  stackSize?: number;
  degrade?: number;
  consume?: number;
  close?: boolean;
  allowArmed?: boolean;
  width?: number;
  height?: number;
  category?: string;
  client?: Record<string, any>;
  server?: Record<string, any>;
  buttons?: any[];
  inventory?: Record<string, any>;
}

function getMigrationState(): MigrationState {
  try {
    if (fs.existsSync(MIGRATION_FILE)) {
      const data = fs.readFileSync(MIGRATION_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[ox_inventory] Failed to read migration state:', e);
  }
  return { migrated: false };
}

function saveMigrationState(state: MigrationState) {
  try {
    fs.writeFileSync(MIGRATION_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[ox_inventory] Failed to save migration state:', e);
  }
}

/**
 * Check if migration is needed (migration.json doesn't exist or migrated = false)
 */
export function checkMigrationNeeded(): boolean {
  const state = getMigrationState();
  return !state.migrated;
}

/**
 * Pre-migration cleanup - deletes old sqlite files if migration is needed.
 * This MUST run before any database modules are imported.
 */
export function preMigrationCleanup(): void {
  const state = getMigrationState();

  // If migration already completed, nothing to do
  if (state.migrated) {
    return;
  }

  console.log('[ox_inventory] ^3Pre-migration cleanup: checking for old database files...^0');

  // Delete db.sqlite and related files
  if (fs.existsSync(SQLITE_PATH)) {
    console.log('[ox_inventory] ^3Deleting db.sqlite for fresh migration...^0');
    try {
      fs.unlinkSync(SQLITE_PATH);
      console.log('[ox_inventory] ^2Successfully deleted db.sqlite^0');
    } catch (e) {
      console.error('[ox_inventory] ^1Failed to delete db.sqlite:^0', e);
    }
  }

  // Also delete WAL and SHM files if they exist
  if (fs.existsSync(`${SQLITE_PATH}-wal`)) {
    try {
      fs.unlinkSync(`${SQLITE_PATH}-wal`);
      console.log('[ox_inventory] ^2Deleted db.sqlite-wal^0');
    } catch (e) {
      console.error('[ox_inventory] ^1Failed to delete db.sqlite-wal:^0', e);
    }
  }

  if (fs.existsSync(`${SQLITE_PATH}-shm`)) {
    try {
      fs.unlinkSync(`${SQLITE_PATH}-shm`);
      console.log('[ox_inventory] ^2Deleted db.sqlite-shm^0');
    } catch (e) {
      console.error('[ox_inventory] ^1Failed to delete db.sqlite-shm:^0', e);
    }
  }
}

/**
 * Migrates items.lua to items.json format
 * Runs once on first start if items.lua exists and items.json doesn't have a .migrated marker
 */
export function migrateItemsLua(): boolean {
  // Check if items.lua exists
  if (!fs.existsSync(ITEMS_LUA_PATH)) {
    return false;
  }

  // Check migration state
  const state = getMigrationState();
  if (state.itemsLuaMigrated) {
    return true;
  }

  console.log('[ox_inventory] Migrating items.lua to items.json...');

  try {
    const luaContent = fs.readFileSync(ITEMS_LUA_PATH, 'utf-8');

    // Count how many items are in the file by counting ['itemname'] patterns
    const allItemNames: string[] = [];
    const itemNameRegex = /\['([^']+)'\]\s*=/g;
    let nameMatch;
    while ((nameMatch = itemNameRegex.exec(luaContent)) !== null) {
      allItemNames.push(nameMatch[1]);
    }
    console.log(`[ox_inventory] Found ${allItemNames.length} item definitions in items.lua`);

    const items = parseLuaItems(luaContent);
    const parsedItemNames = Object.keys(items);

    // Find which items weren't parsed
    const failedItems = allItemNames.filter(name => !parsedItemNames.includes(name));

    if (failedItems.length > 0) {
      console.log(`[ox_inventory] ^3Warning: ${failedItems.length} items could not be fully parsed (likely have functions):^0`);
      // Still add them with just the name so they exist
      for (const name of failedItems) {
        if (!items[name]) {
          // Try to extract at least the label
          const labelMatch = new RegExp(`\\['${name}'\\]\\s*=\\s*\\{[^}]*label\\s*=\\s*['"]([^'"]+)['"]`).exec(luaContent);
          const weightMatch = new RegExp(`\\['${name}'\\]\\s*=\\s*\\{[^}]*weight\\s*=\\s*(\\d+)`).exec(luaContent);

          items[name] = {
            label: labelMatch ? labelMatch[1] : name,
            weight: weightMatch ? Number(weightMatch[1]) : undefined,
          };
          console.log(`[ox_inventory]   - ${name}: extracted basic properties`);
        }
      }
    }

    if (Object.keys(items).length === 0) {
      console.log('[ox_inventory] No items found in items.lua');
      return false;
    }

    // Load existing items.json to merge with
    let existingItems: Record<string, any> = {};
    if (fs.existsSync(ITEMS_JSON_PATH)) {
      try {
        existingItems = JSON.parse(fs.readFileSync(ITEMS_JSON_PATH, 'utf-8'));
      } catch (e) {
        console.error('[ox_inventory] Failed to parse existing items.json:', e);
      }
    }

    // Merge items (Lua items override existing)
    const mergedItems = { ...existingItems, ...items };

    // Write merged items
    fs.writeFileSync(ITEMS_JSON_PATH, JSON.stringify(mergedItems, null, 2));

    // Update migration state
    state.itemsLuaMigrated = true;
    state.itemsLuaMigratedAt = new Date().toISOString();
    state.itemsLuaCount = Object.keys(items).length;
    saveMigrationState(state);

    console.log(`[ox_inventory] ✓ Migrated ${Object.keys(items).length} items from items.lua`);
    console.log('[ox_inventory] NOTE: items.lua is no longer used - you can delete it');

    return true;
  } catch (e) {
    console.error('[ox_inventory] Failed to migrate items.lua:', e);
    return false;
  }
}

/**
 * Find the matching closing brace for an opening brace
 */
function findMatchingBrace(content: string, startIndex: number): number {
  let depth = 1;
  let i = startIndex;
  let inString = false;
  let stringChar = '';

  while (i < content.length && depth > 0) {
    const char = content[i];

    // Handle string literals
    if ((char === '"' || char === "'") && content[i - 1] !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
    }

    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') depth--;
    }

    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

/**
 * Parse Lua table syntax into JavaScript object
 * This is a simplified parser that handles the ox_inventory items.lua format
 */
function parseLuaItems(content: string): Record<string, LuaItemDef> {
  const items: Record<string, LuaItemDef> = {};

  // Find all item definitions: ['itemname'] = { ... }
  const itemStartRegex = /\['([^']+)'\]\s*=\s*\{/g;
  let match;

  while ((match = itemStartRegex.exec(content)) !== null) {
    const itemName = match[1];
    const braceStart = match.index + match[0].length;
    const braceEnd = findMatchingBrace(content, braceStart);

    if (braceEnd === -1) {
      console.warn(`[ox_inventory] Could not find closing brace for item '${itemName}'`);
      continue;
    }

    const itemBody = content.substring(braceStart, braceEnd);

    try {
      const item = parseLuaTable(itemBody);
      if (item) {
        // Convert Lua-style properties to JSON-style
        const jsonItem: LuaItemDef = {};

        if (item.label) jsonItem.label = item.label;
        if (item.weight !== undefined) jsonItem.weight = Number(item.weight);
        if (item.stack === false) jsonItem.stackSize = 1;
        if (item.stackSize !== undefined) jsonItem.stackSize = Number(item.stackSize);
        if (item.degrade !== undefined) jsonItem.degrade = Number(item.degrade);
        if (item.consume !== undefined) jsonItem.consume = Number(item.consume);
        if (item.width !== undefined) jsonItem.width = Number(item.width);
        if (item.height !== undefined) jsonItem.height = Number(item.height);
        if (item.category) jsonItem.category = item.category;

        // Handle container inventory property
        if (item.inventory) {
          jsonItem.category = 'container';
          jsonItem.inventory = {};
          if (item.inventory.weight) jsonItem.inventory.weight = Number(item.inventory.weight);
          if (item.inventory.height) jsonItem.inventory.height = Number(item.inventory.height);
          if (item.inventory.width) jsonItem.inventory.width = Number(item.inventory.width);
        }

        // Skip client/server/buttons as they contain functions that can't be serialized
        // These need to be re-implemented in the v3 format if needed

        items[itemName] = jsonItem;
      }
    } catch (e) {
      console.warn(`[ox_inventory] Failed to parse item '${itemName}':`, e);
    }
  }

  return items;
}

/**
 * Parse a Lua table body into a JS object (simplified - handles basic key-value pairs)
 */
function parseLuaTable(body: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Match simple key = value pairs (not followed by {)
  const simpleKeyValue = /(\w+)\s*=\s*('[^']*'|"[^"]*"|-?[\d.]+|true|false|nil)(?!\s*\{)/g;
  let match;

  while ((match = simpleKeyValue.exec(body)) !== null) {
    const key = match[1];
    let value: any = match[2];

    // Parse the value
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value === 'nil') value = null;
    else if (value.startsWith("'") || value.startsWith('"')) value = value.slice(1, -1);
    else if (!isNaN(Number(value))) value = Number(value);

    result[key] = value;
  }

  // Match nested tables like: inventory = { ... } (simple ones without functions)
  const nestedTableRegex = /(\w+)\s*=\s*\{/g;
  while ((match = nestedTableRegex.exec(body)) !== null) {
    const key = match[1];
    const braceStart = match.index + match[0].length;
    const braceEnd = findMatchingBrace(body, braceStart);

    if (braceEnd === -1) continue;

    const nestedBody = body.substring(braceStart, braceEnd);

    // Skip if it contains functions
    if (nestedBody.includes('function')) continue;

    // Only parse simple nested tables (inventory, etc.)
    if (key === 'inventory') {
      result[key] = parseLuaTable(nestedBody);
    }
  }

  return result;
}

async function mysqlQuery<T = any>(query: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    exports.oxmysql.query(query, params, (result: T[]) => {
      resolve(result || []);
    });
  });
}

async function mysqlScalar<T = any>(query: string, params: any[] = []): Promise<T | null> {
  return new Promise((resolve, reject) => {
    exports.oxmysql.scalar(query, params, (result: T) => {
      resolve(result);
    });
  });
}

function parseInventoryData(data: string | any[] | Record<string, any> | null): V2InventoryItem[] {
  if (!data) return [];

  try {
    let parsed = data;

    // Parse JSON string if needed
    if (typeof data === 'string') {
      parsed = JSON.parse(data);
    }

    // Handle array format
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => item && item.name);
    }

    // Handle object format (slot-keyed)
    if (typeof parsed === 'object') {
      return Object.values(parsed).filter((item: any) => item && item.name) as V2InventoryItem[];
    }
  } catch (e) {
    // Silent fail - data might be corrupted
  }

  return [];
}

function convertV2ItemToV3(item: V2InventoryItem, slotIndex: number, inventoryWidth: number = 11) {
  // Merge info/metadata (v2 used both)
  const metadata = { ...item.info, ...item.metadata };

  return {
    name: item.name,
    quantity: item.count || item.amount || item.quantity || 1,
    anchorSlot: item.slot !== undefined ? item.slot : slotIndex,
    weight: item.weight,
    durability: item.durability,
    // Weapon fields
    ammoName: item.ammotype || item.ammoName,
    ammoCount: item.ammo || item.ammoCount,
    // Copy over any metadata
    ...metadata,
  };
}

export async function runMigration(forceDeleteSqlite: boolean = false): Promise<boolean> {
  console.log(`[ox_inventory] runMigration called with forceDeleteSqlite = ${forceDeleteSqlite}`);

  const state = getMigrationState();
  console.log(`[ox_inventory] Migration state: migrated = ${state.migrated}, itemsLuaMigrated = ${state.itemsLuaMigrated}`);

  // Always delete sqlite if migration hasn't run yet (fresh start)
  const shouldDeleteSqlite = !state.migrated;
  console.log(`[ox_inventory] shouldDeleteSqlite = ${shouldDeleteSqlite} (based on !state.migrated)`);
  console.log(`[ox_inventory] SQLITE_PATH = ${SQLITE_PATH}`);

  if (shouldDeleteSqlite) {
    const sqliteExists = fs.existsSync(SQLITE_PATH);
    console.log(`[ox_inventory] db.sqlite exists = ${sqliteExists}`);

    if (sqliteExists) {
      console.log('[ox_inventory] ^3Deleting db.sqlite for fresh migration...^0');
      try {
        fs.unlinkSync(SQLITE_PATH);
        console.log('[ox_inventory] ^2Successfully deleted db.sqlite^0');
      } catch (e) {
        console.error('[ox_inventory] ^1Failed to delete db.sqlite:^0', e);
      }
    }

    // Also delete WAL and SHM files if they exist
    const walExists = fs.existsSync(`${SQLITE_PATH}-wal`);
    const shmExists = fs.existsSync(`${SQLITE_PATH}-shm`);
    console.log(`[ox_inventory] db.sqlite-wal exists = ${walExists}, db.sqlite-shm exists = ${shmExists}`);

    if (walExists) {
      try {
        fs.unlinkSync(`${SQLITE_PATH}-wal`);
        console.log('[ox_inventory] ^2Deleted db.sqlite-wal^0');
      } catch (e) {
        console.error('[ox_inventory] ^1Failed to delete db.sqlite-wal:^0', e);
      }
    }
    if (shmExists) {
      try {
        fs.unlinkSync(`${SQLITE_PATH}-shm`);
        console.log('[ox_inventory] ^2Deleted db.sqlite-shm^0');
      } catch (e) {
        console.error('[ox_inventory] ^1Failed to delete db.sqlite-shm:^0', e);
      }
    }
  }

  if (state.migrated) {
    console.log('[ox_inventory] Migration already completed, skipping.');
    return true;
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('[ox_inventory] V2 to V3 Migration Starting...');
  console.log('[ox_inventory] NOTE: MySQL data will NOT be modified or deleted!');
  console.log('[ox_inventory] This only COPIES data to SQLite.');
  console.log('='.repeat(60));

  const errors: string[] = [];
  let totalItems = 0;
  let totalInventories = 0;

  // Open SQLite database
  const sqlite = new DatabaseSync(SQLITE_PATH);

  // Ensure schema exists
  const schemaPath = `${GetResourcePath(cache.resource)}/sql/schema.sql`;
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    sqlite.exec(schema);
  }

  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
  `);

  // Prepare statements
  const insertItem = sqlite.prepare(`
    INSERT INTO inventory_items (inventoryId, data)
    VALUES (?, jsonb(?))
  `);
  const deleteInventoryItems = sqlite.prepare(`
    DELETE FROM inventory_items WHERE inventoryId = ?
  `);

  // Check which v2 tables exist
  const tables: string[] = [];

  try {
    // Check for ox_inventory table (main stash storage)
    const oxInvExists = await mysqlScalar<number>(
      `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ox_inventory'`
    );
    if (oxInvExists && oxInvExists > 0) tables.push('ox_inventory');

    // Check for gloveboxes table
    const gloveboxExists = await mysqlScalar<number>(
      `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gloveboxes'`
    );
    if (gloveboxExists && gloveboxExists > 0) tables.push('gloveboxes');

    // Check for trunks table
    const trunksExists = await mysqlScalar<number>(
      `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trunks'`
    );
    if (trunksExists && trunksExists > 0) tables.push('trunks');

    // Check for stashitems table (some v2 setups)
    const stashitemsExists = await mysqlScalar<number>(
      `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stashitems'`
    );
    if (stashitemsExists && stashitemsExists > 0) tables.push('stashitems');

    // Check for players table (for player inventories)
    const playersExists = await mysqlScalar<number>(
      `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'players'`
    );
    if (playersExists && playersExists > 0) tables.push('players');

  } catch (e) {
    console.error('[ox_inventory] Failed to check MySQL tables:', e);
    errors.push(`Failed to check MySQL tables: ${e}`);
  }

  console.log(`[ox_inventory] Found v2 tables: ${tables.join(', ') || 'none'}`);

  if (tables.length === 0) {
    console.log('[ox_inventory] No v2 tables found. Creating fresh database.');
    saveMigrationState({
      migrated: true,
      migratedAt: new Date().toISOString(),
      itemsMigrated: 0,
      inventoriesMigrated: 0,
    });
    sqlite.close();
    return true;
  }

  // Begin transaction for faster inserts
  sqlite.exec('BEGIN TRANSACTION');

  try {
    // ========================================
    // Migrate ox_inventory table (stashes)
    // ========================================
    if (tables.includes('ox_inventory')) {
      console.log('[ox_inventory] Migrating ox_inventory (stashes)...');

      const rows = await mysqlQuery<{ name: string; owner?: string; data: any }>(
        'SELECT * FROM ox_inventory'
      );

      for (const row of rows) {
        try {
          const inventoryId = row.name || row.owner;
          if (!inventoryId) continue;

          const items = parseInventoryData(row.data);

          // Clear any existing items for this inventory (prevents duplicates on re-migration)
          deleteInventoryItems.run(inventoryId);

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const v3Item = convertV2ItemToV3(item, i);

            insertItem.run(inventoryId, JSON.stringify(v3Item));
            totalItems++;
          }

          if (items.length > 0) totalInventories++;
        } catch (e) {
          errors.push(`ox_inventory row error: ${e}`);
        }
      }

      console.log(`[ox_inventory]   ✓ Migrated ${rows.length} stashes`);
    }

    // ========================================
    // Migrate gloveboxes table
    // ========================================
    if (tables.includes('gloveboxes')) {
      console.log('[ox_inventory] Migrating gloveboxes...');

      const rows = await mysqlQuery<{ plate: string; data: any }>(
        'SELECT * FROM gloveboxes'
      );

      for (const row of rows) {
        try {
          const items = parseInventoryData(row.data);
          const inventoryId = `glovebox:${row.plate}`;

          // Clear any existing items for this inventory (prevents duplicates on re-migration)
          deleteInventoryItems.run(inventoryId);

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const v3Item = convertV2ItemToV3(item, i);

            insertItem.run(inventoryId, JSON.stringify(v3Item));
            totalItems++;
          }

          if (items.length > 0) totalInventories++;
        } catch (e) {
          errors.push(`gloveboxes row error: ${e}`);
        }
      }

      console.log(`[ox_inventory]   ✓ Migrated ${rows.length} gloveboxes`);
    }

    // ========================================
    // Migrate trunks table
    // ========================================
    if (tables.includes('trunks')) {
      console.log('[ox_inventory] Migrating trunks...');

      const rows = await mysqlQuery<{ plate: string; data: any }>(
        'SELECT * FROM trunks'
      );

      for (const row of rows) {
        try {
          const items = parseInventoryData(row.data);
          const inventoryId = `trunk:${row.plate}`;

          // Clear any existing items for this inventory (prevents duplicates on re-migration)
          deleteInventoryItems.run(inventoryId);

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const v3Item = convertV2ItemToV3(item, i);

            insertItem.run(inventoryId, JSON.stringify(v3Item));
            totalItems++;
          }

          if (items.length > 0) totalInventories++;
        } catch (e) {
          errors.push(`trunks row error: ${e}`);
        }
      }

      console.log(`[ox_inventory]   ✓ Migrated ${rows.length} trunks`);
    }

    // ========================================
    // Migrate stashitems table (alternative schema)
    // ========================================
    if (tables.includes('stashitems')) {
      console.log('[ox_inventory] Migrating stashitems...');

      const rows = await mysqlQuery<{ stash: string; items: any }>(
        'SELECT * FROM stashitems'
      );

      for (const row of rows) {
        try {
          const items = parseInventoryData(row.items);
          const inventoryId = `stash:${row.stash}`;

          // Clear any existing items for this inventory (prevents duplicates on re-migration)
          deleteInventoryItems.run(inventoryId);

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const v3Item = convertV2ItemToV3(item, i);

            insertItem.run(inventoryId, JSON.stringify(v3Item));
            totalItems++;
          }

          if (items.length > 0) totalInventories++;
        } catch (e) {
          errors.push(`stashitems row error: ${e}`);
        }
      }

      console.log(`[ox_inventory]   ✓ Migrated ${rows.length} stash inventories`);
    }

    // ========================================
    // Migrate player inventories
    // ========================================
    if (tables.includes('players')) {
      console.log('[ox_inventory] Migrating player inventories...');

      // Try different column structures used by various frameworks
      let playerRows: any[] = [];

      // Try QBCore/Qbox structure (citizenid + inventory JSON)
      try {
        playerRows = await mysqlQuery<{ citizenid: string; inventory: any }>(
          'SELECT citizenid, inventory FROM players WHERE inventory IS NOT NULL AND inventory != "[]" AND inventory != "{}"'
        );
      } catch (e) {
        // Try ESX structure
        try {
          playerRows = await mysqlQuery<{ identifier: string; inventory: any }>(
            'SELECT identifier, inventory FROM users WHERE inventory IS NOT NULL'
          );
        } catch (e2) {
          console.log('[ox_inventory]   No compatible player inventory structure found');
        }
      }

      for (const row of playerRows) {
        try {
          const identifier = row.citizenid || row.identifier;
          if (!identifier) continue;

          const items = parseInventoryData(row.inventory);
          const inventoryId = `player:${identifier}`;

          // Clear any existing items for this inventory (prevents duplicates on re-migration)
          deleteInventoryItems.run(inventoryId);

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const v3Item = convertV2ItemToV3(item, i);

            insertItem.run(inventoryId, JSON.stringify(v3Item));
            totalItems++;
          }

          if (items.length > 0) totalInventories++;
        } catch (e) {
          errors.push(`player inventory error: ${e}`);
        }
      }

      console.log(`[ox_inventory]   ✓ Migrated ${playerRows.length} player inventories`);
    }

    // Commit transaction
    sqlite.exec('COMMIT');

  } catch (e) {
    sqlite.exec('ROLLBACK');
    console.error('[ox_inventory] Migration failed, rolled back:', e);
    errors.push(`Critical error: ${e}`);
  }

  sqlite.close();

  // Save migration state
  const finalState: MigrationState = {
    migrated: true,
    migratedAt: new Date().toISOString(),
    itemsMigrated: totalItems,
    inventoriesMigrated: totalInventories,
    errors: errors.length > 0 ? errors : undefined,
  };

  saveMigrationState(finalState);

  console.log('');
  console.log('='.repeat(60));
  console.log('[ox_inventory] Migration Complete!');
  console.log(`[ox_inventory]   Inventories: ${totalInventories}`);
  console.log(`[ox_inventory]   Items: ${totalItems}`);
  if (errors.length > 0) {
    console.log(`[ox_inventory]   Errors: ${errors.length} (see migration.json)`);
  }
  console.log('='.repeat(60));
  console.log('');

  return true;
}
