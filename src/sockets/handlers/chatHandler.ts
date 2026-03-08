import { SocketContext } from "../../types/socket.js";

export function handleChat(context: SocketContext, data: string) {
  const { socket } = context;

  if (socket.data) {
    console.log(`Chat message from ${socket.id}: ${data}`);
    socket.emit("chat", { socketId: socket.id, message: data });
  } else {
    socket.emit("error", { message: "Invalid socket data" });
  }
}
