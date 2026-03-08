import { SocketContext } from "../../types/socket.js";
import redisGameService from "../../services/redisGameService.js";
import redisSocketService from "../../services/redisSocketService.js";
import { getAuthenticatedEmail, AuthenticatedSocket } from "../middleware/socketAuth.js";

export async function handleGetInvitedGames(context: SocketContext, data: any) {
  const { socket } = context;
  const authSocket = socket as AuthenticatedSocket;
  const email = getAuthenticatedEmail(authSocket)?.toLowerCase();

  if (!email) {
    socket.emit("error", { message: "User not authenticated" });
    return;
  }

  try {
    const games = await redisGameService.getInvitedGames(email);
    const resultString = JSON.stringify({ gameList: games });
    socket.emit("invited_games", resultString);
  } catch (error) {
    console.error("Error getting invited games:", error);
    socket.emit("error", { message: "Failed to get invited games" });
  }
}

export async function handleAcceptInvite(context: SocketContext, data: any) {
  const { socket } = context;
  const authSocket = socket as AuthenticatedSocket;
  const { param: gameId } = redisSocketService.getSafeJson(data);
  const email = getAuthenticatedEmail(authSocket)?.toLowerCase();

  if (!email) {
    socket.emit("error", { message: "User not authenticated" });
    return;
  }

  try {
    const isInvited = await redisGameService.isInvitedPlayer(gameId, email);
    if (!isInvited) {
      socket.emit("error", { message: "You are not invited to this game" });
      return;
    }

    socket.join(gameId);
    await redisGameService.addPlayerToAcceptedList(gameId, email);

    console.log("Player joining:", email, gameId);

    const resultString = JSON.stringify({ result: email });
    socket.to(gameId).emit("player_ready", resultString);
  } catch (error) {
    console.error("Error accepting invite:", error);
    socket.emit("error", { message: "Failed to accept invite" });
  }
}

export async function handleRejectInvite(context: SocketContext, data: any) {
  const { io, socket } = context;
  const authSocket = socket as AuthenticatedSocket;
  const joinInfo = redisSocketService.getSafeJson(data);
  const gameId: string = joinInfo['param'];
  const email = getAuthenticatedEmail(authSocket)?.toLowerCase();

  if (!email) {
    socket.emit("error", { message: "User not authenticated" });
    return;
  }

  try {
    await redisGameService.removePlayerFromAcceptedList(gameId, email);

    const resultString = JSON.stringify({ result: email });
    socket.to(gameId).emit("player_not_ready", resultString);
  } catch (error) {
    console.error("Error rejecting invite:", error);
    socket.emit("error", { message: "Failed to reject invite" });
  }
}
