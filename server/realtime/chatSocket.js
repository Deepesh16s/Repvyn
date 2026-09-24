const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isTokenCurrent } = require("../utils/authToken");

const MAX_PAYLOAD_BYTES = 1024;
const MAX_CONNECTIONS_PER_USER = 10;
const CLOSE_INVALID_TOKEN = 4001;
const CLOSE_TOO_MANY_CONNECTIONS = 4008;
const CLOSE_SERVER_ERROR = 1011;
const AUTH_ERROR_NAMES = new Set(["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"]);

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

function disconnectUser(userId) {
  const key = String(userId);
  const set = connections.get(key);
  if (!set) return;
  connections.delete(key);
  for (const ws of set) ws.close(CLOSE_INVALID_TOKEN, "Session ended");
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
      const user = await User.findById(decoded.id).select("_id tokenVersion");
      if (!user || !isTokenCurrent(decoded, user)) {
        ws.close(CLOSE_INVALID_TOKEN, "Invalid token");
        return;
      }

      const userId = String(user._id);
      const existing = connections.get(userId);
      if (existing && existing.size >= MAX_CONNECTIONS_PER_USER) {
        const oldest = existing.values().next().value;
        unregisterConnection(userId, oldest);
        oldest.close(CLOSE_TOO_MANY_CONNECTIONS, "Superseded by a newer connection");
      }

      registeredUserId = userId;
      registerConnection(userId, ws);
    } catch (error) {
      if (AUTH_ERROR_NAMES.has(error.name)) {
        ws.close(CLOSE_INVALID_TOKEN, "Invalid token");
      } else {
        ws.close(CLOSE_SERVER_ERROR, "Server error");
      }
    }
  });

  return wss;
}

module.exports = { attach, notifyUser, disconnectUser };
