const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const MAX_PAYLOAD_BYTES = 1024;
const MAX_CONNECTIONS_PER_USER = 10;
const CLOSE_INVALID_TOKEN = 4001;
const CLOSE_TOO_MANY_CONNECTIONS = 4008;

const connections = new Map();

function registerConnection(userId, ws) {
  const key = String(userId);
  if (!connections.has(key)) connections.set(key, new Set());
  connections.get(key).add(ws);
}

function unregisterConnection(userId, ws) {
  const key = String(userId);
  const set = connections.get(key);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connections.delete(key);
}

function notifyUser(userId, event) {
  const set = connections.get(String(userId));
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function attach(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws/chat",
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  wss.on("connection", async (ws, req) => {
    let registeredUserId = null;
    const cleanup = () => {
      if (registeredUserId) unregisterConnection(registeredUserId, ws);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);

    try {
      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");
      if (!token) {
        ws.close(CLOSE_INVALID_TOKEN, "Missing token");
        return;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("_id");
      if (!user) {
        ws.close(CLOSE_INVALID_TOKEN, "Invalid token");
        return;
      }

      const userId = String(user._id);
      if ((connections.get(userId)?.size || 0) >= MAX_CONNECTIONS_PER_USER) {
        ws.close(CLOSE_TOO_MANY_CONNECTIONS, "Too many connections");
        return;
      }

      registeredUserId = userId;
      registerConnection(userId, ws);
    } catch {
      ws.close(CLOSE_INVALID_TOKEN, "Invalid token");
    }
  });

  return wss;
}

module.exports = { attach, notifyUser };
