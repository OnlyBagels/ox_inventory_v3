import { DatabaseSync } from 'node:sqlite';
import type { InventoryItem, ItemProperties } from '@common/item';
import { cache } from '@communityox/ox_lib';
import { Inventory } from './inventory/class';

const sqlite = new DatabaseSync(`${GetResourcePath(cache.resource)}/db.sqlite`);

if (!sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'`).get()) {
  const statement = LoadResourceFile(cache.resource, 'sql/schema.sql');

  sqlite.exec(statement);
}

sqlite.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA journal_size_limit = 67108864;
  PRAGMA mmap_size = 134217728;
  PRAGMA cache_size = 2000;
`);

interface DbItem {
  name: string;
  data: string;
  category?: string;
}

interface DbInventoryItem {
  uniqueId: string;
  inventoryId: string | null;
  data: string;
}

const db = new (class Database {
  private _getItems = sqlite.prepare('SELECT name, category, JSON(data) as data FROM items');
  private _getItemByName = sqlite.prepare('SELECT name, category, json(data) as data FROM items WHERE name LIKE ?');
  private _getItemsByCategory = sqlite.prepare('SELECT name, json(data) as data FROM items WHERE category LIKE ?');
  private _getInventoryItems = sqlite.prepare(
    'SELECT uniqueId, inventoryId, json(data) as data FROM inventory_items WHERE inventoryId = ?',
  );
  private _getInventoryItemsByOwner = sqlite.prepare(
    'SELECT uniqueId, inventoryId, json(data) as data FROM inventory_items WHERE inventoryId = ?',
  );
  private _deleteInventoryItem = sqlite.prepare('DELETE FROM inventory_items WHERE uniqueId = ?');
  private _updateInventoryItem = sqlite.prepare(
    'INSERT INTO inventory_items (uniqueId, inventoryId, data) VALUES (?, ?, jsonb(?)) ON CONFLICT(uniqueId) DO UPDATE SET inventoryId = excluded.inventoryId, data = excluded.data',
  );
  private _deleteInventoryItems = sqlite.prepare('DELETE FROM inventory_items WHERE inventoryId = ?');

  getItems(category?: string): ItemProperties[] {
    const results = (category ? this._getItemsByCategory.all(category) : this._getItems.all()) as DbItem[];

    return results.map((result) => {
      const obj = JSON.parse(result.data);
      obj.name = result.name;
      obj.category = category || result.category || 'miscellaneous';

      return obj;
    });
  }

  getItem(name: string): ItemProperties {
    const result = this._getItemByName.get(name) as DbItem;

    if (result) return { name: result.name, category: result.category, ...JSON.parse(result.data) };
  }

  getInventoryItems(inventoryId: string, alternateId?: string): ItemProperties[] {
    console.log(`^3[ox_inventory:db] Loading items for inventoryId='${inventoryId}', alternateId='${alternateId}'`);

    let results = this._getInventoryItems.all(inventoryId) as DbInventoryItem[];
    console.log(`^3[ox_inventory:db] Primary query returned ${results.length} items^0`);

    // If no items found and alternateId provided (e.g., for migrated player inventories),
    // try loading from the alternate ID and update them to use the new inventoryId
    if (results.length === 0 && alternateId) {
      results = this._getInventoryItemsByOwner.all(alternateId) as DbInventoryItem[];
      console.log(`^3[ox_inventory:db] Alternate query returned ${results.length} items^0`);

      // Update migrated items to use the correct inventoryId
      if (results.length > 0) {
        console.log(`[ox_inventory] Migrating ${results.length} items from '${alternateId}' to '${inventoryId}'`);
        for (const result of results) {
          this._updateInventoryItem.run(result.uniqueId, inventoryId, result.data);
          result.inventoryId = inventoryId;
        }
      }
    }

    const parsedResults = results.map((result) => {
      const obj = JSON.parse(result.data);
      obj.uniqueId = result.uniqueId;
      obj.inventoryId = result.inventoryId;

      return obj;
    });

    // Debug: show what items we found
    for (const item of parsedResults) {
      console.log(`^3[ox_inventory:db]   - Found item: ${item.name} x${item.quantity || 1} (uniqueId=${item.uniqueId})^0`);
    }

    return parsedResults;
  }

  updateInventoryItem(item: Partial<InventoryItem>): number {
    if (item.quantity < 1) return this._deleteInventoryItem.run(item.uniqueId)?.changes ? 0 : item.uniqueId;

    const inventory = Inventory.FromId(item.inventoryId);

    if (!inventory) return;

    const data = { ...item };
    delete data.uniqueId;
    delete data.inventoryId;

    const rowId = this._updateInventoryItem.run(
      item.uniqueId || null,
      (!inventory.isTemporary && item.inventoryId) || null,
      JSON.stringify(data),
    )?.lastInsertRowid;

    if (!item.uniqueId) item.uniqueId = Number(rowId);

    return item.uniqueId;
  }

  deleteInventory(inventoryId: string) {
    return this._deleteInventoryItems.run(inventoryId).changes;
  }
})();

export default db;

const createItemQuery = sqlite.prepare(`
  INSERT INTO items
    (name, category, data)
  VALUES
    (?, ?, jsonb(?))
  ON CONFLICT(name) DO UPDATE SET
    data = excluded.data
`);

exports('createItem', ({ name, category = null, ...data }: ItemProperties) => {
  try {
    return createItemQuery.run(name, category, JSON.stringify(data)).changes === 1;
  } catch (err) {
    console.error(`Failed to create new item '${name}.\n`, err);
    return false;
  }
});

// Database cleanup utilities

/**
 * Get all orphaned items (items with NULL or invalid inventoryId patterns like player:1, player:2)
 */
export function getOrphanedItems(): { uniqueId: number; inventoryId: string | null; name: string; quantity: number }[] {
  const query = sqlite.prepare(`
    SELECT uniqueId, inventoryId, json_extract(data, '$.name') as name, json_extract(data, '$.quantity') as quantity
    FROM inventory_items
    WHERE inventoryId IS NULL
       OR inventoryId LIKE 'player:%'
       AND inventoryId NOT LIKE 'player:_________'
       AND length(replace(inventoryId, 'player:', '')) < 5
  `);

  return query.all() as { uniqueId: number; inventoryId: string | null; name: string; quantity: number }[];
}

/**
 * Delete orphaned items from the database
 */
export function deleteOrphanedItems(): number {
  const query = sqlite.prepare(`
    DELETE FROM inventory_items
    WHERE inventoryId IS NULL
       OR (inventoryId LIKE 'player:%'
           AND inventoryId NOT LIKE 'player:_________'
           AND length(replace(inventoryId, 'player:', '')) < 5)
  `);

  return query.run().changes;
}

/**
 * Find and clean up duplicate items within the same inventory
 * Keeps only the item with the highest uniqueId for each name+slot combination
 */
export function cleanupDuplicateItems(inventoryId: string): { deleted: number; kept: number } {
  // First, find all items in this inventory
  const allItems = sqlite.prepare(`
    SELECT uniqueId, inventoryId, json_extract(data, '$.name') as name,
           json_extract(data, '$.quantity') as quantity,
           json_extract(data, '$.anchorSlot') as anchorSlot
    FROM inventory_items
    WHERE inventoryId = ?
    ORDER BY uniqueId DESC
  `).all(inventoryId) as { uniqueId: number; inventoryId: string; name: string; quantity: number; anchorSlot: number }[];

  // Group by name+anchorSlot to find duplicates
  const seen = new Map<string, number>();
  const duplicates: number[] = [];

  for (const item of allItems) {
    const key = `${item.name}:${item.anchorSlot}`;

    if (seen.has(key)) {
      // This is a duplicate - mark for deletion (we keep the first one we saw, which is highest uniqueId)
      duplicates.push(item.uniqueId);
    } else {
      seen.set(key, item.uniqueId);
    }
  }

  // Delete duplicates
  if (duplicates.length > 0) {
    const placeholders = duplicates.map(() => '?').join(',');
    sqlite.prepare(`DELETE FROM inventory_items WHERE uniqueId IN (${placeholders})`).run(...duplicates);
  }

  return { deleted: duplicates.length, kept: seen.size };
}
