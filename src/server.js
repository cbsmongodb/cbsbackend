import "dotenv/config";
import http from "http";
import { Server } from "socket.io";

import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { initLiveFeedSocket } from "./sockets/liveFeed.socket.js";

async function start() {
  await connectDB();

  // socket.io needs a raw http server, not the express app directly
  const httpServer = http.createServer();

  const io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL, credentials: true },
  });
  initLiveFeedSocket(io);

  const app = createApp(io);
  httpServer.on("request", app);

  const port = process.env.PORT || 4000;
  httpServer.listen(port, () => {
    console.log(`Server + Socket.io listening on port ${port}`);
  });
}

start();
