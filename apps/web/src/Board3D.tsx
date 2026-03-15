import { useMemo } from "react";
import type { Coord, MatchState, PlayerId } from "@ddm/protocol";
import { BOARD_HEIGHT, BOARD_WIDTH, coordKey } from "@ddm/protocol";

type Board3DProps = {
  state: MatchState | null;
  viewerPlayerId: PlayerId | null;
  highlightedCoords: Coord[];
  selectedSummonId: string | null;
  pendingNetCoords: Coord[];
  onTileClick: (coord: Coord) => void;
  onSummonClick: (summonId: string) => void;
};

export function Board3D({
  state,
  viewerPlayerId,
  highlightedCoords,
  selectedSummonId,
  pendingNetCoords,
  onTileClick,
  onSummonClick
}: Board3DProps) {
  const highlightSet = useMemo(() => new Set(highlightedCoords.map(coordKey)), [highlightedCoords]);
  const pendingSet = useMemo(() => new Set(pendingNetCoords.map(coordKey)), [pendingNetCoords]);
  const visibleBoard = useMemo(
    () =>
      state?.board ??
      Array.from({ length: BOARD_WIDTH * BOARD_HEIGHT }, (_, index) => {
        const x = index % BOARD_WIDTH;
        const y = Math.floor(index / BOARD_WIDTH);
        const isLord = x === Math.floor(BOARD_WIDTH / 2) && (y === 0 || y === BOARD_HEIGHT - 1);

        return {
          coord: { x, y },
          state: isLord ? "lord" : "empty",
          ownerId: isLord ? (y === 0 ? "p2" : "p1") : null,
          occupantId: null
        };
      }),
    [state]
  );

  const summonsByCoord = useMemo(() => {
    const entries = new Map<string, MatchState["summons"][string]>();
    if (!state) {
      return entries;
    }
    for (const summon of Object.values(state.summons)) {
      entries.set(coordKey(summon.tile), summon);
    }
    return entries;
  }, [state]);

  return (
    <div className="board-shell">
      <div className="board-stage">
        <div className={`board-grid ${viewerPlayerId === "p2" ? "board-perspective-p2" : "board-perspective-p1"}`}>
          {visibleBoard.map((tile) => {
            const tileKey = coordKey(tile.coord);
            const summon = summonsByCoord.get(tileKey);
            const classes = [
              "board-tile",
              `tile-${tile.state}`,
              tile.ownerId ? `tile-owner-${tile.ownerId}` : "",
              highlightSet.has(tileKey) ? "tile-highlighted" : "",
              pendingSet.has(tileKey) ? "tile-pending" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button key={tileKey} className={classes} onClick={() => onTileClick(tile.coord)} aria-label={`tile-${tile.coord.x}-${tile.coord.y}`}>
                <span className="tile-coordinate">
                  {tile.coord.x},{tile.coord.y}
                </span>
                {summon && (
                  <span
                    className={`board-summon ${summon.ownerId === "p1" ? "summon-p1" : "summon-p2"} ${
                      selectedSummonId === summon.id ? "summon-selected" : ""
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSummonClick(summon.id);
                    }}
                  >
                    <strong>{summon.kind === "monster_lord" ? "Lord" : summon.attack}</strong>
                    <small>{summon.health} HP</small>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {!state && <div className="board-empty-state">Create or join a room, then ready both players to start the match.</div>}
    </div>
  );
}
