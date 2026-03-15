import { useEffect, useMemo, useState } from "react";
import { catalog, diceById, monstersById } from "@ddm/content";
import type { Coord, CrestType, DeckDefinition, DieDefinition, LobbyState, MatchState, PlayerId, ServerEvent } from "@ddm/protocol";
import { coordKey } from "@ddm/protocol";
import { io, type Socket } from "socket.io-client";
import { attackTargets, legalMoves, shortestPath } from "./board-helpers";
import { Board3D } from "./Board3D";

const LOCAL_DECKS_KEY = "ddm.localDecks";
const SESSION_KEY = "ddm.sessionId";
const PLAYER_KEY = "ddm.playerId";
const ROOM_KEY = "ddm.roomCode";

type ActionMode = "idle" | "move" | "attack";

function crestSummary(deck: DeckDefinition): Record<string, number> {
  const totals: Record<string, number> = {
    ATTACK: 0,
    DEFENSE: 0,
    MOVEMENT: 0,
    MAGIC: 0,
    TRAP: 0,
    summon: 0
  };
  deck.dieIds.forEach((dieId) => {
    const die = diceById[dieId];
    die?.faces.forEach((face) => {
      if (face.kind === "summon") {
        totals.summon += 1;
      } else {
        totals[face.crestType] += face.amount;
      }
    });
  });
  return totals;
}

function loadLocalDecks(): DeckDefinition[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_DECKS_KEY) ?? "[]") as DeckDefinition[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalDecks(decks: DeckDefinition[]): void {
  window.localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(decks));
}

function DicePool({
  state,
  playerId,
  selected,
  toggle,
  inspectedInstanceId,
  inspect
}: {
  state: MatchState;
  playerId: PlayerId;
  selected: string[];
  toggle: (instanceId: string) => void;
  inspectedInstanceId: string | null;
  inspect: (instanceId: string) => void;
}) {
  const pool = state.players[playerId].dicePool;
  return (
    <div className="dice-grid">
      {pool.map((instance) => {
        const die = diceById[instance.dieId];
        const monster = die ? monstersById[die.monsterId] : null;
        return (
          <button
            key={instance.instanceId}
            className={`die-card ${selected.includes(instance.instanceId) ? "selected" : ""} ${instance.lastRoll ? "rolled" : ""} ${
              inspectedInstanceId === instance.instanceId ? "inspected" : ""
            }`}
            disabled={instance.used}
            onClick={() => {
              inspect(instance.instanceId);
              toggle(instance.instanceId);
            }}
          >
            <strong>{monster?.name ?? instance.dieId}</strong>
            <span>L{monster?.level ?? "?"}</span>
            <span>{instance.lastRoll ? renderFace(instance.lastRoll) : "Ready"}</span>
          </button>
        );
      })}
    </div>
  );
}

function renderFace(face: DieDefinition["faces"][number]) {
  if (face.kind === "summon") {
    return `Summon ${face.level}`;
  }
  return `${face.crestType} +${face.amount}`;
}

function prioritizeDice(state: MatchState, playerId: PlayerId, crestType: CrestType): string[] {
  return state.players[playerId].dicePool
    .filter((instance) => !instance.used)
    .map((instance) => {
      const die = diceById[instance.dieId];
      const score =
        die?.faces.reduce((total, face) => {
          if (face.kind !== "crest") {
            return total;
          }
          return total + (face.crestType === crestType ? face.amount : 0);
        }, 0) ?? 0;
      return { instanceId: instance.instanceId, score, dieId: instance.dieId };
    })
    .sort((a, b) => b.score - a.score || a.dieId.localeCompare(b.dieId))
    .slice(0, 3)
    .map((entry) => entry.instanceId);
}

function cycleNetType(currentType: string, step: 1 | -1) {
  const netTypes = ["T", "Y", "Z", "V", "X", "N", "M", "E", "P", "R", "L"];
  const currentIndex = netTypes.indexOf(currentType);
  const nextIndex = (currentIndex + step + netTypes.length) % netTypes.length;
  return netTypes[nextIndex]!;
}

function describePlayer(matchState: MatchState, id: PlayerId, viewerPlayerId: PlayerId | null): string {
  const label = viewerPlayerId === id ? "YOU" : "OPPONENT";
  return `${matchState.players[id].name} (${label})`;
}

function NetPreview({
  type,
  rotation,
  orientation,
  coordinates
}: {
  type: string;
  rotation: number;
  orientation: 1 | -1;
  coordinates: Coord[];
}) {
  const minX = Math.min(...coordinates.map((coord) => coord.x));
  const maxX = Math.max(...coordinates.map((coord) => coord.x));
  const minY = Math.min(...coordinates.map((coord) => coord.y));
  const maxY = Math.max(...coordinates.map((coord) => coord.y));
  const localCoords = coordinates.map((coord) => ({ x: coord.x - minX, y: coord.y - minY }));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cells = Array.from({ length: width * height }, (_, index) => ({
    x: index % width,
    y: Math.floor(index / width)
  }));

  return (
    <div className="net-preview-shell">
      <div className="net-preview-meta">
        <span>Net {type}</span>
        <span>Rotation {rotation * 90}°</span>
        <span>{orientation === 1 ? "Normal" : "Flipped"}</span>
      </div>
      <div className="net-preview-grid" style={{ gridTemplateColumns: `repeat(${width}, 1fr)` }}>
        {cells.map((cell) => {
          const filled = localCoords.some((coord) => coord.x === cell.x && coord.y === cell.y);
          return <div key={`${cell.x}-${cell.y}`} className={`net-preview-cell ${filled ? "filled" : ""}`} />;
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => window.localStorage.getItem(SESSION_KEY));
  const [playerId, setPlayerId] = useState<PlayerId | null>(() => (window.localStorage.getItem(PLAYER_KEY) as PlayerId | null) ?? null);
  const [roomCode, setRoomCode] = useState<string>(() => window.localStorage.getItem(ROOM_KEY) ?? "");
  const [name, setName] = useState("Duelist");
  const [joinCode, setJoinCode] = useState("");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [error, setError] = useState<string>("");
  const [actionMode, setActionMode] = useState<ActionMode>("idle");
  const [selectedSummonId, setSelectedSummonId] = useState<string | null>(null);
  const [selectedRollIds, setSelectedRollIds] = useState<string[]>([]);
  const [inspectedDieInstanceId, setInspectedDieInstanceId] = useState<string | null>(null);
  const [localDecks, setLocalDecks] = useState<DeckDefinition[]>(() => loadLocalDecks());
  const [selectedDeckId, setSelectedDeckId] = useState<string>(catalog.starterDecks[0]?.id ?? "");
  const [builderName, setBuilderName] = useState("Custom Deck");
  const [builderFilter, setBuilderFilter] = useState("");
  const [builderSlots, setBuilderSlots] = useState<string[]>(catalog.starterDecks[0]?.dieIds ?? []);
  const [importJson, setImportJson] = useState("");

  const allDecks = useMemo(() => [...catalog.starterDecks, ...localDecks], [localDecks]);
  const selectedDeck = useMemo(
    () => allDecks.find((deck) => deck.id === selectedDeckId) ?? allDecks[0] ?? null,
    [allDecks, selectedDeckId]
  );
  const me = lobby?.players.find((player) => player.playerId === playerId) ?? null;
  const activePlayer = matchState ? matchState.players[matchState.activePlayerId] : null;
  const selectedSummon = selectedSummonId && matchState ? matchState.summons[selectedSummonId] : null;
  const highlightedCoords = useMemo(() => {
    if (!matchState || !selectedSummonId) {
      return [];
    }
    if (actionMode === "move") {
      return legalMoves(matchState, selectedSummonId);
    }
    if (actionMode === "attack") {
      return attackTargets(matchState, selectedSummonId)
        .map((id) => matchState.summons[id]?.tile)
        .filter(Boolean) as Coord[];
    }
    return [];
  }, [actionMode, matchState, selectedSummonId]);
  const pendingNetCoords = useMemo(() => matchState?.pendingDimension?.net.coordinates ?? [], [matchState?.pendingDimension?.net.coordinates]);
  const inspectedDie =
    inspectedDieInstanceId && matchState && playerId
      ? matchState.players[playerId].dicePool.find((instance) => instance.instanceId === inspectedDieInstanceId)
      : null;
  const inspectedDieDefinition = inspectedDie ? diceById[inspectedDie.dieId] : null;
  const inspectedMonster = inspectedDieDefinition ? monstersById[inspectedDieDefinition.monsterId] : null;

  useEffect(() => {
    saveLocalDecks(localDecks);
  }, [localDecks]);

  useEffect(() => {
    const nextSocket = io({
      auth: {
        sessionId: sessionId ?? undefined
      }
    });

    nextSocket.on("server_event", (event: ServerEvent) => {
      switch (event.type) {
        case "connected":
          setSessionId(event.sessionId);
          window.localStorage.setItem(SESSION_KEY, event.sessionId);
          break;
        case "room_created":
        case "room_joined":
          setRoomCode(event.roomCode);
          setPlayerId(event.playerId);
          window.localStorage.setItem(ROOM_KEY, event.roomCode);
          window.localStorage.setItem(PLAYER_KEY, event.playerId);
          setError("");
          break;
        case "lobby_updated":
          setLobby(event.lobby);
          break;
        case "match_state":
          setMatchState(event.state);
          setSelectedRollIds([]);
          if (event.state.phase !== "reply") {
            setActionMode("idle");
          }
          break;
        case "command_rejected":
          setError(event.reason);
          break;
        case "resynced":
          setLobby(event.lobby);
          setMatchState(event.state);
          break;
      }
    });

    setSocket(nextSocket);
    return () => nextSocket.close();
  }, []);

  useEffect(() => {
    if (socket) {
      socket.emit("command", { type: "request_resync" });
    }
  }, [socket]);

  useEffect(() => {
    if (!matchState?.pendingDimension || !playerId || matchState.activePlayerId !== playerId) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        sendCommand({ type: "rotate_dimension_net", direction: "ccw" });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        sendCommand({ type: "rotate_dimension_net", direction: "cw" });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        sendCommand({ type: "set_dimension_net", netType: cycleNetType(matchState.pendingDimension!.net.type, -1) });
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        sendCommand({ type: "set_dimension_net", netType: cycleNetType(matchState.pendingDimension!.net.type, 1) });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [matchState?.pendingDimension, matchState?.activePlayerId, playerId]);

  function sendCommand(command: object) {
    socket?.emit("command", command);
  }

  function createLobby() {
    sendCommand({ type: "create_lobby", name });
  }

  function joinLobby() {
    sendCommand({
      type: "join_lobby",
      roomCode: joinCode.toUpperCase(),
      name,
      sessionId: sessionId ?? undefined
    });
  }

  function chooseDeck(deckId: string) {
    const deck = allDecks.find((entry) => entry.id === deckId);
    if (!deck) {
      return;
    }
    setSelectedDeckId(deckId);
    sendCommand({ type: "choose_deck", deck });
  }

  function toggleRoll(instanceId: string) {
    setInspectedDieInstanceId(instanceId);
    setSelectedRollIds((current) => {
      if (current.includes(instanceId)) {
        return current.filter((value) => value !== instanceId);
      }
      if (current.length >= 3) {
        return current;
      }
      return [...current, instanceId];
    });
  }

  function applyPrioritization(crestType: CrestType) {
    if (!matchState || !playerId) {
      return;
    }
    const prioritized = prioritizeDice(matchState, playerId, crestType);
    setSelectedRollIds(prioritized);
    if (prioritized.length > 0) {
      setInspectedDieInstanceId(prioritized[0]!);
    }
  }

  function onTileClick(coord: Coord) {
    if (!matchState || !playerId) {
      return;
    }
    if (matchState.pendingDimension) {
      sendCommand({ type: "set_dimension_anchor", anchor: coord });
      return;
    }
    if (actionMode === "move" && selectedSummonId) {
      const path = shortestPath(matchState, selectedSummonId, coord);
      if (path) {
        sendCommand({ type: "move_summon", summonId: selectedSummonId, path });
      }
      return;
    }
  }

  function onSummonClick(summonId: string) {
    if (!matchState) {
      return;
    }
    const summon = matchState.summons[summonId];
    if (!summon) {
      return;
    }
    if (actionMode === "attack" && selectedSummonId && summon.ownerId !== matchState.summons[selectedSummonId]?.ownerId) {
      sendCommand({ type: "start_attack", attackerId: selectedSummonId, targetId: summonId });
      return;
    }
    setSelectedSummonId(summonId);
  }

  function saveBuilderDeck() {
    if (builderSlots.length !== 15) {
      setError("A deck must contain exactly 15 dice.");
      return;
    }
    const deck: DeckDefinition = {
      id: `local-${builderName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: builderName,
      dieIds: builderSlots
    };
    setLocalDecks((current) => {
      const withoutExisting = current.filter((entry) => entry.id !== deck.id);
      return [...withoutExisting, deck];
    });
    setSelectedDeckId(deck.id);
  }

  const builderDice = useMemo(
    () =>
      catalog.dice.filter((die) => {
        const monster = monstersById[die.monsterId];
        return monster?.name.toLowerCase().includes(builderFilter.toLowerCase());
      }),
    [builderFilter]
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Dungeon Dice Monsters</h1>
        <p className="muted">TypeScript web remake with authoritative multiplayer.</p>

        <section className="panel">
          <h2>Lobby</h2>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="button-row">
            <button onClick={createLobby}>Create Room</button>
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ROOM" maxLength={6} />
            <button onClick={joinLobby}>Join</button>
          </div>
          <div className="status-line">Room: <strong>{roomCode || "none"}</strong></div>
          <div className="status-line">Player: <strong>{playerId ?? "spectator"}</strong></div>
          {lobby && (
            <div className="lobby-list">
              {lobby.players.map((player) => (
                <div key={player.playerId} className="lobby-player">
                  <strong>{player.name}</strong>
                  <span>{player.playerId}</span>
                  <span>{player.connected ? "online" : "offline"}</span>
                  <span>{player.ready ? "ready" : "not ready"}</span>
                </div>
              ))}
              {playerId && (
                <button onClick={() => sendCommand({ type: "ready_player" })}>{me?.ready ? "Unready" : "Ready Up"}</button>
              )}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Decks</h2>
          <select value={selectedDeckId} onChange={(event) => chooseDeck(event.target.value)}>
            {allDecks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
              </option>
            ))}
          </select>
          {selectedDeck && (
            <div className="crest-summary">
              {Object.entries(crestSummary(selectedDeck)).map(([key, value]) => (
                <span key={key}>
                  {key}: {value}
                </span>
              ))}
            </div>
          )}
          <details>
            <summary>Deck Builder</summary>
            <label>
              Deck name
              <input value={builderName} onChange={(event) => setBuilderName(event.target.value)} />
            </label>
            <label>
              Filter
              <input value={builderFilter} onChange={(event) => setBuilderFilter(event.target.value)} placeholder="Monster name" />
            </label>
            <div className="builder-grid">
              <div>
                <h3>Available Dice</h3>
                <div className="scroll-list">
                  {builderDice.map((die) => {
                    const monster = monstersById[die.monsterId];
                    return (
                      <button key={die.id} className="list-button" onClick={() => setBuilderSlots((current) => (current.length >= 15 ? current : [...current, die.id]))}>
                        <strong>{monster?.name}</strong>
                        <span>L{monster?.level}</span>
                        <span>{monster?.abilities.map((ability) => ability.kind).join(", ") || "No ability"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <h3>Deck Slots ({builderSlots.length}/15)</h3>
                <div className="scroll-list">
                  {builderSlots.map((dieId, index) => {
                    const monster = monstersById[diceById[dieId]?.monsterId ?? ""];
                    return (
                      <button key={`${dieId}-${index}`} className="list-button" onClick={() => setBuilderSlots((current) => current.filter((_, slot) => slot !== index))}>
                        <strong>{index + 1}. {monster?.name ?? dieId}</strong>
                        <span>{dieId}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="button-row">
                  <button onClick={saveBuilderDeck}>Save Deck</button>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(
                        JSON.stringify(
                          {
                            id: `export-${builderName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                            name: builderName,
                            dieIds: builderSlots
                          },
                          null,
                          2
                        )
                      )
                    }
                  >
                    Copy JSON
                  </button>
                </div>
                <textarea value={importJson} onChange={(event) => setImportJson(event.target.value)} placeholder="Paste deck JSON here" rows={6} />
                <button
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(importJson) as DeckDefinition;
                      if (parsed.dieIds.length !== 15) {
                        throw new Error("Deck must contain 15 dice.");
                      }
                      setLocalDecks((current) => [...current.filter((entry) => entry.id !== parsed.id), parsed]);
                      setSelectedDeckId(parsed.id);
                      setImportJson("");
                    } catch (importError) {
                      setError(importError instanceof Error ? importError.message : "Invalid deck JSON.");
                    }
                  }}
                >
                  Import Deck
                </button>
              </div>
            </div>
          </details>
        </section>

        <section className="panel">
          <h2>Match Controls</h2>
          {matchState && playerId && activePlayer && (
            <>
              <div className="status-line">Turn {matchState.turn}</div>
              <div className="status-line">
                Active: <strong>{describePlayer(matchState, matchState.activePlayerId, playerId)}</strong>
              </div>
              <div className="status-line">Phase: <strong>{matchState.phase}</strong></div>
              {matchState.phase === "roll" && matchState.activePlayerId === playerId && (
                <>
                  <div className="priority-buttons">
                    {(["MOVEMENT", "ATTACK", "DEFENSE", "MAGIC", "TRAP"] as CrestType[]).map((crest) => (
                      <button key={crest} onClick={() => applyPrioritization(crest)}>
                        Prioritize {crest}
                      </button>
                    ))}
                  </div>
                  <DicePool
                    state={matchState}
                    playerId={playerId}
                    selected={selectedRollIds}
                    toggle={toggleRoll}
                    inspectedInstanceId={inspectedDieInstanceId}
                    inspect={setInspectedDieInstanceId}
                  />
                  <button disabled={selectedRollIds.length !== 3} onClick={() => sendCommand({ type: "submit_roll", instanceIds: selectedRollIds })}>
                    Roll Selected Dice
                  </button>
                  <span className="status-line">Select exactly 3 dice.</span>
                  {inspectedDieDefinition && (
                    <details open className="panel-submenu">
                      <summary>Die Faces: {inspectedMonster?.name ?? inspectedDieDefinition.id}</summary>
                      <div className="die-face-grid">
                        {inspectedDieDefinition.faces.map((face, index) => (
                          <div key={`${inspectedDieDefinition.id}-${index}`} className="die-face-card">
                            <strong>Face {index + 1}</strong>
                            <span>{renderFace(face)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
              {matchState.phase === "dimension" && matchState.activePlayerId === playerId && matchState.pendingRoll && !matchState.pendingDimension && (
                <div className="dimension-choices">
                  {matchState.pendingRoll.availableDimensionInstanceIds.map((instanceId) => (
                    <button key={instanceId} onClick={() => sendCommand({ type: "choose_dimension", instanceId })}>
                      Dimension {monstersById[diceById[matchState.players[playerId].dicePool.find((die) => die.instanceId === instanceId)?.dieId ?? ""]?.monsterId ?? ""]?.name ?? instanceId}
                    </button>
                  ))}
                </div>
              )}
              {matchState.pendingDimension && matchState.activePlayerId === playerId && (
                <div className="dimension-controls">
                  <NetPreview
                    type={matchState.pendingDimension.net.type}
                    rotation={matchState.pendingDimension.net.rotation}
                    orientation={matchState.pendingDimension.net.orientation}
                    coordinates={matchState.pendingDimension.net.coordinates}
                  />
                  <select value={matchState.pendingDimension.net.type} onChange={(event) => sendCommand({ type: "set_dimension_net", netType: event.target.value })}>
                    {["T", "Y", "Z", "V", "X", "N", "M", "E", "P", "R", "L"].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <div className="button-row">
                    <button onClick={() => sendCommand({ type: "rotate_dimension_net", direction: "ccw" })}>Rotate Left</button>
                    <button onClick={() => sendCommand({ type: "rotate_dimension_net", direction: "cw" })}>Rotate Right</button>
                    <button onClick={() => sendCommand({ type: "flip_dimension_net" })}>Flip</button>
                  </div>
                  <span className="status-line">Arrow Left/Right rotates. Arrow Up/Down changes net shape.</span>
                  <button onClick={() => sendCommand({ type: "confirm_dimension" })}>Confirm Dimension</button>
                  <button onClick={() => sendCommand({ type: "cancel_dimension" })}>Skip Summon</button>
                </div>
              )}
              {matchState.phase === "action" && matchState.activePlayerId === playerId && (
                <>
                  <div className="button-row">
                    <button disabled={!selectedSummon || selectedSummon.ownerId !== playerId} onClick={() => setActionMode("move")}>
                      Move
                    </button>
                    <button disabled={!selectedSummon || selectedSummon.ownerId !== playerId} onClick={() => setActionMode("attack")}>
                      Attack
                    </button>
                    <button onClick={() => sendCommand({ type: "end_turn" })}>End Turn</button>
                  </div>
                  <button onClick={() => setActionMode("idle")}>Clear Action</button>
                </>
              )}
              {matchState.phase === "reply" &&
                matchState.actionWindow?.kind === "defense" &&
                matchState.actionWindow.defenderId === playerId && (
                  <div className="button-row">
                    <button onClick={() => sendCommand({ type: "reply_defense", mode: "guard" })}>Guard</button>
                    <button onClick={() => sendCommand({ type: "reply_defense", mode: "take_hit" })}>Take Hit</button>
                  </div>
                )}
              {matchState.winnerId && (
                <button onClick={() => sendCommand({ type: "rematch_vote" })}>Vote Rematch</button>
              )}
            </>
          )}
          {error && <p className="error-box">{error}</p>}
        </section>
      </aside>

      <main className="main-panel">
        <Board3D
          state={matchState}
          viewerPlayerId={playerId}
          highlightedCoords={highlightedCoords}
          selectedSummonId={selectedSummonId}
          pendingNetCoords={pendingNetCoords}
          onTileClick={onTileClick}
          onSummonClick={onSummonClick}
        />
        {matchState && (
          <div className="overlay-panel">
            <section className="panel">
              <h2>Players</h2>
              {(["p1", "p2"] as PlayerId[]).map((id) => (
                <div key={id} className="player-card">
                  <strong>{describePlayer(matchState, id, playerId)}</strong>
                  <span>Hearts: {matchState.players[id].hearts}</span>
                  <span>ATK {matchState.players[id].crests.ATTACK}</span>
                  <span>DEF {matchState.players[id].crests.DEFENSE}</span>
                  <span>MOV {matchState.players[id].crests.MOVEMENT}</span>
                  <span>MAG {matchState.players[id].crests.MAGIC}</span>
                  <span>TRP {matchState.players[id].crests.TRAP}</span>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2>Selection</h2>
              {selectedSummon ? (
                <>
                  <strong>{monstersById[selectedSummon.definitionId]?.name ?? selectedSummon.definitionId}</strong>
                  <span>Attack {selectedSummon.attack}</span>
                  <span>Defense {selectedSummon.defense}</span>
                  <span>Health {selectedSummon.health}</span>
                  <span>Abilities: {selectedSummon.abilities.map((ability) => ability.kind).join(", ") || "None"}</span>
                </>
              ) : (
                <span>Select a summon.</span>
              )}
            </section>
            <section className="panel">
              <h2>Log</h2>
              <div className="scroll-list compact">
                {[...matchState.log].slice(-12).reverse().map((entry) => (
                  <div key={entry.id} className="log-entry">
                    <strong>{entry.type}</strong>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
