export { HomeScreen, GAME_CATALOG, REALTIME_CATALOG } from "./HomeScreen";
export type {
  HomeScreenProps,
  GameCatalogEntry,
  RealtimeCatalogEntry,
  GameKind,
} from "./HomeScreen";

export { SetupScreen } from "./SetupScreen";
export type { SetupScreenProps } from "./SetupScreen";

export { GamePlayScreen, GamePlayScreenView, resultTone } from "./GamePlayScreen";
export type {
  GamePlayScreenProps,
  GamePlayScreenViewProps,
  BoardRenderProps,
  OnlineRematchProps,
  PlayController,
} from "./GamePlayScreen";

export { OnlineGamePlayScreen } from "./OnlineGamePlayScreen";
export type { OnlineGamePlayScreenProps } from "./OnlineGamePlayScreen";

export { WatchGamePlayScreen } from "./WatchGamePlayScreen";
export type { WatchGamePlayScreenProps } from "./WatchGamePlayScreen";

export { InviteScreen } from "./InviteScreen";
export type { InviteScreenProps } from "./InviteScreen";

export { JoinScreen } from "./JoinScreen";
export type { JoinScreenProps } from "./JoinScreen";

export { LeaderboardScreen } from "./LeaderboardScreen";
export type { LeaderboardScreenProps } from "./LeaderboardScreen";

export { RankPreview } from "./RankPreview";
export type { RankPreviewProps } from "./RankPreview";

export { RealtimePlayScreen } from "./RealtimePlayScreen";
export type {
  RealtimePlayScreenProps,
  RealtimeControls,
  RealtimeSceneProps,
  TouchAction,
} from "./RealtimePlayScreen";

export {
  TicTacToeRoute,
  TicTacToeMoveRoute,
  ConnectFourRoute,
  NimRoute,
  TicTacToeOnlineRoute,
  TicTacToeMoveOnlineRoute,
  ConnectFourOnlineRoute,
  TicTacToeWatchRoute,
  TicTacToeMoveWatchRoute,
  ConnectFourWatchRoute,
} from "./games";
export type { GameRouteProps, OnlineGameRouteProps, WatchGameRouteProps } from "./games";

export { RealtimeGameRoute, REALTIME_GAMES } from "./realtimeGames";
export type { RealtimeGameRouteProps, RealtimeGameWiring } from "./realtimeGames";
