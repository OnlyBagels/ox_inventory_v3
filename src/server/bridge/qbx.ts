import type { ServerBridge, BridgePlayerData, PlayerLoadData, License } from './index';
import { Inventory } from '../inventory/class';

interface QBXPlayer {
  PlayerData: {
    citizenid: string;
    charinfo: {
      firstname: string;
      lastname: string;
      gender: number;
      birthdate: string;
    };
    money: Record<string, number>;
    metadata: {
      licences: Record<string, boolean>;
    };
  };
  Functions: {
    GetMoney(type: string): number;
    SetMoney(type: string, amount: number, reason?: string): void;
    SetPlayerData(key: string, value: any): void;
    SetMetaData(key: string, value: any): void;
  };
}

// QBX Core exports
const QBX = {
  GetPlayer: (source: number): QBXPlayer | null => exports.qbx_core.GetPlayer(source),
  GetPlayersData: (): any[] => exports.qbx_core.GetPlayersData(),
  GetGroups: (source: number): Record<string, number> => exports.qbx_core.GetGroups(source),
  CanUseItem: (itemName: string): ((source: number, data: any) => boolean) | null =>
    exports.qbx_core.CanUseItem(itemName),
  IsGradeBoss: (group: string, grade: number): boolean => exports.qbx_core.IsGradeBoss(group, grade),
};

export class QBXBridge implements ServerBridge {
  name = 'QBX';

  constructor() {
    // Verify dependencies
    this.checkDependencies();

    // Register event handlers
    this.registerEventHandlers();

    // Setup existing players (for resource restarts)
    setTimeout(() => this.setupExistingPlayers(), 500);
  }

  private checkDependencies(): void {
    const qbxVersion = GetResourceMetadata('qbx_core', 'version', 0);
    const vehiclesVersion = GetResourceMetadata('qbx_vehicles', 'version', 0);

    if (!qbxVersion) {
      throw new Error('qbx_core is required but not found');
    }

    // Version check (basic)
    console.log(`^3[ox_inventory] QBX Core version: ${qbxVersion}^0`);

    if (vehiclesVersion) {
      console.log(`^3[ox_inventory] QBX Vehicles version: ${vehiclesVersion}^0`);
    }
  }

  private registerEventHandlers(): void {
    // Player logged out
    on('qbx_core:server:playerLoggedOut', (source: number) => {
      this.playerDropped(source);
    });

    // Group/job updates
    on('qbx_core:server:onGroupUpdate', (source: number, groupName: string, groupGrade: number | null) => {
      const inventory = Inventory.FromId(`player:${source}`);
      if (!inventory || !inventory.player) return;

      if (groupGrade === null) {
        delete inventory.player.groups[groupName];
      } else {
        inventory.player.groups[groupName] = groupGrade;
      }
    });

    // State bag handler for player loading
    AddStateBagChangeHandler('loadInventory', null, (bagName: string, _key: string, value: boolean) => {
      if (!value) return;

      const source = GetPlayerFromStateBagName(bagName);
      if (!source || source === 0) return;

      const player = QBX.GetPlayer(source);
      if (!player) return;

      this.setupPlayer(player.PlayerData, source);
    });
  }

  private async setupExistingPlayers(): Promise<void> {
    const playersData = QBX.GetPlayersData();

    for (const playerData of playersData) {
      if (playerData && playerData.source) {
        await this.setupPlayer(playerData, playerData.source);
      }
    }
  }

  private async setupPlayer(playerData: any, source: number): Promise<void> {
    const loadData: PlayerLoadData = {
      source,
      identifier: playerData.citizenid,
      name: `${playerData.charinfo.firstname} ${playerData.charinfo.lastname}`,
      groups: QBX.GetGroups(source),
      sex: playerData.charinfo.gender === 0 ? 'male' : 'female',
      dateofbirth: playerData.charinfo.birthdate,
    };

    await this.setPlayerInventory(loadData);

    // Sync inventory money to QBX player money state
    // This ensures the GTA cash UI shows the correct amount from inventory
    // Use citizenid (identifier) for inventoryId, NOT source
    const inventory = Inventory.FromId(`player:${playerData.citizenid}`);
    if (inventory) {
      // First, check if QBX has money but inventory doesn't
      // This handles fresh migrations where QBX has the data
      const player = QBX.GetPlayer(source);
      if (player) {
        const qbxCash = player.Functions.GetMoney('cash') || 0;
        const qbxBank = player.Functions.GetMoney('bank') || 0;
        const invCash = inventory.getItemCount({ name: 'money' });
        const invBank = inventory.getItemCount({ name: 'bank' });

        console.log(`^3[ox_inventory] Player ${source} setup: QBX cash=$${qbxCash}, bank=$${qbxBank} | Inv money=${invCash}, bank=${invBank}^0`);

        // If QBX has money but inventory doesn't, create the items
        if (qbxCash > 0 && invCash === 0) {
          console.log(`^2[ox_inventory] Creating money item from QBX cash: $${qbxCash}^0`);
          inventory.addItem({ name: 'money', quantity: qbxCash });
        }
        if (qbxBank > 0 && invBank === 0) {
          console.log(`^2[ox_inventory] Creating bank item from QBX bank: $${qbxBank}^0`);
          inventory.addItem({ name: 'bank', quantity: qbxBank });
        }
      }

      this.syncInventory(inventory);
    }
  }

  async setPlayerInventory(player: PlayerLoadData): Promise<void> {
    // Import here to avoid circular dependency
    const { GetInventory } = await import('../inventory');

    // IMPORTANT: Use citizenid (identifier) for inventoryId, NOT source
    // This ensures items persist across sessions (source changes each login)
    const inventory = await GetInventory(`player:${player.identifier}`, {
      type: 'player',
      label: player.name,
      playerId: player.source,
      ownerId: player.identifier,
    });

    if (inventory) {
      (inventory as any).player = this.setPlayerData(player);
    }
  }

  setPlayerData(player: any): BridgePlayerData {
    const groups = player.groups ?? (player.source ? QBX.GetGroups(player.source) : {});

    return {
      source: player.source,
      name: player.name ?? `${player.charinfo?.firstname ?? ''} ${player.charinfo?.lastname ?? ''}`.trim(),
      groups,
      sex: player.sex ?? (player.charinfo?.gender === 0 ? 'male' : 'female'),
      dateofbirth: player.dateofbirth ?? player.charinfo?.birthdate,
    };
  }

  syncInventory(inventory: Inventory): void {
    if (!inventory.playerId) return;

    const player = QBX.GetPlayer(inventory.playerId);
    if (!player) return;

    // Build items in QBX format (slot -> item data)
    // QBX expects items keyed by slot number with full item data
    const qbxItems: Record<number, any> = {};
    const items = inventory.mapItems();

    // Debug: log all items in inventory
    console.log(`^3[ox_inventory] Inventory ${inventory.inventoryId} has ${items.length} items^0`);
    for (const item of items) {
      console.log(`^3[ox_inventory]   - ${item.name} x${item.quantity} (slot ${item.anchorSlot})^0`);
    }

    for (const item of items) {
      if (item.anchorSlot !== undefined) {
        qbxItems[item.anchorSlot] = {
          name: item.name,
          amount: item.quantity,
          info: item.toJSON?.() || item,
          label: item.label,
          description: item.description,
          weight: item.weight,
          type: item.category,
          unique: item.stackSize === 1,
          useable: true,
          image: `${item.name}.png`,
          slot: item.anchorSlot,
        };
      }
    }

    // Sync items to QBX
    player.Functions.SetPlayerData('items', qbxItems);

    // Sync money accounts (inventory item name -> QBX account name)
    // Only sync if inventory has money items - if inventory has 0, QBX is the source of truth
    // This prevents zeroing out money when v3 SQLite hasn't been populated with v2 MySQL data
    const accountItems: Record<string, string> = {
      money: 'cash',
      bank: 'bank',
    };

    for (const [itemName, account] of Object.entries(accountItems)) {
      const count = inventory.getItemCount({ name: itemName });
      const currentMoney = player.Functions.GetMoney(account);

      console.log(`^3[ox_inventory] Sync ${account}: inventory has ${count} ${itemName}, QBX has $${currentMoney}^0`);

      // Only sync TO QBX if inventory actually has this item type
      // If inventory has 0, don't overwrite QBX - it's likely not migrated yet
      if (count > 0 && currentMoney !== count) {
        player.Functions.SetMoney(account, count, `Sync ${account} with inventory`);
        console.log(`^2[ox_inventory] Set ${account} to $${count}^0`);
      } else if (count === 0 && currentMoney > 0) {
        // Inventory has no money items but QBX does - create the money item in inventory
        console.log(`^3[ox_inventory] Creating ${itemName} item from QBX ${account}: $${currentMoney}^0`);
        inventory.addItem({ name: itemName, quantity: currentMoney });
      }
    }
  }

  hasGroup(inventory: any, group: string | Record<string, number>): [string | undefined, number | undefined] {
    const playerGroups = inventory.player?.groups ?? {};

    if (typeof group === 'string') {
      const rank = playerGroups[group];
      if (rank !== undefined) {
        return [group, rank];
      }
    } else {
      for (const [name, requiredRank] of Object.entries(group)) {
        const playerRank = playerGroups[name];
        if (playerRank !== undefined && playerRank >= (requiredRank ?? 0)) {
          return [name, playerRank];
        }
      }
    }

    return [undefined, undefined];
  }

  hasLicense(inventory: any, license: string): boolean {
    if (!inventory.playerId) return false;

    const player = QBX.GetPlayer(inventory.playerId);
    return player?.PlayerData.metadata.licences[license] ?? false;
  }

  buyLicense(inventory: any, license: License): [boolean, string] {
    if (!inventory.playerId) return [false, 'invalid_player'];

    const player = QBX.GetPlayer(inventory.playerId);
    if (!player) return [false, 'invalid_player'];

    // Check if already has license
    if (player.PlayerData.metadata.licences[license.name]) {
      return [false, 'already_have'];
    }

    // Check if can afford
    const moneyCount = inventory.getItemCount({ name: 'money' });
    if (moneyCount < license.price) {
      return [false, 'can_not_afford'];
    }

    // Remove money and grant license
    inventory.removeItem({ name: 'money', quantity: license.price });

    player.PlayerData.metadata.licences[license.name] = true;
    player.Functions.SetMetaData('licences', player.PlayerData.metadata.licences);

    return [true, 'have_purchased'];
  }

  UseItem(source: number, itemName: string, data: any): boolean {
    const callback = QBX.CanUseItem(itemName);
    if (!callback) return false;

    try {
      return callback(source, data);
    } catch (error) {
      console.error(`^1[ox_inventory] Error using item ${itemName}:^0`, error);
      return false;
    }
  }

  isPlayerBoss(playerId: number, group: string, grade: number): boolean {
    return QBX.IsGradeBoss(group, grade);
  }

  getOwnedVehicleId(entityId: number): number | string {
    const vehicleId = Entity(entityId).state.vehicleid;

    if (vehicleId) return vehicleId;

    // Fallback to plate lookup via qbx_vehicles
    try {
      const plate = GetVehicleNumberPlateText(entityId);
      return exports.qbx_vehicles.GetVehicleIdByPlate(plate) ?? entityId;
    } catch {
      return entityId;
    }
  }

  playerDropped(source: number): void {
    const inventory = Inventory.FromId(`player:${source}`);

    if (inventory) {
      inventory.closeAll();
      inventory.remove(false);
    }
  }
}
