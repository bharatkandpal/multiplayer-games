export type {
  CosmeticConfig,
  CosmeticOption,
  CosmeticPalette,
  CosmeticSchema,
  CosmeticSlot,
  CosmeticSlotKind,
} from "./types";

export {
  clearCosmeticRegistry,
  defaultConfig,
  defaultOption,
  getCosmeticSchema,
  hasCosmetics,
  listCosmeticGames,
  registerCosmetics,
  resolveOption,
  resolvePalette,
} from "./registry";

export { clearCosmetics, loadCosmetics, storeCosmetics } from "./storage";
