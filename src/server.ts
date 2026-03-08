import { createServer } from "http";
import app from "./app.js";
import { SocketHandler } from "./sockets/socketHandler.js";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.HTTPS_PORT || 443;
const SOCKET_ORIGIN = process.env.SOCKET_ORIGIN;

const server = createServer(app);
const socketHandler = new SocketHandler(server);

server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🚀 Http Server running on http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO server ready for real-time on ${SOCKET_ORIGIN}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});