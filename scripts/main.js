import {registerSettings} from "./settings.js";
import {addSceneControl, LightSwitch, registerKeybindings} from "./light-switch.js";

let proxyRefreshQueued = false;

function queueProxyRefresh() {
  if ( proxyRefreshQueued ) return;
  proxyRefreshQueued = true;
  requestAnimationFrame(() => {
    proxyRefreshQueued = false;
    LightSwitch.applyLayerState();
  });
}

Hooks.once("init", () => {
  registerSettings({
    onEnabledChange: () => {
      LightSwitch.applyLayerState();
      LightSwitch.syncControlState();
    },
    onHideByLevelChange: () => {
      LightSwitch.applyLayerState();
    },
    onShowByLevelsChange: () => {
      LightSwitch.applyLayerState();
    }
  });
  registerKeybindings();
});

Hooks.on("getSceneControlButtons", controls => {
  addSceneControl(controls);
});

Hooks.on("canvasReady", () => {
  LightSwitch.applyLayerState();
  LightSwitch.syncControlState();
});

Hooks.on("activateCanvasLayer", () => {
  LightSwitch.applyLayerState();
  LightSwitch.syncControlState();
});

Hooks.on("createAmbientLight", () => {
  LightSwitch.applyLayerState();
});

Hooks.on("updateAmbientLight", () => {
  LightSwitch.applyLayerState();
});

Hooks.on("deleteAmbientLight", () => {
  LightSwitch.applyLayerState();
});

Hooks.on("initializeLightSources", () => {
  if ( !LightSwitch.bypassActive ) return;
  queueProxyRefresh();
});

Hooks.on("lightingRefresh", () => {
  if ( !LightSwitch.bypassActive ) return;
  queueProxyRefresh();
});
