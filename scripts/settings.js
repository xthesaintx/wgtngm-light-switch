import {MODULE_ID} from "./constants.js";

function isV14Plus() {
  return (game.release?.generation ?? 13) >= 14;
}

function isV13WithLevels() {
  return !isV14Plus() && !!game.modules?.get("levels")?.active;
}

export function registerSettings({onEnabledChange, onHideByLevelChange, onShowByLevelsChange}={}) {
  game.settings.register(MODULE_ID, "enabled", {
    name: "LIGHT_SWITCH.SettingName",
    hint: "LIGHT_SWITCH.SettingHint",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => onEnabledChange?.()
  });

  game.settings.register(MODULE_ID, "hideByLevelV14", {
    name: "LIGHT_SWITCH.HideByLevelSettingName",
    hint: "LIGHT_SWITCH.HideByLevelSettingHint",
    scope: "client",
    config: isV14Plus(),
    type: Boolean,
    default: true,
    onChange: () => onHideByLevelChange?.()
  });

  game.settings.register(MODULE_ID, "showByLevelsV13", {
    name: "LIGHT_SWITCH.ShowByLevelsV13SettingName",
    hint: "LIGHT_SWITCH.ShowByLevelsV13SettingHint",
    scope: "client",
    config: isV13WithLevels(),
    type: Boolean,
    default: true,
    onChange: () => onShowByLevelsChange?.()
  });
}

export function getLightSwitchEnabled() {
  return !!game.settings.get(MODULE_ID, "enabled");
}

export async function setLightSwitchEnabled(active) {
  return game.settings.set(MODULE_ID, "enabled", !!active);
}

export function getHideByLevelV14Enabled() {
  if ( !isV14Plus() ) return false;
  return !!game.settings.get(MODULE_ID, "hideByLevelV14");
}

export function getShowByLevelsV13Enabled() {
  if ( !isV13WithLevels() ) return false;
  return !!game.settings.get(MODULE_ID, "showByLevelsV13");
}
