import { Redis } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisClientOptions: any = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
};

if (process.env.REDIS_PASSWORD) {
  redisClientOptions.password = process.env.REDIS_PASSWORD;
}

const redisClient = new Redis(redisClientOptions);


redisClient.on("connect", () => {
  // redisClient.flushdb();
  console.log(`✅ Redis client connected successfully: ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
});

redisClient.on("error", (error: Error) => {
  console.error(`❌ Redis client error: ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`, error.message);
});

redisClient.on("close", () => {
  console.log("🔌 Redis client connection closed");
});

redisClient.on("reconnecting", () => {
  console.log("🔄 Redis client reconnecting...");
});

process.on("SIGTERM", () => {
  redisClient.quit();
  console.log("Redis client disconnected on SIGTERM");
});

process.on("SIGINT", () => {
  redisClient.quit();
  console.log("Redis client disconnected on SIGINT");
});

export default redisClient;

