import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import cron from "node-cron";

import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { initLiveFeedSocket } from "./sockets/liveFeed.socket.js";
import { runStockAlertJob } from "./jobs/stockAlertJob.js";
import { runCarryOverJob } from "./jobs/carryOverJob.js";

async function start() {
  await connectDB();

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

  cron.schedule("0 8 * * *", runStockAlertJob);
  cron.schedule("30 0 1 * *", runCarryOverJob);
}

start();
