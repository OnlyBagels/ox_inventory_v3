import type { ItemContextButton } from '@common/item';
import { RequestOpenInventory, CloseInventory } from './inventory';
import { GetInventoryItem, UseItem } from './item';

interface ContextMenuAction {
  buttonId: string;
  label: string;
  icon: string;
  action?: string;
  exportName?: string;
  eventName?: string;
}

// Store action metadata for context menu buttons
const buttonActionMap: Map<string, { action?: string; exportName?: string; eventName?: string; itemId: number }> = new Map();

RegisterNuiCallback('openContextMenu', async (itemId: number, cb: NuiCb) => {
  const item = await GetInventoryItem(itemId);
  const response: ContextMenuAction[] = [];

  // Clear previous action map
  buttonActionMap.clear();

  if (!item) {
    cb(response);
    return;
  }

  // Add weapon-specific buttons
  if (item.category === 'weapon') {
    response.push({
      buttonId: 'unload',
      label: 'Unload',
      icon: 'game-icons:machine-gun-magazine',
    });
  }

  // Add custom context buttons from item data
  const contextButtons = (item as any).contextButtons as ItemContextButton[] | undefined;
  if (contextButtons && Array.isArray(contextButtons)) {
    for (const btn of contextButtons) {
      response.push({
        buttonId: btn.buttonId,
        label: btn.label,
        icon: btn.icon || 'hugeicons:cursor-click-01',
      });

      // Store action metadata for later use
      buttonActionMap.set(btn.buttonId, {
        action: btn.action,
        exportName: btn.exportName,
        eventName: btn.eventName,
        itemId: item.uniqueId,
      });
    }
  }

  cb(response);
});

RegisterNuiCallback(
  'contextMenuClick',
  async ({ itemId, buttonId }: { itemId: number; buttonId: string }, cb: NuiCb) => {
    const item = await GetInventoryItem(itemId);

    if (!item) return cb(0);

    // Check for standard buttons first
    switch (buttonId) {
      case 'use':
        UseItem(itemId);
        cb(1);
        return;
      case 'give':
        cb(1);
        return; //todo
      case 'unload':
        cb(1);
        return; //todo
    }

    // Check for custom button actions
    const actionData = buttonActionMap.get(buttonId);
    if (actionData) {
      switch (actionData.action) {
        case 'open':
          // Open the item as a container
          CloseInventory();
          await RequestOpenInventory([`container:${item.uniqueId}`]);
          cb(1);
          return;

        case 'event':
          // Trigger a client event
          if (actionData.eventName) {
            emit(actionData.eventName, item, { name: item.name, slot: item.anchorSlot });
          }
          cb(1);
          return;

        case 'export':
          // Call an export
          if (actionData.exportName) {
            const [resourceName, exportName] = actionData.exportName.split('.');
            try {
              exports[resourceName][exportName](item, { name: item.name, slot: item.anchorSlot });
            } catch (err) {
              console.error(`Failed to call export ${actionData.exportName}:`, err);
            }
          }
          cb(1);
          return;
      }
    }

    cb(1);
  },
);
