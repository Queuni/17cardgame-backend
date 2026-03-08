import redisClient from "../config/redis.js";
import { GameData } from "../types/game.js";

export class RedisGameService {
  private readonly GAME_PREFIX = "game:";
  private readonly GAME_TTL = 3600;

  private getGameKey(gameId: string): string {
    return `${this.GAME_PREFIX}${gameId}`;
  }

  async saveGame(gameData: GameData): Promise<void> {
    try {
      const key = this.getGameKey(gameData.gameId);
      const gameJson = JSON.stringify({
        ...gameData,
        updatedAt: new Date().toISOString(),
      });

      await redisClient.setex(key, this.GAME_TTL, gameJson);

    } catch (error) {
      console.error("Error saving game to Redis:", error);
      throw error;
    }
  }

  async getGame(gameId: string): Promise<GameData | null> {
    try {
      const key = this.getGameKey(gameId);
      const gameJson = await redisClient.get(key);

      if (!gameJson) {
        console.log(`Game not found in Redis: ${gameId}`);
        return null;
      }

      const gameData = JSON.parse(gameJson) as GameData;

      return gameData;
    } catch (error) {
      console.error("Error retrieving game from Redis:", error);
      throw error;
    }
  }

  async getAllGames(): Promise<GameData[]> {
    try {
      const keys = await redisClient.keys(`${this.GAME_PREFIX}*`);
      const games: GameData[] = [];

      for (const key of keys) {
        const gameJson = await redisClient.get(key);
        if (gameJson) {
          games.push(JSON.parse(gameJson) as GameData);
        }
      }

      return games;
    } catch (error) {
      console.error("Error retrieving all games from Redis:", error);
      throw error;
    }
  }

  async getInvitedGames(playerEmail: string): Promise<GameData[]> {
    try {
      const normalizedEmail = playerEmail.toLowerCase();
      const allGames = await this.getAllGames();
      console.log(allGames);
      const invitedGames = allGames.filter(game =>
        game.invitingList.includes(normalizedEmail) && game.status === "waiting"
      );

      return invitedGames;
    } catch (error) {
      console.error("Error retrieving games by invitee:", error);
      throw error;
    }
  }

  async deleteGame(gameId: string): Promise<void> {
    try {
      const key = this.getGameKey(gameId);
      await redisClient.del(key);
      console.log(`Game deleted from Redis: ${gameId}`);
    } catch (error) {
      console.error("Error deleting game from Redis:", error);
      throw error;
    }
  }

  async isInvitedPlayer(gameId: string, playerEmail: string): Promise<boolean> {
    try {
      const game = await this.getGame(gameId);
      if (!game) {
        return false;
      }
      return game.invitingList.includes(playerEmail);
    }
    catch (error) {
      console.error("Error checking if player is invited:", error);
      throw error;
    }
  }

  async updateGameField(gameId: string, field: string, value: any): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (!game) throw new Error(`Game not found: ${gameId}`);

      setNestedValue(game, field, value);
      await this.saveGame(game);

    } catch (error) {
      console.error("❌ Error updating game field:", error);
      throw error;
    }
  }

  async getGameField(gameId: string, field: string): Promise<any> {
    try {
      const game = await this.getGame(gameId);
      if (!game) throw new Error(`Game not found: ${gameId}`);

      const value = getNestedValue(game, field);

      return value;
    } catch (error) {
      console.error("❌ Error getting game field:", error);
      throw error;
    }
  }


  async addPlayerToAcceptedList(gameId: string, playerEmail: string): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (!game) {
        throw new Error(`Game not found: ${gameId}`);
      }

      const normalizedEmail = playerEmail.toLowerCase();
      if (!game.acceptedList.includes(normalizedEmail)) {
        game.acceptedList.push(normalizedEmail);
        await this.saveGame(game);
        console.log(`Player added to accepted list: ${gameId} - ${normalizedEmail}`);
      }
    } catch (error) {
      console.error("Error adding player to accepted list:", error);
      throw error;
    }
  }

  async removePlayerFromAcceptedList(gameId: string, playerEmail: string): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (!game) {
        throw new Error(`Game not found: ${gameId}`);
      }

      const normalizedEmail = playerEmail.toLowerCase();
      game.acceptedList = game.acceptedList.filter((email) => email !== normalizedEmail);
      await this.saveGame(game);
      console.log(`Player removed from accepted list: ${gameId} - ${normalizedEmail}`);
    } catch (error) {
      console.error("Error removing player from accepted list:", error);
      throw error;
    }
  }

  async gameExists(gameId: string): Promise<boolean> {
    try {
      const key = this.getGameKey(gameId);
      const exists = await redisClient.exists(key);
      return exists === 1;
    } catch (error) {
      console.error("Error checking if game exists:", error);
      throw error;
    }
  }

  async removeCreatedGame(email: string): Promise<void> {
    try {
      const allGames = await this.getAllGames();
      // Only remove games that are in "waiting" status (not started)
      // Games in "playing" status should NOT be removed - they can continue even if player disconnects
      const createdGames = allGames.filter(game =>
        game.player0.email.toLowerCase() === email.toLowerCase() &&
        (!game.status || game.status === "waiting") // Only waiting games, not playing or finished
      );

      for (const game of createdGames) {
        await this.deleteGame(game.gameId);
        console.log(`Removed waiting game ${game.gameId} created by ${email}`);
      }

      if (createdGames.length > 0) {
        console.log(`Removed ${createdGames.length} waiting game(s) created by ${email}`);
      }
    } catch (error) {
      console.error("Error removing game mapping from Redis:", error);
      throw error;
    }
  }

  /**
   * Find all active games where a player is participating
   * @param email - Player email to search for
   * @param status - Optional game status filter (e.g., "playing")
   * @returns Array of games where the player is a participant
   */
  async getGamesByPlayer(email: string, status?: string): Promise<GameData[]> {
    try {
      const normalizedEmail = email.toLowerCase();
      const allGames = await this.getAllGames();

      const playerGames = allGames.filter(game => {
        const isPlayer =
          game.player0.email?.toLowerCase() === normalizedEmail ||
          game.player1.email?.toLowerCase() === normalizedEmail ||
          game.player2.email?.toLowerCase() === normalizedEmail;

        if (!isPlayer) return false;
        if (status && game.status !== status) return false;

        return true;
      });

      return playerGames;
    } catch (error) {
      console.error("Error finding games by player:", error);
      throw error;
    }
  }

  async refreshGameTTL(gameId: string): Promise<void> {
    try {
      const key = this.getGameKey(gameId);
      await redisClient.expire(key, this.GAME_TTL);
      console.log(`Game TTL refreshed: ${gameId}`);
    } catch (error) {
      console.error("Error refreshing game TTL:", error);
      throw error;
    }
  }
}

/**
 * Safely sets a nested field in an object, creating intermediate objects if missing.
 * Example: setNestedValue(obj, "player0.hands", ["3_of_spades"])
 */
export function setNestedValue<T extends object>(
  obj: T,
  path: string,
  value: any
): void {
  const keys = path.split(".");
  let current: any = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (key && (typeof current[key] !== "object" || current[key] === null)) {
      current[key as keyof typeof current] = {}; // create sub-object
    }
    current = current[key as keyof typeof current];
  }

  const lastKey = keys[keys.length - 1];
  current[lastKey as keyof typeof current] = value;
}

/**
 * Safely retrieves a nested field from an object.
 * Example: const hands = getNestedValue(obj, "player0.hands")
 */
export function getNestedValue<T extends object, R = unknown>(
  obj: T,
  path: string
): R | undefined {
  const keys = path.split(".");
  let current: any = obj;

  for (const key of keys) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[key];
  }

  return current as R;
}

export default new RedisGameService();

