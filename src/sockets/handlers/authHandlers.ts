import { SocketContext } from "../../types/socket.js";
import redisSocketService from "../../services/redisSocketService.js";
import { AuthenticatedSocket } from "../middleware/socketAuth.js";
import { cancelPendingRemoval } from "./disconnectHandler.js";
import { logger } from "../../utils/logger.js";
import { auth } from "../../config/firebase.js";

export async function handleRegisterSocketId(context: SocketContext, data: any) {
  try {
    const { socket } = context;
    const authSocket = socket as AuthenticatedSocket;

    // Use authenticated user email from socket.data.user (set during handshake)
    const email = authSocket.data.user?.email || authSocket.data.email;

    if (!email) {
      logger.error("AUTH_FAILED", `socketId:${socket.id} reason:no_email`);
      socket.emit("error", { message: "User not authenticated" });
      return;
    }

    // Check if there's an existing socket ID for this email
    const existingSocketId = await redisSocketService.getSocketId(email);
    const isReconnection = existingSocketId && existingSocketId !== socket.id;

    // If there's an existing socket ID that's different from the current one, clean it up
    // This handles reconnection scenarios where Socket.IO creates a new socket ID
    if (isReconnection) {
      logger.info("SOCKET_RECONNECT", `email:${email} old:${existingSocketId} new:${socket.id}`);
      await redisSocketService.removeSocketMapping(existingSocketId);
      // Cancel any pending game removal since player reconnected
      cancelPendingRemoval(email);
    }

    // Store in Redis for multi-server support (always update to refresh TTL)
    await redisSocketService.setSocketMapping(email, socket.id);

    // Always cancel pending removal on registration (handles quick reconnection after disconnect)
    // This is safe because if there's no pending removal, cancelPendingRemoval does nothing
    cancelPendingRemoval(email);

    // Log new registration
    if (!isReconnection && existingSocketId !== socket.id) {
      logger.info("SOCKET_REGISTERED", `email:${email} socketId:${socket.id}`);
    }
  } catch (error) {
    logger.error("REGISTER_SOCKET_FAILED", `socketId:${context.socket.id} error:${error}`);
    context.socket.emit("error", { message: "Failed to register socket ID" });
  }
}

/**
 * Handle token refresh - allows client to update token without reconnecting
 */
export async function handleRefreshToken(context: SocketContext, data: any) {
  try {
    const { socket } = context;
    const authSocket = socket as AuthenticatedSocket;

    const token = typeof data === 'string' ? data : data?.token;

    if (!token) {
      socket.emit("token_refreshed", JSON.stringify({ success: false, error: "No token provided" }));
      return;
    }

    // Verify the new token
    const decodedToken = await auth.verifyIdToken(token);

    // Update socket authentication data with new token
    authSocket.data.user = {
      uid: decodedToken.uid,
      email: decodedToken.email?.toLowerCase() || '',
      emailVerified: decodedToken.email_verified || false,
    };
    authSocket.data.email = decodedToken.email?.toLowerCase() || '';

    socket.emit("token_refreshed", JSON.stringify({ success: true }));
    logger.info("TOKEN_REFRESHED", `socketId:${socket.id} email:${authSocket.data.email}`);
  } catch (error: any) {
    logger.error("TOKEN_REFRESH_ERROR", `socketId:${context.socket.id} error:${error.message}`);
    context.socket.emit("token_refreshed", JSON.stringify({
      success: false,
      error: error.message || "Token refresh failed"
    }));
  }
}
