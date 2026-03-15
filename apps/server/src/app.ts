import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { catalog, diceById } from "@ddm/content";
import { createMatchState, reduceMatchState, type RulesCatalog } from "@ddm/engine";
import type { ClientCommand, LobbyState, MatchState, PlayerId, ServerEvent } from "@ddm/protocol";
import { clientCommandSchema, deckDefinitionSchema, serverEventSchema } from "@ddm/protocol";
import { nanoid } from "nanoid";
import { Server as SocketIOServer } from "socket.io";

type LobbyPlayerState = LobbyState["players"][number];
type LobbyRecord = {
  roomCode: string;
  players: LobbyPlayerState[];
  rematchVotes: Set<PlayerId>;
  matchStarted: boolean;
  updatedAt: number;
  matchState: MatchState | null;
};

export function createServerApp() {
  const SESSION_ROOM = new Map<string, string>();
  const lobbies = new Map<string, LobbyRecord>();
  const catalogRefs: RulesCatalog = {
    monstersById: Object.fromEntries(catalog.monsters.map((monster) => [monster.id, monster])),
    diceById
  };

  const app = Fastify({
    logger: true
  });

  const publicDirCandidates = [
    resolve(process.cwd(), "apps/server/public"),
    resolve(process.cwd(), "apps/web/dist"),
    resolve(process.cwd(), "../public")
  ];
  const publicDir = publicDirCandidates.find((dir) => existsSync(dir));

  const ready = (async () => {
    if (publicDir) {
      await app.register(fastifyStatic, {
        root: publicDir,
        prefix: "/"
      });
    }
  })();

  app.get("/health", async () => ({ ok: true }));
  app.get("/", async (_, reply) => {
    if (publicDir) {
      return reply.sendFile("index.html");
    }
    return reply.type("text/plain").send("DDM server is running.");
  });

  const io = new SocketIOServer(app.server, {
    cors: {
      origin: "*"
    }
  });

  function serializeLobby(lobby: LobbyRecord): LobbyState {
    return {
      roomCode: lobby.roomCode,
      players: lobby.players,
      rematchVotes: Array.from(lobby.rematchVotes),
      matchStarted: lobby.matchStarted
    };
  }

  function send(socketId: string, event: ServerEvent): void {
    io.to(socketId).emit("server_event", serverEventSchema.parse(event));
  }

  function broadcastLobby(lobby: LobbyRecord): void {
    const event: ServerEvent = {
      type: "lobby_updated",
      lobby: serializeLobby(lobby)
    };
    io.to(lobby.roomCode).emit("server_event", event);
  }

  function broadcastMatch(lobby: LobbyRecord): void {
    if (!lobby.matchState) {
      return;
    }
    const event: ServerEvent = {
      type: "match_state",
      state: lobby.matchState
    };
    io.to(lobby.roomCode).emit("server_event", event);
  }

  function createRoomCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do {
      code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    } while (lobbies.has(code));
    return code;
  }

  function startMatch(lobby: LobbyRecord): void {
    const p1 = lobby.players.find((player) => player.playerId === "p1");
    const p2 = lobby.players.find((player) => player.playerId === "p2");
    if (!p1 || !p2 || !p1.deck || !p2.deck) {
      return;
    }

    lobby.matchState = createMatchState(
      {
        matchId: nanoid(),
        roomCode: lobby.roomCode,
        players: {
          p1: { name: p1.name, deck: p1.deck },
          p2: { name: p2.name, deck: p2.deck }
        }
      },
      catalogRefs
    );
    lobby.matchStarted = true;
    lobby.rematchVotes.clear();
  }

  function getPlayerBySession(lobby: LobbyRecord, sessionId: string): LobbyPlayerState | undefined {
    return lobby.players.find((player) => player.sessionId === sessionId);
  }

  function findLobbyBySession(sessionId: string): LobbyRecord | undefined {
    const roomCode = SESSION_ROOM.get(sessionId);
    return roomCode ? lobbies.get(roomCode) : undefined;
  }

  function validateDeck(rawDeck: unknown) {
    const deck = deckDefinitionSchema.parse(rawDeck);
    const everyDieExists = deck.dieIds.every((dieId) => Boolean(diceById[dieId]));
    if (!everyDieExists) {
      throw new Error("Deck contains unsupported dice.");
    }
    return deck;
  }

  io.on("connection", (socket) => {
    const previousSessionId = typeof socket.handshake.auth.sessionId === "string" ? socket.handshake.auth.sessionId : undefined;
    const sessionId = previousSessionId ?? nanoid();
    send(socket.id, {
      type: "connected",
      sessionId
    });

    const rejoinLobby = previousSessionId ? findLobbyBySession(previousSessionId) : undefined;
    if (rejoinLobby) {
      const player = getPlayerBySession(rejoinLobby, previousSessionId!);
      if (player) {
        player.connected = true;
        SESSION_ROOM.set(previousSessionId!, rejoinLobby.roomCode);
        void socket.join(rejoinLobby.roomCode);
        send(socket.id, {
          type: "resynced",
          lobby: serializeLobby(rejoinLobby),
          state: rejoinLobby.matchState
        });
        broadcastLobby(rejoinLobby);
        if (rejoinLobby.matchState) {
          broadcastMatch(rejoinLobby);
        }
      }
    }

    socket.on("command", (rawCommand: unknown) => {
      let command: ClientCommand;
      try {
        command = clientCommandSchema.parse(rawCommand);
      } catch {
        send(socket.id, {
          type: "command_rejected",
          reason: "Invalid command payload."
        });
        return;
      }

      try {
        switch (command.type) {
          case "create_lobby": {
            const roomCode = createRoomCode();
            const lobby: LobbyRecord = {
              roomCode,
              players: [
                {
                  sessionId,
                  playerId: "p1",
                  name: command.name,
                  ready: false,
                  connected: true,
                  deck: catalog.starterDecks[0] ?? null
                }
              ],
              rematchVotes: new Set<PlayerId>(),
              matchStarted: false,
              updatedAt: Date.now(),
              matchState: null
            };
            lobbies.set(roomCode, lobby);
            SESSION_ROOM.set(sessionId, roomCode);
            void socket.join(roomCode);
            send(socket.id, {
              type: "room_created",
              roomCode,
              playerId: "p1"
            });
            broadcastLobby(lobby);
            return;
          }
          case "join_lobby": {
            const lobby = lobbies.get(command.roomCode);
            if (!lobby) {
              throw new Error("Room not found.");
            }
            if (lobby.players.length >= 2 && !getPlayerBySession(lobby, command.sessionId ?? sessionId)) {
              throw new Error("Room is full.");
            }

            let player = getPlayerBySession(lobby, command.sessionId ?? sessionId);
            if (!player) {
              const playerId: PlayerId = lobby.players.some((entry) => entry.playerId === "p1") ? "p2" : "p1";
              player = {
                sessionId,
                playerId,
                name: command.name,
                ready: false,
                connected: true,
                deck: catalog.starterDecks[playerId === "p1" ? 0 : 1] ?? catalog.starterDecks[0] ?? null
              };
              lobby.players.push(player);
            } else {
              player.connected = true;
              player.name = command.name;
            }
            lobby.updatedAt = Date.now();
            SESSION_ROOM.set(player.sessionId, lobby.roomCode);
            void socket.join(lobby.roomCode);
            send(socket.id, {
              type: "room_joined",
              roomCode: lobby.roomCode,
              playerId: player.playerId
            });
            broadcastLobby(lobby);
            if (lobby.matchState) {
              broadcastMatch(lobby);
            }
            return;
          }
          case "choose_deck": {
            const lobby = findLobbyBySession(sessionId);
            if (!lobby) {
              throw new Error("Join a room first.");
            }
            const player = getPlayerBySession(lobby, sessionId);
            if (!player) {
              throw new Error("Player not found in room.");
            }
            player.deck = validateDeck(command.deck);
            player.ready = false;
            lobby.updatedAt = Date.now();
            broadcastLobby(lobby);
            return;
          }
          case "ready_player": {
            const lobby = findLobbyBySession(sessionId);
            if (!lobby) {
              throw new Error("Join a room first.");
            }
            const player = getPlayerBySession(lobby, sessionId);
            if (!player || !player.deck) {
              throw new Error("Choose a deck first.");
            }
            player.ready = !player.ready;
            lobby.updatedAt = Date.now();
            if (!lobby.matchStarted && lobby.players.length === 2 && lobby.players.every((entry) => entry.ready && entry.deck)) {
              startMatch(lobby);
            }
            broadcastLobby(lobby);
            broadcastMatch(lobby);
            return;
          }
          case "request_resync": {
            const lobby = findLobbyBySession(sessionId);
            send(socket.id, {
              type: "resynced",
              lobby: lobby ? serializeLobby(lobby) : null,
              state: lobby?.matchState ?? null
            });
            return;
          }
          case "rematch_vote": {
            const lobby = findLobbyBySession(sessionId);
            if (!lobby) {
              throw new Error("Join a room first.");
            }
            const player = getPlayerBySession(lobby, sessionId);
            if (!player) {
              throw new Error("Player not found.");
            }
            lobby.rematchVotes.add(player.playerId);
            if (lobby.rematchVotes.size === 2) {
              lobby.players.forEach((entry) => {
                entry.ready = false;
              });
              startMatch(lobby);
            }
            broadcastLobby(lobby);
            broadcastMatch(lobby);
            return;
          }
          default: {
            const lobby = findLobbyBySession(sessionId);
            if (!lobby || !lobby.matchState) {
              throw new Error("No active match.");
            }
            const player = getPlayerBySession(lobby, sessionId);
            if (!player) {
              throw new Error("Player not found.");
            }
            const result = reduceMatchState(lobby.matchState, player.playerId, command, catalogRefs);
            if (!result.ok) {
              send(socket.id, {
                type: "command_rejected",
                reason: result.reason
              });
              return;
            }
            lobby.matchState = result.state;
            lobby.updatedAt = Date.now();
            broadcastMatch(lobby);
          }
        }
      } catch (error) {
        send(socket.id, {
          type: "command_rejected",
          reason: error instanceof Error ? error.message : "Unknown server error."
        });
      }
    });

    socket.on("disconnect", () => {
      const lobby = findLobbyBySession(sessionId);
      if (!lobby) {
        return;
      }
      const player = getPlayerBySession(lobby, sessionId);
      if (!player) {
        return;
      }
      player.connected = false;
      lobby.updatedAt = Date.now();
      broadcastLobby(lobby);
    });
  });

  setInterval(() => {
    const cutoff = Date.now() - 1000 * 60 * 60 * 2;
    for (const [roomCode, lobby] of lobbies.entries()) {
      if (lobby.updatedAt < cutoff && lobby.players.every((player) => !player.connected)) {
        lobbies.delete(roomCode);
        lobby.players.forEach((player) => SESSION_ROOM.delete(player.sessionId));
      }
    }
  }, 60_000).unref();

  return { app, io, ready };
}
