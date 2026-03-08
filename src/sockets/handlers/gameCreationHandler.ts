import { SocketContext } from "../../types/socket.js";
import redisGameService from "../../services/redisGameService.js";
import redisSocketService from "../../services/redisSocketService.js";
import firebasePlayerService from "../../services/firebasePlayerService.js";
import { GameData } from "../../types/game.js";
import { logger } from "../../utils/logger.js";

export async function handleCreateGame(context: SocketContext, data: any) {
  const { io, socket } = context;
  const jsonData = redisSocketService.getSafeJson(data);
  const { gameId, gameName, player0, player1, player2, betAmount } = jsonData;

  // Generate gameId if not provided
  const generatedGameId = gameId || `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Check if any player is a CPU (player0 is always host/human, so only check player1 and player2)
  const hasCPU = [player1, player2].some(p => p.isCPU === true);

  const gameData = {
    gameId: generatedGameId,
    gameName,
    player0,
    player1,
    player2,
    invitingList: [],
    acceptedList: [],
    hasCPU: hasCPU,
    betAmount,
    status: "waiting",
    createdAt: new Date().toISOString()
  };


  try {
    // Check if the game has a CPU
    // If yes, use session token
    // If no, use real token 


    // Get player names
    await Promise.all(
      [player0, player1, player2].map(async (p, i) => {
        if (!p.isCPU) {
          const info = await firebasePlayerService.getPlayerInfo(p.email);
          (gameData as any)[`player${i}` as keyof GameData].name = info.displayName;
          (gameData as any)[`player${i}` as keyof GameData].email = info.email;
          (gameData as any)[`player${i}` as keyof GameData].avatarIndex = info.avatarIndex;
          (gameData as any).invitingList.push(info.email);
        }
        else {
          (gameData as any)[`player${i}` as keyof GameData].avatarIndex = -1;
        }
      })
    );

    await redisGameService.saveGame(gameData);

    socket.emit("game_created", JSON.stringify(gameData));
    logger.info("GAME_CREATED", `gameId:${generatedGameId} name:${gameName} creator:${player0.email}`);

    socket.join(generatedGameId);

    const invitedPlayers = [player1, player2];
    for (const player of invitedPlayers) {
      if (player.isCPU == true) {
        continue;
      }
      // Get socket ID from Redis
      const socketId = await redisSocketService.getSocketId(player.email);

      if (socketId) {
        const invitedInfo = { gameId: generatedGameId, gameInfo: gameData };
        const invitedString = JSON.stringify(invitedInfo);
        io.to(socketId).emit("invited_to_game", invitedString);
        logger.info("INVITATION_SENT", `gameId:${generatedGameId} to:${player.email}`);
      }
    }
  } catch (error) {
    logger.error("CREATE_GAME_FAILED", `error:${error}`);
    socket.emit("error", { message: "Failed to create game" });
  }
}

export async function handleCancelCreatingAction(context: SocketContext, data: any) {
  const { io, socket } = context;
  const jsonData = redisSocketService.getSafeJson(data);
  const gameId = jsonData.param;

  try {
    const gameInfo = await redisGameService.getGame(gameId);
    const invitedPlayers = [gameInfo?.player0, gameInfo?.player1, gameInfo?.player2];
    await redisGameService.deleteGame(gameId);

    invitedPlayers.forEach(async (player) => {
      if (!player?.email) return;
      const socketId = await redisSocketService.getSocketId(player.email);
      if (socketId) {
        io.to(socketId).emit("game_canceled", JSON.stringify({ result: gameId }));
      }
    });

    logger.info("GAME_CANCELED", `gameId:${gameId} name:${gameInfo?.gameName}`);
  } catch (error) {
    logger.error("CANCEL_GAME_FAILED", `gameId:${gameId} error:${error}`);
    socket.emit("error", { message: "Failed to cancel game" });
  }
}
