// Per-game wiring between the generic `GamePlayScreen`/`useLocalPlayController`
// and each concrete `GameModule` + board renderer. Kept small and mechanical on
// purpose — all the actual orchestration lives in the shared, engine-agnostic
// pieces (GamePlayScreen, useLocalPlayController).

import { connectFour, gomoku, nim, ticTacToe, ticTacToeMove } from "@mpg/engine";
import type { GomokuMove, NimMove, Player, TicTacToeMoveMove } from "@mpg/engine";
import {
  ConnectFourBoard,
  GomokuBoard,
  NimBoard,
  TicTacToeBoard,
  TicTacToeMoveBoard,
} from "../components/board";
import type { SeatsConfig } from "../game";
import type { PublicRoom, Slot } from "../api/roomTypes";
import { GamePlayScreen } from "./GamePlayScreen";
import { OnlineGamePlayScreen } from "./OnlineGamePlayScreen";
import { WatchGamePlayScreen } from "./WatchGamePlayScreen";
import { GAME_CATALOG } from "./HomeScreen";

export interface GameRouteProps {
  seats: SeatsConfig;
  onExit: () => void;
  onPlayAgain?: (seats: SeatsConfig) => void;
  /** Quick-starts the next game in the catalog from the game-over surface. */
  onNextGame?: () => void;
  /** MPG-055: shows a post-game rank preview on the result screen when provided. */
  onViewLeaderboard?: () => void;
}

/** Props shared by the `*OnlineRoute` variants below (MPG-068) — the
 * room-backed counterpart to `GameRouteProps`, wired to `OnlineGamePlayScreen`
 * instead of the local `useLocalPlayController` path. */
export interface OnlineGameRouteProps {
  seats: SeatsConfig;
  roomId: string;
  yourSlot: Slot | undefined;
  sessionToken: string | undefined;
  initialRoom: PublicRoom | undefined;
  onExit: () => void;
  onRematchStart: (newRoomId: string) => void;
  /** MPG-055: shows a post-game rank preview on the result screen when provided. */
  onViewLeaderboard?: () => void;
}

/** Props shared by the `*WatchRoute` variants below (MPG-025) — the
 * read-only, all-bot counterpart to `OnlineGameRouteProps`, wired to
 * `WatchGamePlayScreen` instead. No `seats`/`yourSlot`/`sessionToken` — a
 * watch room has no seat for this client to hold; seats come from the socket
 * (`useWatchOnlinePlay`) instead of being passed in. */
export interface WatchGameRouteProps {
  roomId: string;
  creatorToken: string | undefined;
  initialRoom: PublicRoom | undefined;
  onExit: () => void;
}

function describeTicTacToeMove(move: { cell: number }, player: Player): string {
  const mark = player === 1 ? "X" : "O";
  const row = Math.floor(move.cell / 3) + 1;
  const col = (move.cell % 3) + 1;
  return `${mark} placed at row ${row}, column ${col}`;
}

export function TicTacToeRoute({
  seats,
  onExit,
  onPlayAgain,
  onNextGame,
  onViewLeaderboard,
}: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={ticTacToe}
      gameTitle={GAME_CATALOG.tictactoe?.title ?? "Tic-Tac-Toe"}
      seats={seats}
      describeMove={describeTicTacToeMove}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      {...(onNextGame ? { onNextGame } : {})}
      {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
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

export function TicTacToeOnlineRoute({
  seats,
  roomId,
  yourSlot,
  sessionToken,
  initialRoom,
  onExit,
  onRematchStart,
  onViewLeaderboard,
}: OnlineGameRouteProps): React.JSX.Element {
  return (
    <OnlineGamePlayScreen
      game={ticTacToe}
      gameTitle={GAME_CATALOG.tictactoe?.title ?? "Tic-Tac-Toe"}
      seats={seats}
      roomId={roomId}
      yourSlot={yourSlot}
      sessionToken={sessionToken}
      initialRoom={initialRoom}
      describeMove={describeTicTacToeMove}
      onExit={onExit}
      onRematchStart={onRematchStart}
      {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
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

export function TicTacToeWatchRoute({
  roomId,
  creatorToken,
  initialRoom,
  onExit,
}: WatchGameRouteProps): React.JSX.Element {
  return (
    <WatchGamePlayScreen
      game={ticTacToe}
      gameTitle={GAME_CATALOG.tictactoe?.title ?? "Tic-Tac-Toe"}
      roomId={roomId}
      creatorToken={creatorToken}
      initialRoom={initialRoom}
      describeMove={describeTicTacToeMove}
      onExit={onExit}
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
  onNextGame,
  onViewLeaderboard,
}: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={ticTacToeMove}
      gameTitle={GAME_CATALOG["tictactoe-move"]?.title ?? "Move-Mode Tic-Tac-Toe"}
      seats={seats}
      describeMove={describeTicTacToeMoveMove}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      {...(onNextGame ? { onNextGame } : {})}
      {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
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

export function TicTacToeMoveOnlineRoute({
  seats,
  roomId,
  yourSlot,
  sessionToken,
  initialRoom,
  onExit,
  onRematchStart,
  onViewLeaderboard,
}: OnlineGameRouteProps): React.JSX.Element {
  return (
    <OnlineGamePlayScreen
      game={ticTacToeMove}
      gameTitle={GAME_CATALOG["tictactoe-move"]?.title ?? "Move-Mode Tic-Tac-Toe"}
      seats={seats}
      roomId={roomId}
      yourSlot={yourSlot}
      sessionToken={sessionToken}
      initialRoom={initialRoom}
      describeMove={describeTicTacToeMoveMove}
      onExit={onExit}
      onRematchStart={onRematchStart}
      {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
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

export function TicTacToeMoveWatchRoute({
  roomId,
  creatorToken,
  initialRoom,
  onExit,
}: WatchGameRouteProps): React.JSX.Element {
  return (
    <WatchGamePlayScreen
      game={ticTacToeMove}
      gameTitle={GAME_CATALOG["tictactoe-move"]?.title ?? "Move-Mode Tic-Tac-Toe"}
      roomId={roomId}
      creatorToken={creatorToken}
      initialRoom={initialRoom}
      describeMove={describeTicTacToeMoveMove}
      onExit={onExit}
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

export function NimRoute({
  seats,
  onExit,
  onPlayAgain,
  onNextGame,
}: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={nim}
      gameTitle={GAME_CATALOG.nim?.title ?? "Nim"}
      seats={seats}
      describeMove={describeNimMove}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      {...(onNextGame ? { onNextGame } : {})}
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

function describeGomokuMove(move: GomokuMove, player: Player): string {
  const stone = player === 1 ? "Black" : "White";
  return `${stone} played row ${move.row + 1}, column ${move.col + 1}`;
}

export function GomokuRoute({
  seats,
  onExit,
  onPlayAgain,
  onNextGame,
}: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={gomoku}
      gameTitle={GAME_CATALOG.gomoku?.title ?? "Gomoku"}
      seats={seats}
      describeMove={describeGomokuMove}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      {...(onNextGame ? { onNextGame } : {})}
      renderBoard={({ state, onMove, disabled, lastMove, winningLine, winningLineTone }) => (
        <GomokuBoard
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
  onNextGame,
  onViewLeaderboard,
}: GameRouteProps): React.JSX.Element {
  return (
    <GamePlayScreen
      game={connectFour}
      gameTitle={GAME_CATALOG.connect4?.title ?? "Connect Four"}
      seats={seats}
      describeMove={describeConnectFourMove}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      {...(onNextGame ? { onNextGame } : {})}
      {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
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

export function ConnectFourWatchRoute({
  roomId,
  creatorToken,
  initialRoom,
  onExit,
}: WatchGameRouteProps): React.JSX.Element {
  return (
    <WatchGamePlayScreen
      game={connectFour}
      gameTitle={GAME_CATALOG.connect4?.title ?? "Connect Four"}
      roomId={roomId}
      creatorToken={creatorToken}
      initialRoom={initialRoom}
      describeMove={describeConnectFourMove}
      onExit={onExit}
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

export function ConnectFourOnlineRoute({
  seats,
  roomId,
  yourSlot,
  sessionToken,
  initialRoom,
  onExit,
  onRematchStart,
  onViewLeaderboard,
}: OnlineGameRouteProps): React.JSX.Element {
  return (
    <OnlineGamePlayScreen
      game={connectFour}
      gameTitle={GAME_CATALOG.connect4?.title ?? "Connect Four"}
      seats={seats}
      roomId={roomId}
      yourSlot={yourSlot}
      sessionToken={sessionToken}
      initialRoom={initialRoom}
      describeMove={describeConnectFourMove}
      onExit={onExit}
      onRematchStart={onRematchStart}
      {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
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
