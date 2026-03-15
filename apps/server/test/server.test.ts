import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as clientIo, type Socket } from "socket.io-client";
import { createServerApp } from "../src/app.js";
import type { ServerEvent } from "@ddm/protocol";

let baseUrl = "";
let closeApp: (() => Promise<void>) | null = null;

function waitForEvent(socket: Socket, predicate: (event: ServerEvent) => boolean): Promise<ServerEvent> {
  return new Promise((resolve) => {
    const handler = (event: ServerEvent) => {
      if (!predicate(event)) {
        return;
      }
      socket.off("server_event", handler);
      resolve(event);
    };
    socket.on("server_event", handler);
  });
}

describe("server lobby flow", () => {
  beforeAll(async () => {
    const { app, ready } = createServerApp();
    await ready;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind test server.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeApp = () => app.close();
  });

  afterAll(async () => {
    await closeApp?.();
  });

  it("creates a room, joins a second player, and starts a match after ready-up", async () => {
    const a = clientIo(baseUrl, { transports: ["websocket"] });
    const b = clientIo(baseUrl, { transports: ["websocket"] });

    const aConnected = waitForEvent(a, (event) => event.type === "connected");
    const bConnected = waitForEvent(b, (event) => event.type === "connected");
    const aSession = await aConnected;
    const bSession = await bConnected;

    expect(aSession.type).toBe("connected");
    expect(bSession.type).toBe("connected");

    const roomCreated = waitForEvent(a, (event) => event.type === "room_created");
    a.emit("command", { type: "create_lobby", name: "Alpha" });
    const created = await roomCreated;
    if (created.type !== "room_created") {
      throw new Error("Unexpected event type");
    }

    const roomJoined = waitForEvent(b, (event) => event.type === "room_joined");
    b.emit("command", { type: "join_lobby", roomCode: created.roomCode, name: "Bravo" });
    const joined = await roomJoined;
    expect(joined.type).toBe("room_joined");

    a.emit("command", { type: "ready_player" });
    const matchPromise = waitForEvent(a, (event) => event.type === "match_state");
    b.emit("command", { type: "ready_player" });
    const match = await matchPromise;
    expect(match.type).toBe("match_state");
    if (match.type !== "match_state") {
      return;
    }
    expect(match.state.phase).toBe("roll");
    expect(match.state.players.p1.deck.dieIds).toHaveLength(15);

    a.close();
    b.close();
  });

  it("returns lobby state on explicit resync", async () => {
    const socket = clientIo(baseUrl, { transports: ["websocket"] });
    await waitForEvent(socket, (event) => event.type === "connected");

    const roomCreated = waitForEvent(socket, (event) => event.type === "room_created");
    socket.emit("command", { type: "create_lobby", name: "Resyncer" });
    const created = await roomCreated;
    expect(created.type).toBe("room_created");

    const resync = waitForEvent(socket, (event) => event.type === "resynced");
    socket.emit("command", { type: "request_resync" });
    const result = await resync;
    expect(result.type).toBe("resynced");
    if (result.type !== "resynced") {
      return;
    }
    expect(result.lobby?.roomCode).toBe(created.type === "room_created" ? created.roomCode : "");

    socket.close();
  });
});
