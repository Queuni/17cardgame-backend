import { Socket } from "socket.io";

export interface SocketContext {
  io: any;
  socket: Socket;
}