const http = require("http");
const WebSocket = require("ws");
const app = require("../../app");
const { attach } = require("../../realtime/chatSocket");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

let server;
let port;

beforeAll(async () => {
  await connectTestDB();
  server = http.createServer(app);
  attach(server);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});
afterEach(clearTestDB);
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await disconnectTestDB();
});

const socketUrl = (token) => `ws://127.0.0.1:${port}/ws/chat${token === undefined ? "" : `?token=${token}`}`;

function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function connect(url) {
  const ws = new WebSocket(url);
  const closed = new Promise((resolve) => ws.once("close", (code) => resolve(code)));
  return { ws, closed };
}

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

describe("chat WebSocket hardening", () => {
  it("closes a connection that presents no token", async () => {
    const { closed } = connect(socketUrl());
    expect(await closed).toBe(4001);
  });

  it("closes a connection that presents a bad token", async () => {
    const { closed } = connect(socketUrl("not-a-real-token"));
    expect(await closed).toBe(4001);
  });

  it("accepts a valid token", async () => {
    const user = await createUser();
    const ws = await open(socketUrl(tokenFor(user)));
    await settle();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("closes a connection that sends a frame larger than the payload limit, and keeps serving others", async () => {
    const user = await createUser();
    const ws = await open(socketUrl(tokenFor(user)));
    const closed = new Promise((resolve) => ws.once("close", (code) => resolve(code)));
    ws.send("x".repeat(4096));
    expect(await closed).toBe(1009);

    const other = await createUser();
    const healthy = await open(socketUrl(tokenFor(other)));
    await settle();
    expect(healthy.readyState).toBe(WebSocket.OPEN);
    healthy.close();
  });

  it("survives an oversized frame sent before authentication finishes", async () => {
    const user = await createUser();
    const ws = new WebSocket(socketUrl(tokenFor(user)));
    ws.on("error", () => {});
    ws.once("open", () => ws.send("x".repeat(4096)));
    await new Promise((resolve) => ws.once("close", resolve));

    const healthy = await open(socketUrl(tokenFor(user)));
    await settle();
    expect(healthy.readyState).toBe(WebSocket.OPEN);
    healthy.close();
  });

  it("caps simultaneous connections per user and rejects the extra one with a distinct close code", async () => {
    const user = await createUser();
    const token = tokenFor(user);

    const sockets = [];
    for (let i = 0; i < 10; i++) sockets.push(await open(socketUrl(token)));
    await settle();
    expect(sockets.every((s) => s.readyState === WebSocket.OPEN)).toBe(true);

    const { closed } = connect(socketUrl(token));
    expect(await closed).toBe(4008);

    sockets.forEach((s) => s.terminate());
  });

  it("frees a slot when a connection closes", async () => {
    const user = await createUser();
    const token = tokenFor(user);

    const sockets = [];
    for (let i = 0; i < 10; i++) sockets.push(await open(socketUrl(token)));
    const closedFirst = new Promise((resolve) => sockets[0].once("close", resolve));
    sockets[0].close();
    await closedFirst;
    await settle();

    const replacement = await open(socketUrl(token));
    await settle();
    expect(replacement.readyState).toBe(WebSocket.OPEN);

    sockets.slice(1).forEach((s) => s.terminate());
    replacement.terminate();
  });

  it("does not let one user's connections count against another's cap", async () => {
    const a = await createUser();
    const b = await createUser();
    const sockets = [];
    for (let i = 0; i < 10; i++) sockets.push(await open(socketUrl(tokenFor(a))));

    const other = await open(socketUrl(tokenFor(b)));
    await settle();
    expect(other.readyState).toBe(WebSocket.OPEN);

    sockets.forEach((s) => s.terminate());
    other.terminate();
  });
});
