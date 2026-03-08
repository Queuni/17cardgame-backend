import redisSocketService from "../../services/redisSocketService.js";
import redisGameService from "../../services/redisGameService.js";
import { GameData, GamePlayer } from "../../types/game.js";
import { SocketContext } from "../../types/socket.js";
import { logger } from "../../utils/logger.js";

// Store pending game removals to allow cancellation on reconnection
// Map: email -> { quickCheckTimeout, gameIds[] }
interface PendingRemoval {
  quickCheckTimeout: NodeJS.Timeout;
  gameIds: string[];
}

interface PlayerRole {
  isCreator: boolean;
  isPlayer1: boolean;
  isPlayer2: boolean;
  player: GamePlayer | null;
}

interface GameDisconnectResult {
  deleted: boolean;
  notified: boolean;
}

const pendingRemovals = new Map<string, PendingRemoval>();

// Quick reconnect check to distinguish token refresh reconnection from real disconnect
// Token refresh reconnections typically happen within 5 seconds
const QUICK_RECONNECT_THRESHOLD = 5000; // 5 seconds

// ==================== Helper Functions ====================

/**
 * Get player role in a game (creator or joined player)
 */
function getPlayerRole(game: GameData, email: string): PlayerRole {
  const normalizedEmail = email.toLowerCase();
  return {
    isCreator: game.player0.email?.toLowerCase() === normalizedEmail,
    isPlayer1: game.player1.email?.toLowerCase() === normalizedEmail,
    isPlayer2: game.player2.email?.toLowerCase() === normalizedEmail,
    player: game.player0.email?.toLowerCase() === normalizedEmail ? game.player0 :
      game.player1.email?.toLowerCase() === normalizedEmail ? game.player1 :
        game.player2.email?.toLowerCase() === normalizedEmail ? game.player2 : null
  };
}

/**
 * Notify other players in a game about a disconnect
 */
function notifyPlayers(io: any, gameId: string, playerName: string, message: string, otherPlayers: GamePlayer[]): void {
  if (otherPlayers.length > 0) {
    io.to(gameId).emit("player_disconnected", JSON.stringify({
      gameId: gameId,
      playerName: playerName,
      message: message
    }));
    logger.info("PLAYER_DISCONNECTED_NOTIFY", `gameId:${gameId} player:${playerName} notified:${otherPlayers.length}`);
  }
}

/**
 * Notify creator that a player is not ready (for waiting games when joined player disconnects)
 */
function notifyCreatorPlayerNotReady(io: any, gameId: string, playerEmail: string): void {
  io.to(gameId).emit("player_not_ready", JSON.stringify({ result: playerEmail }));
  logger.info("PLAYER_NOT_READY_NOTIFY", `gameId:${gameId} player:${playerEmail} target:creator`);
}

/**
 * Notify players in active (playing) games about immediate disconnect
 */
async function notifyActiveGamesDisconnect(io: any, activeGames: GameData[], email: string): Promise<void> {
  for (const game of activeGames) {
    const role = getPlayerRole(game, email);
    if (!role.player) continue;

    const playerName = role.player.name || email;
    const otherHumanPlayers = [
      game.player0,
      game.player1,
      game.player2
    ].filter((p, index) => {
      const playerIndex = role.isCreator ? 0 : role.isPlayer1 ? 1 : 2;
      return index !== playerIndex && !p.isCPU;
    });

    notifyPlayers(io, game.gameId, playerName, `${playerName} has disconnected from the game.`, otherHumanPlayers);
  }
}

// ==================== Game Disconnect Handlers ====================

/**
 * Handle disconnect from a playing game - always delete and notify
 */
async function handlePlayingGameDisconnect(
  io: any,
  game: GameData,
  gameId: string,
  email: string,
  role: PlayerRole
): Promise<GameDisconnectResult> {
  const playerName = role.player?.name || email;
  const otherPlayers = [
    game.player0,
    game.player1,
    game.player2
  ].filter(p => p.email?.toLowerCase() !== email.toLowerCase() && !p.isCPU);

  notifyPlayers(io, gameId, playerName, `${playerName} has disconnected. The game has ended.`, otherPlayers);
  await redisGameService.deleteGame(gameId);
  logger.info("GAME_DELETED", `gameId:${gameId} reason:disconnect status:playing`);

  return { deleted: true, notified: otherPlayers.length > 0 };
}

/**
 * Handle creator disconnect from waiting game - delete and notify invitees
 */
async function handleWaitingGameCreatorDisconnect(
  io: any,
  game: GameData,
  gameId: string,
  email: string,
  role: PlayerRole
): Promise<GameDisconnectResult> {
  const playerName = role.player?.name || email;
  const otherPlayers = [
    game.player1,
    game.player2
  ].filter(p => !p.isCPU && p.email);

  notifyPlayers(io, gameId, playerName, `${playerName} has disconnected. The game has been cancelled.`, otherPlayers);
  await redisGameService.deleteGame(gameId);
  logger.info("GAME_DELETED", `gameId:${gameId} reason:disconnect status:waiting role:creator`);

  return { deleted: true, notified: otherPlayers.length > 0 };
}

/**
 * Handle joined player disconnect from waiting game - remove from acceptedList, notify but don't delete
 * Notifies creator with "player_not_ready" and other joined players with "player_disconnected"
 */
async function handleWaitingGameJoinedDisconnect(
  io: any,
  game: GameData,
  gameId: string,
  email: string,
  role: PlayerRole
): Promise<GameDisconnectResult> {
  const playerName = role.player?.name || email;

  // Remove player's email from acceptedList
  try {
    await redisGameService.removePlayerFromAcceptedList(gameId, email);
    logger.info("REMOVED_FROM_ACCEPTED", `gameId:${gameId} email:${email}`);
  } catch (removeError) {
    logger.error("REMOVE_FROM_ACCEPTED_FAILED", `gameId:${gameId} email:${email} error:${removeError}`);
  }

  // Notify creator with "player_not_ready" event
  if (game.player0 && !game.player0.isCPU && game.player0.email) {
    notifyCreatorPlayerNotReady(io, gameId, email);
  }

  // Notify other joined human players (not creator) with "player_disconnected"
  const otherJoinedPlayers = [
    game.player1,
    game.player2
  ].filter(p =>
    p.email?.toLowerCase() !== email.toLowerCase() &&
    !p.isCPU &&
    p.email
  );

  if (otherJoinedPlayers.length > 0) {
    notifyPlayers(io, gameId, playerName, `${playerName} has left the game.`, otherJoinedPlayers);
  }

  const totalNotified = (game.player0 && !game.player0.isCPU && game.player0.email ? 1 : 0) + otherJoinedPlayers.length;

  return { deleted: false, notified: totalNotified > 0 };
}

/**
 * Process a single game disconnect based on status and player role
 */
async function processGameDisconnect(
  io: any,
  gameId: string,
  email: string
): Promise<GameDisconnectResult | null> {
  try {
    const game = await redisGameService.getGame(gameId);
    if (!game || game.status === "finished") {
      return null;
    }

    const role = getPlayerRole(game, email);

    if (game.status === "playing") {
      return await handlePlayingGameDisconnect(io, game, gameId, email, role);
    } else if (game.status === "waiting") {
      if (role.isCreator) {
        return await handleWaitingGameCreatorDisconnect(io, game, gameId, email, role);
      } else {
        return await handleWaitingGameJoinedDisconnect(io, game, gameId, email, role);
      }
    }

    return null;
  } catch (gameError) {
    logger.error("HANDLE_GAME_FAILED", `gameId:${gameId} error:${gameError}`);
    return null;
  }
}

// ==================== Removal Scheduling ====================

/**
 * Handle game removal after grace period
 */
async function handleGameRemoval(io: any, email: string, gameIds: string[]): Promise<void> {
  try {
    // Final check if player has reconnected
    const finalSocketId = await redisSocketService.getSocketId(email);
    if (finalSocketId) {
      logger.info("RECONNECTED", `email:${email}`);
      pendingRemovals.delete(email);
      return;
    }

    let deletedCount = 0;
    let notifiedCount = 0;

    for (const gameId of gameIds) {
      const result = await processGameDisconnect(io, gameId, email);
      if (result) {
        if (result.deleted) deletedCount++;
        if (result.notified) notifiedCount++;
      }
    }

    pendingRemovals.delete(email);
    logger.info("DISCONNECT_HANDLED", `email:${email} deleted:${deletedCount} notified:${notifiedCount} total:${gameIds.length}`);
  } catch (error) {
    logger.error("REMOVE_GAMES_FAILED", `email:${email} error:${error}`);
    pendingRemovals.delete(email);
  }
}

/**
 * Check for quick reconnect, then remove games immediately if no reconnect
 * 
 * Note: Normal token refresh (via refresh_token event) does NOT trigger disconnect,
 * so this handler is only called for:
 * 1. Token refresh with reconnection (RefreshTokenAndReconnect on auth errors)
 * 2. Real disconnects (exit, crash, internet failure)
 * 
 * The quick reconnect check (5 seconds) distinguishes between:
 * - Token refresh reconnection (reconnects within 5 seconds) → skip removal
 * - Real disconnect (no quick reconnect) → remove games immediately
 */
function scheduleGameRemoval(io: any, email: string, gameIds: string[]): void {
  // Cancel any existing pending removal
  const existingRemoval = pendingRemovals.get(email);
  if (existingRemoval) {
    clearTimeout(existingRemoval.quickCheckTimeout);
  }

  // Wait to see if player reconnects quickly (token refresh reconnection scenario)
  // Normal token refresh via refresh_token event doesn't disconnect, so this handles
  // cases where RefreshTokenAndReconnect() is called (e.g., on AUTH_FAILED errors)
  const quickCheckTimeout = setTimeout(async () => {
    try {
      const currentSocketId = await redisSocketService.getSocketId(email);
      if (currentSocketId) {
        // Player reconnected quickly (likely token refresh reconnection) - don't remove
        logger.info("TOKEN_REFRESH", `email:${email} reason:quick_reconnect`);
        pendingRemovals.delete(email);
        return;
      }

      // Player didn't reconnect quickly - remove games immediately
      // No grace period since there's no game resume feature
      await handleGameRemoval(io, email, gameIds);
      logger.info("GAMES_REMOVED_IMMEDIATELY", `email:${email} games:${gameIds.length}`);
    } catch (error) {
      logger.error("QUICK_CHECK_FAILED", `email:${email} error:${error}`);
      pendingRemovals.delete(email);
    }
  }, QUICK_RECONNECT_THRESHOLD);

  // Store the quick check timeout
  pendingRemovals.set(email, { quickCheckTimeout, gameIds });
}

// ==================== Main Handler ====================

/**
 * Main disconnect handler - orchestrates the disconnect process
 */
export async function handleDisconnect(socketId: string, io: any) {
  try {
    const email = await redisSocketService.getEmail(socketId);

    if (!email) {
      return;
    }

    await redisSocketService.removeSocketMapping(socketId);

    // Get ALL games where player is a participant
    const allPlayerGames = await redisGameService.getGamesByPlayer(email);
    const gameIds = allPlayerGames.map(game => game.gameId);

    // Notify players in active (playing) games about immediate disconnect
    const activeGames = allPlayerGames.filter(game => game.status === "playing");
    await notifyActiveGamesDisconnect(io, activeGames, email);

    if (gameIds.length === 0) {
      return;
    }

    // Schedule game removal after grace period
    scheduleGameRemoval(io, email, gameIds);

    logger.info("DISCONNECT", `socketId:${socketId} email:${email}`);
  } catch (error) {
    logger.error("DISCONNECT_FAILED", `socketId:${socketId} error:${error}`);
  }
}

// Cancel pending removal when player reconnects
export function cancelPendingRemoval(email: string): void {
  const removal = pendingRemovals.get(email);
  if (removal) {
    clearTimeout(removal.quickCheckTimeout);
    pendingRemovals.delete(email);
    logger.info("REMOVAL_CANCELLED", `email:${email}`);
  }
}

/**
 * Handle player quitting/leaving a game while playing
 * Deletes the game, removes player from game, and notifies other human players
 */
export async function handlePlayerOutOfGame(context: SocketContext, data: any) {
  const { io } = context;
  try {
    const { param: gameId } = redisSocketService.getSafeJson(data);
    const email = await redisSocketService.getEmail(context.socket.id);

    if (!email) {
      logger.error("PLAYER_OUT_OF_GAME_FAILED", `socketId:${context.socket.id} error:No email found`);
      return;
    }

    const game = await redisGameService.getGame(gameId);
    if (!game || game.status !== "playing") {
      logger.warn("PLAYER_OUT_OF_GAME_INVALID", `gameId:${gameId} status:${game?.status || "not_found"}`);
      return;
    }

    const role = getPlayerRole(game, email);
    if (!role.player) {
      logger.warn("PLAYER_OUT_OF_GAME_NOT_FOUND", `gameId:${gameId} email:${email}`);
      return;
    }

    const playerName = role.player.name || email;

    // Get other human players to notify
    const otherHumanPlayers = [
      game.player0,
      game.player1,
      game.player2
    ].filter((p, index) => {
      const playerIndex = role.isCreator ? 0 : role.isPlayer1 ? 1 : 2;
      return index !== playerIndex && !p.isCPU && p.email;
    });

    // First: Notify other human players
    if (otherHumanPlayers.length > 0) {
      notifyPlayers(io, gameId, playerName, `${playerName} has quit the game. The game has ended.`, otherHumanPlayers);
      logger.info("PLAYER_QUIT_NOTIFY", `gameId:${gameId} player:${playerName} notified:${otherHumanPlayers.length}`);
    }

    // Second: Check if game still exists, then delete it
    const gameStillExists = await redisGameService.getGame(gameId);
    if (gameStillExists) {
      await redisGameService.deleteGame(gameId);
      logger.info("GAME_DELETED", `gameId:${gameId} reason:player_quit status:playing player:${email}`);
    } else {
      logger.warn("GAME_ALREADY_DELETED", `gameId:${gameId} player:${email}`);
    }
  } catch (error) {
    logger.error("PLAYER_OUT_OF_GAME_FAILED", `socketId:${context.socket.id} error:${error}`);
  }
}

