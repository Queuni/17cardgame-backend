import redisClient from "../config/redis.js";

export class RedisSocketService {
  private readonly SOCKET_PREFIX = "socket:";
  private readonly USER_PREFIX = "user:";
  private readonly SOCKET_TTL = 3600; // 1 hour

  // Store mapping: email -> socket_id
  private getUserKey(email: string): string {
    return `${this.USER_PREFIX}${email}`;
  }

  // Store reverse mapping: socket_id -> email (for cleanup)
  private getSocketKey(socketId: string): string {
    return `${this.SOCKET_PREFIX}${socketId}`;
  }

  async setSocketMapping(email: string, socketId: string): Promise<void> {
    try {
      const userKey = this.getUserKey(email);
      const socketKey = this.getSocketKey(socketId);

      // Store email -> socket mapping
      await redisClient.setex(userKey, this.SOCKET_TTL, socketId);

      // Store reverse mapping for cleanup
      await redisClient.setex(socketKey, this.SOCKET_TTL, email);
    } catch (error) {
      console.error("Error storing socket mapping:", error);
      throw error;
    }
  }

  async getSocketId(email: string): Promise<string | null> {
    try {
      const userKey = this.getUserKey(email);
      const socketId = await redisClient.get(userKey);
      return socketId;
    } catch (error) {
      console.error("Error getting socket ID:", error);
      throw error;
    }
  }

  async getEmail(socketId: string): Promise<string | null> {
    try {
      const socketKey = this.getSocketKey(socketId);
      const email = await redisClient.get(socketKey);
      return email;
    } catch (error) {
      console.error("Error getting email:", error);
      throw error;
    }
  }

  async removeSocketMapping(socketId: string): Promise<void> {
    try {
      const socketKey = this.getSocketKey(socketId);
      const email = await redisClient.get(socketKey);

      if (email) {
        // Remove both mappings
        const userKey = this.getUserKey(email);
        await redisClient.del(userKey);
        await redisClient.del(socketKey);
        console.log(`Socket mapping removed: ${email} -> ${socketId}`);
      }
    } catch (error) {
      console.error("Error removing socket mapping:", error);
      throw error;
    }
  }

  async updateSocketMapping(email: string, oldSocketId: string, newSocketId: string): Promise<void> {
    try {
      // Remove old mapping first
      await this.removeSocketMapping(oldSocketId);

      // Add new mapping
      await this.setSocketMapping(email, newSocketId);

      console.log(`Socket mapping updated: ${email} -> ${newSocketId}`);
    } catch (error) {
      console.error("Error updating socket mapping:", error);
      throw error;
    }
  }

  async isUserOnline(email: string): Promise<boolean> {
    try {
      const socketId = await this.getSocketId(email);
      return socketId !== null;
    } catch (error) {
      console.error("Error checking if user is online:", error);
      return false;
    }
  }

  getSafeJson(data: any): any {
    return typeof data === "string" ? JSON.parse(data) : data;
  }
}

export default new RedisSocketService();

