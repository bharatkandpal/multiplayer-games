export { HomeScreen, GAME_CATALOG, REALTIME_CATALOG } from "./HomeScreen";
export type {
  HomeScreenProps,
  GameCatalogEntry,
  RealtimeCatalogEntry,
  GameKind,
} from "./HomeScreen";

export { SetupScreen } from "./SetupScreen";
export type { SetupScreenProps } from "./SetupScreen";

export { GamePlayScreen } from "./GamePlayScreen";
export type { GamePlayScreenProps, BoardRenderProps } from "./GamePlayScreen";

export { RealtimePlayScreen } from "./RealtimePlayScreen";
export type {
  RealtimePlayScreenProps,
  RealtimeControls,
  RealtimeSceneProps,
  TouchAction,
} from "./RealtimePlayScreen";

export { TicTacToeRoute, TicTacToeMoveRoute, ConnectFourRoute, NimRoute } from "./games";
export type { GameRouteProps } from "./games";

export { RealtimeGameRoute, REALTIME_GAMES } from "./realtimeGames";
export type { RealtimeGameRouteProps, RealtimeGameWiring } from "./realtimeGames";
