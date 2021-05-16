import $ from 'jquery';
import 'jquery-localize';
import 'jquery-contextmenu';
import 'devbridge-autocomplete';
import 'jquery-modal';
import { Remarkable } from 'remarkable';
import _ from 'lodash';
import { forceCollide } from 'd3-force';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import ForceGraph3D from '3d-force-graph';
import TWEEN from '@tweenjs/tween.js';
import { hueToRGBA, uiThemeFontColors, uiThemeBgColors, getFontColor, getBaseBgColor } from './utils';
import { updateConfig } from './config.js';
import { ConnType } from './conn-type.js';

$(document).on("keydown", function (event) {
    if (event.which === 16)
        isShift = true;
    else if (event.which === 17)
        isCtrl = true;
});

$(document).on("keyup", function (event) {
    if (event.which === 16)
        isShift = false;
    else if (event.which === 17)
        isCtrl = false;
});

let isDebug = false;
let isShift = false;
let isCtrl = false;
let fontsLoaded = false;
let isWebGL2;
let is2d;
let graphCanvas;
let graphContext;
const nodeImgDimensions = { x: 320, y: 240 };
let nodeObjectMaterial;
let iconTexts = [];
let removedCount;
const worldScales = {};
const defaultPathIgnoreConnTypeFlags = ConnType.NO_ENTRY | ConnType.LOCKED | ConnType.DEAD_END | ConnType.ISOLATED | ConnType.LOCKED_CONDITION | ConnType.EXIT_POINT;

const defaultLoadImage = THREE.ImageLoader.prototype.load;
THREE.ImageLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    const image = defaultLoadImage.apply(this, [url, onLoad, onProgress, onError]);
    image.referrerPolicy = "no-referrer";

    return image;
};

const imageLoader = new THREE.ImageLoader();

$.fn.extend({
    animateCss: function (animation, duration, endCallback) {
        const animationEnd = "webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend animationend";
        $(this).removeClass($(this).data("animateCss")).trigger("webkitAnimationEnd");
        if (!duration)
            duration = 250;
        $(this).css({
            "-webkit-animation-duration": duration + "ms",
            "animation-duration": duration + "ms"
        });
        const classes = "animated " + animation;
        $(this).data("animateCss", classes);

        $(this).addClass(classes).one(animationEnd, function () {
            $(this).off(animationEnd);
            $(this).css({
                "-webkit-animation-duration": "initial",
                "animation-duration": "initial"
            });
            if (endCallback)
                endCallback.apply(this);
            $(this).removeClass(classes);
        });

        return this;
    }
});

export let worldData;

function initWorldData(data) {
    worldData = data;

    removedCount = 0;

    for (let w in worldData) {
        const world = worldData[w];
        world.id = parseInt(w);
        if (world.removed)
            world.rId = removedCount++;
        for (let world of worldData) {
            world.connections.forEach(conn => {
                const effectParams = conn.typeParams[ConnType.EFFECT];
                if (effectParams) {
                    effectParams.paramsJP = effectParams.params.split(',').map(e => effectsJP[e]).join('」か「');
                    effectParams.params = effectParams.params.replace(/,/g, ', ');
                }
            });
        }
    }

    const worldSizes = worldData.map(w => w.size); 

    minSize = _.min(worldSizes);
    maxSize = _.max(worldSizes);
}

let menuThemeData;

function initMenuThemeData(data) {
    menuThemeData = data;

    const $menuThemesContainerItems = $(".js--menu-themes-container__items");
    const $menuThemesContainerBorders = $(".js--menu-themes-container__borders");
    const $removedMenuThemesContainerItems = $(".js--removed-menu-themes-container__items");
    const $removedMenuThemesContainerBorders = $(".js--removed-menu-themes-container__borders");
    const menuThemeLocationsById = {};

    $menuThemesContainerItems.empty();
    $menuThemesContainerBorders.empty();
    $removedMenuThemesContainerItems.empty();
    $removedMenuThemesContainerBorders.empty();

    for (let m of menuThemeData) {
        for (let l of m.locations) {
            const removedCollectableClass = l.removed ? ' removed-collectable' : '';
            const worldIdAttribute = l.worldId ? ` data-world-id="${l.worldId}"` : '';
            const menuThemeImageHtml = `<div href="javascript:void(0);" class="menu-theme collectable${removedCollectableClass} noselect"><img src="${m.filename}" referrerpolicy="no-referrer" /></div>`;
            const menuThemeLinkHtml = `<a href="javascript:void(0);" class="js--menu-theme menu-theme collectable--border noselect" data-location-id="${l.id}"${worldIdAttribute}></a>`;
            l.method = l.method.replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
            if (l.methodJP)
                l.methodJP = l.methodJP.replace(/<span .*?>(.*?)<\/ *span>/ig, '$1').replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
            $(menuThemeImageHtml).appendTo(l.removed ? $removedMenuThemesContainerItems : $menuThemesContainerItems);
            $(menuThemeLinkHtml).appendTo(l.removed ? $removedMenuThemesContainerBorders : $menuThemesContainerBorders);
            menuThemeLocationsById[l.id] = l;
        }
    }

    var $tooltip = $('<div class="menu-theme-tooltip scene-tooltip display--none"></div>').prependTo('.content');

    $(".js--menu-theme[data-world-id]").on("click", function () {
        if (trySelectNode($(this).data("worldId"), true))
            $.modal.close();
    })
    
    $(".js--menu-theme").on("mousemove", function (e) {
        $tooltip.css({
            top: e.pageY + 10 + 'px',
            left: (e.pageX - ($tooltip.innerWidth() / 2)) + 'px'
        });
    }).on("mouseenter", function () {
        const location = menuThemeLocationsById[$(this).data("locationId")];
        const world = location.worldId ? worldData[location.worldId] : null;
        const worldName = world ?
            config.lang === "en" || !world.titleJP ? world.title : world.titleJP
            : null;
        const worldLabel = worldName ? `<span class="menu-theme-tooltip__world">${worldName}</span><br />` : '';
        const method = config.lang === "en" || !location.methodJP ? location.method : location.methodJP;
        $tooltip.html(`${worldLabel}${method}`).removeClass("display--none");
    }).on("mouseleave", function () {
        $tooltip.addClass("display--none");
    });
}

function loadOrInitConfig() {
    try {
        if (!window.localStorage.hasOwnProperty("config"))
            window.localStorage.setItem("config", JSON.stringify(config));
        else {
            const savedConfig = JSON.parse(window.localStorage.getItem("config"));
            for (let key of Object.keys(savedConfig)) {
                if (config.hasOwnProperty(key)) {
                    const value = savedConfig[key];
                    config[key] = value;
                    switch (key) {
                        case "debug":
                            isDebug = value;
                            break;
                        case "lang":
                            $(".js--lang").val(value);
                            break;
                        case "uiTheme":
                            $(".js--ui-theme").val(value);
                            break;
                        case "fontStyle":
                            $(".js--font-style").val(value);
                            break;
                        case "renderMode":
                            $(".js--render-mode").val(value);
                            break;
                        case "displayMode":
                            $(".js--display-mode").val(value);
                            if (parseInt(value) >= 2)
                                $(".js--stack-size--container").css("display", "none");
                            break;
                        case "connMode":
                            $(".js--conn-mode").val(value);
                            break;
                        case "labelMode":
                            $(".js--label-mode").val(value);
                            break;
                        case "removedContentMode":
                            $(".js--removed-content-mode").val(value);
                            $(".js--removed-content").toggleClass("display--none", !value);
                            break;
                        case "pathMode":
                            $(".js--path-mode").val(value);
                            break;
                        case "sizeDiff":
                            $(".js--size-diff").val(value);
                            break;
                        case "stackSize":
                            $(".js--stack-size").val(value);
                            break;
                    }
                }
            }
        }
    } catch (error) {
        console.log(error);
    }
}

function updateControlsContainer(updateTabMargin) {
    const controlsHeight = $(".controls-top").outerHeight();
    const settingsHeight = $(".controls-bottom").outerHeight();
    const collectableControlsHeight = $(".controls-side").outerHeight();
    const collectableControlsWidth = $(".controls-side").outerWidth();
    $(".controls-top--container, .controls-bottom--container").css("margin-top", `-${(settingsHeight + 20)}px`);
    $(".controls-top--container, controls-bottom--container, .controls-bottom--container--tab, .footer").each(function () {
        $(this).css("height", `${settingsHeight - ($(this).outerHeight() - parseFloat(window.getComputedStyle(this, null).getPropertyValue("height")))}px`);
    });
    $(".controls-bottom--container--tab").css("left", `calc(50% - ${($(".controls-bottom--container--tab").outerWidth() / 2)}px`);
    $(".controls-side--container").css({
        "top": `${(controlsHeight + 16)}px`,
        "margin-left": `-${(collectableControlsWidth + 20)}px`
    });
    $(".controls-side--container--tab").css({
        "width": `${collectableControlsWidth}px`,
        "top": `${(controlsHeight + 16)}px`,
        "margin-top": `${16 + (((collectableControlsHeight + 16) - $(".controls-side--container--tab").outerHeight()) / 2)}px`
    });
    if (updateTabMargin) {
        if ($(".controls-bottom").hasClass("visible"))
            $(".controls-bottom--container--tab, .footer").css("margin-top", `-${(settingsHeight + 8)}px`);
        if ($(".controls-side").hasClass("visible"))
            $(".controls-side--container--tab").css("margin-left", `-${(collectableControlsWidth + 8)}px`);
        $(".modal").css("transition", "");
    }

    let modalMaxWidth;
    let modalLeftMargin;
    let modalRightMargin;
    if ($(".controls-side").hasClass("visible")) {
        const fullModalWidth = window.innerWidth * 0.9;
        const collectableControlsWidth = $(".controls-side").outerWidth() + parseFloat($(".controls-side").css("margin-right")) + $(".controls-side--container--tab__button").outerWidth();
        modalMaxWidth = window.innerWidth - (collectableControlsWidth + 8);
        modalLeftMargin =  collectableControlsWidth >= window.innerWidth - fullModalWidth
            ? (window.innerWidth - (fullModalWidth + collectableControlsWidth + 8)) * -1
            : 0;
            modalLeftMargin = 0;
        modalRightMargin = collectableControlsWidth - 12;
    } else {
        modalMaxWidth = window.innerWidth;
        modalLeftMargin = 0;
        modalRightMargin = 0;
    }

    $(".modal").css({
        "margin-top": `${(controlsHeight + 16)}px`,
        "height": `calc(100% - ${(controlsHeight + 16 + ($(".controls-bottom").hasClass("visible") ? settingsHeight + 8 : 0))}px)`,
        "max-width": `${modalMaxWidth}px`,
        "margin-left": `${modalLeftMargin}px`,
        "margin-right": `${modalRightMargin}px`
    });
}

export function loadData(update, success, fail) {
    let queryString = update ? "?update=" + update : "";
    if (config.removedContentMode === 1)
        queryString += (queryString.length ? "&" : "?") + "includeRemovedContent=true";
    const urlSearchParams = new URLSearchParams(window.location.search);
    if (urlSearchParams.has("adminKey"))
        queryString += (queryString.length ? "&" : "?") + "adminKey=" + urlSearchParams.get("adminKey");
    $.get("/data" + queryString, function (data) {
        if (document.fonts.check("12px MS Gothic")) {
            fontsLoaded = true;
            success(data);
        } else {
            document.fonts.onloadingdone = _ => fontsLoaded = true;
            const fontsLoadedCheck = window.setInterval(function () {
                if (fontsLoaded) {
                    window.clearInterval(fontsLoadedCheck);
                    success(data);
                }
            }, 100);
        }
    }).fail(fail);
}

function reloadData(update) {
    const loadCallback = displayLoadingAnim($("#graphContainer"));
    loadData(update, function (data) {
        initWorldData(data.worldData);
        initMenuThemeData(data.menuThemeData);
        lastUpdate = new Date(data.lastUpdate);
        lastFullUpdate = new Date(data.lastFullUpdate);

        initLocalization();

        if (isWebGL2) {
            worldImageData = [];
            initNodeObjectMaterial().then(() => {
                reloadGraph();
                loadCallback();
            }).catch(err => console.error(err));
        } else {
            reloadGraph();
            loadCallback();
        }
    }, loadCallback);
}

export let graph;

let contextWorldId = null, startWorldId = null, endWorldId = null, hoverWorldId = null, selectedWorldId = null;

let searchWorldIds = [], visibleWorldIds = [];

let selectedAuthor = null;

let visibleTwoWayLinks = [];
let visibleOneWayLinks = [];
let hiddenLinks = [];
let linksTwoWayBuffered;
let linksOneWayBuffered;

let nodeObject;
let iconObject;

let icons3D;

const colorLinkSelected = new THREE.Color('red');
const nodeTextColors = ["#FFFFFF", "#AAAAAA", "#888888"];

let localizedNodeLabel;
let localizedPathNodeLabel;

let iconLabel;

let raycaster, mousePos = { x: 0, y: 0 };

let localizedUnknownAuthor;

let localizedConns;

let effectsJP;

let config = {
    debug: false,
    lang: "en",
    uiTheme: "Default_Custom",
    fontStyle: 0,
    renderMode: 0,
    displayMode: 0,
    connMode: 0,
    labelMode: 1,
    removedContentMode: 0,
    pathMode: 1,
    sizeDiff: 1,
    stackSize: 20
};

let lastUpdate, lastFullUpdate;

let worldImageData = [];

function initGraph(renderMode, displayMode, paths) {

    is2d = !renderMode;

    const links = [];

    const addedLinks = [];

    const dagIgnore = {};

    const worldDepths = {};
    const worldRealDepths = {};
    const worldRemoved = {};

    iconTexts = [];

    for (let w of worldData) {
        worldScales[w.id] = 1 + (Math.round((w.size - minSize) / (maxSize - minSize) * 10 * (config.sizeDiff - 1)) / 10);
        worldRemoved[w.id] = w.removed;
    }

    let maxDepth;

    if (paths) {
        visibleWorldIds = _.uniq(_.flatten(paths).map(p => p.id));

        const pathScores = [];
        let minPathDepth = paths[0].length - 2;
        let maxPathDepth;
        let pathDepthLimit;
        let depthDiff;
        let maxPathScore;
        let filteredPathConnTypes = ConnType.LOCKED | ConnType.EFFECT | ConnType.CHANCE | ConnType.LOCKED_CONDITION | ConnType.EXIT_POINT;
        do {
            const filteredPaths = paths.filter(p => !p.filter(pi => filteredPathConnTypes & pi.connType).length);
            if (filteredPaths.length)
                pathDepthLimit = filteredPaths[0].length;
            else {
                if (filteredPathConnTypes & ConnType.EFFECT)
                    filteredPathConnTypes ^= ConnType.EFFECT;
                else if (filteredPathConnTypes & ConnType.CHANCE)
                    filteredPathConnTypes ^= ConnType.CHANCE;
                else {
                    pathDepthLimit = paths[0].length;
                    break;
                }
            }
        } while (!pathDepthLimit);
        pathDepthLimit = Math.max(0, pathDepthLimit - 2) * 2;
        for (let pi in paths) {
            const path = paths[pi];
            if (path.length - 2 > pathDepthLimit) {
                isDebug && console.log("Removing path of length", path.length, "as it is too far from minimum length of", pathDepthLimit + 2);
                let visibleWorldIdRemovalCandidates = _.uniq(_.flatten(paths.slice(pi)).map(p => p.id));
                paths = paths.slice(0, pi);
                let requiredWorldIds = _.uniq(_.flatten(paths).map(p => p.id));
                _.remove(visibleWorldIdRemovalCandidates, w => requiredWorldIds.indexOf(w) > -1);
                _.remove(visibleWorldIds, w => visibleWorldIdRemovalCandidates.indexOf(w) > -1);
                break;
            }
            pathScores[pi] = parseInt(pi) + 3 * ((path.length - 2) - minPathDepth);
        }
        
        maxPathDepth = paths[paths.length - 1].length;
        depthDiff = maxPathDepth - minPathDepth;
        maxPathScore = ((paths.length - 1) + (3 * depthDiff)) * (depthDiff > 0 ? 1 : 2) || 1;
        if (paths.length === 1 && paths[0][0].connType & ConnType.INACCESSIBLE)
            pathScores[0] = maxPathScore;
        const pathWorldIds = paths.map(p => p.map(w => w.id));

        for (let p in paths) {
            const path = paths[p];
            for (let w = 1; w < path.length; w++) {
                const sourceId = path[w - 1].id;
                const targetId = path[w].id;
                const linkId = `${sourceId}_${targetId}`;
                const hue = 0.6666 - ((pathScores[p] / maxPathScore) * 0.6666);
                if (addedLinks.indexOf(linkId) === -1) {
                    const link = {
                        key: linkId,
                        source: sourceId,
                        target: targetId,
                        connType: path[w - 1].connType,
                        typeParams: path[w - 1].typeParams,
                        icons: [],
                        hidden: false,
                        defaultColor: hueToRGBA(hue, 1),
                        connTypeCheck: 'replace'
                    };
                    links.push(link);
                    addedLinks.push(linkId);
                }
            }
        }

        const worldMinDepths = {};

        for (let w of visibleWorldIds) {
            const worldDepthsMap = pathWorldIds.map(p => p.indexOf(w));
            worldDepths[w] = _.max(worldDepthsMap);
            worldMinDepths[w] = _.min(worldDepthsMap.filter(d => d > -1));
            worldRealDepths[w] = findRealPathDepth(paths, w, pathWorldIds, worldDepthsMap, worldDepths[w], worldMinDepths[w]);
        }

        const depths = Object.values(worldDepths);

        maxDepth = _.max(depths);

        if (worldDepths[endWorldId] < maxDepth || (worldDepths[endWorldId] === maxDepth && depths.filter(d => d === maxDepth).length > 1))
            worldDepths[endWorldId] = ++maxDepth;

        const nexusWorldName = "The Nexus";
        const nexusWorldId = worldData.filter(w => w.title === nexusWorldName)[0].id;
        const nexusShortcutLinks = links.filter(l => l.target === nexusWorldId && l.connType & ConnType.EFFECT && !worldData[l.source].connections.filter(c => c.targetId === nexusWorldId).length);
        const nexusShortcutWorldIds = nexusShortcutLinks.map(l => l.source);
        
        for (let w of visibleWorldIds) {
            const world = worldData[w];
            let connections = world.connections;
            const dagIgnoreIds = dagIgnore[w] || (dagIgnore[w] = []);
            if (nexusShortcutWorldIds.indexOf(w) > -1) {
                const nexusShortcutLink = nexusShortcutLinks.filter(l => l.source === w)[0];
                connections = connections.concat([{
                    targetId: nexusShortcutLink.target,
                    type: nexusShortcutLink.connType,
                    typeParams: nexusShortcutLink.typeParams
                }]);
            }
            for (let conn of connections) {
                const linkId = `${w}_${conn.targetId}`;
                if (addedLinks.indexOf(linkId) === -1)
                    continue;
                const link = links.filter(l => l.key === linkId)[0];
                const connWorld = worldData[conn.targetId];
                const reverseLinkId = `${connWorld.id}_${w}`;
                const reverseConn = connWorld.connections.filter(c => c.targetId === w);
                let hidden = false;
                if (conn.type & ConnType.NO_ENTRY) {
                    hidden = true;
                    dagIgnoreIds.push(connWorld.id);
                } else if (worldMinDepths[w] >= worldMinDepths[connWorld.id]) {
                    dagIgnoreIds.push(connWorld.id);
                    if (worldDepths[w] >= worldDepths[connWorld.id]) {
                        const sameDepth = worldDepths[w] === worldDepths[connWorld.id];
                        hidden = (!sameDepth && !reverseConn.length) || (reverseConn.length && !(reverseConn[0].type & ConnType.NO_ENTRY) && (!sameDepth || (!(conn.type & ConnType.ONE_WAY) && w > connWorld.id)));
                    }
                }
                if (hidden) {
                    link.hidden = true;
                    link.connTypeCheck = 'after';
                }
                if (addedLinks.indexOf(reverseLinkId) === -1) {
                    const reverseLink = {
                        key: reverseLinkId,
                        source: connWorld.id,
                        target: w,
                        connType: reverseConn.length
                            ? reverseConn[0].type
                            : conn.type & ConnType.ONE_WAY
                            ? ConnType.NO_ENTRY
                            : conn.type & ConnType.NO_ENTRY
                            ? ConnType.ONE_WAY
                            : 0,
                        typeParams: reverseConn.length ? reverseConn[0].typeParams : {},
                        icons: [],
                        hidden: !hidden,
                        defaultColor: link.defaultColor,
                        connTypeCheck: hidden ? 'replace' : 'after'
                    };
                    links.push(reverseLink);
                    if (dagIgnoreIds.indexOf(connWorld.id) === -1) {
                        let reverseDagIgnoreIds = dagIgnore[connWorld.id];
                        if (!reverseDagIgnoreIds)
                            reverseDagIgnoreIds = dagIgnore[connWorld.id] = [];
                        reverseDagIgnoreIds.push(w);
                    }
                }
            }
        }
    } else {
        visibleWorldIds = worldData.map(w => w.id);

        maxDepth = _.max(worldData.map(w => w.depth));
        
        for (let w of visibleWorldIds) {
            const world = worldData[w];
            const connections = world.connections;
            const dagIgnoreIds = dagIgnore[w] = [];
            worldDepths[w] = world.depth;
            for (let conn of connections) {
                const connWorld = worldData[conn.targetId];
                let hidden = false;
                if (conn.type & ConnType.NO_ENTRY)
                    hidden = true;
                else if (world.depth >= connWorld.depth) {
                    const sameDepth = world.depth === connWorld.depth;
                    const reverseConn = connWorld.connections.filter(c => c.targetId === w);
                    hidden = (!sameDepth && !reverseConn.length) || (reverseConn.length && !(reverseConn[0].type & ConnType.NO_ENTRY) && (!sameDepth || (!(conn.type & ConnType.ONE_WAY) && w > connWorld.id)));
                    if (!hidden)
                        dagIgnoreIds.push(connWorld.id);
                }
                if (hidden)
                    dagIgnoreIds.push(connWorld.id);
                const hue = Math.max(0.6666 - ((world.depth / (maxDepth - 1)) * 0.6666), 0);
                const link = {
                    key: `${w}_${connWorld.id}`,
                    source: w,
                    target: connWorld.id,
                    connType: conn.type,
                    typeParams: conn.typeParams,
                    icons: [],
                    hidden: hidden,
                    defaultColor: hueToRGBA(hue, 1),
                    connTypeCheck: hidden ? 'after' : 'replace'
                };
                links.push(link);
            }
        }
    }

    initWorldSearch();

    links.forEach(l => {
        const icons = l.icons;
        const connType = l.connType;
        
        if (connType & ConnType.INACCESSIBLE)
            icons.push(getConnTypeIcon(ConnType.INACCESSIBLE));
        if (connType & ConnType.ONE_WAY)
            icons.push(getConnTypeIcon(ConnType.ONE_WAY));
        else if (connType & ConnType.NO_ENTRY)
            icons.push(getConnTypeIcon(ConnType.NO_ENTRY));
        if (connType & ConnType.UNLOCK)
            icons.push(getConnTypeIcon(ConnType.UNLOCK));
        else if (connType & ConnType.LOCKED)
            icons.push(getConnTypeIcon(ConnType.LOCKED));
        else if (connType & ConnType.LOCKED_CONDITION)
            icons.push(getConnTypeIcon(ConnType.LOCKED_CONDITION, l.typeParams[ConnType.LOCKED_CONDITION]));
        else if (connType & ConnType.SHORTCUT)
            icons.push(getConnTypeIcon(ConnType.SHORTCUT));
        else if (connType & ConnType.EXIT_POINT)
            icons.push(getConnTypeIcon(ConnType.EXIT_POINT));
        if (connType & ConnType.DEAD_END)
            icons.push(getConnTypeIcon(ConnType.DEAD_END));
        else if (connType & ConnType.ISOLATED)
            icons.push(getConnTypeIcon(ConnType.ISOLATED));
        if (connType & ConnType.EFFECT)
            icons.push(getConnTypeIcon(ConnType.EFFECT, l.typeParams[ConnType.EFFECT]));
        if (connType & ConnType.CHANCE)
            icons.push(getConnTypeIcon(ConnType.CHANCE, l.typeParams[ConnType.CHANCE]));
    });

    const images = (paths ? worldData.filter(w => visibleWorldIds.indexOf(w.id) > -1) : worldData).map(d => {
        const img = imageLoader.load(d.filename);
        img.id = d.id;
        img.rId = d.rId;
        img.title = config.lang === "en" || !d.titleJP ? d.title : d.titleJP;
        return img;
    });
    
    const depthColors = [];
    const depthHueIncrement = (1 / maxDepth) * 0.6666;
    
    for (let d = 0; d <= maxDepth; d++)
        depthColors.push(hueToRGBA(0.6666 - depthHueIncrement * d, 1));

    let n = 0;

    const nodes = images.map(img => {
        const id = parseInt(img.id);
        const rId = parseInt(img.rId);
        const scale = worldScales[id];
        const removed = worldRemoved[id];
        const ret = { id, rId, index: n++, img, scale: scale, removed: removed };
        ret.depth = worldDepths[id];
        ret.depthColor = depthColors[ret.depth];
        if (paths)
        {
            ret.depthOverride = ret.depth;
            ret.minDepth = worldRealDepths[id];
            ret.minDepthColor = depthColors[ret.minDepth];
        }
        ret.dagIgnore = dagIgnore[id];
        ret.width = 16 * scale;
        ret.height = 12 * scale;
        return ret;
    });

    const radius = 12;
    const gData = {
        nodes: nodes,
        links: _.sortBy(links, l => (endWorldId == null || l.target !== endWorldId ? worldDepths[l.source] : maxDepth) + (maxDepth + 1) * (l.connType & ConnType.ONE_WAY ? 1 : 0))
    };

    icons3D = [];

    visibleTwoWayLinks = [];
    visibleOneWayLinks = [];
    hiddenLinks = [];

    const rendererConfig = isWebGL2
        ? {
            antialias: true,
            alpha: true,
            canvas: graphCanvas,
            context: graphContext
        }
        : {
            antialias: true,
            alpha: true
        };

    const elem = document.getElementById('graph');

    graph = ForceGraph3D({
        rendererConfig: rendererConfig,
        controlType: 'orbit',
        numDimensions: is2d ? 2 : 3
    })(elem);

    const maxAnisotropy = graph.renderer().capabilities.getMaxAnisotropy();

    if (displayMode < 4)
        graph = graph
            .dagMode(displayMode === 0 ? 'td' : displayMode === 1 ? 'lr' : displayMode === 2 ? 'radialin' : 'radialout')
            .dagLevelDistance(displayMode < 2 ? 12 : 24 + radius * (config.sizeDiff + 1));

    linksTwoWayBuffered = undefined;
    linksOneWayBuffered = undefined;

    const dummyLinkObject = new THREE.Line();
    dummyLinkObject.visible = false;

    graph = graph
        .numDimensions(is2d ? 2 : 3)
        .backgroundColor('#00000000')
        .linkOpacity(1)
        .nodeThreeObject(node => {
            let ret;
            const scale = worldScales[node.id];
            const world = worldData[node.id];
            const box = new THREE.BoxGeometry(13 * scale, 9.75 * scale, is2d ? 0.1 : 13 * scale);
            let material;
            if (isWebGL2) {
                material = new THREE.MeshBasicMaterial();
                material.visible = false;
                ret = new THREE.Mesh(box, material);
            } else {
                const texture = new THREE.TextureLoader().load(world.filename);
                texture.anisotropy = maxAnisotropy;
                texture.minFilter = THREE.NearestFilter; // disables mipmaps (eliminates blur)
                material = new THREE.MeshBasicMaterial({ map: texture });
                ret = new THREE.Mesh(box, material);
                ret.material.transparent = true;
                if (is2d) {
                    ret.material.depthTest = false;
                    ret.renderOrder = world.id;
                }
                ret.material.opacity = getNodeOpacity(node.id);
                ret.material.grayscale = getNodeGrayscale(node);
            }

            if (!(isWebGL2 && is2d)) {
                const worldName = config.lang === "en" || !world.titleJP ? world.title : world.titleJP;
                const text = new SpriteText(worldName, 1.5, node.removed ? getNodeTextColor(node, ret.material.grayscale) : 'white');
                text.__graphObjType = 'label';
                text.fontFace = 'MS Gothic';
                text.fontSize = 80;
                text.strokeWidth = is2d ? 1.5 : 2;
                text.strokeColor = '#000000';
                text.backgroundColor = false;
                if (is2d) {
                    text.material.depthTest = false;
                    text.renderOrder = world.id;
                } else {
                    text.borderWidth = 1;
                    text.borderColor = 'transparent';
                }
                if (isWebGL2) {
                    text.renderOrder = 2;
                    text.material.depthWrite = false;
                }
                let textLines = worldName.split(" ");
                for (let l = 0; l < textLines.length; l++) {
                    text.text = textLines[l];
                    if (text.scale.x * scale < 13 * scale) {
                        let mergeIndex = 0;
                        for (let l2 = l + 1; l2 < textLines.length; l2++) {
                            const mergedLine = textLines.slice(l, l2 + 1).join(" ");
                            text.text = mergedLine;
                            if (text.scale.x * scale < 13 * scale)
                                mergeIndex = l2;
                            else
                                break;
                        }
                        if (mergeIndex)
                            textLines = textLines.slice(0, l).concat([textLines.slice(l, mergeIndex + 1).join(" ")], textLines.slice(mergeIndex + 1));
                    } else if (textLines[l].indexOf("：") > -1)
                        textLines = textLines.slice(0, l).concat(textLines[l].replace(/：/g, "： ").split(" ")).concat(textLines.slice(l + 1));
                }
                text.text = textLines.join('\n');
                text.defaultScale = { "x": text.scale.x, "y": text.scale.y };
                text.material.transparent = true;
                text.material.opacity = ret.material.opacity;
                if (config.labelMode < 3)
                    text.visible = false;

                ret.add(text);
            }
            return ret;
        })
        .onEngineTick(() => {
            updateLinkObjects(visibleTwoWayLinks, linksTwoWayBuffered, is2d);
            updateLinkObjects(visibleOneWayLinks, linksOneWayBuffered, is2d);
            updateLinkDistances();
            if (isWebGL2)
                updateNodePositions(is2d);
        })
        .linkThreeObject(link => dummyLinkObject)
        .linkPositionUpdate((linkObject, { start, end }, link) => {
            if (!isWebGL2 && icons3D[link.key] !== undefined) {
                const linkIcons = icons3D[link.key];
                const dist = is2d
                    ? new THREE.Vector2(start.x, start.y).distanceTo(new THREE.Vector2(end.x, end.y))
                    : new THREE.Vector3(start.x, start.y, start.z).distanceTo(new THREE.Vector3(end.x, end.y, end.z));
                const spacing = Math.min(((dist / 2) / dist) / (linkIcons.length + 1), 16 / dist);
                if (is2d) {
                    for (let i in linkIcons) {
                        const icon = linkIcons[i];
                        let resX, resY;
                        const rat = ((dist / 4) / dist) + i * spacing;
                        resX = (1 - rat) * start.x + rat * end.x;
                        resY = (1 - rat) * start.y + rat * end.y;
                        icon.position.set(resX, resY, 0);
                    }
                } else {
                    for (let i in linkIcons) {
                        const icon = linkIcons[i];
                        let resX, resY, resZ;
                        const rat = ((dist / 4) / dist) + i * spacing;
                        resX = (1 - rat) * start.x + rat * end.x;
                        resY = (1 - rat) * start.y + rat * end.y;
                        resZ = (1 - rat) * start.z + rat * end.z;
                        icon.position.set(resX, resY, is2d ? 0 : resZ);
                    }
                }
                if (link.connType & ConnType.ONE_WAY) {
                    const oneWayIcon = linkIcons.filter(i => i.connType & ConnType.ONE_WAY)[0];
                    oneWayIcon.material.map.repeat.x = link.source.x <= link.target.x ? 1 : -1;
                }
            }
        })
        .connMode(() => config.connMode)
        .nodeVal(node => node.width)
        .nodeLabel(node => {
            let ret = (paths && node.depth !== node.minDepth ? localizedPathNodeLabel : localizedNodeLabel)
                .replace('{WORLD}', node.img.title).replace('{DEPTH}', node.depth).replace('{DEPTH_COLOR}', node.depthColor).replace('{AUTHOR}', worldData[node.id].author || localizedUnknownAuthor);
            if (paths)
                ret = ret.replace('{MIN_DEPTH}', node.minDepth).replace('{MIN_DEPTH_COLOR}', node.minDepthColor);
            return ret;
        })
        .nodesPerStack(config.stackSize)
        .onNodeDragEnd(node => {
            node.fx = node.x;
            node.fy = node.y;
            if (!is2d)
                node.fz = node.z;
        })
        .onNodeHover((node, prevNode) => {
            elem.style.cursor = node ? 'pointer' : null;

            if (node) {
                hoverWorldId = node.id;
                if (nodeObject && node.removed) {
                    const nodeGrayscale = getNodeGrayscale(node);
                    nodeObject.geometry.attributes.grayscale.array[node.index] = nodeGrayscale;
                    nodeObject.geometry.attributes.grayscale.needsUpdate = true;
                }
                const removedTwoWayLinks = visibleTwoWayLinks.filter(l => getWorldLinkRemoved(node.id, l, worldRemoved));
                const removedOneWayLinks = visibleOneWayLinks.filter(l => getWorldLinkRemoved(node.id, l, worldRemoved));
                const removedLinks = removedTwoWayLinks.concat(removedOneWayLinks).concat(hiddenLinks.filter(l => getWorldLinkRemoved(node.id, l, worldRemoved)));
                if (removedTwoWayLinks.length)
                    updateLinkColors(removedTwoWayLinks, linksTwoWayBuffered, visibleTwoWayLinks);
                if (removedOneWayLinks.length)
                    updateLinkColors(removedOneWayLinks, linksOneWayBuffered, visibleOneWayLinks);
                if (removedLinks.length)
                    updateConnectionModeIcons(removedLinks);
            }
            else
                hoverWorldId = null;

            if (prevNode) {
                if (nodeObject && prevNode.removed) {
                    const nodeGrayscale = getNodeGrayscale(prevNode);
                    nodeObject.geometry.attributes.grayscale.array[prevNode.index] = nodeGrayscale;
                    nodeObject.geometry.attributes.grayscale.needsUpdate = true;
                }
                const removedTwoWayLinks = visibleTwoWayLinks.filter(l => getWorldLinkRemoved(prevNode.id, l, worldRemoved));
                const removedOneWayLinks = visibleOneWayLinks.filter(l => getWorldLinkRemoved(prevNode.id, l, worldRemoved));
                const removedLinks = removedTwoWayLinks.concat(removedOneWayLinks).concat(hiddenLinks.filter(l => getWorldLinkRemoved(prevNode.id, l, worldRemoved)));
                if (removedTwoWayLinks.length)
                    updateLinkColors(removedTwoWayLinks, linksTwoWayBuffered, visibleTwoWayLinks);
                if (removedOneWayLinks.length)
                    updateLinkColors(removedOneWayLinks, linksOneWayBuffered, visibleOneWayLinks);
                if (removedLinks.length)
                    updateConnectionModeIcons(removedLinks);
            }

            if (isWebGL2 && is2d)
                updateNodeLabels2D();
        })
        .onNodeClick(node => {
            if (isCtrl || isShift)
                openWorldWikiPage(node.id, isShift);
            else
                trySelectNode(node);
        })
        .onNodeRightClick((node, ev) => {
            contextWorldId = node.id;
            $(".graph canvas").contextMenu({
                x: ev.x,
                y: ev.y
            });
        })
        .onBackgroundClick(node => {
            $(".js--search-world").removeClass("selected").val("");
            selectedWorldId = null;
            highlightWorldSelection();
        })
        .cooldownTicks(400)
        // Deactivate existing forces
        // Add collision and bounding box forces
        .d3Force('collide', forceCollide(node => radius * worldScales[node.id]))
        .d3Force('box', () => {
            const SQUARE_HALF_SIDE = radius * 50;

            gData.nodes.forEach(node => {
                const x = node.x || 0, y = node.y || 0;

                // bounce on box walls
                if (Math.abs(x) > SQUARE_HALF_SIDE) { node.vx += 0.1 * (x > 0 ? -1 : 1); }
                if (Math.abs(y) > SQUARE_HALF_SIDE) { node.vy += 0.1 * (y > 0 ? -1 : 1); }

                if (!is2d) {
                    const z = node.z || 0;
                    if (Math.abs(z) > SQUARE_HALF_SIDE) { node.vz += 0.1 * (z > 0 ? -1 : 1); }
                }
            });
        })
        .graphData(gData);

    document.querySelector(".controls-bottom--container--tab").style.display = '';
    document.querySelector(".controls-side--container--tab").style.display = '';

    document.removeEventListener('mousemove', onDocumentMouseMove, false);
    document.querySelector('#graph canvas').removeEventListener('wheel', clearTweens, false)

    if (is2d) {
        const controls = graph.controls();
        controls.minAzimuthAngle = 0;
        controls.maxAzimuthAngle = 0;
        controls.mouseButtons.PAN = THREE.MOUSE.LEFT;
        controls.mouseButtons.ORBIT = THREE.MOUSE.MIDDLE;
        controls.enableRotate = false;
        controls.update();
    }

     // when the mouse moves, call the given function
     document.addEventListener('mousemove', onDocumentMouseMove, false);
     document.querySelector('#graph canvas').addEventListener('wheel', clearTweens, false);

    (function () {
        let _animationCycle = graph._animationCycle
        graph._animationCycle = function () {
            onRender(is2d);
            _animationCycle.apply(this)
        }
    })();

    if (isWebGL2) {
        initNodeObject(is2d);
        updateNodeImageData(nodes, paths, is2d);
        makeIconObject(is2d);
        let index = 0;
        graph.graphData().links.forEach(link => {
            link.icons.forEach(icon => iconTexts[index++] = icon.text);
        });
        updateConnectionModeIcons();
        if (is2d)
            updateNodeLabels2D();
    } else
        makeLinkIcons(is2d);

    // initialize object to perform world/screen calculations
    raycaster = new THREE.Raycaster();

    graph.graphData().links.forEach(link => {
        if (!link.hidden) {
            if (link.connType & ConnType.ONE_WAY)
                visibleOneWayLinks.push(link);
            else
                visibleTwoWayLinks.push(link);
        }
        else
            hiddenLinks.push(link);
    });

    makeLinkIconTooltip();
    linksTwoWayBuffered = makeTwoWayLinkObjects(is2d);
    linksOneWayBuffered = makeOneWayLinkObjects(is2d);
    updateLinkColors(visibleTwoWayLinks, linksTwoWayBuffered);
    updateLinkColors(visibleOneWayLinks, linksOneWayBuffered);
}

const clock = new THREE.Clock();
let time = 0;
const dashLineSpeed = 20;
function onRender(is2d) {
    time -= clock.getDelta() * dashLineSpeed;
    if (!(isWebGL2 && is2d))
        updateNodeLabels(is2d);
    if (isWebGL2)
        updateIconPositions(is2d);
    updateLinkAnimation(linksOneWayBuffered, time);
}

// START WEBGL2.0 SPECIFIC CODE
function updateNodeImageData(nodes, isSubset, is2d) {
    nodeObject.count = nodes.length;
    if (isSubset) {
        let index = 0;
        let rIndex = 0;
        const totalNodeCount = nodes.length;
        const removedNodeCount = nodes.filter(n => n.removed).length;
     
        nodes.forEach(node => {
            copyImageData(node.id, index);
            if (is2d) {
                copyImageData(node.id + worldData.length, index + totalNodeCount);
                if (node.removed) {
                    copyImageData(node.rId + worldData.length * 2, rIndex + totalNodeCount * 2);
                    copyImageData(node.rId + worldData.length * 2 + removedCount, rIndex + totalNodeCount * 2 + removedNodeCount);
                    rIndex++;
                }
            }
            index++;
        });
    } else
        nodeObject.material.uniforms.diffuse.value.image.data.set(worldImageData, 0);
    nodeObject.material.uniforms.diffuse.value.needsUpdate = true;
}

function copyImageData(from, to) {
    const dataLength = nodeImgDimensions.x * nodeImgDimensions.y * 4;
    let offsetFrom = from * dataLength;
    let offsetTo = to * dataLength;
    nodeObject.material.uniforms.diffuse.value.image.data.set(worldImageData.slice(offsetFrom, offsetFrom + dataLength), offsetTo);
}

const instanceVS = `#version 300 es
    precision highp float;

    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    in mat4 instanceMatrix;
    in vec3 position;
    in vec2 uv;

    in float opacity;
    out float vOpacity;
    in float grayscale;
    out float vGrayscale;
    out vec2 vUv;
    in float texIndex;
    out float vTexIndex;
    void main() {
        vOpacity = opacity;
        vGrayscale = grayscale;
        vUv = vec2(uv.x, 1.0 - uv.y); // flip texture vertically, because of how it's stored
        vTexIndex = texIndex;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const instanceIconVS = `#version 300 es
    precision highp float;

    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    in mat4 instanceMatrix;
    in vec3 position;
    in vec2 uv;

    in float opacity;
    out float vOpacity;
    in float grayscale;
    out float vGrayscale;
    out vec2 vUv;
    in float texIndex;
    out float vTexIndex;
    void main() {
        vOpacity = opacity;
        vGrayscale = grayscale;
        vUv = vec2(uv.x, 1.0 - uv.y); // flip texture vertically, because of how it's stored
        vTexIndex = texIndex;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mvPosition.xy += position.xy;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const instanceFS = `#version 300 es
    precision highp float;
    precision highp sampler2DArray;

    in float vOpacity;
    in float vGrayscale;
    uniform sampler2DArray diffuse;
    in vec2 vUv;
    out vec4 fragmentColor;
    in float vTexIndex;

    void main() {
        vec4 temp = texture(diffuse, vec3(vUv, int(vTexIndex + 0.1)));
        temp.a = vOpacity;
        if (vGrayscale > 0.0) {
            float v = (temp.r + temp.g + temp.b) / 3.0;
            temp.r = (temp.r * (1.0 - vGrayscale)) + (v * vGrayscale);
            temp.g = (temp.g * (1.0 - vGrayscale)) + (v * vGrayscale);
            temp.b = (temp.b * (1.0 - vGrayscale)) + (v * vGrayscale);
        }
        fragmentColor = temp;
    }
`;

const instanceIconFS = `#version 300 es
    precision highp float;
    precision highp int;
    precision highp sampler2DArray;

    in float vOpacity;
    in float vGrayscale;
    uniform sampler2DArray diffuse;
    in vec2 vUv;
    out vec4 fragmentColor;
    in float vTexIndex;

    void main() {
        vec4 temp = texture(diffuse, vec3(vUv, int(vTexIndex + 0.1)));
        temp.a = temp.a * vOpacity;
        if (vGrayscale > 0.0) {
            float v = (temp.r + temp.g + temp.b) / 3.0;
            temp.r = (temp.r * (1.0 - vGrayscale)) + (v * vGrayscale);
            temp.g = (temp.g * (1.0 - vGrayscale)) + (v * vGrayscale);
            temp.b = (temp.b * (1.0 - vGrayscale)) + (v * vGrayscale);
        }
        fragmentColor = temp;
    }
`;

let unsortedIconOpacities = [];
let unsortedIconGrayscales = [];
let unsortedIconTexIndexes = [];
let sortedIconIds = [];
let iconCount;
function makeIconObject(is2d) {
    const connTypes = [
        ConnType.ONE_WAY,
        ConnType.NO_ENTRY,
        ConnType.UNLOCK,
        ConnType.LOCKED,
        ConnType.DEAD_END,
        ConnType.ISOLATED,
        ConnType.EFFECT,
        ConnType.CHANCE,
        ConnType.LOCKED_CONDITION,
        ConnType.SHORTCUT,
        ConnType.EXIT_POINT,
        ConnType.INACCESSIBLE
    ];
    const iconImgDimensions = { x: 64, y: 64 };
    const amountTextures = connTypes.length + 1; // 1 reversed one-way arrow

    const buffer = new ArrayBuffer(iconImgDimensions.x * iconImgDimensions.y * 4 * amountTextures);

    iconCount = 0;
    graph.graphData().links.forEach(link => {
        link.icons.forEach(icon => {
            icon.id = iconCount++;
        })
    });
    let iconImgData = new Uint8ClampedArray(buffer);
    let index = 0;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = iconImgDimensions.x;
    canvas.height = iconImgDimensions.y;
    context.font = '50px MS Gothic';
    context.fillStyle = 'white';
    const dataLength = iconImgDimensions.x * iconImgDimensions.y * 4;
    connTypes.forEach(type => {
        let char = getConnTypeChar(type);
        context.fillText(char, 0, 52);
        const imgData = context.getImageData(0, 0, iconImgDimensions.x, iconImgDimensions.y);
        const offset = index * dataLength;
        iconImgData.set(imgData.data, offset);
        context.clearRect(0, 0, canvas.width, canvas.height);
        index++;
    });
    context.scale(-1, 1);
    context.fillText(getConnTypeChar(ConnType.ONE_WAY), -canvas.width, 52);
    iconImgData.set(context.getImageData(0, 0, iconImgDimensions.x, iconImgDimensions.y).data, index * dataLength);

    const texture = new THREE.DataTexture2DArray(iconImgData, iconImgDimensions.x, iconImgDimensions.y, amountTextures);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    const material = new THREE.RawShaderMaterial({
        uniforms: {
            diffuse: { value: texture },
        },
        vertexShader: instanceIconVS,
        fragmentShader: instanceIconFS,
        transparent: true,
        depthTest: !is2d,
        depthWrite: false
    });

    const opacities = [];
    const grayscales = [];
    const texIndexes = [];

    let iconIndex = 0;
    graph.graphData().links.forEach(link => {
        link.icons.forEach(icon => {
            opacities[iconIndex] = 1.0;
            grayscales[iconIndex] = 0;
            texIndexes[iconIndex] = connTypes.findIndex(a => a == icon.type);
            iconIndex++;
        });
    });

    unsortedIconOpacities = opacities.slice();
    unsortedIconGrayscales = grayscales.slice();
    unsortedIconTexIndexes = texIndexes.slice();

    const geometry = new THREE.PlaneBufferGeometry(5, 5);
    geometry.attributes.opacity = new THREE.InstancedBufferAttribute(new Float32Array(opacities), 1);
    geometry.attributes.grayscale = new THREE.InstancedBufferAttribute(new Float32Array(grayscales), 1);
    geometry.attributes.texIndex = new THREE.InstancedBufferAttribute(new Float32Array(texIndexes), 1);

    iconObject = new THREE.InstancedMesh(geometry, material, iconCount);
    iconObject.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    iconObject.renderOrder = is2d ? -1 : 3;
    graph.scene().add(iconObject);
}

function updateIconPositions(is2d) {
    const dummy = new THREE.Object3D();
    if (iconObject) {
        let index = 0;
        graph.graphData().links.forEach(link => {
            const start = link.source;
            const end = link.target;
            const dist = is2d
                ? new THREE.Vector2(start.x, start.y).distanceTo(new THREE.Vector2(end.x, end.y))
                : new THREE.Vector3(start.x, start.y, start.z).distanceTo(new THREE.Vector3(end.x, end.y, end.z));
            const spacing = Math.min(((dist / 2) / dist) / (link.icons.length + 1), 16 / dist);
            let iconIndex = 0;
            link.icons.forEach(icon => {
                let pos;
                if (is2d) {
                    let resX, resY;
                    const rat = ((dist / 4) / dist) + iconIndex * spacing;
                    resX = (1 - rat) * start.x + rat * end.x;
                    resY = (1 - rat) * start.y + rat * end.y;
                    pos = new THREE.Vector3(resX, resY, 0);
                } else {
                    let resX, resY, resZ;
                    const rat = ((dist / 4) / dist) + iconIndex * spacing;
                    resX = (1 - rat) * start.x + rat * end.x;
                    resY = (1 - rat) * start.y + rat * end.y;
                    resZ = (1 - rat) * start.z + rat * end.z;
                    pos = new THREE.Vector3(resX, resY, is2d ? 0 : resZ);
                }
                if (pos !== undefined) {
                    iconObject.getMatrixAt(index, dummy.matrix);
                    if (!is2d)
                        dummy.position.set(pos.x, pos.y, pos.z);
                    else
                        dummy.position.set(pos.x, pos.y, 0);
                    dummy.updateMatrix();
                    iconObject.setMatrixAt(index, dummy.matrix);
                }
                const texIndex = unsortedIconTexIndexes[index];
                if (texIndex == 0 || texIndex == 12) {
                    if (is2d) {
                        if (start.x > end.x) {
                            if (texIndex == 0)
                                unsortedIconTexIndexes[index] = 12;
                        } else if (texIndex == 12)
                            unsortedIconTexIndexes[index] = 0;
                    } else {
                        if (graph.graph2ScreenCoords(start.x, start.y, start.z).x > graph.graph2ScreenCoords(end.x, end.y, end.z).x) {
                            if (texIndex == 0)
                                unsortedIconTexIndexes[index] = 12;
                        } else if (texIndex == 12)
                            unsortedIconTexIndexes[index] = 0;
                    }
                }
                index++;
                iconIndex++;
            });
        });
        sortInstances(iconObject, unsortedIconOpacities, unsortedIconGrayscales, unsortedIconTexIndexes);
        iconObject.instanceMatrix.needsUpdate = true;
    }
}

function sortInstances(instanceObject, unsortedOpacities, unsortedGrayscales, unsortedTexIndexes) {
    const camera = graph.camera();
    let dummy = new THREE.Object3D();
    let index = 0;
    let positions = [];
    graph.graphData().links.forEach(link => {
        link.icons.forEach(icon => {
            instanceObject.getMatrixAt(index, dummy.matrix);
            positions[index] = new THREE.Vector3(dummy.matrix.elements[12], dummy.matrix.elements[13], dummy.matrix.elements[14]);
            index++;
        });
    });

    const opacities = instanceObject.geometry.attributes.opacity.array;
    const grayscales = instanceObject.geometry.attributes.grayscale.array;
    const texIndexes = instanceObject.geometry.attributes.texIndex.array;
    let vecArray = [];
    for (let i = 0; i < iconCount; i++)
        vecArray.push({ pos: positions[i], opacity: unsortedOpacities[i], grayscale: unsortedGrayscales[i], texIndex: unsortedTexIndexes[i], unsortedId: i });
    vecArray.sort((a, b) => a.pos.distanceTo(camera.position) > b.pos.distanceTo(camera.position)
        ? -1
        : a.pos.distanceTo(camera.position) < b.pos.distanceTo(camera.position)
        ? 1
        : 0
    );

    index = 0;
    vecArray.forEach(item => {
       sortedIconIds[index] = item.unsortedId;
       index++;
    });

    index = 0;
    const camPos = graph.camera().position;
    graph.graphData().links.forEach(link => {
        link.icons.forEach(_ => {
            instanceObject.getMatrixAt(index, dummy.matrix);
            dummy.position.set(vecArray[index].pos.x, vecArray[index].pos.y, vecArray[index].pos.z);
            dummy.lookAt(camPos);
            dummy.updateMatrix();
            instanceObject.setMatrixAt(index, dummy.matrix);
            opacities[index] = vecArray[index].opacity;
            grayscales[index] = vecArray[index].grayscale;
            texIndexes[index] = vecArray[index].texIndex;
            index++;
        });
    });

    instanceObject.geometry.attributes.opacity.needsUpdate = true;
    instanceObject.geometry.attributes.grayscale.needsUpdate = true;
    instanceObject.geometry.attributes.texIndex.needsUpdate = true;
}

function initNodeObjectMaterial() {
    const amount = worldData.length;
    const dataLength = nodeImgDimensions.x * nodeImgDimensions.y * 4;
    const buffer = new ArrayBuffer(dataLength * amount * 2 + (dataLength * removedCount * 2));
    const texture = new THREE.DataTexture2DArray(new Uint8ClampedArray(buffer), nodeImgDimensions.x, nodeImgDimensions.y, amount * 2 + (removedCount * 2));
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    nodeObjectMaterial = new THREE.RawShaderMaterial({
        uniforms: {
            diffuse: { value: texture },
        },
        vertexShader: instanceVS,
        fragmentShader: instanceFS,
        transparent: true,
        depthTest: !is2d
    });

    const filenames = [];
    worldData.forEach(world => filenames.push(worldData[world.id].filename));

    return new Promise((resolve, reject) => {
        Promise.all(getImageRawData(filenames))
            .then(images => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { alpha: false });
                canvas.width = nodeImgDimensions.x;
                canvas.height = nodeImgDimensions.y;
                const fontSize = 36;
                const halfFontSize = fontSize / 2;
                let lineYOffset;
                ctx.font = fontSize + 'px MS Gothic';
                ctx.fillStyle = 'white';
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 5;
                let index = 0;
                let rIndex = 0;
                const offsetLabels = images.length * dataLength;
                images.forEach(img => {
                    // stretch to fit
                    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, nodeImgDimensions.x, nodeImgDimensions.y);
                    let nodeImageData = ctx.getImageData(0, 0, nodeImgDimensions.x, nodeImgDimensions.y);
                    let offset = index * dataLength;
                    nodeObjectMaterial.uniforms.diffuse.value.image.data.set(nodeImageData.data, offset);
                    const worldId = index;
                    const world = worldData[worldId];
                    const worldName = config.lang === "en" || !world.titleJP ? world.title : world.titleJP;

                    if (world.removed)
                        ctx.save();

                    for (let v = 0; v < 3; v++) {
                        if (v)
                            ctx.restore();
                        
                        let textLines = worldName.split(" ");
                        ctx.fillStyle = nodeTextColors[v];
                        for (let l = 0; l < textLines.length; l++) {
                            if (ctx.measureText(textLines[l]).width < nodeImgDimensions.x) {
                                let mergeIndex = 0;
                                for (let l2 = l + 1; l2 < textLines.length; l2++) {
                                    const mergedLine = textLines.slice(l, l2 + 1).join(" ");
                                    if (ctx.measureText(mergedLine).width < nodeImgDimensions.x)
                                        mergeIndex = l2;
                                    else
                                        break;
                                }
                                if (mergeIndex)
                                    textLines = textLines.slice(0, l).concat([textLines.slice(l, mergeIndex + 1).join(" ")], textLines.slice(mergeIndex + 1));
                            } else if (textLines[l].indexOf("：") > -1)
                                textLines = textLines.slice(0, l).concat(textLines[l].replace(/：/g, "： ").split(" ")).concat(textLines.slice(l + 1));
                        }
                        for (let l in textLines) {
                            const textLine = textLines[l];
                            const lineWidth = ctx.measureText(textLine).width;
                            !lineYOffset && (lineYOffset = ctx.measureText(textLine).actualBoundingBoxAscent / 2);
                            const lineX = (nodeImgDimensions.x - lineWidth) / 2;
                            const lineY = ((nodeImgDimensions.y / 2) + lineYOffset) - ((textLines.length - 1) * halfFontSize) + l * fontSize;
                            ctx.strokeText(textLine, lineX, lineY);
                            ctx.fillText(textLine, lineX, lineY);
                        }

                        nodeImageData = ctx.getImageData(0, 0, nodeImgDimensions.x, nodeImgDimensions.y);
                        offset = v
                            ? offsetLabels + images.length * dataLength + (removedCount * dataLength * (v - 1)) + rIndex * dataLength
                            : offsetLabels + index * dataLength;
                        nodeObjectMaterial.uniforms.diffuse.value.image.data.set(nodeImageData.data, offset);

                        if (!world.removed)
                            break;
                    }
                    index++;
                    if (world.removed)
                        rIndex++;
                });
                canvas.remove();
                worldImageData = nodeObjectMaterial.uniforms.diffuse.value.image.data.slice();
                nodeObjectMaterial.uniforms.diffuse.value.needsUpdate = true;
                resolve();
            })
            .catch(err => reject(err));
    });
}

function initNodeObject(is2d) {
    const amount = worldData.length;
    const opacities = [];
    const grayscales = [];
    const texIndexes = [];

    for (let i = 0; i < amount; i++) {
        const world = worldData[i];
        opacities[i] = getNodeOpacity(world.id);
        grayscales[i] = world.removed ? 1 : 0;
        texIndexes[i] = i;
    }

    let geometry;
    if (is2d)
        geometry = new THREE.PlaneBufferGeometry(1, 1);
    else
        geometry = new THREE.BoxBufferGeometry(1, 1, 1);

    geometry.attributes.opacity = new THREE.InstancedBufferAttribute(new Float32Array(opacities), 1);
    geometry.attributes.grayscale = new THREE.InstancedBufferAttribute(new Float32Array(grayscales), 1);
    geometry.attributes.texIndex = new THREE.InstancedBufferAttribute(new Float32Array(texIndexes), 1);
    nodeObject = new THREE.InstancedMesh(geometry, nodeObjectMaterial, amount);
    nodeObject.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nodeObject.renderOrder = 1;
    graph.scene().add(nodeObject);
}

function updateNodePositions(is2d) {
    const dummy = new THREE.Object3D();
    if (nodeObject) {
        let index = 0;
        graph.graphData().nodes.forEach(node => {
            nodeObject.getMatrixAt(index, dummy.matrix);
            if (!is2d)
                dummy.position.set(node.x, node.y, node.z);
            else
                dummy.position.set(node.x, node.y, 0);
            const scale = worldScales[node.id];
            dummy.scale.set(13 * scale, 9.75 * scale, is2d ? 0.1 : 13 * scale);
            dummy.updateMatrix();
            nodeObject.setMatrixAt(index, dummy.matrix);
            index++;
        });
        nodeObject.instanceMatrix.needsUpdate = true;
    }
}

function updateNodeLabels2D() {
    if (nodeObject) {
        let index = 0;
        let rIndex = 0;
        const nodes = graph.graphData().nodes;
        const totalNodeCount = nodes.length;
        const removedNodeCount = nodes.filter(n => n.removed).length;
        nodes.forEach(node => {
            if (is2d && (config.labelMode === 3 || (config.labelMode === 1 && node.id === hoverWorldId) || (config.labelMode === 2 && node.id === selectedWorldId))) {
                const layerIndex = node.removed
                    ? nodeTextColors.indexOf(getNodeTextColor(node))
                    : 0;
                nodeObject.geometry.attributes.texIndex.array[index] = layerIndex
                    ? rIndex + (totalNodeCount * 2) + (layerIndex - 1) * removedNodeCount
                    : index + totalNodeCount;
            } else
                nodeObject.geometry.attributes.texIndex.array[index] = index;
            index++;
            if (node.removed)
                rIndex++;
        });
        nodeObject.geometry.attributes.texIndex.needsUpdate = true;
    }
}
// END WEBGL2.0 SPECIFIC CODE

function getLocalizedNodeLabel(localizedNodeLabel, forPath)
{
    return `<span class='node-label__world node-label__value'>{WORLD}</span><br>`
        + `${localizedNodeLabel.depth}<span class='node-label__value' style='color:{DEPTH_COLOR}'>{DEPTH}</span>`
        + `${forPath ? " <span class='node-label__value' style='color:{MIN_DEPTH_COLOR}'>({MIN_DEPTH})</span>" : ""}<br>`
        + `${localizedNodeLabel.author}<span class='node-label__value'>{AUTHOR}</span>`
}

/**
 *
 * @param {Array} texturesSources - List of Strings that represent texture sources
 * @returns {Array} Array containing a Promise for each source 
 */
function getImageRawData(imageSources) {
    return imageSources.map(imageSource => {
        return new Promise((resolve, reject) => {
            imageLoader.load(
                imageSource,
                image => resolve(image),
                undefined, // onProgress callback not supported from r84
                err => reject(err)
            );
        });
    });
}

function updateNodeLabels(is2d) {
    if (config.labelMode > 0) {
        const camera = graph.camera();
        graph.graphData().nodes.forEach(node => {
            const obj = node.__threeObj;
            if (obj) {
                const text = obj.children[0];
                if (config.labelMode === 3 || (config.labelMode === 1 && node.id === hoverWorldId) || (config.labelMode === 2 && node.id === selectedWorldId)) {
                    const scale = worldScales[node.id];
                    if (!is2d) {
                        const dist = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z).distanceTo(new THREE.Vector3(node.x, node.y, node.z));
                        let resX, resY, resZ;
                        const rat = (13 * scale) / dist;
                        resX = (1 - rat) * node.x + rat * camera.position.x;
                        resY = (1 - rat) * node.y + rat * camera.position.y;
                        resZ = (1 - rat) * node.z + rat * camera.position.z;
                        text.position.set(resX - node.x, resY - node.y, resZ - node.z);
                    }
                    text.scale.x = text.defaultScale.x * scale;
                    text.scale.y = text.defaultScale.y * scale;
                    text.material.opacity = getNodeOpacity(node.id);
                    text.color = getNodeTextColor(node);
                    
                    text.visible = true;
                } else
                    text.visible = false;
            }
        });
    }
}

function getNodeOpacity(id) {
    const filterForAuthor = selectedAuthor != null && worldData[id].author !== selectedAuthor;
    const opacity = ((selectedWorldId == null && !filterForAuthor)
        || id === selectedWorldId) && (!searchWorldIds.length || searchWorldIds.indexOf(id) > -1)
        ? 1
        : selectedWorldId != null && worldData[selectedWorldId].connections.filter(c => c.targetId === id).length
        ? 0.625
        : 0.1;
    return opacity;
}

function getNodeGrayscale(node) {
    if (!node.removed)
        return 0;

    const id = node.id;
    const grayscale = id === selectedWorldId
        ? 0
        : id === hoverWorldId || (selectedAuthor != null && worldData[id].author === selectedAuthor) || (searchWorldIds.length && searchWorldIds.indexOf(id) > -1) || (selectedWorldId != null && worldData[selectedWorldId].connections.filter(c => c.targetId === id).length)
        ? 0.625
        : 1;
    return grayscale;
}

function getNodeTextColor(node, grayscale) {
    if (grayscale === undefined && node)
        grayscale = getNodeGrayscale(node);
    return nodeTextColors[!grayscale ? 0 : grayscale === 1 ? 2 : 1];
}

function makeLinkIcons(is2d) {
    graph.graphData().links.forEach(link => {
        if (icons3D[link.key] === undefined) {
            const linkOpacity = getLinkOpacity(link);
            const linkGrayscale = getLinkGrayscale(link);
            let linkIcons = [];
            link.icons.forEach(icon => {
                const text = new SpriteText(icon.char, 1, 'white');
                text.__graphObjType = 'icon';
                text.name = icon.text;
                text.connType = icon.type;
                text.fontFace = 'MS Gothic';
                text.fontSize = 80;
                text.borderWidth = 1;
                text.borderColor = 'transparent';
                if (is2d) {
                    text.renderOrder = 0;
                    text.material.depthTest = false;
                }
                text.material.transparent = true;
                text.material.opacity = linkOpacity;
                text.material.grayscale = linkGrayscale;
                if (icon.type & ConnType.ONE_WAY) {
                    text.material.map.wrapS = THREE.RepeatWrapping;
                    link.source.x > link.target.x && (text.material.map.repeat.x = -1);
                }
                if (!config.connMode && link.hidden)
                    text.visible = false;
                linkIcons.push(text);
                graph.scene().add(text);
            });
            icons3D[link.key] = linkIcons;
        }
    });
}

function makeLinkIconTooltip() {
    if (iconLabel) {
        const element = document.getElementById("iconLabel");
        element.parentNode.removeChild(element);
    }
    iconLabel = document.createElement('div');
    iconLabel.innerHTML = ' ';
    iconLabel.id = 'iconLabel';
    iconLabel.className = "scene-tooltip";
    iconLabel.style.position = 'absolute';
    iconLabel.style.top = 0;
    iconLabel.style.color = 'transparent';
    iconLabel.style.zIndex = 10;
    document.body.appendChild(iconLabel);
}

function makeTwoWayLinkObjects(is2d) {
    const lineVertShader = `
        attribute float opacity;
        varying vec3 vColor;
        varying float vOpacity;

        void main() {
            vColor = color;
            vOpacity = opacity;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
        }
    `;
    const lineFragShader = `
        varying vec3 vColor;
        varying float vOpacity;
        varying float vGrayscale;

        void main() {
            gl_FragColor = vec4(vColor, vOpacity);
        }
    `;
    const size = visibleTwoWayLinks.length;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * 2 * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(size * 2 * 3), 3));
    geometry.setAttribute('opacity', new THREE.BufferAttribute(new Float32Array(size * 2), 1));
    geometry.setAttribute('grayscale', new THREE.BufferAttribute(new Float32Array(size * 2), 1));
    const material = new THREE.ShaderMaterial({
        vertexShader: lineVertShader,
        fragmentShader: lineFragShader,
        transparent: true,
        vertexColors: true,
        depthTest: !is2d
    });
    const bufferedGeometry = new THREE.LineSegments(geometry, material);
    if (is2d)
        bufferedGeometry.renderOrder = -2;
    graph.scene().add(bufferedGeometry);
    return bufferedGeometry;
}

function makeOneWayLinkObjects(is2d) {
    const lineVertShader = `
        attribute float lineDistance;
        attribute float opacity;
        varying float vLineDistance;
        varying vec3 vColor;
        varying float vOpacity;

        void main() {
            vColor = color;
            vOpacity = opacity;
            vLineDistance = lineDistance;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
        }
    `;
    const lineFragShader = `
        uniform float time;

        uniform float dashSize;
        uniform float gapSize;
        varying float vLineDistance;
        varying vec3 vColor;
        varying float vOpacity;

        void main() {
            float totalSize = dashSize + gapSize;
            float modulo = mod(vLineDistance + time, totalSize);
            if (modulo > dashSize) {
                discard;
            }
            gl_FragColor = vec4(vColor, vOpacity);
        }
    `;
    const size = visibleOneWayLinks.length;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * 2 * 3), 3));
    geometry.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(size * 2), 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(size * 2 * 3), 3));
    geometry.setAttribute('opacity', new THREE.BufferAttribute(new Float32Array(size * 2), 1));
    const material = new THREE.ShaderMaterial({
        uniforms: {
            dashSize: { value: 10 },
            gapSize: { value: 10 },
            time: { value: 0 }
        },
        vertexShader: lineVertShader,
        fragmentShader: lineFragShader,
        transparent: true,
        vertexColors: true,
        depthTest: !is2d
    });
    const bufferedGeometry = new THREE.LineSegments(geometry, material);
    if (is2d)
        bufferedGeometry.renderOrder = -2;
    graph.scene().add(bufferedGeometry);
    return bufferedGeometry;
}

function updateLinkObjects(linkData, bufferedObject, is2d) {
    const positions = bufferedObject.geometry.attributes.position.array;
    let index = 0;
    linkData.forEach(link => {
        let source, target;
        source = link.source;
        target = link.target;
        positions[index++] = source.x;
        positions[index++] = source.y;
        positions[index++] = is2d ? 0 : source.z;
        positions[index++] = target.x;
        positions[index++] = target.y;
        positions[index++] = is2d ? 0 : target.z;
    });
    bufferedObject.geometry.attributes.position.needsUpdate = true;
    bufferedObject.geometry.computeBoundingSphere();
}

function updateLinkAnimation(bufferedObject, time) {
    bufferedObject.material.uniforms.time.value = time;
}

function updateLinkColors(linkData, bufferedObject, unfilteredLinkData) {
    const colors = bufferedObject.geometry.attributes.color.array;
    const opacities = bufferedObject.geometry.attributes.opacity.array;
    let index = 0;
    let opacityIndex = 0;
    linkData.forEach(link => {
        let color;
        let opacity;
        const grayscale = getLinkGrayscale(link);
        const sourceId = link.source.id !== undefined ? link.source.id : link.source;
        const targetId = link.target.id !== undefined ? link.target.id : link.target;
        const filterForAuthor = selectedAuthor != null && (worldData[sourceId].author !== selectedAuthor || worldData[targetId].author !== selectedAuthor);
        if (selectedWorldId != null && (selectedWorldId === sourceId || selectedWorldId === targetId)) {
            opacity = 1.0;
            color = colorLinkSelected;
        } else if ((selectedWorldId == null && !filterForAuthor) && (!searchWorldIds.length || searchWorldIds.indexOf(sourceId) > -1 || searchWorldIds.indexOf(targetId) > -1)) {
            opacity = 0.625;
            color = new THREE.Color(link.defaultColor);
        } else {
            opacity = 0.1;
            color = new THREE.Color(link.defaultColor);
        }
        if (grayscale) {
            const v = (color.r + color.g + color.b) / 3;
            color.setRGB(
                color.r * (1 - grayscale) + v * grayscale,
                color.g * (1 - grayscale) + v * grayscale,
                color.b * (1 - grayscale) + v * grayscale
            );
        }
        if (unfilteredLinkData) {
            const linkIndex = unfilteredLinkData.indexOf(link);
            index = linkIndex * 6;
            opacityIndex = linkIndex * 2;
        }
        colors[index++] = color.r;
        colors[index++] = color.g;
        colors[index++] = color.b;
        colors[index++] = color.r;
        colors[index++] = color.g;
        colors[index++] = color.b;
        opacities[opacityIndex++] = opacity;
        opacities[opacityIndex++] = opacity;
    });
    bufferedObject.geometry.attributes.color.needsUpdate = true;
    bufferedObject.geometry.attributes.opacity.needsUpdate = true;
}

function updateLinkDistances() {
    const actual = linksOneWayBuffered.geometry.attributes.position.array;
    let index = 3;
    let d = 0;
    for (let i = 0; i < visibleOneWayLinks.length * 2; i++) {
        if ((i % 2)) {
            const previousPoint = new THREE.Vector3(actual[index - 3], actual[index - 2], actual[index - 1]);
            const currentPoint = new THREE.Vector3(actual[index++], actual[index++], actual[index++]);
            d = currentPoint.distanceTo(previousPoint);
            index += 3;
        } else
            d = 0;
        linksOneWayBuffered.geometry.attributes.lineDistance.array[i] = d;
    }
    linksOneWayBuffered.geometry.attributes.lineDistance.needsUpdate = true;
}

function getWorldLinkRemoved(worldId, link, worldRemoved) {
    const sourceId = link.source.id !== undefined ? link.source.id : l.source;
    const targetId = link.target.id !== undefined ? link.target.id : l.target;
    return (sourceId === worldId || targetId === worldId) && (worldRemoved[sourceId] || worldRemoved[targetId] || link.connType & ConnType.INACCESSIBLE);
}

function getLinkOpacity(link) {
    const sourceId = link.source.id !== undefined ? link.source.id : link.source;
    const targetId = link.target.id !== undefined ? link.target.id : link.target;
    const filterForAuthor = selectedAuthor != null && (worldData[sourceId].author !== selectedAuthor || worldData[targetId].author !== selectedAuthor);
    return ((selectedWorldId == null && !filterForAuthor) || (selectedWorldId != null && (selectedWorldId === sourceId || selectedWorldId === targetId)))
        && (!searchWorldIds.length || searchWorldIds.indexOf(sourceId) > -1 || searchWorldIds.indexOf(targetId) > -1)
        ? 1
        : selectedWorldId != null && (selectedWorldId === sourceId || selectedWorldId === targetId)
        ? 0.625
        : 0.1;
}

function getLinkGrayscale(link) {
    const sourceId = link.source.id !== undefined ? link.source.id : link.source;
    const targetId = link.target.id !== undefined ? link.target.id : link.target;
    const sourceWorld = worldData[sourceId];
    const targetWorld = worldData[targetId];

    if (!sourceWorld.removed && !targetWorld.removed)
        return 0;

    return sourceId === selectedWorldId || targetId === selectedWorldId
        ? 0
        : (sourceId === hoverWorldId || targetId === hoverWorldId) || (selectedAuthor != null && (sourceWorld.author === selectedAuthor || targetWorld.author === selectedAuthor))
            || (searchWorldIds.length && (searchWorldIds.indexOf(sourceId) > -1 || searchWorldIds.indexOf(targetId) > -1))
        ? 0.375
        : 0.85;
}

function getConnTypeIcon(connType, typeParams) {
    const localizedConn = localizedConns[connType];
    const char = getConnTypeChar(connType);
    const name = localizedConn.name;
    let description = localizedConn.description;
    if (description) {
        switch (connType) {
            case ConnType.EFFECT:
                description = typeParams && ((config.lang === 'en' && typeParams.params) || (config.lang !== 'en' && typeParams.paramsJP))
                    ? description.replace('{0}', config.lang === 'en' ? typeParams.params : typeParams.paramsJP)
                    : null;
                break;
            case ConnType.CHANCE:
                description = typeParams && typeParams.params
                    ? description.replace('{0}', config.lang === 'en' ? typeParams.params : typeParams.params.replace('%', '％'))
                    : '';
                break;
            case ConnType.LOCKED_CONDITION:
                description = typeParams && ((config.lang === 'en' && typeParams.params) || (config.lang !== 'en' && typeParams.paramsJP))
                    ? description.replace('{0}', config.lang === 'en' ? typeParams.params : typeParams.paramsJP)
                    : '';
                break;
        }
    }
    return {
        type: connType,
        char: char,
        text: name + (description ? (config.lang === 'en' ? ' - ' : '：') + description : '')
    };
}

function getConnTypeChar(connType) {
    let char;
    switch (connType) {
        case ConnType.ONE_WAY:
            char = "➜";
            break;
        case ConnType.NO_ENTRY:
            char = "⛔";
            break;
        case ConnType.UNLOCK:
            char = "🔑";
            break;
        case ConnType.LOCKED:
            char = "🔒";
            break;
        case ConnType.DEAD_END:
            char = "🚩";
            break;
        case ConnType.ISOLATED:
            char = "↩️";
            break;
        case ConnType.EFFECT:
            char = "✨";
            break;
        case ConnType.CHANCE:
            char = "🍀";
            break;
        case ConnType.LOCKED_CONDITION:
            char = "🔐";
            break;
        case ConnType.SHORTCUT:
            char = "📞";
            break;
        case ConnType.EXIT_POINT:
            char = "☎️";
            break;
        case ConnType.INACCESSIBLE:
            char = "🚫";
            break;
    }
    return char;
}

function reloadGraph() {
    const startWorld = startWorldId != null ? worldData[startWorldId] : null;
    const endWorld = endWorldId != null ? worldData[endWorldId] : null;
    const matchPaths = startWorld && endWorld && startWorld != endWorld
        ? findPath(startWorld.id, endWorld.id, true, ConnType.NO_ENTRY | ConnType.DEAD_END | ConnType.ISOLATED | ConnType.SHORTCUT, config.pathMode === 0 ? 3 : config.pathMode === 1 ? 5 : 10)
        : null;
    if (graph)
        graph._destructor();
    initGraph(config.renderMode, config.displayMode, matchPaths);
}

function findPath(s, t, isRoot, ignoreTypeFlags, limit, existingMatchPaths) {
    const startTime = performance.now();

    const checkedSourceNodes = [s];
    const checkedTargetNodes = [t];

    const source = worldData[s];
    const target = worldData[t];

    if (!existingMatchPaths)
        existingMatchPaths = [];
    let matchPaths = [];

    let sourcePaths = {};
    let targetPaths = {};

    let nextGenSourceWorlds = [source];
    let nextGenTargetWorlds = [target];

    let genIndex = 0;

    sourcePaths[s] = [{ id: s, connType: null, typeParams: null }];
    targetPaths[t] = [{ id: t, connType: null, typeParams: null }];
  
    while (genIndex <= 20) {
        let sourceWorlds = nextGenSourceWorlds.slice(0);
        let targetWorlds = nextGenTargetWorlds.slice(0);
        nextGenSourceWorlds = [];
        nextGenTargetWorlds = [];
        for (let sourceWorld of sourceWorlds) {
            const sourcePath = sourcePaths[sourceWorld.id];
            //delete sourcePaths[sourceWorld.id];
            const sourceConns = traverseConns(checkedSourceNodes, sourcePath, nextGenSourceWorlds, sourceWorld, ignoreTypeFlags, true);
            $.extend(sourcePaths, sourceConns);
        }
        for (let targetWorld of targetWorlds) {
            const targetPath = targetPaths[targetWorld.id];
            //delete targetPaths[targetWorld.id];
            const targetConns = traverseConns(checkedTargetNodes, targetPath, nextGenTargetWorlds, targetWorld, ignoreTypeFlags, false);
            $.extend(targetPaths, targetConns);
        }
        
        genIndex++;

        /*let checkedSourceIds = Object.keys(sourcePaths).map(id => parseInt(id));
        let checkedTargetIds = Object.keys(targetPaths).map(id => parseInt(id));*/

        $.grep(checkedSourceNodes, id => {
            const ret = $.inArray(id, checkedTargetNodes) !== -1;
            if (ret) {
                let skip = false;

                let sourcePath = _.cloneDeep(sourcePaths[id]);
                let targetPath = _.cloneDeep(targetPaths[id]);

                if (sourcePath[sourcePath.length - 1].id === id && targetPath[targetPath.length - 1].id === id)
                    sourcePath = sourcePath.slice(0, -1);

                let loopWorldIds, sourcePathIds, targetPathIds;
                while ((loopWorldIds = _.intersectionWith((sourcePathIds = sourcePath.map(sp => sp.id)), (targetPathIds = targetPath.map(tp => tp.id)), _.isEqual)).length) {
                    //console.log("Loop found", worldData[loopWorldIds[0]].title, JSON.stringify(sourcePath.map(function(p) { return worldData[p].title})), JSON.stringify(targetPath.map(function(p) { return worldData[p].title})));
                    sourcePath = sourcePath.slice(0, sourcePathIds.indexOf(loopWorldIds[0]));
                    targetPath = targetPath.slice(0, targetPathIds.indexOf(loopWorldIds[0]) + 1);
                    //console.log("Loop fixed", worldData[loopWorldIds[0]].title, JSON.stringify(sourcePath.map(function(p) { return worldData[p].title})), JSON.stringify(targetPath.map(function(p) { return worldData[p].title})));
                }
                
                const matchPath = sourcePath.concat(targetPath.reverse());
                const allMatchPaths = existingMatchPaths.concat(matchPaths);
                for (let p of allMatchPaths) {
                    if (p.length === matchPath.length) {
                        for (let m = 1; m < matchPath.length; m++) {
                            const linkId = `${p[m - 1].id}_${p[m].id}`;
                            const matchLinkId = `${matchPath[m - 1].id}_${matchPath[m].id}`;
                            if (linkId !== matchLinkId)
                                break;
                            if (m === matchPath.length - 1)
                                skip = true;
                        }
                        if (skip)
                            break;
                    }
                }
                if (skip)
                    return false;
                _.remove(nextGenSourceWorlds, w => w.id === id);
                _.remove(nextGenTargetWorlds, w => w.id === id);
                matchPaths.push(matchPath);
            }
            return ret;
        });
    }

    const endTime = performance.now();

    isDebug && console.log("Found", matchPaths.length, "matching path(s) in", Math.round((endTime - startTime) * 10) / 10, "ms");
    if (!matchPaths.length) {
        if (!tryAddNexusPath(matchPaths, existingMatchPaths, worldData, s, t)) {
            isDebug && console.log("Marking route as inaccessible");
            matchPaths = [ [ { id: s, connType: ConnType.INACCESSIBLE }, { id: t, connType: null } ] ];
        }
        return matchPaths;
    } else if (isRoot) {
        const rootLimit = Math.min(5, limit);
        const ignoreTypesList = [ConnType.CHANCE, ConnType.EFFECT, ConnType.LOCKED | ConnType.LOCKED_CONDITION | ConnType.EXIT_POINT];
        const pathCount = Math.min(matchPaths.length, rootLimit);
        let ignoreTypes = 0;
        for (let ignoreType of ignoreTypesList)
            ignoreTypes |= ignoreType;
        matchPaths = _.sortBy(matchPaths, [ 'length' ]);
        isDebug && console.log("Looking for unconditionally accessible path...");
        let accessiblePathIndex = -1;
        for (let it = 0; it <= ignoreTypesList.length; it++) {
            const ignoreType = it < ignoreTypesList.length ? ignoreTypesList[it] : 0;
            if (matchPaths.slice(0, pathCount).filter(mp => mp.filter(p => p.connType && (p.connType & ignoreTypes)).length).length === pathCount) {
                if (matchPaths.length > rootLimit) {
                    for (let mp = rootLimit + 1; mp < matchPaths.length; mp++) {
                        const path = matchPaths[mp];
                        if (!path.filter(p => p.connType && (p.connType & ignoreTypes)).length) {
                            isDebug && console.log("Found unconditionally accessible path at index", mp);
                            if (mp >= rootLimit) {
                                isDebug && console.log("Truncating paths to limit of", limit, "with unconditionally accessible path as last element");
                                matchPaths = matchPaths.slice(0, rootLimit - 1).concat([path]);
                            }
                            accessiblePathIndex = rootLimit - 1;
                            break;
                        }
                    }
                    if (accessiblePathIndex > -1)
                        break;
                }
                let additionalPaths = findPath(s, t, false, ignoreTypeFlags | ignoreTypes, Math.max(1, Math.min(rootLimit, rootLimit - pathCount)), matchPaths);
                if (additionalPaths.length && !(additionalPaths[0][0].connType & ConnType.INACCESSIBLE)) {
                    additionalPaths = _.sortBy(additionalPaths, [ 'length' ]);
                    if (isDebug) {
                        const ignoreTypeNames = ["chance", "effect", "locked/locked condition", "phone locked"];
                        console.log("Found", additionalPaths.length, "additional path(s) by ignoring", ignoreType ? ignoreTypeNames.slice(it).join(", ") : "none");
                    }
                    for (let ap of additionalPaths) {
                        if (matchPaths.length < rootLimit) {
                            if (accessiblePathIndex === -1)
                                accessiblePathIndex = matchPaths.length;
                            matchPaths.push(ap);
                        } else if (accessiblePathIndex === -1)
                            matchPaths = matchPaths.slice(0, rootLimit - 1).concat([ap]);
                        else
                            // shouldn't happen
                            break;
                    }
                    break;
                }
            } else
                break;
            ignoreTypes ^= ignoreType;
        }

        const addAdditionalPaths = matchPaths.length && limit > rootLimit;
        if (addAdditionalPaths || matchPaths.length > limit) {
            if (matchPaths.length > rootLimit) {
                isDebug && console.log("Truncating array of", matchPaths.length, "paths to root limit of", rootLimit);
                matchPaths = matchPaths.slice(0, rootLimit);
            }
            if (addAdditionalPaths) {
                isDebug && console.log("Searching for additional paths...");
                const additionalPaths = findPath(s, t, false, defaultPathIgnoreConnTypeFlags, limit - rootLimit, existingMatchPaths.concat(matchPaths));
                if (additionalPaths.length && !(additionalPaths[0][0].connType & ConnType.INACCESSIBLE)) {
                    for (let ap of additionalPaths)
                        matchPaths.push(ap);
                    matchPaths = _.sortBy(matchPaths, [ 'length' ]);
                }
            }
        }

        if (tryAddNexusPath(matchPaths, existingMatchPaths, worldData, s, t))
            limit++;
    }

    matchPaths = _.sortBy(matchPaths, [ 'length' ]);
    if (matchPaths.length > limit) {
        isDebug && console.log("Truncating array of", matchPaths.length, "paths to limit of", limit);
        matchPaths = matchPaths.slice(0, limit);
    }

    return matchPaths;
}

function traverseConns(checkedNodes, path, nextGenWorlds, world, ignoreTypeFlags, isSource) {
    const ret = {};
    const conns = world.connections;
    for (let conn of conns) {
        let connType = conn.type;
        let typeParams = conn.typeParams;
        if (isSource && connType & ignoreTypeFlags)
            continue;
        const connWorld = worldData[conn.targetId];
        const id = connWorld.id;
        if (checkedNodes.indexOf(id) === -1) {
            const connPath = _.cloneDeep(path);
            // If checking from target
            if (isSource) {
                connPath[connPath.length - 1].connType = connType;
                connPath[connPath.length - 1].typeParams = typeParams;
                connType = null;
            } else {
                const reverseConn = connWorld.connections.filter(c => c.targetId === world.id);
                let reverseConnType = 0;
                let reverseConnTypeParams = {};
                if (reverseConn.length) {
                    reverseConnType = reverseConn[0].type;
                    reverseConnTypeParams = reverseConn[0].typeParams;
                } else {
                    if (connType & ConnType.ONE_WAY)
                        reverseConnType |= ConnType.NO_ENTRY;
                    else if (connType & ConnType.NO_ENTRY)
                        reverseConnType |= ConnType.ONE_WAY;
                    if (connType & ConnType.LOCKED)
                        reverseConnType |= ConnType.UNLOCK;
                    else if (connType & ConnType.UNLOCK)
                        reverseConnType |= ConnType.LOCKED;
                    else if (connType & ConnType.EXIT_POINT)
                        reverseConnType |= ConnType.SHORTCUT;
                    else if (connType & ConnType.SHORTCUT)
                        reverseConnType |= ConnType.EXIT_POINT;
                    if (connType & ConnType.DEAD_END)
                        reverseConnType |= ConnType.ISOLATED;
                    else if (connType & ConnType.ISOLATED)
                        reverseConnType |= ConnType.DEAD_END;
                }
                connType = reverseConnType;
                if (connType & ignoreTypeFlags)
                    continue;
                typeParams = reverseConnTypeParams;
            }
            connPath.push({
                id: id,
                connType: connType,
                typeParams: typeParams
            });
            ret[id] = connPath;
            checkedNodes.push(id);
            nextGenWorlds.push(worldData[id]);
        }
    }
    return ret;
}

function tryAddNexusPath(matchPaths, existingMatchPaths, worldData, sourceId, targetId) {
    const nexusWorldName = "The Nexus";
    const nexusWorldId = worldData.filter(w => w.title === nexusWorldName)[0].id;

    if (sourceId !== nexusWorldId) {
        isDebug && console.log("Searching for paths eligible for Eyeball Bomb Nexus shortcut...");
        const nexusPaths = existingMatchPaths.concat(matchPaths).filter(p => (p.length > targetId !== nexusWorldId ? 2 : 3) && p.filter(w => w.id === nexusWorldId).length);
        if (nexusPaths.length) {
            isDebug && console.log("Found", nexusPaths.length, "paths eligible for Eyeball Bomb Nexus shortcut: creating shortcut paths");
            for (let nexusPath of nexusPaths) {
                const nexusWorldIndex = nexusPath.indexOf(nexusPath.filter(w => w.id === nexusWorldId)[0]);
                const nexusShortcutPath = _.cloneDeep([nexusPath[0]].concat(nexusPath.slice(nexusWorldIndex)));
                const nexusSource = nexusShortcutPath[0];
                nexusSource.connType = (nexusWorldIndex > 1 ? ConnType.ONE_WAY : 0) | ConnType.EFFECT;
                nexusSource.typeParams = {};
                nexusSource.typeParams[ConnType.EFFECT] = {
                    params: 'Eyeball Bomb',
                    paramsJP: effectsJP['Eyeball Bomb']
                };
                matchPaths.push(nexusShortcutPath);
                return true;
            }
        }
    }

    return false;
}

function findRealPathDepth(paths, worldId, pathWorldIds, worldDepthsMap, maxDepth, minDepth, ignoreTypeFlags) {
    let ret = -1;

    if (minDepth == maxDepth)
        return minDepth;

    if (!ignoreTypeFlags)
        ignoreTypeFlags = defaultPathIgnoreConnTypeFlags;
    else if (ignoreTypeFlags & ConnType.LOCKED || ignoreTypeFlags & ConnType.LOCKED_CONDITION || ignoreTypeFlags & ConnType.EXIT_POINT)
        ignoreTypeFlags ^= ConnType.LOCKED | ConnType.LOCKED_CONDITION | ConnType.EXIT_POINT;
    else if (ignoreTypeFlags & ConnType.DEAD_END)
        ignoreTypeFlags ^= ConnType.DEAD_END | ConnType.ISOLATED;
    else
        return minDepth;
    
    for (let p in paths)
    {
        if (worldDepthsMap[p] === -1)
             continue;

        const path = paths[p];
        const pathWorldDepth = pathWorldIds[p].indexOf(worldId);

        if (pathWorldDepth)
        {
            let skipPath = pathWorldDepth > 0 && path.slice(0, pathWorldDepth).filter(w => w.connType & ignoreTypeFlags).length;
            if (skipPath)
                continue;
        }

        if (ret === -1 || pathWorldDepth < ret)
            ret = pathWorldDepth;
    }

    return ret > -1 ? ret : findRealPathDepth(paths, worldId, pathWorldIds, worldDepthsMap, maxDepth, minDepth, ignoreTypeFlags);
}

function getMissingConnections() {
    const ret = [];
    const connData = {};
    
    worldData.forEach(w => {
        connData[w.id] = [];
        worldData[w.id].connections.map(c => worldData[c.targetId]).forEach(c => connData[w.id].push(c.id));
    });

    Object.keys(connData).forEach(id => {
        let connIds = connData[id].slice(0);
        connIds.forEach(c => {
            const index = connData[c].indexOf(parseInt(id));
            if (index > -1) {
                connData[id].splice(connData[id].indexOf(c), 1);
                connData[c].splice(index, 1);
            }
        });
    });

    Object.keys(connData).forEach(id => {
        if (connData[id].length)
            connData[id].forEach(c => ret.push(`${getWorldLinkForAdmin(worldData[c])} is missing a connection to ${getWorldLinkForAdmin(worldData[id])}`));
    });

    return ret;
}

function getInvalidConnectionPairs() {
    const ret = [];

    const checkedReverseConnIds = [];
    const expectedReverseConnTypes = {};

    var addConnTypePair = function(x, y) {
        expectedReverseConnTypes[x] = y;
        expectedReverseConnTypes[y] = x;
    };

    addConnTypePair(ConnType.ONE_WAY, ConnType.NO_ENTRY);
    addConnTypePair(ConnType.UNLOCK, ConnType.LOCKED);
    addConnTypePair(ConnType.DEAD_END, ConnType.ISOLATED);
    addConnTypePair(ConnType.SHORTCUT, ConnType.EXIT_POINT);
    
    worldData.forEach(w =>
        worldData[w.id].connections.forEach(c => {
            const connId = `${w.id}_${c.targetId}`;
            if (checkedReverseConnIds.indexOf(connId) === -1) {
                const conns = worldData[c.targetId].connections;
                for (let reverseConn of conns) {
                    if (reverseConn.targetId === w.id) {
                        const reverseConnId = `${c.targetId}_${w.id}`;
                        Object.keys(expectedReverseConnTypes).forEach(ct => {
                            const connType = parseInt(ct);
                            const expectedReverseConnType = expectedReverseConnTypes[ct];
                            if (c.type & connType && !(reverseConn.type & expectedReverseConnType))
                                ret.push(`${localizedConns[ct].name} connection between ${getWorldLinkForAdmin(worldData[w.id])} and ${getWorldLinkForAdmin(worldData[c.targetId])} expects ${localizedConns[expectedReverseConnType + ''].name} connection on the opposite side`);
                            else if (reverseConn.type & connType && !(c.type & expectedReverseConnType))
                                ret.push(`${localizedConns[ct].name} connection between ${getWorldLinkForAdmin(worldData[c.targetId])} and ${getWorldLinkForAdmin(worldData[w.id])} expects ${localizedConns[expectedReverseConnType + ''].name} connection on the opposite side`);
                        });
                        checkedReverseConnIds.push(reverseConnId);
                        break;
                    }
                }
            }
        })
    );

    return ret;
}

function getMissingLocationParams() {
    const ret = [];

    worldData.forEach(w => {
        if (!w.titleJP || w.titleJP === "None")
            ret.push(`${getWorldLinkForAdmin(w)} is missing its Japanese name parameter`);
            
        w.connections.forEach(conn => {
            const connWorld = worldData[conn.targetId];
            if (conn.type & ConnType.EFFECT) {
                if (!conn.typeParams || !conn.typeParams[ConnType.EFFECT] || !conn.typeParams[ConnType.EFFECT].params)
                    ret.push(`${getWorldLinkForAdmin(w)} is missing the effects parameter for its connection to ${getWorldLinkForAdmin(connWorld)}`);
            }
            if (conn.type & ConnType.CHANCE) {
                if (!conn.typeParams || !conn.typeParams[ConnType.CHANCE] || !conn.typeParams[ConnType.CHANCE].params)
                    ret.push(`${getWorldLinkForAdmin(w)} is missing the chance percentage parameter for its connection to ${getWorldLinkForAdmin(connWorld)}`);
                else if (conn.typeParams[ConnType.CHANCE].params === "0%")
                    ret.push(`${getWorldLinkForAdmin(w)} has a chance percentage parameter of 0% for its connection to ${getWorldLinkForAdmin(connWorld)}`);
            }
            if (conn.type & ConnType.LOCKED_CONDITION) {
                if (!conn.typeParams || !conn.typeParams[ConnType.LOCKED_CONDITION] || !conn.typeParams[ConnType.LOCKED_CONDITION].params)
                    ret.push(`${getWorldLinkForAdmin(w)} is missing the lock condition parameter for its connection to ${getWorldLinkForAdmin(connWorld)}`);
                if (!conn.typeParamsJP || !conn.typeParams[ConnType.LOCKED_CONDITION] || !conn.typeParams[ConnType.LOCKED_CONDITION].paramsJP)
                    ret.push(`${getWorldLinkForAdmin(w)} is missing the Japanese lock condition parameter for its connection to ${getWorldLinkForAdmin(connWorld)}`);
            }
        });
    });

    return ret;
}

function getMissingMapIds() {
    return worldData.filter(w => w.noMaps).map(w => `${getWorldLinkForAdmin(w)} has no associated Map IDs`);
}

function getWorldLinkForAdmin(world) {
    const removedPrefix = world.removed ? '[REMOVED] ' : '';
    return `${removedPrefix}<a class="world-link no-border" href="javascript:void(0);" data-world-id="${world.id}">${world.title}</a>`
}

function initLocalization(isInitial) {
    const isEn = config.lang === "en";

    $("[data-localize]").localize("ui", {
        language: config.lang,
        pathPrefix: "/lang",
        callback: function (data, defaultCallback) {
            data.footer.about = data.footer.about.replace("{VERSION}", "2.11.0");
            const formatDate = (date) => date.toLocaleString(isEn ? "en-US" : "ja-JP", { timeZoneName: "short" });
            data.footer.lastUpdate = data.footer.lastUpdate.replace("{LAST_UPDATE}", isInitial ? "" : formatDate(lastUpdate));
            data.footer.lastFullUpdate = data.footer.lastFullUpdate.replace("{LAST_FULL_UPDATE}", isInitial ? "" : formatDate(lastFullUpdate));
            if (config.lang === "ja") {
                convertJPControlLabels(data.controls);
                convertJPControlLabels(data.collectableControls);
                convertJPControlLabels(data.settings);
            }
            localizedConns = data.conn;
            initContextMenu(data.contextMenu);
            localizedNodeLabel = getLocalizedNodeLabel(data.nodeLabel);
            localizedPathNodeLabel = getLocalizedNodeLabel(data.nodeLabel, true)
            localizedUnknownAuthor = data.controls.author.values[''];
            if (isInitial) {
                Object.keys(data.settings.uiTheme.values).forEach(t => {
                    $(".js--ui-theme").append('<option data-localize="settings.uiTheme.values.' + t + '" value="' + t + '">' + data.settings.uiTheme.values[t] + '</option>');
                });
                $(".js--ui-theme").val(config.uiTheme).trigger("change");
            } else
                initAuthorSelectOptions(localizedUnknownAuthor);
            window.setTimeout(() => updateControlsContainer(true), 0);
            defaultCallback(data);
        }
    });

    $(".js--help-modal__content--localized--en").toggle(isEn);
    $(".js--help-modal__content--localized--jp").toggle(!isEn);

    $.localize("conn", {
        language: config.lang,
        pathPrefix: "/lang",
        callback: function (data) {
            localizedConns = data;
        }
    });

    if (isInitial) {
        $.localize("effect", {
            language: 'ja',
            pathPrefix: "/lang",
            callback: function (data) {
                effectsJP = data;
            }
        });
    } else {
        worldsByName = isEn ? _.keyBy(worldData, w => w.title) : _.keyBy(worldData, w => w.titleJP || w.title);

        worldNames = Object.keys(worldsByName);
    }

    $(".js--world-input").each(function() {
        const val = $(this).val();
        if (val && worldNames.indexOf(val) > -1) {
            const world = worldsByName[worldNames[worldNames.indexOf(val)]];
            $(this).val(isEn || !world.titleJP ? world.title : world.titleJP);
        }
    });

    $(".js--path--world-input").each(function () {
        $(this).off("change").devbridgeAutocomplete("destroy");
        $(this).on("change", function () {
            const currentWorldId = $(this).is(".js--start-world") ? startWorldId : endWorldId;
            const currentWorld = worldData[currentWorldId];
            if (currentWorld != null && $(this).val() !== (config.lang === 'en' || !currentWorld.titleJP ? currentWorld.title : currentWorld.titleJP)) {
                let isReloadGraph;
                $(this).removeClass("selected");
                if ($(this).is(".js--start-world")) {
                    isReloadGraph = endWorldId != null && endWorldId !== startWorldId;
                    startWorldId = null;
                } else {
                    isReloadGraph = startWorldId != null && startWorldId !== endWorldId;
                    endWorldId = null;
                }
                if (isReloadGraph)
                    reloadGraph();
            }
        }).devbridgeAutocomplete({
            lookup: worldNames,
            triggerSelectOnValidInput: false,
            onSelect: function (selectedWorld) {
                let isReloadGraph;
                const worldId = worldsByName[selectedWorld.value].id;
                $(this).addClass("selected");
                if ($(this).is(".js--start-world")) {
                    startWorldId = worldId;
                    isReloadGraph = endWorldId != null && endWorldId !== startWorldId;
                } else {
                    endWorldId = worldId;
                    isReloadGraph = startWorldId != null && startWorldId !== endWorldId;
                }
                if (isReloadGraph)
                    reloadGraph();
            }
        });
    });
}

function convertJPControlLabels(data) {
    if (data) {
        Object.keys(data).forEach(function (key) {
            const value = data[key];
            if (value) {
                switch (typeof value) {
                    case "object":
                        convertJPControlLabels(value);
                        break;
                    case "string":
                        if (value.indexOf(" ") > -1)
                            data[key] = value.split(/ +/g).map(v => `<span class="jp-word-break">${v}</span>`).join("");
                        break;
                }
            }
        });
    }
}

function initWorldSearch() {
    const $search = $(".js--search-world");
    $search.devbridgeAutocomplete("destroy");
    const visibleWorldNames = worldData ? worldData.filter(w => visibleWorldIds.indexOf(w.id) > -1).map(w => config.lang === 'en' || !w.titleJP ? w.title : w.titleJP) : [];
    if (selectedWorldId != null && visibleWorldIds.indexOf(selectedWorldId) === -1) {
        $search.removeClass("selected").val("");
        selectedWorldId = null;
    }
    $search.devbridgeAutocomplete({
        lookup: visibleWorldNames,
        triggerSelectOnValidInput: false,
        onSearchComplete: function (query, searchWorlds) {
            const selectedWorld = selectedWorldId != null ? worldData[selectedWorldId] : null;
            const selectedWorldName = selectedWorld ? config.lang === 'en' || !selectedWorld.titleJP ? selectedWorld.title : selectedWorld.titleJP : null;
            searchWorldIds = searchWorlds.length && (!selectedWorld || (searchWorlds.length > 1 || searchWorlds.filter(w => w.value !== selectedWorldName).length)) ? searchWorlds.map(w => worldsByName[w.value].id) : [];
            if (searchWorldIds.length && selectedWorld && (searchWorldIds.length !== 1 || selectedWorldId !== searchWorldIds[0])) {
                $search.removeClass("selected");
                selectedWorldId = null;
            }
            highlightWorldSelection();
        },
        onSelect: function (selectedWorld) {
            $search.addClass("selected");
            const worldId = worldsByName[selectedWorld.value].id;
            trySelectNode(graph.graphData().nodes.filter(n => n.id === worldId)[0], false, true);
        },
        onHide: function () {
           if (selectedWorldId != null) {
                const selectedWorld = worldData[selectedWorldId];
                const selectedWorldName = config.lang === 'en' || !selectedWorld.titleJP ? selectedWorld.title : selectedWorld.titleJP;
                if ($(this).val() !== selectedWorldName) {
                    $search.removeClass("selected");
                    selectedWorldId = null;
                }
            }
            searchWorldIds = [];
            highlightWorldSelection();
        }
    });
}

function initAuthorSelectOptions(localizedEmptyAuthor) {
    const authors = _.uniq(worldData.map(w => w.author)).sort((a, b) => {
        const authorA = a ? a.toUpperCase() : 'ZZZ';
        const authorB = b ? b.toUpperCase() : 'ZZZ';
        return (authorA < authorB) ? -1 : (authorA > authorB) ? 1 : 0;
    });
    const $authorSelect = $('.js--author');
    $authorSelect.find('option:not(:first-child)').remove();
    authors.forEach(a => {
        const $opt = $('<option>');
        $opt.val(a || '');
        $opt.text(a || localizedEmptyAuthor);
        $authorSelect.append($opt);
    });
    if (selectedAuthor === '')
        $authorSelect.val('');
    else if (selectedAuthor) {
        const validAuthor = authors.indexOf(selectedAuthor) > -1;
        if (!validAuthor)
            selectedAuthor = null;
        $authorSelect.val(validAuthor ? selectedAuthor : 'null');
    }
}

function initContextMenu(localizedContextMenu) {
    $.contextMenu('destroy');
    $.contextMenu({
        selector: '.graph canvas', 
        trigger: 'none',
        items: {
            "wiki": {
                name: () => localizedContextMenu.items.wiki,
                callback: () => openWorldWikiPage(contextWorldId)
            },
            "start": {
                name: () => localizedContextMenu.items.start,
                callback: function () {
                    const world = worldData[contextWorldId];
                    const worldName = config.lang === 'en' || !world.titleJP ? world.title : world.titleJP;
                    $(".js--start-world").val(worldName).trigger("change").devbridgeAutocomplete().select(0);
                }
            },
            "end": {
                name: () => localizedContextMenu.items.end,
                callback: function () {
                    const world = worldData[contextWorldId];
                    const worldName = config.lang === 'en' || !world.titleJP ? world.title : world.titleJP;
                    $(".js--end-world").val(worldName).trigger("change").devbridgeAutocomplete().select(0);
                }
            }
        }
    });
}

function openWorldWikiPage(worldId, newWindow) {
    const world = worldData[worldId];
    window.open(config.lang === 'en' || !world.titleJP || world.removed
        ? 'https://yume2kki.fandom.com/wiki/' + world.title
        : ('https://wikiwiki.jp/yume2kki-t/' + (world.titleJP.indexOf("：") > -1 ? world.titleJP.slice(0, world.titleJP.indexOf("：")) : world.titleJP)),
        "_blank", newWindow ? "width=" + window.outerWidth + ",height=" + window.outerHeight : "");
}

function trySelectNode(node, forceFocus, ignoreSearch) {
    if (node == null)
        return false;
    if (!node.hasOwnProperty("id")) {
        const nodes = graph.graphData().nodes.filter(n => n.id === node);
        if (!nodes.length)
            return false;
        node = nodes[0];
    }
    const world = worldData[node.id];
    selectedWorldId = world.id;
    if ((node && (selectedWorldId == null || selectedWorldId !== node.id))) {
        if (!ignoreSearch)
            $(".js--search-world").addClass("selected").val(config.lang === 'en' || !world.titleJP ? world.title : world.titleJP);
        if (forceFocus)
            focusNode(node);
    } else
        focusNode(node);
    highlightWorldSelection();
    return true;
}

function focusNode(node) {
    const scale = worldScales[node.id];
    const distance = 50 * scale;
    if (!config.renderMode) {
        const camera = graph.camera();
        graph.cameraPosition({ x: node.x, y: node.y, z: distance }, node, 1000);
        const oldZoom = { zoom: camera.zoom };
        const newZoom = { zoom: 20 / scale };
        new TWEEN.Tween(oldZoom).to(newZoom, graph.controls().zoomSpeed * 1000).easing(TWEEN.Easing.Quadratic.Out).onUpdate(zoom => {
            camera.zoom = zoom.zoom;
            camera.updateProjectionMatrix();
        }).start();
    } else {
        const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
        graph.cameraPosition({ x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, node, 1000);
    }
}

function updateConnectionModeIcons(links) {
    if (!links)
        links = graph ? graph.graphData().links : [];
    if (!links.length)
        return;
    if (isWebGL2 && iconObject) {
        iconObject.geometry.attributes.opacity.array.set(unsortedIconOpacities, 0);
        iconObject.geometry.attributes.grayscale.array.set(unsortedIconGrayscales, 0);
        let opacities = iconObject.geometry.attributes.opacity.array;
        let grayscales = iconObject.geometry.attributes.grayscale.array;
        links.forEach(link => {
            const linkOpacity = getLinkOpacity(link);
            const linkGrayscale = getLinkGrayscale(link);
            link.icons.forEach(icon => {
                opacities[icon.id] = linkOpacity;
                grayscales[icon.id] = linkGrayscale;
                if (config.connMode === 0 && link.hidden)
                    opacities[icon.id] = 0;
            });
        });
        unsortedIconOpacities = opacities.slice();
        unsortedIconGrayscales = grayscales.slice();
        iconObject.geometry.attributes.opacity.needsUpdate = true;
        iconObject.geometry.attributes.grayscale.needsUpdate = true;
    } else {
        links.forEach(link => {
            if (icons3D[link.key] !== undefined) {
                const linkOpacity = getLinkOpacity(link);
                const linkGrayscale = getLinkGrayscale(link);
                icons3D[link.key].forEach(icon => {
                    icon.visible = true;
                    icon.material.opacity = linkOpacity;
                    icon.material.grayScale = linkGrayscale;
                    if (config.connMode === 0 && link.hidden)
                        icon.visible = false;
                });
            }
        });
    }
}

function highlightWorldSelection() {
    updateConnectionModeIcons();
    let index = 0;
    graph.graphData().nodes.forEach(node => {
        const nodeOpacity = getNodeOpacity(node.id);
        const nodeGrayscale = getNodeGrayscale(node);
        if (nodeObject) {
            nodeObject.geometry.attributes.opacity.array[index] = nodeOpacity;
            nodeObject.geometry.attributes.grayscale.array[index] = nodeGrayscale;
        } else {
            node.__threeObj.material.opacity = nodeOpacity;
            node.__threeObj.material.grayscale = nodeGrayscale;
        }
        index++;
    });
    if (nodeObject) {
        nodeObject.geometry.attributes.opacity.needsUpdate = true;
        nodeObject.geometry.attributes.grayscale.needsUpdate = true;
    }
    updateLinkColors(visibleTwoWayLinks, linksTwoWayBuffered);
    updateLinkColors(visibleOneWayLinks, linksOneWayBuffered);
    if (isWebGL2 && is2d)
        updateNodeLabels2D();
}

export let worldsByName;

let worldNames, minSize, maxSize;

function onDocumentMouseMove(event) {
    updateRaycast();
    // update the mouse variable
    mousePos.clientX = event.clientX;
    mousePos.clientY = event.clientY;
    mousePos.x = (event.clientX / window.innerWidth) * 2 - 1;
    mousePos.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function clearTweens() {
    TWEEN._tweens = {};
}

function updateRaycast() {
    const vector = new THREE.Vector3(mousePos.x, mousePos.y, 1);
    let intersects = [];

    if (!$(".modal:visible").length) {
        raycaster.setFromCamera(vector, graph.camera());
        // create an array containing all objects in the scene with which the ray intersects
        if (isWebGL2)
            intersects = raycaster.intersectObject(iconObject);
        else
            intersects = raycaster.intersectObjects(graph.graphData().nodes.map(node => node.__threeObj).filter(o => o).concat(graph.scene().children.filter(o => o.__graphObjType === 'icon' && o.visible)));
    }

    // if there are one or more intersections
    if (intersects.length)
    {
        if (isWebGL2) {
            const topInstanceId = intersects[0].instanceId;
            if (iconObject.geometry.attributes.opacity.array[topInstanceId] < 1)
                return;
            const index = sortedIconIds[topInstanceId];
            const text = iconTexts[index];
            $(".graph .scene-tooltip").css("visibility", "hidden");
            if (text !== undefined) {
                const viewPortCoords = {
                    x: mousePos.clientX,
                    y: mousePos.clientY
                };
                iconLabel.innerHTML = text;
                iconLabel.style.left = viewPortCoords.x + (mousePos.x + 1) * iconLabel.offsetWidth * -0.5;
                iconLabel.style.top = viewPortCoords.y + 21;
            }
            return;
        } else {
            const topObj = intersects[0];
            if (topObj.object.__graphObjType !== "node") {
                $(".graph .scene-tooltip").css("visibility", "hidden"); 
                // update text, if it has a "name" field.
                if (topObj.object.name) {
                    const viewPortCoords = {
                        x: mousePos.clientX,
                        y: mousePos.clientY
                    };
                    iconLabel.innerHTML = intersects[0].object.name;
                    iconLabel.style.left = viewPortCoords.x + (mousePos.x + 1) * iconLabel.offsetWidth * -0.5;
                    iconLabel.style.top = viewPortCoords.y + 21;
                }
                return;
            }
        }
    }
    iconLabel.innerHTML = '';
    $(".graph .scene-tooltip").css("visibility", "visible");
}

function openHelpModal() {
    $(".js--help-modal").modal({
        fadeDuration: 100,
        closeClass: 'noselect',
        closeText: '✖'
    });
}

function initControls() {
    $(".controls-bottom--container--tab__button").on("click", function() {
        if ($(".controls-bottom").hasClass("visible")) {
            $(".controls-bottom").removeClass("visible").animateCss("slideOutDown", 250, function () {
                if (!$(this).hasClass("visible"))
                    $(this).css("opacity", 0);
            });
            $(".controls-bottom--container--tab, .footer").css("margin-top", "0px").animateCss("slideInDown", 300);
            $(".modal").css("transition", "height 0.3s ease-out, margin-top 0.3s ease-out");
        } else {
            const settingsHeight = $(".controls-bottom").outerHeight() + 8;
            $(".controls-bottom").addClass("visible").css("opacity", 1).animateCss("slideInUp", 250);
            $(".controls-bottom--container--tab, .footer").css("margin-top", "-" + settingsHeight + "px").animateCss("slideInUp", 250);
            $(".modal").css("transition", "height 0.25s ease-out, margin-top 0.25s ease-out");
        }
        updateControlsContainer();
    });

    $(".controls-side--container--tab__button").on("click", function() {
        if ($(".controls-side").hasClass("visible")) {
            $(".controls-side").removeClass("visible").animateCss("slideOutRight", 250, function () {
                if (!$(this).hasClass("visible"))
                    $(this).css("opacity", 0);
            });
            $(".controls-side--container--tab").css("margin-left", "0px").animateCss("slideInLeft", 300);
            $(".modal").css("transition", "max-width 0.3s ease-out, margin-left 0.3s ease-out, margin-right 0.3s ease-out");
        } else {
            $(".controls-side").addClass("visible").css("opacity", 1).animateCss("slideInRight", 250);
            $(".controls-side--container--tab").css("margin-left", "-" + ($(".controls-side").outerWidth() + 8) + "px").animateCss("slideInRight", 250);
            $(".modal").css("transition", "max-width 0.25s ease-out, margin-left 0.25s ease-out, margin-right 0.25s ease-out");
        }
        updateControlsContainer();
    });

    updateControlsContainer(true);

    $(window).on("resize", updateControlsContainer).on("blur", function() {
        isShift = false;
        isCtrl = false;
    });

    const onModalShown = function () {
        const $modalContent = $(this).find(".modal__content");
        $modalContent.css("padding-right", $modalContent[0].scrollHeight > $modalContent[0].clientHeight ? "24px" : null);
    };

    $(document).on($.modal.OPEN, ".modal", onModalShown);
    
    $(".js--lang").on("change", function() {
        config.lang = $(this).val();
        updateConfig(config);

        const loadCallback = displayLoadingAnim($("#graphContainer"));
        const callback = function () {
            if (worldData) {
                reloadGraph();
                loadCallback();
            }
        };

        if ($(".modal:visible").length)
            $.modal.close();

        initLocalization();

        if (isWebGL2)
            initNodeObjectMaterial().then(() => callback()).catch(err => console.error(err));
        else if (worldData)
            callback();
    });

    $(".js--ui-theme").on("change", function() {
        config.uiTheme = $(this).val();
        const themeStyles = $(".js--theme-styles")[0];
        getBaseBgColor(config.uiTheme || (config.uiTheme = "Default_Custom"), function (color) {
            const bgColorPixel = uiThemeBgColors[config.uiTheme];
            const altColor = "rgba(" + Math.min(bgColorPixel[0] + 48, 255) + ", " + Math.min(bgColorPixel[1] + 48, 255) + ", " + Math.min(bgColorPixel[2] + 48, 255) + ", 1)";
            themeStyles.textContent = themeStyles.textContent.replace(/url\(\/images\/ui\/[a-zA-Z0-9\_]+\/(containerbg|border(?:2)?|font\d)\.png\)/g, "url(/images/ui/" + config.uiTheme + "/$1.png)")
                .replace(/background-color:( *)[^;!]*(!important)?;( *)\/\*base\*\//g, "background-color:$1" + color + "$2;$3/*base*/")
                .replace(/background-color:( *)[^;!]*(!important)?;( *)\/\*alt\*\//g, "background-color:$1" + altColor + "$2;$3/*alt*/");
            $(".js--font-style").trigger("change");
            updateConfig(config);
        });
    });

    $(".js--font-style").on("change", function() {
        config.fontStyle = parseInt($(this).val());
        const themeStyles = $(".js--theme-styles")[0];
        getFontColor(config.uiTheme, config.fontStyle, function (baseColor) {
            const altFontStyle = config.fontStyle !== 4 ? 4 : 0;
            getFontColor(config.uiTheme, altFontStyle, function (altColor) {
                themeStyles.textContent = themeStyles.textContent = themeStyles.textContent = themeStyles.textContent
                    .replace(/url\(\/images\/ui\/([a-zA-Z0-9\_]+)\/font\d\.png\)( *!important)?;( *)\/\*base\*\//g, "url(/images/ui/$1/font" + (config.fontStyle + 1) + ".png)$2;$3/*base*/")
                    .replace(/url\(\/images\/ui\/([a-zA-Z0-9\_]+)\/font\d\.png\)( *!important)?;( *)\/\*alt\*\//g, "url(/images/ui/$1/font" + (altFontStyle + 1) + ".png)$2;$3/*alt*/")
                    .replace(/([^\-])color:( *)[^;!]*(!important)?;( *)\/\*base\*\//g, "$1color:$2" + baseColor + "$3;$4/*base*/")
                    .replace(/([^\-])color:( *)[^;!]*(!important)?;( *)\/\*alt\*\//g, "$1color:$2" + altColor + "$3;$4/*alt*/");
                updateConfig(config);
            });
        });
    });

    $(".js--render-mode").on("change", function() {
        config.renderMode = parseInt($(this).val());
        updateConfig(config);
        if (worldData)
            reloadGraph();
    });

    $(".js--display-mode").on("change", function() {
        config.displayMode = parseInt($(this).val());
        updateConfig(config);
        if (worldData)
            reloadGraph();
        $(".js--stack-size--container").css("display", config.displayMode < 2 ? "flex" : "none");
    });

    $(".js--conn-mode").on("change", function() {
        config.connMode = parseInt($(this).val());
        updateConfig(config);
        updateConnectionModeIcons();
    });

    $(".js--label-mode").on("change", function() {
        config.labelMode = parseInt($(this).val());
        updateConfig(config);
        if (isWebGL2 && is2d)
            updateNodeLabels2D();
        if (!config.labelMode) {
            if (!isWebGL2 || !is2d) {
                graph.graphData().nodes.forEach(node => {
                    const obj = node.__threeObj;
                    if (obj)
                        obj.children[0].visible = false;
                });
            }
        }
    });

    $(".js--removed-content-mode").on("change", function() {
        config.removedContentMode = parseInt($(this).val());
        $(".js--removed-content").toggleClass("display--none", !config.removedContentMode);
        updateConfig(config);
        if (worldData) {
            if ($(".modal:visible").length)
                $.modal.close();
            reloadData(false);
        }
    });

    $(".js--path-mode").on("change", function() {
        config.pathMode = parseInt($(this).val());
        updateConfig(config);
        if (worldData && startWorldId != null && endWorldId != null)
            reloadGraph();
    });

    $(".js--size-diff").on("change", function() {
        config.sizeDiff = parseFloat($(this).val());
        updateConfig(config);
        if (worldData)
            reloadGraph();
    });

    $(".js--stack-size").on("change", function() {
        config.stackSize = parseInt($(this).val());
        updateConfig(config);
        if (worldData)
            reloadGraph();
    });

    $(".js--author").on("change", function() {
        selectedAuthor = $(this).val() !== "null" ? $(this).val() || "" : null;
        if (worldData)
            highlightWorldSelection();
    });

    $(".js--menu-themes").on("click", function() {
        if (menuThemeData && menuThemeData.length) {
            if ($(".js--menu-themes-modal:visible").length)
                $.modal.close();
            else
                $(".js--menu-themes-modal").modal({
                    fadeDuration: 100,
                    closeClass: 'noselect',
                    closeText: '✖'
                });
        }
    });

    $(".js--reset").on("click", function() {
        $(".js--world-input").removeClass("selected").val("");
        $(".js--author").val("null");
        startWorldId = null;
        endWorldId = null;
        hoverWorldId = null;
        selectedWorldId = null;
        selectedAuthor = null;
        if (worldData)
            reloadGraph();
    });

    $(".js--help").on("click", function() {
        if ($(".js--help-modal:visible").length)
            $.modal.close();
        else if ($(".js--help-modal__content--localized").text())
            openHelpModal();
        else {
            $.get("/help", function (data) {
                const md = new Remarkable();
                data = data.split('---');
                const helpEn = md.render(data[0]);
                const helpJp = data.length > 1 ? md.render(data[1]) : helpEn;
                $('.js--help-modal__content--localized').html('<div class="js--help-modal__content--localized--en"' + (config.lang === 'en' ? '' : ' style="display: none;"') + '>' + helpEn + '</div>'
                    + '<div class="js--help-modal__content--localized--jp"' + (config.lang === 'en' ? ' style="display: none;"' : '') + '>' + helpJp + '</div>');
                openHelpModal();
            });
        }
    });
}

function initAdminControls() {
    $(".js--check-data-issues").on("click", function() {
        if ($(".js--data-issues-modal:visible").length) {
            $.modal.close();
            return;
        }

        $(".js--data-issues-modal").modal({
            fadeDuration: 100,
            closeClass: 'noselect',
            closeText: '✖'
        });

        const dataIssues = {
            "missing-conns": {
                data: getMissingConnections(),
                emptyMessage: "No missing connections found"
            },
            "invalid-conn-pairs": {
                data: getInvalidConnectionPairs(),
                emptyMessage: "No invalid connection pairs found"
            },
            "missing-location-params": {
                data: getMissingLocationParams(),
                emptyMessage: "No missing location parameters found"
            },
            "missing-map-ids": {
                data: getMissingMapIds(),
                emptyMessage: "No locations with missing map IDs found"
            }
        };

        Object.keys(dataIssues).forEach(di => {
            const data = dataIssues[di].data;
            const $dataList = $("<ul></ul>");
            if (data.length) {
                for (let d of data)
                    $dataList.append(`<li>${d}</li>`);
            } else
                $dataList.append(`<li>${dataIssues[di].emptyMessage}</li>`);
            $(".js--data-issues__" + di).html($dataList);
        });
    });

    $(".js--update-data, .js--reset-data").on("click", function() {
        if ($(".modal:visible").length)
            $.modal.close();
        const isReset = $(this).hasClass("js--reset-data");
        reloadData(isReset ? "reset" : true);
    });

    $(document).on("click", "a.world-link", function () {
        openWorldWikiPage($(this).data("worldId"), isShift);
    });
}

function displayLoadingAnim($container) {
    const $existingLoadingContainer = $container.find(".loading-container");
    const $loadingContainer = $(`
        <div class="loading-container">
            <span class="loading-container__text loading-container__text--loading"><span data-localize="loading.label" class="loading-container__text__main">Loading</span><span data-localize="loading.space" class="loading-container__text__append">   </span></span>
            <span class="loading-container__text loading-container__text--error" data-localize="loading.error" style="display: none;"></span>
            <img src="images/urowalk.gif" />
        </div>`);
    if ($existingLoadingContainer.length)
        $existingLoadingContainer.remove();
    const $content = $container.children();
    $content.addClass("display--none");
    $container.prepend($loadingContainer);

    let loadingFrameCount = 0;
    const updateLoadingText = function () {
        let loadingTextAppend = "";
        const loadingTextAppendChar = config.lang === "en" ? "." : "．";
        const loadingTextSpaceChar = config.lang === "en" ? " " : "　";
        for (let i = 0; i < 3; i++)
            loadingTextAppend += i < loadingFrameCount ? loadingTextAppendChar : loadingTextSpaceChar;
        $loadingContainer.find(".loading-container__text__append").text(loadingTextAppend);
        loadingFrameCount += loadingFrameCount < 3 ? 1 : -3;
    };
    updateLoadingText();
    const loadingTimer = window.setInterval(updateLoadingText, 300);

    return function (error) {
        if (error) {
            window.clearInterval(loadingTimer);
            $loadingContainer.find(".loading-container .loading-container__text--loading").hide();
            $loadingContainer.find(".loading-container .loading-container__text--error").show();
            $loadingContainer.find(".loading-container img").attr("src", "images/urofaint.gif");
        } else {
            const marginTop = $content.css("marginTop");
            const offsetMarginTop = (($loadingContainer[0].offsetHeight * -1) + (marginTop ? parseInt(marginTop) : 0)) + "px";
            $loadingContainer.animateCss("fadeOut", 250);
            $content.css("marginTop", offsetMarginTop).removeClass("display--none").animateCss("fadeIn", 250, function () {
                window.clearInterval(loadingTimer);
                $content.css("marginTop", marginTop);
                $loadingContainer.remove();
            });
        }
    };
}

$(function () {
    const loadCallback = displayLoadingAnim($("#graphContainer"));

    initControls();

    loadOrInitConfig();

    initLocalization(true);

    loadData(false, function (data) {
        initWorldData(data.worldData);
        initMenuThemeData(data.menuThemeData);
        lastUpdate = new Date(data.lastUpdate);
        lastFullUpdate = new Date(data.lastFullUpdate);

        if (data.isAdmin) {
            initAdminControls();
            $('.admin-only').removeClass('admin-only');
        }

        initLocalization();

        graphCanvas = document.createElement('canvas');
        graphContext = graphCanvas.getContext('webgl2');

        isWebGL2 = graphContext != null;

        if (isWebGL2) {
            initNodeObjectMaterial().then(() => {
                reloadGraph();
                loadCallback();
            }).catch(err => console.error(err));
        } else {
            reloadGraph();
            loadCallback();
        }
    }, loadCallback);
});