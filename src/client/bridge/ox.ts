import type { ClientBridge, ClientBridgePlayerData } from './index';
import { setPlayerData } from './index';

// Import from ox_core client if available
let OxPlayer: any = null;

try {
  const oxCore = require('@communityox/ox_core/client');
  OxPlayer = oxCore.OxPlayer;
} catch {
  // ox_core client not available, will use exports
}

export class OxClientBridge implements ClientBridge {
  name = 'Ox';
  private dataChangeCallbacks: ((key: string, value: any) => void)[] = [];

  constructor() {
    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    // Player loaded
    on('ox:playerLoaded', (player: any) => {
      const data = this.transformPlayerData(player);
      setPlayerData(data);
      this.notifyDataChange('loaded', true);
    });

    // Player logout
    on('ox:playerLogout', () => {
      setPlayerData(null);
      this.notifyDataChange('loaded', false);
    });

    // Group changes
    on('ox:setGroup', (group: string, grade: number | null) => {
      const data = this.getPlayerData();
      if (data) {
        if (grade === null || grade < 0) {
          delete data.groups[group];
        } else {
          data.groups[group] = grade;
        }
        setPlayerData(data);
        this.notifyDataChange('groups', data.groups);
      }
    });

    // Death state
    on('ox:playerDeath', (isDead: boolean) => {
      const data = this.getPlayerData();
      if (data) {
        data.dead = isDead;
        setPlayerData(data);
        this.notifyDataChange('dead', isDead);
      }
    });
  }

  private notifyDataChange(key: string, value: any): void {
    for (const callback of this.dataChangeCallbacks) {
      try {
        callback(key, value);
      } catch (error) {
        console.error('[ox_inventory] Error in player data change callback:', error);
      }
    }
  }

  private transformPlayerData(player: any): ClientBridgePlayerData {
    return {
      source: GetPlayerServerId(PlayerId()),
      name: `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim() || 'Unknown',
      groups: player.groups ?? {},
      loaded: true,
      dead: player.dead ?? false,
      cuffed: player.cuffed ?? false,
    };
  }

  getPlayerData(): ClientBridgePlayerData | null {
    // Try to get from OxPlayer if available
    if (OxPlayer) {
      const player = OxPlayer;
      if (!player.charId) return null;

      return {
        source: GetPlayerServerId(PlayerId()),
        name: `${player.firstName} ${player.lastName}`,
        groups: player.getGroups?.() ?? {},
        loaded: true,
        dead: player.dead ?? false,
        cuffed: player.cuffed ?? false,
      };
    }

    // Fallback to exports
    try {
      const player = exports.ox_core?.GetPlayer?.();
      if (!player) return null;

      return this.transformPlayerData(player);
    } catch {
      return null;
    }
  }

  hasGroup(group: string | Record<string, number>): [string | undefined, number | undefined] {
    const data = this.getPlayerData();
    if (!data) return [undefined, undefined];

    if (typeof group === 'string') {
      const rank = data.groups[group];
      if (rank !== undefined) {
        return [group, rank];
      }
    } else {
      for (const [name, requiredRank] of Object.entries(group)) {
        const playerRank = data.groups[name];
        if (playerRank !== undefined && playerRank >= (requiredRank ?? 0)) {
          return [name, playerRank];
        }
      }
    }

    return [undefined, undefined];
  }

  onPlayerDataChange(callback: (key: string, value: any) => void): void {
    this.dataChangeCallbacks.push(callback);
  }

  isPlayerLoaded(): boolean {
    if (OxPlayer) {
      return !!OxPlayer.charId;
    }

    try {
      return !!exports.ox_core?.GetPlayer?.();
    } catch {
      return false;
    }
  }

  isPlayerDead(): boolean {
    if (OxPlayer) {
      return OxPlayer.dead ?? false;
    }

    try {
      return exports.ox_core?.GetPlayer?.()?.dead ?? false;
    } catch {
      return false;
    }
  }

  setPlayerStatus(status: Record<string, number>): void {
    // Emit event for status resources to handle
    emit('ox_inventory:setStatus', status);
  }
}
