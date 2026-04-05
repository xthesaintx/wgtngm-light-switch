import {MODULE_ID, TOOL_NAME} from "./constants.js";
import {
  getHideByLevelV14Enabled,
  getLightSwitchEnabled,
  getShowByLevelsV13Enabled,
  setLightSwitchEnabled
} from "./settings.js";

const PROXY_CONTAINER_NAME = "wgtngm-light-switch-proxies";
const proxyInteractionHandlers = new WeakMap();
let tagContextMenu = null;
let proxyRefreshQueued = false;

function isV14Plus() {
  return (game.release?.generation ?? 13) >= 14;
}

function isLevelsV13Active() {
  if ( isV14Plus() ) return false;
  return !!(game.modules?.get("levels")?.active && CONFIG?.Levels);
}

function isLightEmitting(light) {
  if ( typeof light?.isVisible === "boolean" ) return light.isVisible;
  return !!(light?.emitsLight || light?.emitsDarkness);
}

function isTaggerActive() {
  return !!game.modules?.get("tagger")?.active;
}


function isVisibleInViewedLevelV14(light) {
  if ( !isV14Plus() ) return true;
  if ( !getHideByLevelV14Enabled() ) return true;
  return isInViewedLevelV14(light);
}

function isInViewedLevelV14(light) {
  if ( !isV14Plus() ) return true;
  const viewedLevel = canvas?.level;
  const document = light?.document;
  if ( !viewedLevel || !document ) return true;

  const elevation = Number(document.elevation ?? 0);
  const {bottom, top} = viewedLevel.elevation ?? {};
  if ( Number.isFinite(bottom) && (elevation < bottom) ) return false;
  if ( Number.isFinite(top) && (elevation > top) ) return false;
  return true;
}

function isOutOfShownLevelV14(light) {
  if ( !isV14Plus() ) return false;
  if ( getHideByLevelV14Enabled() ) return false;
  return !isInViewedLevelV14(light);
}

function isVisibleInLevelsV13(light) {
  if ( !isLevelsV13Active() ) return true;
  if ( !getShowByLevelsV13Enabled() ) return true;
  return isInLevelsV13Range(light);
}

function isInLevelsV13Range(light) {
  if ( !isLevelsV13Active() ) return true;
  if ( !CONFIG.Levels?.UI?.rangeEnabled ) return true;

  const [bottomRaw, topRaw] = CONFIG.Levels.UI.range ?? [];
  const bottom = Number.parseFloat(bottomRaw);
  const top = Number.parseFloat(topRaw);
  const elevation = Number(light?.document?.elevation ?? 0);

  if ( Number.isFinite(bottom) && (elevation < bottom) ) return false;
  if ( Number.isFinite(top) && (elevation >= top) ) return false;
  return true;
}

function isOutOfShownRangeInLevelsV13(light) {
  if ( !isLevelsV13Active() ) return false;
  if ( getShowByLevelsV13Enabled() ) return false;
  if ( !CONFIG.Levels?.UI?.rangeEnabled ) return false;
  return !isInLevelsV13Range(light);
}

function isProxyVisibleForCurrentContext(light) {
  if ( isV14Plus() ) return isVisibleInViewedLevelV14(light);
  return isVisibleInLevelsV13(light);
}

function queueProxyRefresh() {
  if ( proxyRefreshQueued ) return;
  proxyRefreshQueued = true;
  requestAnimationFrame(() => {
    proxyRefreshQueued = false;
    LightSwitch.applyLayerState();
  });
}

function normalizeTags(rawTags) {
  if ( rawTags === undefined || rawTags === null ) return [];
  const values = rawTags instanceof Set
    ? Array.from(rawTags)
    : (Array.isArray(rawTags) ? rawTags : [rawTags]);
  return values.map(tag => `${tag ?? ""}`.trim()).filter(Boolean);
}

function getTaggerTags(document) {
  const rawFlagTags = foundry.utils.getProperty(document, "flags.tagger.tags")
    ?? foundry.utils.getProperty(document, "_source.flags.tagger.tags");
  if ( !isTaggerActive() ) return normalizeTags(rawFlagTags);

  let tags = rawFlagTags;
  try {
    tags = document?.getFlag?.("tagger", "tags") ?? rawFlagTags;
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed reading Tagger flag via getFlag; falling back to raw flags`, error);
  }
  return normalizeTags(tags);
}

function getLightTags(light) {
  const document = light?.document;
  if ( !document ) return [];

  // ready to split or combine if native or alternative tagging gets added
  const tagsBySource = {
    tagger: getTaggerTags(document)
  };
  const sourceOrder = ["tagger"];
  const tags = [];
  for ( const source of sourceOrder ) tags.push(...tagsBySource[source]);
  return Array.from(new Set(tags));
}

function getSceneLights() {
  return (canvas?.lighting?.placeables ?? []).filter(light => light?.id && !light.isPreview);
}

function getSceneLightsByTag(tag = null) {
  return getSceneLights().filter(light => {
    if ( !tag ) return true;
    return getLightTags(light).includes(tag);
  });
}

async function toggleSceneLightsByTag(tag = null) {
  const scene = canvas?.scene;
  if ( !scene ) return;

  const matchingLights = getSceneLightsByTag(tag);

  if ( !matchingLights.length ) return;
  const updates = matchingLights.map(light => ({
    _id: light.id,
    hidden: !light.document.hidden
  }));
  try {
    await scene.updateEmbeddedDocuments("AmbientLight", updates);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to toggle lights by tag`, error);
  } finally {
    queueProxyRefresh();
  }
}

async function setSceneLightsFromSourceState(sourceLight, tag = null) {
  const scene = canvas?.scene;
  if ( !scene || !sourceLight?.document ) return;

  const targetHidden = !sourceLight.document.hidden;
  const matchingLights = getSceneLightsByTag(tag);
  if ( !matchingLights.length ) return;

  const updates = matchingLights
    .filter(light => light.document.hidden !== targetHidden)
    .map(light => ({
      _id: light.id,
      hidden: targetHidden
    }));

  if ( !updates.length ) {
    queueProxyRefresh();
    return;
  }

  try {
    await scene.updateEmbeddedDocuments("AmbientLight", updates);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to set lights from source state`, error);
  } finally {
    queueProxyRefresh();
  }
}

function getContextMenuClass() {
  return CONFIG?.ux?.ContextMenu
    ?? globalThis.ContextMenu
    ?? foundry.applications?.ux?.ContextMenu
    ?? null;
}

function getTagContextMenu() {
  if ( tagContextMenu ) return tagContextMenu;
  const ContextMenuClass = getContextMenuClass();
  if ( !ContextMenuClass ) return null;

  const options = {fixed: true, jQuery: false};
  if ( isV14Plus() ) options.relative = "cursor";
  tagContextMenu = new ContextMenuClass(document.body, ".__wgtngm-light-switch-context-target", [], options);
  return tagContextMenu;
}

function createContextMenuEntry(label, onSelect, iconClass) {
  if ( isV14Plus() ) {
    return {
      label,
      icon: iconClass,
      onClick: () => onSelect()
    };
  }

  return {
    name: label,
    icon: `<i class="${iconClass}"></i>`,
    callback: () => onSelect()
  };
}

function getPointerButton(event) {
  return event?.button ?? event?.data?.button ?? event?.originalEvent?.button ?? event?.data?.originalEvent?.button;
}

function getContextTriggerEvent(event) {
  return event?.data?.originalEvent ?? event?.originalEvent ?? event?.nativeEvent ?? event;
}

function openTagContextMenu(light, event) {
  const tags = getLightTags(light);

  const menu = getTagContextMenu();
  const target = canvas?.app?.view;
  if ( !menu || !target ) return;

  const triggerEvent = getContextTriggerEvent(event);
  triggerEvent?.preventDefault?.();
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const allLabel = game.i18n.localize("LIGHT_SWITCH.ContextAll");
  menu.menuItems = [
    createContextMenuEntry(allLabel, () => void setSceneLightsFromSourceState(light), "fa-solid fa-lightbulb"),
    ...tags.map(tag => createContextMenuEntry(tag, () => void setSceneLightsFromSourceState(light, tag), "fa-solid fa-tag"))
  ];

  ui.context?.close({animate: false});
  ui.context = menu;
  void menu.render(target, {event: triggerEvent, animate: false});
}

function getProxyContainer() {
  if ( !canvas?.ready || !canvas.controls ) return null;
  let container = canvas.controls.getChildByName(PROXY_CONTAINER_NAME);
  if ( container ) return container;

  container = new PIXI.Container();
  container.name = PROXY_CONTAINER_NAME;
  container.eventMode = "passive";
  container.sortableChildren = true;
  container.__lightSwitchProxyMap = new Map();
  canvas.controls.addChild(container);
  return container;
}

function getProxyMap(container) {
  container.__lightSwitchProxyMap ??= new Map();
  return container.__lightSwitchProxyMap;
}

function destroyProxyIcon(icon) {
  const handlers = proxyInteractionHandlers.get(icon);
  if ( handlers?.leftTap ) icon.off("pointertap", handlers.leftTap);
  if ( handlers?.rightDown ) icon.off("rightdown", handlers.rightDown);
  proxyInteractionHandlers.delete(icon);
  icon.destroy({children: true});
}

function clearProxyContainer(container) {
  const proxyMap = getProxyMap(container);
  for ( const icon of proxyMap.values() ) destroyProxyIcon(icon);
  proxyMap.clear();
  container.removeChildren();
}

function getLightForProxy(proxyIcon) {
  if ( !canvas?.lighting?.placeables ) return null;
  const lightId = proxyIcon?.__lightSwitchLightId;
  if ( !lightId ) return null;
  return canvas.lighting.placeables.find(light => light.id === lightId) ?? null;
}

function setProxyIconTexture(icon, texture) {
  if ( isV14Plus() ) {
    icon.texture = texture;
    return;
  }

  if ( icon.iconSrc === texture ) return;
  icon.iconSrc = texture;
  icon.texture = null;
  void icon.draw();
}

function buildProxyForLight(light, icon=null) {
  const size = 60 * canvas.dimensions.uiScale;
  const isHidden = !!(light.id && light.document.hidden);
  const outOfShownLevelV14 = isOutOfShownLevelV14(light);
  const outOfShownRangeV13 = isOutOfShownRangeInLevelsV13(light);
  const borderTint = isHidden ? 0xFF3300 : 0xFF5500;
  const texture = isHidden ? CONFIG.controlIcons.lightOff : CONFIG.controlIcons.light;
  const tint = isHidden ? 0xFF3300 : ((outOfShownLevelV14 || outOfShownRangeV13 || !isLightEmitting(light)) ? 0x808080 : 0xFFFFFF);
  if ( !icon ) {
    const ControlIcon = light.controlIcon?.constructor ?? foundry.canvas.containers.ControlIcon;
    icon = new ControlIcon({
      texture,
      size,
      borderColor: borderTint,
      tint,
      elevation: light.document.elevation
    });
    void icon.draw();
  }

  if ( !isV14Plus() ) {
    icon.tintColor = tint;
    icon.borderColor = borderTint;
  }

  icon.__lightSwitchLightId = light.id;
  setProxyIconTexture(icon, texture);
  if ( icon.size !== size ) icon.size = size;
  icon.icon.tint = tint;
  icon.border.tint = borderTint;
  icon.elevation = light.document.elevation;
  icon.x = light.document.x - (isV14Plus() ? 0 : (size * 0.5));
  icon.y = light.document.y - (isV14Plus() ? 0 : (size * 0.5));
  icon.zIndex = light.document.elevation ?? 0;
  icon.refresh({visible: true, borderVisible: false});

  if ( !proxyInteractionHandlers.has(icon) ) {
    const leftTap = (event) => {
      const button = getPointerButton(event);
      if ( (button !== undefined) && (button !== 0) ) return;
      const target = getLightForProxy(icon);
      if ( !target || !LightSwitch.isBypassForLight(target, game.user) ) return;
      event.stopPropagation();
      void target.document.update({hidden: !target.document.hidden})
        .catch(error => {
          console.error(`${MODULE_ID} | Failed to toggle light`, error);
        })
        .finally(() => {
          queueProxyRefresh();
        });
    };

    const rightDown = (event) => {
      const button = getPointerButton(event);
      if ( (button !== undefined) && (button !== 2) ) return;
      const target = getLightForProxy(icon);
      if ( !target || !LightSwitch.isBypassForLight(target, game.user) ) return;
      openTagContextMenu(target, event);
    };

    proxyInteractionHandlers.set(icon, {leftTap, rightDown});
    icon.on("pointertap", leftTap);
    icon.on("rightdown", rightDown);
  }
  return icon;
}

export const LightSwitch = {
  get enabled() {
    return getLightSwitchEnabled();
  },

  get bypassActive() {
    const notLightingControl = ui.controls?.control?.name !== "lighting";
    return !!(canvas?.ready && game.user?.isGM && this.enabled && notLightingControl);
  },

  isBypassForLight(light, user = game.user) {
    if ( !user?.isGM ) return false;
    if ( !this.bypassActive ) return false;
    if ( !light || light.isPreview ) return false;
    return light.layer === canvas.lighting;
  },

  applyLayerState() {
    if ( !canvas?.ready || !game.user?.isGM ) return;
    const container = getProxyContainer();
    if ( !container ) return;
    const proxyMap = getProxyMap(container);

    if ( !this.bypassActive ) {
      clearProxyContainer(container);
      container.visible = false;
      return;
    }

    const keepIds = new Set();
    container.visible = true;
    for ( const light of canvas.lighting?.placeables ?? [] ) {
      if ( !light?.id || light.isPreview ) continue;
      if ( !isProxyVisibleForCurrentContext(light) ) continue;
      keepIds.add(light.id);
      let icon = proxyMap.get(light.id);
      if ( !icon ) {
        icon = buildProxyForLight(light);
        proxyMap.set(light.id, icon);
        container.addChild(icon);
      } else {
        buildProxyForLight(light, icon);
      }
    }

    for ( const [lightId, icon] of proxyMap.entries() ) {
      if ( keepIds.has(lightId) ) continue;
      proxyMap.delete(lightId);
      container.removeChild(icon);
      destroyProxyIcon(icon);
    }
  },

  async setEnabled(active) {
    await setLightSwitchEnabled(active);
    this.applyLayerState();
    this.syncControlState();
  },

  syncControlState() {
    const tool = ui.controls?.controls?.lighting?.tools?.[TOOL_NAME];
    if ( tool ) tool.active = this.enabled;

    if ( ui.controls?.control?.name === "lighting" ) {
      const button = ui.controls.element?.querySelector(`button.tool[data-tool="${TOOL_NAME}"]`);
      if ( button ) button.setAttribute("aria-pressed", this.enabled ? "true" : "false");
    }
  }
};

export function addSceneControl(controls) {
  if ( !game.user?.isGM ) return;
  const lighting = controls.lighting;
  if ( !lighting?.tools ) return;

  lighting.tools[TOOL_NAME] = {
    name: TOOL_NAME,
    title: "LIGHT_SWITCH.SceneControlTitle",
    icon: "fa-solid fa-toggle-on",
    order: 99,
    toggle: true,
    active: LightSwitch.enabled,
    onChange: (event, active) => LightSwitch.setEnabled(active)
  };
}

export function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "toggleLightSwitch", {
    name: "LIGHT_SWITCH.KeybindingToggleName",
    hint: "LIGHT_SWITCH.KeybindingToggleHint",
    editable: [
      {key: "KeyL", modifiers: ["Shift"]}
    ],
    restricted: true,
    onDown: () => {
      void LightSwitch.setEnabled(!LightSwitch.enabled);
      return true;
    }
  });
}
