import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { Socket } from "socket.io";
import { SocketContext } from "../types/socket.js";
import { authenticateSocket, AuthenticatedSocket } from "./middleware/socketAuth.js";
import { logger } from "../utils/logger.js";

// Import handlers
import { handleRegisterSocketId, handleRefreshToken } from "./handlers/authHandlers.js";
import { handleCreateGame, handleCancelCreatingAction } from "./handlers/gameCreationHandler.js";
import { handleAcceptInvite, handleRejectInvite, handleGetInvitedGames } from "./handlers/invitationHandlers.js";
import { handleStartGame, handleSendPlayerTurn, handleDealEndedAction, handleSendPlayAgain } from "./handlers/gameFlowHandlers.js";
import { handleChat } from "./handlers/chatHandler.js";
import { handleDisconnect, handlePlayerOutOfGame } from "./handlers/disconnectHandler.js";

export class SocketHandler {
  private io: SocketIOServer;


  constructor(server: HTTPServer) {
    const allowedOrigins = [process.env.DOMAIN_ADDRESS1, process.env.DOMAIN_ADDRESS2, process.env.LOCAL_ADDRESS]
      .filter(Boolean) as string[];
    this.io = new SocketIOServer(server, {
      cors: {
        origin: `${allowedOrigins}`,
        methods: ["GET", "POST"],
        credentials: true,
      }
    });

    this.setupSocketHandlers();
  }

  private createSocketContext(socket: Socket): SocketContext {
    return {
      io: this.io,
      socket: socket
    };
  }

  private setupSocketHandlers(): void {
    this.io.on("connection", async (socket: AuthenticatedSocket) => {
      // Authenticate socket during handshake
      const isAuthenticated = await authenticateSocket(socket);

      if (!isAuthenticated) {
        logger.error("CONNECTION_REJECTED", `socketId:${socket.id} reason:auth_failed`);
        socket.emit("error", {
          message: "Authentication failed. Please provide a valid Firebase ID token. If your token expired, please refresh it and reconnect.",
          code: "AUTH_FAILED"
        });
        socket.disconnect(true);
        return;
      }

      const context = this.createSocketContext(socket);

      // Register socket ID mapping (now using authenticated user)
      // This is called automatically on connection - no need for client to send event
      await handleRegisterSocketId(context, {});

      // Game creation handlers
      socket.on("create_game", async (data: any) => {
        await handleCreateGame(context, data);
      });

      socket.on("cancel_creating", (data: any) => {
        handleCancelCreatingAction(context, data);
      });

      socket.on("get_invited_games", async (data: any) => {
        await handleGetInvitedGames(context, data);
      });

      // Invitation handlers
      socket.on("accept_invite", async (data: any) => {
        await handleAcceptInvite(context, data);
      });

      socket.on("reject_invite", async (data: any) => {
        await handleRejectInvite(context, data);
      });

      // Game flow handlers
      socket.on("start_game", async (data: any) => {
        await handleStartGame(context, data);
      });

      socket.on("deal_ended", async (data: any) => {
        await handleDealEndedAction(context, data);
      });

      socket.on("send_player_turn", async (data: any) => {
        await handleSendPlayerTurn(context, data);
      });

      socket.on("send_play_again", async (data: any) => {
        await handleSendPlayAgain(context, data);
      });

      // Chat handler
      socket.on("chat", (data: string) => {
        handleChat(context, data);
      });

      // Token refresh handler - allows client to update token without reconnecting
      socket.on("refresh_token", async (data: any) => {
        await handleRefreshToken(context, data);
      });

      socket.on("player_out_of_game", async (data: any) => {
        await handlePlayerOutOfGame(context, data);
      });

      // Disconnect handler - handles cleanup and game removal
      socket.on("disconnect", async (reason: string) => {
        // Handle disconnect logic (game removal, notifications, etc.)
        await handleDisconnect(socket.id, this.io);
      });

      // Error handler for socket errors
      socket.on("error", async (error: Error) => {
        logger.error("SOCKET_ERROR", `socketId:${socket.id} error:${error.message}`);
        // Clean up on error to prevent stale connections
        await handleDisconnect(socket.id, this.io);
      });
    });
  }
}
