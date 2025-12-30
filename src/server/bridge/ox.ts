import { GetPlayer } from '@communityox/ox_core/server';
import type { ServerBridge, BridgePlayerData, PlayerLoadData, License } from './index';
import { Inventory } from '../inventory/class';

export class OxBridge implements ServerBridge {
  name = 'Ox';

  constructor() {
    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    // Player loaded
    on('ox:playerLoaded', async (source: number) => {
      const player = GetPlayer(source);
      if (!player) return;

      const loadData: PlayerLoadData = {
        source,
        identifier: player.charId.toString(),
        name: `${player.firstName} ${player.lastName}`,
        groups: player.getGroups(),
        sex: player.gender,
        dateofbirth: player.dateOfBirth,
      };

      await this.setPlayerInventory(loadData);
    });

    // Player logged out
    on('ox:playerLogout', (source: number) => {
      this.playerDropped(source);
    });

    // Group updates
    on('ox:setGroup', (source: number, groupName: string, grade: number | null) => {
      const inventory = Inventory.FromId(`player:${source}`);
      if (!inventory || !inventory.player) return;

      if (grade === null || grade < 0) {
        delete inventory.player.groups[groupName];
      } else {
        inventory.player.groups[groupName] = grade;
      }
    });
  }

  async setPlayerInventory(player: PlayerLoadData): Promise<void> {
    const { GetInventory } = await import('../inventory');

    const inventory = await GetInventory(`player:${player.source}`, {
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
    const oxPlayer = player.source ? GetPlayer(player.source) : null;

    return {
      source: player.source,
      name: player.name ?? (oxPlayer ? `${oxPlayer.firstName} ${oxPlayer.lastName}` : 'Unknown'),
      groups: player.groups ?? oxPlayer?.getGroups() ?? {},
      sex: player.sex ?? oxPlayer?.gender,
      dateofbirth: player.dateofbirth ?? oxPlayer?.dateOfBirth,
    };
  }

  syncInventory(inventory: Inventory): void {
    // Ox Core handles its own syncing, but we can emit events if needed
    if (!inventory.playerId) return;

    const player = GetPlayer(inventory.playerId);
    if (!player) return;

    // Emit event for other resources
    emit('ox_inventory:inventoryUpdated', inventory.playerId, inventory.inventoryId);
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

    const player = GetPlayer(inventory.playerId);
    // Ox Core doesn't have built-in licenses, check via metadata or external resource
    return player?.get('licenses')?.[license] ?? false;
  }

  buyLicense(inventory: any, license: License): [boolean, string] {
    if (!inventory.playerId) return [false, 'invalid_player'];

    const player = GetPlayer(inventory.playerId);
    if (!player) return [false, 'invalid_player'];

    const licenses = player.get('licenses') ?? {};

    if (licenses[license.name]) {
      return [false, 'already_have'];
    }

    const moneyCount = inventory.getItemCount({ name: 'money' });
    if (moneyCount < license.price) {
      return [false, 'can_not_afford'];
    }

    inventory.removeItem({ name: 'money', quantity: license.price });

    licenses[license.name] = true;
    player.set('licenses', licenses, true);

    return [true, 'have_purchased'];
  }

  UseItem(source: number, itemName: string, data: any): boolean {
    // Ox Core uses exports for item callbacks
    try {
      const callback = exports.ox_inventory?.getItemCallback?.(itemName);
      if (callback) {
        return callback(source, data);
      }
    } catch {
      // No callback registered
    }
    return false;
  }

  isPlayerBoss(playerId: number, group: string, grade: number): boolean {
    // Check via ox_core or custom implementation
    try {
      return exports.ox_core?.isGroupBoss?.(group, grade) ?? false;
    } catch {
      return false;
    }
  }

  getOwnedVehicleId(entityId: number): number | string {
    const state = Entity(entityId).state;
    return state?.vehicleId ?? state?.vin ?? NetworkGetNetworkIdFromEntity(entityId);
  }

  playerDropped(source: number): void {
    const inventory = Inventory.FromId(`player:${source}`);

    if (inventory) {
      inventory.closeAll();
      inventory.remove(false);
    }
  }
}
