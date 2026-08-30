// Per-game wiring between the generic `GamePlayScreen`/`useLocalPlayController`
// and each concrete `GameModule` + board renderer. Kept small and mechanical on
// purpose — all the actual orchestration lives in the shared, engine-agnostic
// pieces (GamePlayScreen, useLocalPlayController).

import { connectFour, nim, ticTacToe, ticTacToeMove } from "@mpg/engine";
import type { NimMove, Player, TicTacToeMoveMove } from "@mpg/engine";
import {
  ConnectFourBoard,
  NimBoard,
  TicTacToeBoard,
  TicTacToeMoveBoard,
} from "../components/board";
import type { SeatsConfig } from "../game";
import { GamePlayScreen } from "./GamePlayScreen";
import { GAME_CATALOG } from "./HomeScreen";

export interface GameRouteProps {
  seats: SeatsConfig;
  onExit: () => void;
  onPlayAgain?: (seats: SeatsConfig) => void;
}

function describeTicTacToeMove(move: { cell: number }, player: Player): string {
  const mark = player === 1 ? "X" : "O";
  const row = Math.floor(move.cell / 3) + 1;
  const col = (move.cell % 3) + 1;
  return `${mark} placed at row ${row}, column ${col}`;
}

export function TicTacToeRoute({ seats, onExit, onPlayAgain }: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={ticTacToe}
      gameTitle={GAME_CATALOG.tictactoe?.title ?? "Tic-Tac-Toe"}
      seats={seats}
      describeMove={describeTicTacToeMove}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      renderBoard={({ state, onMove, disabled, lastMove, winningLine, winningLineTone }) => (
        <TicTacToeBoard
          state={state}
          onMove={onMove}
          disabled={disabled}
          lastMove={lastMove}
          winningLine={winningLine}
          winningLineTone={winningLineTone ?? "win"}
        />
      )}
    />
  );
}

function describeTicTacToeMoveMove(move: TicTacToeMoveMove, player: Player): string {
  const mark = player === 1 ? "X" : "O";
  if (move.kind === "place") {
    const row = Math.floor(move.cell / 3) + 1;
    const col = (move.cell % 3) + 1;
    return `${mark} placed at row ${row}, column ${col}`;
  }
  const fromRow = Math.floor(move.from / 3) + 1;
  const fromCol = (move.from % 3) + 1;
  const toRow = Math.floor(move.to / 3) + 1;
  const toCol = (move.to % 3) + 1;
  return `${mark} moved from row ${fromRow}, column ${fromCol} to row ${toRow}, column ${toCol}`;
}

export function TicTacToeMoveRoute({
  seats,
  onExit,
  onPlayAgain,
}: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={ticTacToeMove}
      gameTitle={GAME_CATALOG["tictactoe-move"]?.title ?? "Move-Mode Tic-Tac-Toe"}
      seats={seats}
      describeMove={describeTicTacToeMoveMove}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      renderBoard={({ state, onMove, disabled, lastMove, winningLine, winningLineTone }) => (
        <TicTacToeMoveBoard
          state={state}
          onMove={onMove}
          disabled={disabled}
          lastMove={lastMove}
          winningLine={winningLine}
          winningLineTone={winningLineTone ?? "win"}
        />
      )}
    />
  );
}

function describeConnectFourMove(move: { column: number }, player: Player): string {
  return `Player ${player} dropped a disc in column ${move.column + 1}`;
}

function describeNimMove(move: NimMove, player: Player): string {
  const taken = move.count === 1 ? "1 object" : `${move.count} objects`;
  return `Player ${player} took ${taken} from pile ${move.pile + 1}`;
}

export function NimRoute({ seats, onExit, onPlayAgain }: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={nim}
      gameTitle={GAME_CATALOG.nim?.title ?? "Nim"}
      seats={seats}
      describeMove={describeNimMove}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      renderBoard={({ state, onMove, disabled, lastMove, winningLine, winningLineTone }) => (
        <NimBoard
          state={state}
          onMove={onMove}
          disabled={disabled}
          lastMove={lastMove}
          winningLine={winningLine}
          winningLineTone={winningLineTone ?? "win"}
        />
      )}
    />
  );
}

export function ConnectFourRoute({
  seats,
  onExit,
  onPlayAgain,
}: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={connectFour}
      gameTitle={GAME_CATALOG.connect4?.title ?? "Connect Four"}
      seats={seats}
      describeMove={describeConnectFourMove}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      renderBoard={({ state, onMove, disabled, lastMove, winningLine, winningLineTone }) => (
        <ConnectFourBoard
          state={state}
          onMove={onMove}
          disabled={disabled}
          lastMove={lastMove}
          winningLine={winningLine}
          winningLineTone={winningLineTone ?? "win"}
        />
      )}
    />
  );
}
