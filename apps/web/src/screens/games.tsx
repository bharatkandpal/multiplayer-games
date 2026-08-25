// Per-game wiring between the generic `GamePlayScreen`/`useLocalPlayController`
// and each concrete `GameModule` + board renderer. Kept small and mechanical on
// purpose — all the actual orchestration lives in the shared, engine-agnostic
// pieces (GamePlayScreen, useLocalPlayController).

import { connectFour, ticTacToe } from "@mpg/engine";
import type { Player } from "@mpg/engine";
import { ConnectFourBoard, TicTacToeBoard } from "../components/board";
import type { SeatsConfig } from "../game";
import { GamePlayScreen } from "./GamePlayScreen";
import { GAME_CATALOG } from "./HomeScreen";

export interface GameRouteProps {
  seats: SeatsConfig;
  onExit: () => void;
}

function describeTicTacToeMove(move: { cell: number }, player: Player): string {
  const mark = player === 1 ? "X" : "O";
  const row = Math.floor(move.cell / 3) + 1;
  const col = (move.cell % 3) + 1;
  return `${mark} placed at row ${row}, column ${col}`;
}

export function TicTacToeRoute({ seats, onExit }: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={ticTacToe}
      gameTitle={GAME_CATALOG.tictactoe.title}
      seats={seats}
      describeMove={describeTicTacToeMove}
      onExit={onExit}
      renderBoard={({ state, onMove, disabled, lastMove }) => (
        <TicTacToeBoard state={state} onMove={onMove} disabled={disabled} lastMove={lastMove} />
      )}
    />
  );
}

function describeConnectFourMove(move: { column: number }, player: Player): string {
  return `Player ${player} dropped a disc in column ${move.column + 1}`;
}

export function ConnectFourRoute({ seats, onExit }: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={connectFour}
      gameTitle={GAME_CATALOG.connect4.title}
      seats={seats}
      describeMove={describeConnectFourMove}
      onExit={onExit}
      renderBoard={({ state, onMove, disabled, lastMove }) => (
        <ConnectFourBoard state={state} onMove={onMove} disabled={disabled} lastMove={lastMove} />
      )}
    />
  );
}
