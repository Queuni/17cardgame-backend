import { Socket } from "socket.io";
import { auth } from "../../config/firebase.js";

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: {
      uid: string;
      email?: string;
      emailVerified: boolean;
    };
    email?: string; // Keep for backward compatibility during migration
  };
}

/**
 * Authenticates socket connection using Firebase ID token
 * Token should be sent in handshake.auth.token or handshake.query.token
 */
export async function authenticateSocket(socket: AuthenticatedSocket): Promise<boolean> {
  try {
    // Try to get token from handshake.auth (preferred) or handshake.query
    const token =
      (socket.handshake.auth?.token as string) ||
      (socket.handshake.query?.token as string);

    if (!token) {
      console.log(`Socket ${socket.id}: No token provided`);
      return false;
    }

    // Verify Firebase ID token
    const decodedToken = await auth.verifyIdToken(token);

    // Store authenticated user data in socket
    socket.data.user = {
      uid: decodedToken.uid,
      email: decodedToken.email?.toLowerCase() || '',
      emailVerified: decodedToken.email_verified || false,
    };

    // Also store email for backward compatibility
    socket.data.email = decodedToken.email?.toLowerCase() || '';

    console.log(`Socket ${socket.id} authenticated for user: ${decodedToken.email}`);
    return true;
  } catch (error: any) {
    // Check if error is due to token expiration
    if (error?.code === 'auth/id-token-expired' || error?.message?.includes('expired')) {
      console.error(`Socket ${socket.id} authentication failed: Token expired`);
      return false;
    }

    // Check for other authentication errors
    if (error?.code?.startsWith('auth/')) {
      console.error(`Socket ${socket.id} authentication failed: ${error.code} - ${error.message}`);
      return false;
    }

    console.error(`Socket ${socket.id} authentication failed:`, error);
    return false;
  }
}

/**
 * Get authenticated user email from socket
 * Returns the email from authenticated user data
 */
export function getAuthenticatedEmail(socket: AuthenticatedSocket): string | null {
  return socket.data.user?.email || socket.data.email || null;
}

/**
 * Middleware to require authentication for socket events
 * Use this to wrap event handlers that require authentication
 */
export function requireAuth(
  handler: (context: { io: any; socket: AuthenticatedSocket }, data: any) => Promise<void> | void
) {
  return async (context: { io: any; socket: AuthenticatedSocket }, data: any) => {
    const { socket } = context;

    if (!socket.data.user || !socket.data.user.email) {
      socket.emit("error", {
        message: "Authentication required",
        code: "UNAUTHORIZED"
      });
      return;
    }

    await handler(context, data);
  };
}

