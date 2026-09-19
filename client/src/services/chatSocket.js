const EVENT_NAME = "repvyn:chat-event";
const MAX_BACKOFF_MS = 30000;
const CLOSE_TOO_MANY_CONNECTIONS = 4008;

let socket = null;
let intentionalClose = false;
let backoffMs = 1000;
let reconnectTimer = null;

function getWsUrl() {
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
  const base = apiUrl.replace(/\/api\/?$/, "");
  const wsBase = base.replace(/^http/, "ws");
  const token = localStorage.getItem("token") || "";
  return `${wsBase}/ws/chat?token=${encodeURIComponent(token)}`;
}

function scheduleReconnect() {
  if (intentionalClose || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
}

export function connect() {
  if (!localStorage.getItem("token")) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  intentionalClose = false;
  socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
    backoffMs = 1000;
  };

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
    } catch {
      /* empty */
    }
  };

  socket.onclose = (event) => {
    socket = null;
    if (event.code === CLOSE_TOO_MANY_CONNECTIONS) return;
    scheduleReconnect();
  };

  socket.onerror = () => {
  };
}

export function disconnect() {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  backoffMs = 1000;
  if (socket) {
    socket.close();
    socket = null;
  }
}

export function subscribe(handler) {
  const listener = (event) => handler(event.detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
