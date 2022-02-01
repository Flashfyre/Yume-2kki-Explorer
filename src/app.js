import $ from 'jquery';
import 'jquery-localize';
import 'jquery-contextmenu';
import 'devbridge-autocomplete';
import 'jquery-modal';
import 'sortablejs';
import 'jquery-sortablejs';
import { Remarkable } from 'remarkable';
import _ from 'lodash';
import { forceCollide } from 'd3-force';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import ForceGraph3D from '3d-force-graph';
import TWEEN from '@tweenjs/tween.js';
import GreenAudioPlayer from 'green-audio-player/dist/js/green-audio-player';
import { checkIsMobile, formatDate, getLocalizedValue, getLangUsesEn, hueToRGBA, uiThemeFontColors, uiThemeBgColors, getFontColor, getBaseBgColor, getFontShadow } from './utils';
import { updateConfig } from './config.js';
import { ConnType } from './conn-type.js';
import * as versionUtils from './version-utils.js';

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

const urlSearchParams = new URLSearchParams(window.location.search);
const helpLangs = ['en', 'ja', 'ko', 'ru'];
let isDebug = false;
let isShift = false;
let isCtrl = false;
let fontsLoaded = false;
let isWebGL2;
let is2d;
let graphCanvas;
let graphContext;
const nodeImgDimensions = { x: 320, y: 240 };
const nodeIconImgDimensions = { x: nodeImgDimensions.x / 4, y: nodeImgDimensions.y / 4 };
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

const getLocalizedLabel = (enLabel, jaLabel, singleValue) => getLocalizedValue(enLabel, jaLabel, config.lang, singleValue);

const isMobile = checkIsMobile(navigator.userAgent);

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
let missingVersionIndex;
let versionData;
let authoredVersionData;
let authorData;
let effectData;
let menuThemeData;
let wallpaperData;
let bgmTrackData;
let bgmTrackIds;
let bgmTrackIndexesById;

function initWorldData(data) {
    worldData = data;

    removedCount = 0;

    const verAddedWorlds = worldData.filter(w => w.verAdded);
    const versionNames = versionUtils.getUniqueWorldVersionNames(worldData).sort(versionUtils.compareVersionNames).reverse();
    versionData = versionUtils.parseVersionNames(versionNames);

    for (let w in worldData) {
        const world = worldData[w];
        world.id = parseInt(w);
        world.images.unshift(world.filename);
        if (world.verAdded) {
            world.verAdded = versionData[versionNames.indexOf(world.verAdded)];
            world.verAdded.addedWorldIds.push(world.id);
        }
        if (world.verUpdated) {
            world.verUpdated.forEach(vu => {
                vu.verUpdated = versionData[versionNames.indexOf(vu.verUpdated)];
                vu.verUpdated.updatedWorldIds.push(world.id);
            });
        }
        if (world.verRemoved) {
            world.verRemoved = versionData[versionNames.indexOf(world.verRemoved)];
            world.verRemoved.removedWorldIds.push(world.id);
        }
        if (world.verGaps) {
            world.verGaps.forEach(vg => {
                vg.verRemoved = versionData[versionNames.indexOf(vg.verRemoved)];
                vg.verReadded = versionData[versionNames.indexOf(vg.verReadded)];
                vg.verRemoved.removedWorldIds.push(world.id);
                vg.verReadded.addedWorldIds.push(world.id);
            });
        }
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

    if (verAddedWorlds.length < worldData.length)
    {
        versionData.push(versionUtils.getMissingVersion(versionData.length + 1));
        missingVersionIndex = versionData.length;
    } else
        missingVersionIndex = -999;

    const worldSizes = worldData.map(w => w.size); 

    minSize = _.min(worldSizes);
    maxSize = _.max(worldSizes);
}

function initAuthorData(authorInfoData, versionInfoData) {
    const worldSortFunc = versionUtils.getVersionSortFunction(w => w.verAdded, w => w.id, versionData);
    const versionSortFunc = versionUtils.getVersionSortFunction(v => v, v => v.index, versionData);
    const primaryAuthorSortFunc = versionUtils.getVersionSortFunction(a => a.lastVer, _ => 0, versionData);
    const secondaryAuthorSortFunc = versionUtils.getVersionSortFunction(a => a.firstVer, a => a.name, versionData);
    const authorSortFunc = function (a1, a2) {
        let ret = primaryAuthorSortFunc(a1, a2);
        if (ret === 0)
            ret = secondaryAuthorSortFunc(a1, a2);
        return ret;
    }
    const worldsByAuthor = _.groupBy(worldData.filter(w => w.author).sort(worldSortFunc), w => w.author);
    const authors = Object.keys(worldsByAuthor);

    const versionsByName = _.keyBy(versionData, v => v.name);
    const versionsByAuthorNameLower = {};

    authoredVersionData = [];
    
    for (let vi of versionInfoData) {
        if (!vi.authors)
            continue;
        
        if (!versionsByName.hasOwnProperty(vi.name)) {
            const newVer = versionUtils.getEmptyVersion(-1, vi.name);
            if (vi.authors)
                newVer.authors = vi.authors.split(',');
            if (vi.releaseDate) {
                const releaseDate = new Date(vi.releaseDate);
                if (!isNaN(releaseDate))
                    newVer.releaseDate = releaseDate;
            }
            versionsByName[vi.name] = newVer;
            authoredVersionData.push(newVer);
        } else
            authoredVersionData.push(versionsByName[vi.name]);

        authoredVersionData[authoredVersionData.length - 1].authoredIndex = authoredVersionData.length;

        const ver = versionsByName[vi.name];

        ver.authors.forEach(va => {
            const authorNameLower = va.toLowerCase();
            if (!versionsByAuthorNameLower.hasOwnProperty(authorNameLower))
                versionsByAuthorNameLower[authorNameLower] = [];
            versionsByAuthorNameLower[authorNameLower].push(ver);
        });
    }

    authorData = authors.map(a => {
        const authorWorlds = worldsByAuthor[a];
        const authorNameLower = a.toLowerCase();
        const authorVersions = versionsByAuthorNameLower.hasOwnProperty(authorNameLower)
            ? versionsByAuthorNameLower[authorNameLower].sort(versionSortFunc)
            : [];
        const authorInfo = authorInfoData.find(ai => ai.name.toLowerCase() === authorNameLower);
        return {
            name: a,
            displayName: authorInfo ? authorInfo.name : a,
            displayNameJP: authorInfo ? authorInfo.nameJP : null,
            worldIds: authorWorlds.map(w => w.id),
            worldCount: authorWorlds.length,
            firstVer: authorVersions.length ? authorVersions[authorVersions.length - 1] : null,
            lastVer: authorVersions.length ? authorVersions[0] : null
        };
    }).sort(authorSortFunc);

    const $authorEntriesContainerItems = $('.js--author-entries-container__items');
    const $authorEntriesContainerBorders = $('.js--author-entries-container__borders');

    $authorEntriesContainerItems.empty();
    $authorEntriesContainerBorders.empty();

    const authorEntryHtmlTemplate = '<div class="author-entry collectable-entry collectable noselect"></div>';
    const authorEntryImageContainerHtmlTemplate = '<div class="author-entry__image-container collectable-entry__image-container"></div>';
    const authorEntryImageHtmlTemplate = '<img src="{FILENAME}" referrerpolicy="no-referrer" />';
    const authorsByName = {};

    for (let a of authorData) {
        const authorWorldIds = a.worldIds;
        const $authorEntry = $(authorEntryHtmlTemplate);
        const maxDisplayCount = Math.min(authorWorldIds.length, 4);
        if (maxDisplayCount > 1) {
            const $authorEntryImageContainer = $(authorEntryImageContainerHtmlTemplate).addClass(`collectable-entry__image-container--${maxDisplayCount}`);
            const displayWorldIds = getDisplayWorldIdsForEntryImage(authorWorldIds, 4);
            displayWorldIds.forEach(w => {
                const world = worldData[w];
                const $entryImage = $(authorEntryImageHtmlTemplate.replace('{FILENAME}', world.filename));
                if (world.removed)
                    $entryImage.addClass('removed');
                $authorEntryImageContainer.append($entryImage);
            });
            $authorEntry.append($authorEntryImageContainer);
        } else {
            const world = worldData[authorWorldIds[authorWorldIds.length - 1]];
            const $entryImage = $(authorEntryImageHtmlTemplate.replace('{FILENAME}', world.filename));
            if (world.removed)
                $entryImage.addClass('removed');
            $authorEntry.append($entryImage)
        }
        const authorEntryLinkHtml =
            `<a href="javascript:void(0);" class="js--author-entry author-entry collectable-entry collectable--border noselect" data-id="${a.name}" data-display-name="${a.displayName}" data-display-name-jp="${(a.displayNameJP || a.displayName)}">
                <h1 class="author-entry__name--shadow collectable-entry__name--shadow">${a.name}</h1>
                <h1 class="author-entry__name collectable-entry__name">${a.name}</h1>
            </a>`;
        $authorEntry.appendTo($authorEntriesContainerItems);
        $(authorEntryLinkHtml).appendTo($authorEntriesContainerBorders);
        authorsByName[a.name] = a;
    }

    const $tooltip = $('<div class="author-entry-tooltip scene-tooltip display--none"></div>').prependTo('.content');

    $('.js--author-entry[data-id]').on('click', function () {
        $tooltip.addClass('display--none');
        tempSelectAuthor($(this).data('id'));
        $.modal.close();
    });
    
    $('.js--author-entry').on('mousemove', function (e) {
        $tooltip.css({
            top: e.pageY + 10 + 'px',
            left: (e.pageX - ($tooltip.innerWidth() / 2)) + 'px'
        });
    }).on('mouseenter', function () {
        const author = authorsByName[$(this).data('id')];
        $tooltip.html(localizedAuthorLabel
            .replace('{AUTHOR}', getLocalizedLabel(author.displayName, author.displayNameJP))
            .replace('{FIRST_VERSION}', author.firstVer ? getLocalizedLabel(author.firstVer.name, author.firstVer.nameJP, true) : '')
            .replace('{LAST_VERSION}', author.lastVer !== author.firstVer ? getLocalizedLabel(author.lastVer.name, author.lastVer.nameJP, true) : '')
            .replace('{WORLD_COUNT}', author.worldIds.length)
        ).removeClass('display--none');
        if (!author.firstVer)
            $tooltip.find('.js--author-entry-tooltip__first-version').remove();
        if (!author.lastVer || author.lastVer === author.firstVer)
            $tooltip.find('.js--author-entry-tooltip__last-version').remove();
        $($authorEntriesContainerItems.children()[$(this).index()]).addClass('hover');
    }).on('mouseleave', function () {
        $tooltip.addClass('display--none');
        $($authorEntriesContainerItems.children()[$(this).index()]).removeClass('hover');
    });
}

function getAuthorDisplayName(author, appendShi) {
    let ret = author;
    const authorLower = author.toLowerCase();
    const authorNameMatches = !authorData
        ? author
        : authorData.filter(a => a.name.toLowerCase() === authorLower).map(a => {
            if (a.displayName !== a.displayNameJP)
                return getLocalizedLabel(a.displayName, appendShi ? `${a.displayNameJP}氏` : a.displayNameJP);
            return !getLangUsesEn(config.lang) && appendShi ? `${a.displayNameJP}氏` : a.displayName;
        });
    if (authorNameMatches.length)
        ret = authorNameMatches[0];
    return ret;
}

function initVersionData(versionInfoData) {
    const $versionEntriesControls = $('.js--version-entries-controls');
    const $versionEntriesContainerItems = $('.js--version-entries-container__items');
    const $versionEntriesContainerBorders = $('.js--version-entries-container__borders');

    $versionEntriesControls.empty();
    $versionEntriesContainerItems.empty();
    $versionEntriesContainerBorders.empty();

    const versionEntryHtmlTemplate = '<div class="js--version-entry version-entry collectable-entry collectable noselect"></div>';
    const versionEntryImageContainerHtmlTemplate = '<div class="version-entry__image-container collectable-entry__image-container"></div>';
    const versionEntryImageHtmlTemplate = '<img src="{FILENAME}" referrerpolicy="no-referrer" />';
    const versionsByIndex = {};

    const versionIndexAddedWorldIds = {};
    const versionIndexUpdatedWorldIds = {};
    const versionIndexRemovedWorldIds = {};

    for (let v of versionData) {
        if (v.index === missingVersionIndex)
            break;
        if (versionInfoData) {
            for (let vi of versionInfoData) {
                if (vi.name === v.name) {
                    if (vi.authors)
                        v.authors = vi.authors.split(',');
                    if (vi.releaseDate) {
                        const releaseDate = new Date(vi.releaseDate);
                        if (!isNaN(releaseDate))
                            v.releaseDate = releaseDate;
                    }
                    break;
                }
            }
        }
        
        let versionAddedWorldIds = v.addedWorldIds.slice(0);
        let versionUpdatedWorldIds = v.updatedWorldIds.slice(0);
        let versionRemovedWorldIds = v.removedWorldIds.slice(0);

        versionIndexAddedWorldIds[v.index] = versionAddedWorldIds;
        versionIndexUpdatedWorldIds[v.index] = versionUpdatedWorldIds;
        versionIndexRemovedWorldIds[v.index] = versionRemovedWorldIds;

        const versionDisplayToggles = config.versionDisplayToggles;

        const $versionEntry = $(versionEntryHtmlTemplate);
        if (versionAddedWorldIds.length && !versionDisplayToggles.ADD)
            versionAddedWorldIds.slice(0, versionAddedWorldIds.splice(0, versionAddedWorldIds.length));
        if (versionUpdatedWorldIds.length) {
            if (versionDisplayToggles.UPDATE && versionDisplayToggles.UPDATE['']) {
                const updateDisplayToggles = versionDisplayToggles.UPDATE;
                const updateTypeKeys = Object.keys(versionUtils.VersionEntryUpdateType).slice(1);
                for (let utk of updateTypeKeys) {
                    if (!updateDisplayToggles[utk])
                        removeVersionUpdatedWorldIdsOfUpdateTypes(v.name, versionUpdatedWorldIds, versionUtils.VersionEntryUpdateType[utk]);
                }

                const excludeMinorUpdates = (updateDisplayToggles.MINOR_CHANGE || updateDisplayToggles.BUG_FIX) && (versionAddedWorldIds.length || versionRemovedWorldIds.length || versionUpdatedWorldIds.find(
                        vuw => worldData[vuw].verUpdated.find(vu => vu.verUpdated.name === v.name && vu.updateType !== versionUtils.VersionEntryUpdateType.MINOR_CHANGE && vu.updateType !== versionUtils.VersionEntryUpdateType.BUG_FIX)
                    ));
                if (excludeMinorUpdates) {
                    versionUpdatedWorldIds = versionUpdatedWorldIds.slice(0);
                    removeVersionUpdatedWorldIdsOfUpdateTypes(v.name, versionUpdatedWorldIds, [versionUtils.VersionEntryUpdateType.MINOR_CHANGE, versionUtils.VersionEntryUpdateType.BUG_FIX]);
                }
            } else
                versionUpdatedWorldIds.splice(0, versionUpdatedWorldIds.length);
        }
        if (versionRemovedWorldIds.length && !versionDisplayToggles.REMOVE)
            versionRemovedWorldIds.slice(0, versionRemovedWorldIds.splice(0, versionRemovedWorldIds.length));
        if (!versionAddedWorldIds.length && !versionUpdatedWorldIds.length && !versionRemovedWorldIds.length)
            continue;
        if (versionAddedWorldIds.length + versionUpdatedWorldIds.length + versionRemovedWorldIds.length > 1) {
            const maxDisplayCount = Math.min(versionAddedWorldIds.length + versionUpdatedWorldIds.length + versionRemovedWorldIds.length, 4);
            const $versionEntryImageContainer = $(versionEntryImageContainerHtmlTemplate).addClass(`collectable-entry__image-container--${maxDisplayCount}`);
            let addedDisplayCount = maxDisplayCount;
            let updatedDisplayCount = 0;
            let removedDisplayCount = 0;
            if (versionRemovedWorldIds.length) {
                addedDisplayCount = versionAddedWorldIds.length
                    ? Math.min(Math.max(Math.ceil(versionAddedWorldIds.length / versionRemovedWorldIds.length), 1), maxDisplayCount)
                    : 0;
                removedDisplayCount = Math.min(maxDisplayCount - addedDisplayCount, versionRemovedWorldIds.length);
                updatedDisplayCount = maxDisplayCount - (addedDisplayCount + removedDisplayCount);
            } else if (versionUpdatedWorldIds.length) {
                addedDisplayCount = versionAddedWorldIds.length
                    ? Math.min(versionAddedWorldIds.length, maxDisplayCount)
                    : 0;
                updatedDisplayCount = maxDisplayCount - addedDisplayCount;
            }
            const addedDisplayWorldIds = getDisplayWorldIdsForEntryImage(versionAddedWorldIds, addedDisplayCount);
            const updatedDisplayWorldIds = getDisplayWorldIdsForEntryImage(versionUpdatedWorldIds, updatedDisplayCount);
            const removedDisplayWorldIds = getDisplayWorldIdsForEntryImage(versionRemovedWorldIds, removedDisplayCount);
            const displayWorldIds = addedDisplayWorldIds.concat(updatedDisplayWorldIds).concat(removedDisplayWorldIds);
            displayWorldIds.forEach((w, i) => {
                const $entryImage = $(versionEntryImageHtmlTemplate.replace('{FILENAME}', worldData[w].filename));
                if (i >= addedDisplayCount + updatedDisplayCount)
                    $entryImage.addClass('removed');
                $versionEntryImageContainer.append($entryImage);
            });
            $versionEntry.append($versionEntryImageContainer);
        } else {
            const worldId = versionAddedWorldIds.length ? versionAddedWorldIds[0] : versionUpdatedWorldIds.length ? versionUpdatedWorldIds[0] : versionRemovedWorldIds[0];
            const $entryImage = $(versionEntryImageHtmlTemplate.replace('{FILENAME}', worldData[worldId].filename));
            if (versionRemovedWorldIds.length)
                $entryImage.addClass('removed');
            $versionEntry.append($entryImage);
        }
        const $versionEntryLink = $(`
            <div class="js--version-entry--container collectable-entry--container">
                <a href="javascript:void(0);" class="js--version-entry-link version-entry collectable-entry collectable--border noselect" data-id="${v.index}">
                    <div class="collectable-entry__name--container">
                        <h1 class="version-entry__name--shadow collectable-entry__name--shadow">${getLocalizedLabel(v.name, v.nameJP, true)}</h1>
                        <h1 class="version-entry__name collectable-entry__name">${getLocalizedLabel(v.name, v.nameJP, true)}</h1>
                    </div>
                </a>
            </div>
        `);

        const versionDetailsEntries = getVersionDetailsEntries(v);
        
        const $versionEntryContent = $('<div class="js--version-entry--content collectable-entry--content"></div>');
        const $versionEntryContentList = $('<ul class="js--version-entry--content__list collectable-entry--content__list"></ul>');
        for (let vde of versionDetailsEntries)
            $versionEntryContentList.append(`<li class="styled-list-item">${vde}</li>`);
        $versionEntryContent.append($versionEntryContentList);
        $versionEntryLink.append($versionEntryContent);
        $versionEntryLink.append(`
            <button class="js--version-entry--expand collectable-entry--expand noselect">
                <a href="javascript:void(0);" class="tab--arrow tab--right-arrow no-border">&nbsp;</a>
            </button>
        `);
        
        $versionEntry.appendTo($versionEntriesContainerItems);
        $versionEntryLink.appendTo($versionEntriesContainerBorders);
        versionsByIndex[v.index] = v;
    }

    const $tooltip = $('<div class="version-entry-tooltip scene-tooltip display--none"></div>').prependTo('.content');

    $('.js--version-entry-link[data-id]').on('click', function () {
        $tooltip.addClass('display--none');
        tempSelectVersion($(this).data('id'));
        $.modal.close();
    });
    
    $('.js--version-entry-link').on('mousemove', function (e) {
        $tooltip.css({
            top: e.pageY + 10 + 'px',
            left: (e.pageX - ($tooltip.innerWidth() / 2)) + 'px'
        });
    }).on('mouseenter', function () {
        const verIndex = $(this).data('id');
        const version = versionsByIndex[verIndex];
        $tooltip.html(localizedVersionLabel
            .replace('{VERSION}', getLocalizedLabel(version.name, version.nameJP, true))
            .replace('{AUTHORS}', version.authors.map(a => `<span class='tooltip__value'>${(a ? getAuthorDisplayName(a, true) : localizedNA)}</span>`).join(localizedComma))
            .replace('{RELEASE_DATE}', version.releaseDate ? formatDate(version.releaseDate, config.lang) : localizedNA)
            .replace('{WORLD_COUNT}', versionIndexAddedWorldIds[verIndex].length)
            .replace('{UPDATED_WORLD_COUNT}', versionIndexUpdatedWorldIds[verIndex].length)
            .replace('{REMOVED_WORLD_COUNT}', versionIndexRemovedWorldIds[verIndex].length)
        ).removeClass('display--none');
        if (!versionIndexAddedWorldIds[verIndex].length)
            $tooltip.find('.js--version-entry-tooltip__world-count').remove();
        if (!versionIndexUpdatedWorldIds[verIndex].length)
            $tooltip.find('.js--version-entry-tooltip__updated-world-count').remove();
        if (!versionIndexRemovedWorldIds[verIndex].length)
            $tooltip.find('.js--version-entry-tooltip__removed-world-count').remove();
        $($versionEntriesContainerItems.children()[$(this).index()]).addClass('hover');
    }).on('mouseleave', function () {
        $tooltip.addClass('display--none');
        $($versionEntriesContainerItems.children()[$(this).index()]).removeClass('hover');
    });

    const entryTypeKeys = Object.keys(versionUtils.VersionEntryType);
    const entryUpdateTypeKeys = Object.keys(versionUtils.VersionEntryUpdateType).slice(1);

    for (let t of entryTypeKeys) {
        const isUpdate = t === 'UPDATE';
        const isEntryTypeChecked = isUpdate ? config.versionDisplayToggles[t][''] : config.versionDisplayToggles[t];
        const $entryTypeCheck = $(`
            <div class="control">
                <input class="checkbox js--version-entries-modal__entry-type-check noselect" type="checkbox" data-entry-type="${t}"${(isEntryTypeChecked ? ' checked' : '')}>
                <button class="checkbox-button noselect"><span></span></button>
                <label>${localizedVersionDisplayToggle.name.replace('{ENTRY_TYPE}', localizedVersionDisplayToggle.entryType[t])}</label>
            </div>
        `);
        $versionEntriesControls.append($entryTypeCheck);
        if (isUpdate && isEntryTypeChecked) {
            for (let ut of entryUpdateTypeKeys) {
                const isEntryUpdateTypeChecked = config.versionDisplayToggles[t][ut];
                const $entryUpdateTypeCheck = $(`
                    <div class="control">
                        <input class="checkbox js--version-entries-modal__entry-update-type-check noselect" type="checkbox" data-entry-type="${t}" data-entry-update-type="${ut}"${(isEntryUpdateTypeChecked ? ' checked' : '')}>
                        <button class="checkbox-button noselect"><span></span></button>
                        <label>${localizedVersionDisplayToggle.name.replace('{ENTRY_TYPE}', localizedVersionDisplayToggle.entryUpdateType[ut])}</label>
                    </div>
                `);
                $versionEntriesControls.append($entryUpdateTypeCheck);
            }
        }
    }

    $('.js--version-entries-modal__entry-type-check').on('change', function() {
        const entryType = $(this).data('entryType');
        if (entryType === 'UPDATE')
            config.versionDisplayToggles[entryType][''] = $(this).prop('checked');
        else
            config.versionDisplayToggles[entryType] = $(this).prop('checked');
        updateConfig(config);
        initVersionData(versionInfoData);
    });

    $('.js--version-entries-modal__entry-update-type-check').on('change', function() {
        config.versionDisplayToggles[$(this).data('entryType')][$(this).data('entryUpdateType')] = $(this).prop('checked');
        updateConfig(config);
        initVersionData(versionInfoData);
    });

    $('.js--version-entry--expand').on('click', function () {
        const $entryContainer = $(this).parent('.js--version-entry--container');
        $(this).prev('.js--version-entry--content').toggleClass('expanded');
        $entryContainer.parent('.js--version-entries-container__borders')
            .prev('.js--version-entries-container__items')
            .children(`.js--version-entry:nth-child(${$entryContainer.index() + 1})`)
            .toggleClass('expanded');
    });
}

function removeVersionUpdatedWorldIdsOfUpdateTypes(verName, versionUpdatedWorldIds, updateTypes) {
    if (!versionUpdatedWorldIds.length)
        return;
    const updateTypeCheckFunc = Array.isArray(updateTypes)
        ? vu => updateTypes.indexOf(vu.updateType) > -1
        : vu => vu.updateType === updateTypes;
    for (let uw = versionUpdatedWorldIds.length - 1; uw >= 0; uw--) {
        if (worldData[versionUpdatedWorldIds[uw]].verUpdated.find(vu => vu.verUpdated.name === verName && updateTypeCheckFunc(vu)))
            versionUpdatedWorldIds.splice(uw, 1);
    }
}

function getVersionDetailsEntries(ver) {
    const ret = [];
    const verIndex = ver.index;

    for (let aw of ver.addedWorldIds)
        ret.push(getVersionDetailsEntryText(aw, versionUtils.VersionEntryType.ADD));

    const updateTypes = Object.values(versionUtils.VersionEntryUpdateType);
    const worldUpdateVers = _.sortBy(
        ver.updatedWorldIds.map(uw => {
            return {
                worldId: uw,
                verUpdated: worldData[uw].verUpdated.find(vu => vu.verUpdated.index === verIndex)
            };
        }).filter(wvu => wvu.verUpdated), wvu => updateTypes.indexOf(wvu.verUpdated.updateType));

    for (let wvu of worldUpdateVers)
        ret.push(getVersionDetailsEntryText(wvu.worldId, versionUtils.VersionEntryType.UPDATE, wvu.verUpdated.updateType));

    for (let rw of ver.removedWorldIds)
        ret.push(getVersionDetailsEntryText(rw, versionUtils.VersionEntryType.REMOVE));

    return ret;
}

function getVersionDetailsEntryText(worldId, entryType, updateType) {
    let ret;
    const versionDetails = localizedVersionDetails[entryType];

    if (entryType === versionUtils.VersionEntryType.UPDATE)
        ret = versionDetails[updateType && versionDetails.hasOwnProperty(updateType) ? updateType : ''];
    else
        ret = versionDetails;

    const world = worldData[worldId];

    return ret.replace('{WORLD}', getLocalizedLabel(world.title, world.titleJP));
}

function getDisplayWorldIdsForEntryImage(worldIds, displayCount) {
    let ret = [];
    if (worldIds.length) {
        const firstWorldId = worldIds[0];
        const lastWorldId = worldIds[worldIds.length - 1];
        switch (Math.min(worldIds.length, displayCount)) {
            case 0:
                break;
            case 1:
                ret = [firstWorldId];
                break;
            case 2:
                ret = [firstWorldId, lastWorldId];
                break;
            case 3:
                ret = [
                    firstWorldId,
                    worldIds[Math.ceil(worldIds.length / 2) - 1],
                    lastWorldId
                ];
                break;
            default:
                ret = [
                    firstWorldId,
                    worldIds[Math.ceil((worldIds.length / 4) * 2) - 1],
                    worldIds[Math.ceil((worldIds.length / 4) * 3) - 1],
                    lastWorldId
                ];
                break;
        }
    }
    return ret;
}

function initEffectData(data) {
    effectData = data;

    const $effectsContainerItems = $('.js--effects-container__items');
    const $effectsContainerBorders = $('.js--effects-container__borders');
    const effectsById = {};

    $effectsContainerItems.empty();
    $effectsContainerBorders.empty();

    for (let e of effectData) {
        const worldIdAttribute = e.worldId != null ? ` data-id="${e.worldId}"` : '';
        const effectImageHtml = `<div class="effect collectable noselect"><img src="${e.filename}" referrerpolicy="no-referrer" /></div>`;
        const effectLinkHtml = `<a href="javascript:void(0);" class="js--effect effect collectable--border noselect" data-effect-id="${e.id}"${worldIdAttribute}></a>`;
        e.method = e.method.replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
        e.methodJP = e.methodJP ? e.methodJP.replace(/<span .*?>(.*?)<\/ *span>/ig, '$1').replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>') : '';
        $(effectImageHtml).appendTo($effectsContainerItems);
        $(effectLinkHtml).appendTo($effectsContainerBorders);
        effectsById[e.id] = e;
    }

    const $tooltip = $('<div class="effect-tooltip scene-tooltip display--none"></div>').prependTo('.content');

    $('.js--effect[data-id]').on('click', function () {
        if (trySelectNode($(this).data('id'), true, true)) {
            $tooltip.addClass('display--none');
            $.modal.close();
        }
    });
    
    $('.js--effect').on('mousemove', function (e) {
        $tooltip.css({
            top: e.pageY + 10 + 'px',
            left: (e.pageX - ($tooltip.innerWidth() / 2)) + 'px'
        });
    }).on('mouseenter', function () {
        const effect = effectsById[$(this).data('effectId')];
        const effectName = getLocalizedLabel(effect.name, effect.nameJP);
        const world = effect.worldId != null ? worldData[effect.worldId] : null;
        const worldName = world ?
            getLocalizedLabel(world.title, world.titleJP)
            : localizedNA;
        const method = getLocalizedLabel(effect.method, effect.methodJP);
        $tooltip.html(localizedEffectLabel
            .replace('{EFFECT}', effectName)
            .replace('{LOCATION}', worldName)
            .replace('{METHOD}', method)).removeClass('display--none');
    }).on('mouseleave', function () {
        $tooltip.addClass('display--none');
    });
}

function initMenuThemeData(data) {
    menuThemeData = data;

    const $menuThemesContainerItems = $('.js--menu-themes-container__items');
    const $menuThemesContainerBorders = $('.js--menu-themes-container__borders');
    const $removedMenuThemesContainerItems = $('.js--removed-menu-themes-container__items');
    const $removedMenuThemesContainerBorders = $('.js--removed-menu-themes-container__borders');
    const menuThemeLocationsById = {};

    $menuThemesContainerItems.empty();
    $menuThemesContainerBorders.empty();
    $removedMenuThemesContainerItems.empty();
    $removedMenuThemesContainerBorders.empty();

    for (let m of menuThemeData) {
        for (let l of m.locations) {
            const removedCollectableClass = l.removed ? ' removed-collectable' : '';
            const worldIdAttribute = l.worldId != null ? ` data-id="${l.worldId}"` : '';
            const menuThemeImageHtml = `<div class="menu-theme collectable${removedCollectableClass} noselect"><img src="${m.filename}" referrerpolicy="no-referrer" /></div>`;
            const menuThemeLinkHtml = `<a href="javascript:void(0);" class="js--menu-theme menu-theme collectable--border noselect" data-location-id="${l.id}"${worldIdAttribute}></a>`;
            l.method = l.method.replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
            if (l.methodJP)
                l.methodJP = l.methodJP.replace(/<span .*?>(.*?)<\/ *span>/ig, '$1').replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
            $(menuThemeImageHtml).appendTo(l.removed ? $removedMenuThemesContainerItems : $menuThemesContainerItems);
            $(menuThemeLinkHtml).appendTo(l.removed ? $removedMenuThemesContainerBorders : $menuThemesContainerBorders);
            menuThemeLocationsById[l.id] = l;
        }
    }

    const $tooltip = $('<div class="menu-theme-tooltip scene-tooltip display--none"></div>').prependTo('.content');

    $('.js--menu-theme[data-id]').on('click', function () {
        if (trySelectNode($(this).data('id'), true, true)) {
            $tooltip.addClass('display--none');
            $.modal.close();
        }
    });
    
    $('.js--menu-theme').on('mousemove', function (e) {
        $tooltip.css({
            top: e.pageY + 10 + 'px',
            left: (e.pageX - ($tooltip.innerWidth() / 2)) + 'px'
        });
    }).on('mouseenter', function () {
        const location = menuThemeLocationsById[$(this).data('locationId')];
        const world = location.worldId != null ? worldData[location.worldId] : null;
        const worldName = world ?
            getLocalizedLabel(world.title, world.titleJP)
            : null;
        const worldLabel = worldName ? `<span class="menu-theme-tooltip__world tooltip__value">${worldName}</span><br>` : '';
        const method = getLocalizedLabel(location.method, location.methodJP);
        $tooltip.html(`${worldLabel}${method}`).removeClass('display--none');
    }).on('mouseleave', function () {
        $tooltip.addClass('display--none');
    });
}

function initWallpaperData(data) {
    wallpaperData = data;

    const $wallpapersContainerItems = $('.js--wallpapers-container__items');
    const $wallpapersContainerBorders = $('.js--wallpapers-container__borders');
    const $removedWallpapersContainerItems = $('.js--removed-wallpapers-container__items');
    const $removedWallpapersContainerBorders = $('.js--removed-wallpapers-container__borders');
    const wallpapersById = {};

    $wallpapersContainerItems.empty();
    $wallpapersContainerBorders.empty();
    $removedWallpapersContainerItems.empty();
    $removedWallpapersContainerBorders.empty();

    for (let wp of wallpaperData) {
        const removedCollectableClass = wp.removed ? ' removed-collectable' : '';
        const censoredClass = wp.wallpaperId === 1149 ? ' censored' : '';
        const worldIdAttribute = wp.worldId != null ? ` data-id="${wp.worldId}"` : '';
        const removedAttribute = wp.removed ? ' data-removed="true"' : '';
        const wallpaperImageHtml = `<div class="wallpaper collectable${censoredClass}${removedCollectableClass} noselect"><img src="${wp.filename}" referrerpolicy="no-referrer" /></div>`;
        const wallpaperLinkHtml = `<a href="javascript:void(0);" class="js--wallpaper wallpaper collectable--border noselect" data-wallpaper-id="${wp.id}"${worldIdAttribute}${removedAttribute}></a>`;
        wp.method = wp.method.replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
        if (wp.methodJP)
            wp.methodJP = wp.methodJP.replace(/<span .*?>(.*?)<\/ *span>/ig, '$1').replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
        $(wallpaperImageHtml).appendTo(wp.removed ? $removedWallpapersContainerItems : $wallpapersContainerItems);
        $(wallpaperLinkHtml).appendTo(wp.removed ? $removedWallpapersContainerBorders : $wallpapersContainerBorders);
        wallpapersById[wp.id] = wp;
    }

    const $tooltip = $('<div class="wallpaper-tooltip scene-tooltip display--none"></div>').prependTo('.content');

    $('.js--wallpaper[data-id]').on('click', function () {
        if (trySelectNode($(this).data('id'), true, true)) {
            $tooltip.addClass('display--none');
            $.modal.close();
        }
    });
    
    $('.js--wallpaper').on('mousemove', function (e) {
        $tooltip.css({
            top: e.pageY + 10 + 'px',
            left: (e.pageX - ($tooltip.innerWidth() / 2)) + 'px'
        });
    }).on('mouseenter', function () {
        const wallpaper = wallpapersById[$(this).data('wallpaperId')];
        const title = getLocalizedLabel(wallpaper.name, wallpaper.nameJP);
        const method = getLocalizedLabel(wallpaper.method, wallpaper.methodJP);
        $tooltip.html(localizedWallpaperLabel
                .replace('{WALLPAPER_ID}', wallpaper.wallpaperId - (wallpaper.removed ? 1000 : 0))
                .replace('{TITLE}', title)
                .replace('{METHOD}', method || ''))
                .removeClass('display--none');
        if (!title)
            $tooltip.find('.js--wallpaper-tooltip__title').remove();
        $tooltip.find('.js--wallpaper-tooltip__wallpaper').toggleClass('alone', !method);
        $((wallpaper.removed ? $removedWallpapersContainerItems : $wallpapersContainerItems).children()[$(this).index()]).addClass('hover');
    }).on('mouseleave', function () {
        $tooltip.addClass('display--none');
        const $wallpapersContainer = $(this).data('removed') ? $removedWallpapersContainerItems : $wallpapersContainerItems;
        $($($wallpapersContainer.children()[$(this).index()])).removeClass('hover');
    });
}

function initBgmTrackData(data) {
    bgmTrackData = data;
    bgmTrackIds = [];
    bgmTrackIndexesById = {};

    const $bgmTracksContainerItems = $('.js--bgm-tracks-container__items');
    const $unnumberedBgmTracksContainerItems = $('.js--unnumbered-bgm-tracks-container__items');
    const $removedBgmTracksContainerItems = $('.js--removed-bgm-tracks-container__items');
    const $favBgmTracksContainerItems = $('.js--fav-bgm-tracks-container__items');
    const $bgmTracksContainerBorders = $('.js--bgm-tracks-container__borders');
    const $unnumberedBgmTracksContainerBorders = $('.js--unnumbered-bgm-tracks-container__borders');
    const $removedBgmTracksContainerBorders = $('.js--removed-bgm-tracks-container__borders');
    const $favBgmTracksContainerBorders = $('.js--fav-bgm-tracks-container__borders');
    const bgmTracksById = {};

    $bgmTracksContainerItems.empty();
    $unnumberedBgmTracksContainerItems.empty();
    $removedBgmTracksContainerItems.empty();
    $favBgmTracksContainerItems.empty();
    $bgmTracksContainerBorders.empty();
    $unnumberedBgmTracksContainerBorders.empty();
    $removedBgmTracksContainerBorders.empty();
    $favBgmTracksContainerBorders.empty();

    let i = 0;

    for (let t of bgmTrackData) {
        let trackId = '';
        if (t.trackNo < 1000)
            trackId = t.trackNo.toString().padStart(3, 0);
        if (t.variant)
            trackId += ` ${t.variant}`;
        const hasIdAttribute = t.url ? ` data-id="true"` : '';
        const removedCollectableClass = t.removed ? ' removed-collectable' : '';
        const worldIdAttribute = t.worldId != null ? ` data-world-id="${t.worldId}"` : '';
        const imageUrl = t.worldId != null ? worldData[t.worldId].images[t.worldImageOrdinal] : getMissingBgmTrackUrl(t.location);
        const unnumberedAttribute = t.trackNo >= 1000 ? ' data-unnumbered="true"' : '';
        const removedAttribute = t.removed ? ' data-removed="true"' : '';
        const favButtonClass = config.bgmTrackInput.hasOwnProperty(t.id) ? config.bgmTrackInput[t.id] ? ' on' : ' inactive' : '';
        const ignoreButtonClass = config.bgmTrackInput.hasOwnProperty(t.id) ? !config.bgmTrackInput[t.id] ? ' on' : ' inactive' : '';
        const bgmTrackImageHtml = `<div class="js--bgm-track-image--container bgm-track collectable-entry collectable${removedCollectableClass} noselect"><img src="${imageUrl}" class="js--bgm-track-image" referrerpolicy="no-referrer" /></div>`;
        const bgmTrackNameHtml = t.trackNo < 1000 ? `
            <div class="collectable-entry__name--container">
                <h1 class="bgm-track__name--shadow collectable-entry__name--shadow">${trackId}</h1>
                <h1 class="bgm-track__name collectable-entry__name">${trackId}</h1>
            </div>` : '';
        const bgmTrackImageButtonHtml = t.worldId && worldData[t.worldId].images.length > 1 ? `
             <button class="js--bgm-track__set-image bgm-track__set-image collectable-entry--control">
                <svg width="24" height="18" viewBox="0 0 24 18" xmlns="http://www.w3.org/2000/svg">
                    <path class="collectable-entry--control__icon" d="m0 0h24v16h-2v-14h-22zm24 16v2h-24v-16h2v14zm-20-2v-2l3-4 3 2 5-5 5 5v4zm0-9a1 1 0 0 0 4 0 1 1 0 0 0 -4 0z" fill-rule="evenodd" />
                </svg>
            </button>
        ` : '';
        const bgmTrackLinkHtml = `
            <div class="js--bgm-track-entry--container bgm-track--collectable-entry-container collectable-entry--container">
                <a href="javascript:void(0);" class="js--bgm-track bgm-track collectable-entry collectable--border noselect" data-bgm-track-id="${t.id}"${hasIdAttribute}${worldIdAttribute}${unnumberedAttribute}${removedAttribute}>${bgmTrackNameHtml}</a>
                <div class="js--bgm-track--collectable-entry--input-controls collectable-entry--controls noselect">
                    <button class="js--bgm-track__fav bgm-track__fav${favButtonClass} collectable-entry--control">
                        <svg width="24" height="24" viewBox="0 -1.5 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path class="collectable-entry--control__icon" d="m22.2 2c-2.5-2.7-6.5-2.6-9.1 0.1l-1.1 1.3-1.1-1.3c-2.6-2.7-6.6-2.8-9-0.1h-0.1c-2.4 2.6-2.4 7 0.2 9.7l5.4 5.9 0.1 0.1 4.5 4.8 4.4-4.8h0.1l0.1-0.1 5.4-5.9c2.6-2.7 2.6-7.1 0.2-9.7z" fill-rule="evenodd" />
                        </svg>
                    </button>
                    <button class="js--bgm-track__ignore bgm-track__ignore${ignoreButtonClass} collectable-entry--control">
                        <svg width="24" height="24" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                            <path class="collectable-entry--control__icon" d="m9 0a9 9 90 1 0 9 9 9 9 90 0 0 -9 -9zm0 2.1a6.9 6.9 90 0 1 4.1 1.3l-9.7 9.7a6.9 6.9 90 0 1 5.6 -11zm0 13.8a6.9 6.9 90 0 1 -4.1 -1.3l9.6-9.6a6.9 6.9 90 0 1 -5.5 10.9z" fill-rule="evenodd"/>
                        </svg>
                    </button>
                    ${bgmTrackImageButtonHtml}
                </div>
                <div class="js--bgm-track--collectable-entry--play-controls collectable-entry--controls noselect">
                    <button class="js--bgm-track__play collectable-entry--control">
                        <svg width="18" height="24" viewBox="0 0 18 24" xmlns="http://www.w3.org/2000/svg">
                            <path class="collectable-entry--control__icon" d="M18 12L0 24V0" fill-rule="evenodd" />
                        </svg>
                    </button>
                    <button class="js--bgm-track__pause collectable-entry--control display--none">
                        <svg width="18" height="24" viewBox="0 0 18 24" xmlns="http://www.w3.org/2000/svg">
                            <path class="collectable-entry--control__icon" d="M0 0h6v24H0zM12 0h6v24h-6z" fill-rule="evenodd" />
                        </svg>
                    </button>
                    <button class="js--bgm-track__playlist-add collectable-entry--control">
                        <svg width="24" height="24" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                            <path class="collectable-entry--control__icon" d="m18 2h-18v-2h18zm0 5h-18v-2h18zm-11 5h-7v-2h7zm0 5h-7v-2h7zm8 1h-3v-3h-3v-3h3v-3h3v3h3v3h-3z" fill-rule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>`;
        if (t.location)
            t.location = t.location.replace(/<span .*?>(.*?)<\/ *span>/ig, '$1').replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
        if (t.locationJP)
            t.locationJP = t.locationJP.replace(/<span .*?>(.*?)<\/ *span>/ig, '$1').replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
        if (t.notes)
            t.notes = t.notes.replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
        if (t.notesJP)
            t.notesJP = t.notesJP.replace(/<a .*?>(.*?)<\/ *a>/ig, '<span class="alt-highlight">$1</span>');
        $(bgmTrackImageHtml).appendTo(t.trackNo < 1000 ? $bgmTracksContainerItems : !t.removed ? $unnumberedBgmTracksContainerItems : $removedBgmTracksContainerItems);
        $(bgmTrackLinkHtml).appendTo(t.trackNo < 1000 ? $bgmTracksContainerBorders : !t.removed ? $unnumberedBgmTracksContainerBorders : $removedBgmTracksContainerBorders);
        bgmTracksById[t.id] = t;
        bgmTrackIds.push(t.id);
        bgmTrackIndexesById[t.id] = i++;
    }

    const $tooltip = $('<div class="bgm-track-tooltip scene-tooltip display--none"></div>').prependTo('.content');
    
    const getBgmTrackImageContainer = function ($bgmTrackEntry) {
        const $bgmTracksContainer = !$bgmTrackEntry.hasClass('js--fav-bgm-track') ?
            $bgmTrackEntry.data('removed') ? $removedBgmTracksContainerItems : $bgmTrackEntry.data('unnumbered') ? $unnumberedBgmTracksContainerItems : $bgmTracksContainerItems
            : $favBgmTracksContainerItems;
        return $($($bgmTracksContainer.children('.js--bgm-track-image--container')[$bgmTrackEntry.parent().index()]));
    };
    
    const $bgmTrackSearch = $('<input type="text" class="js--bgm-track-search" />').on('input', function() {
        const changeValue = $(this).val().trim();

        window.setTimeout(function() {
            if ($bgmTrackSearch.val().trim() === changeValue) {
                if (changeValue) {
                    const bgmTrackIdMatch = /^(\d+) ?([A-Z])?$/i.exec(changeValue);
                    const trackNo = bgmTrackIdMatch ? parseInt(bgmTrackIdMatch[1]) : null;
                    const variant = bgmTrackIdMatch && bgmTrackIdMatch[2] || null;
                    const changeValueLower = changeValue.toLowerCase();

                    $('.js--bgm-track[data-bgm-track-id]').each(function() {
                        const bgmTrack = bgmTracksById[$(this).data('bgmTrackId')];
                        const name = bgmTrack.name;
                        const location = getLocalizedLabel(bgmTrack.location, bgmTrack.locationJP);
                        const notes = getLocalizedLabel(bgmTrack.notes, bgmTrack.notesJP);
                        let visible = (name && name.toLowerCase().indexOf(changeValueLower) > -1) ||
                                        (location && location.toLowerCase().indexOf(changeValueLower) > -1) ||
                                        (notes && notes.toLowerCase().indexOf(changeValueLower) > -1);

                        if (!visible && bgmTrackIdMatch)
                            visible = bgmTrack.trackNo === trackNo && (variant === null || bgmTrack.variant === variant);

                        $(this).parent().toggleClass('display--none', !visible);
                        getBgmTrackImageContainer($(this)).toggleClass('display--none', !visible);
                    });
                } else
                     $('.js--bgm-track-entry--container, .js--bgm-track-image--container').removeClass('display--none');
            }
        }, 500);
    });
    
    $('.js--bgm-track-search--container').empty().append($bgmTrackSearch);

    const playBgmTrackEntry = function (openWorld) {
        const bgmTrack = bgmTracksById[$(this).data('bgmTrackId')];
        if (bgmTrack.url) {
            const playlistIndex = bgmTrackIds.indexOf(bgmTrack.id);
            if (!config.playlist && config.playlistIndex === playlistIndex)
                GreenAudioPlayer.playPlayer(audioPlayer.player);
            else {
                playBgmTrack(bgmTrack, playlistIndex);
                updatePlaylistShuffleIndexes(playlistIndex);
            }
            if (openWorld) {
                const worldId = $(this).data('worldId');
                if (worldId !== undefined)
                    trySelectNode(worldId, true, true);
                $tooltip.addClass('display--none');
                $.modal.close();
            } else
                updateControlsContainer();
        }
    };

    $('.js--bgm-track[data-id]').on('click', function () { playBgmTrackEntry.apply(this, [ true ]); }).parent()
        .children('.js--bgm-track--collectable-entry--input-controls').children().on('click', function () {
            const $bgmTrackEntry = $(this).parent().parent().children('.js--bgm-track');
            const bgmTrackId = $bgmTrackEntry.data('bgmTrackId');
            const isFav = $(this).hasClass('js--bgm-track__fav');
            const isIgnore = !isFav && $(this).hasClass('js--bgm-track__ignore');
            if (isFav || isIgnore) {
                const hasInput = config.bgmTrackInput.hasOwnProperty(bgmTrackId);
                if (!hasInput || !!config.bgmTrackInput[bgmTrackId] === isFav) {
                    if (hasInput)
                        delete config.bgmTrackInput[bgmTrackId];
                    else
                        config.bgmTrackInput[bgmTrackId] = isFav ? 1 : 0;
                    updateConfig(config);
                    if (isFav) {
                        if (hasInput)
                            removeFavBgmTrackEntry(bgmTrackId);
                        else
                            addFavBgmTrackEntry(bgmTrackId);
                    }
                    $(this).toggleClass('on', !hasInput);
                    $(this).parent().children(`.js--bgm-track__${isFav ? 'ignore' : 'fav'}`).toggleClass('inactive', !hasInput);
                    if (config.playlistIndex > -1) {
                        if (bgmTrackId === getPlaylistBgmTrackIds()[config.playlistIndex]) {
                            $(`.audio-player .${isFav ? 'fav' : 'ignore'}-btn`).toggleClass('on', !hasInput);
                            $(`.audio-player .${isFav ? 'ignore' : 'fav'}-btn`).toggleClass('inactive', !hasInput);
                        }
                    }
                }
            }
        }).parent().parent().children('.js--bgm-track--collectable-entry--play-controls').children().on('click', function () {
            const isPlay = $(this).hasClass('js--bgm-track__play');
            const isPause = !isPlay && $(this).hasClass('js--bgm-track__pause');
            if (isPlay || isPause) {
                if (!$(this).hasClass('pressed')) {
                    if (isPlay)
                        playBgmTrackEntry.apply($(this).parent().parent().children('.js--bgm-track')[0]);
                    else
                        pauseBgm();
                    $(this).addClass('pressed');
                }
            } else if ($(this).hasClass('js--bgm-track__playlist-add'))
                addPlaylistBgmTrack($(this).parent().parent().children('.js--bgm-track').data('bgmTrackId'));
        });

    $('.js--bgm-track__set-image').on('click', function () {
        const $bgmTrackEntry = $(this).parent().parent().children('.js--bgm-track');
        initBgmTrackImagesModal($bgmTrackEntry, getBgmTrackImageContainer);
    });
    
    $('.js--bgm-track').on('mousemove', function (e) {
        $tooltip.css({
            top: e.pageY + 10 + 'px',
            left: (e.pageX - ($tooltip.innerWidth() / 2)) + 'px'
        });
    }).on('mouseenter', function () {
        const bgmTrack = bgmTracksById[$(this).data('bgmTrackId')];
        const name = bgmTrack.name;
        const location = getLocalizedLabel(bgmTrack.location, bgmTrack.locationJP);
        const notes = getLocalizedLabel(bgmTrack.notes, bgmTrack.notesJP);
        $tooltip.html(localizedBgmTrackLabel
                .replace('{BGM_TRACK_ID}', bgmTrack.trackNo < 1000 ? bgmTrack.trackNo + (bgmTrack.variant ? ` ${bgmTrack.variant}` : '') : '')
                .replace('{NAME}', name)
                .replace('{LOCATION}', location)
                .replace('{NOTES}', notes || ''))
                .removeClass('display--none');
        if (bgmTrack.trackNo >= 1000)
            $tooltip.find('.js--bgm-track-tooltip__bgm-track-id').remove();
        if (!location)
            $tooltip.find('.js--bgm-track-tooltip__location').remove();
        $tooltip.find('.js--bgm-track-tooltip__name').toggleClass('alone', !location && !notes);
        $tooltip.find('.js--bgm-track-tooltip__location').toggleClass('alone', location && !notes);
        getBgmTrackImageContainer($(this)).addClass('hover');
    }).on('mouseleave', function () {
        $tooltip.addClass('display--none');
        getBgmTrackImageContainer($(this)).removeClass('hover');
    });

    for (let t of Object.keys(config.bgmTrackInput)) {
        if (config.bgmTrackInput[t])
            addFavBgmTrackEntry(t);
    }
}

function addFavBgmTrackEntry(bgmTrackId) {
    const bgmTrack = bgmTrackData[bgmTrackIndexesById[bgmTrackId]];

    const $bgmTracksContainerItems = $('.js--bgm-tracks-container__items');
    const $unnumberedBgmTracksContainerItems = $('.js--unnumbered-bgm-tracks-container__items');
    const $removedBgmTracksContainerItems = $('.js--removed-bgm-tracks-container__items');
    const $favBgmTracksContainerItems = $('.js--fav-bgm-tracks-container__items');
    const $favBgmTracksContainerBorders = $('.js--fav-bgm-tracks-container__borders');

    const $bgmTrackEntry = $(`.js--bgm-track[data-bgm-track-id=${bgmTrackId}]`);
    const $bgmTracksContainer = $bgmTrackEntry.data('removed') ? $removedBgmTracksContainerItems : $bgmTrackEntry.data('unnumbered') ? $unnumberedBgmTracksContainerItems : $bgmTracksContainerItems;
    const $bgmTrackImageContainer = $($($bgmTracksContainer.children('.js--bgm-track-image--container')[$bgmTrackEntry.parent().index()]));

    const $favBgmTrackImageContainer = $bgmTrackImageContainer.clone(true).addClass('fav-bgm-track');
    const $favBgmTrackLinkContainer = $bgmTrackEntry.parent().clone(true).data('trackNo', bgmTrack.trackNo).data('variant', bgmTrack.variant);

    $favBgmTrackLinkContainer.children('.js--bgm-track').addClass('js--fav-bgm-track');

    let foundPos = false;

    $favBgmTracksContainerBorders.children().each(function() {
        const trackNo = $(this).data('trackNo');
        if (trackNo > bgmTrack.trackNo || (trackNo === bgmTrack.trackNo && $(this).data('variant') > bgmTrack.variant)) {
            $favBgmTrackImageContainer.insertBefore($favBgmTracksContainerItems.children()[$(this).index()]);
            $favBgmTrackLinkContainer.insertBefore(this);
            foundPos = true;
            return false;
        }
    });

    if (!foundPos) {
        $favBgmTracksContainerItems.append($favBgmTrackImageContainer);
        $favBgmTracksContainerBorders.append($favBgmTrackLinkContainer);
    }
    
    const $bgmTrackEntryInputControls = $favBgmTrackLinkContainer.children('.js--bgm-track--collectable-entry--input-controls');
    const $bgmTrackEntryPlayControls = $favBgmTrackLinkContainer.children('.js--bgm-track--collectable-entry--play-controls');
    const $setImageBtn = $bgmTrackEntryInputControls.children('.js--bgm-track__set-image');
    if ($setImageBtn.length)
        $setImageBtn.detach().appendTo($bgmTrackEntryPlayControls);
    $bgmTrackEntryInputControls.remove();

    if ($favBgmTracksContainerBorders.children().length === 1)
        $('.js--fav-bgm-tracks--section').removeClass('display--none');
}

function removeFavBgmTrackEntry(bgmTrackId) {
    const $favBgmTracksContainerItems = $('.js--fav-bgm-tracks-container__items');
    const $favBgmTracksContainerBorders = $('.js--fav-bgm-tracks-container__borders');

    const $bgmTrackLinkContainer = $favBgmTracksContainerBorders.find(`.js--bgm-track[data-bgm-track-id=${bgmTrackId}]`).parent();
    const $bgmTrackImageContainer = $($($favBgmTracksContainerItems.children('.js--bgm-track-image--container')[$bgmTrackLinkContainer.index()]));
    
    $bgmTrackLinkContainer.remove();
    $bgmTrackImageContainer.remove();

    if (!$favBgmTracksContainerBorders.children().length)
        $('.js--fav-bgm-tracks--section').addClass('display--none');
}

function initBgmTrackImagesModal($bgmTrackEntry, getBgmTrackImageContainer) {
    const bgmTrackId = $bgmTrackEntry.data('bgmTrackId');
    const bgmTrack = bgmTrackData[bgmTrackIndexesById[bgmTrackId]];
    const world = worldData[bgmTrack.worldId];

    const $bgmTrackImagesContainerItems = $('.js--bgm-track-images-container__items');
    const $bgmTrackImagesContainerBorders = $('.js--bgm-track-images-container__borders');

    $bgmTrackImagesContainerItems.empty();
    $bgmTrackImagesContainerBorders.empty();

    let i = 0;

    for (let bti of world.images) {
        const bgmTrackImageImageHtml = `<div class="bgm-track-image collectable noselect"><img src="${bti}" referrerpolicy="no-referrer" /></div>`;
        const bgmTrackImageLinkHtml = `<a href="javascript:void(0);" class="js--bgm-track-image bgm-track-image collectable--border noselect" data-id="${i++}"></a>`;
        $(bgmTrackImageImageHtml).appendTo($bgmTrackImagesContainerItems);
        $(bgmTrackImageLinkHtml).appendTo($bgmTrackImagesContainerBorders);
    }

    $('.js--bgm-track-image').on('click', function () {
        const ordinal = $(this).data('id');
        $.post('/updateBgmTrackWorldImageOrdinal', { bgmTrackId: bgmTrackId, ordinal: ordinal }, function (data) {
            if (data.success) {
                const filename = world.images[ordinal];
                bgmTrack.worldImageOrdinal = ordinal;
                $(`.js--bgm-track[data-bgm-track-id='${bgmTrackId}']`).each(function() {
                    getBgmTrackImageContainer($(this)).find('.js--bgm-track-image').attr('src', filename);
                });
                $(`.js--playlist-item[data-bgm-track-id='${bgmTrackId}'] .playlist-item__image`).attr('src', filename)
                $.modal.close();
            }
        });
     });
    
    $('.js--bgm-track-images-modal').modal({
        closeExisting: false,
        fadeDuration: 100,
        closeClass: 'noselect',
        closeText: '✖'
    });
}

function isYNTheme() {
    return config.uiTheme === 'Yume_Nikki';
}

function loadOrInitConfig() {
    try {
        if (!window.localStorage.hasOwnProperty("config")) {
            window.localStorage.setItem("config", JSON.stringify(config));
            if (config.lang !== "en")
                $(".js--lang").val(config.lang);
        } else {
            const savedConfig = JSON.parse(window.localStorage.getItem("config"));
            for (let key of Object.keys(savedConfig)) {
                if (config.hasOwnProperty(key)) {
                    let value = savedConfig[key];
                    switch (key) {
                        case "debug":
                            isDebug = value;
                            break;
                        case "username":
                            username = value;
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
                        case "versionDisplayToggles":
                            value = getUpdatedVersionDisplayToggles(value);
                            break;
                    }
                    config[key] = value;
                }
            }
        }
    } catch (error) {
        console.log(error);
    }
}

function getDefaultVersionDisplayToggles() {
    return {
        ADD: true,
        UPDATE: {
            '': false,
            MINOR_CHANGE: false,
            MAJOR_CHANGE: true,
            BUG_FIX: false,
            ADD_CONTENT: true,
            REMOVE_CONTENT: true,
            LAYOUT_CHANGE: true,
            EXPANSION: true,
            REDUCTION: true,
            ADD_SUB_AREA: true,
            REMOVE_SUB_AREA: true,
            CONNECTION_CHANGE: true,
            ADD_CONNECTION: true,
            REMOVE_CONNECTION: true,
            BGM_CHANGE: false,
            EFFECT_CHANGE: false,
            REWORK: true
        },
        REMOVE: true
    };
}

function getUpdatedVersionDisplayToggles(value) {
    let ret;
    const defaultValue = getDefaultVersionDisplayToggles();
    if (typeof value === 'object') {
        ret = {};
        Object.keys(defaultValue).forEach(et => {
            const defaultEntryTypeValue = defaultValue[et];
            if (value.hasOwnProperty(et)) {
                const entryTypeValue = value[et];
                if (typeof defaultEntryTypeValue === 'object') {
                    if (typeof entryTypeValue === 'object') {
                        ret[et] = {};
                        Object.keys(defaultEntryTypeValue)
                            .forEach(eut => ret[et][eut] = entryTypeValue.hasOwnProperty(eut) ? entryTypeValue[eut] : defaultEntryTypeValue[eut]);
                    } else
                        ret[et] = defaultEntryTypeValue;
                } else
                    ret[et] = entryTypeValue;
            } else
                ret[et] = defaultEntryTypeValue;
        });
    } else
        ret = defaultValue;

    return ret;
}

function updateControlsContainer(updateTabMargin) {
    const controlsHeight = $(".controls-top").outerHeight();
    const settingsHeight = $(".controls-bottom").outerHeight();
    const collectableControlsHeight = $(".controls-collectables").outerHeight();
    const collectableControlsWidth = $(".controls-collectables").outerWidth();
    $(".controls-top--container, .controls-bottom--container").css("margin-top", `-${(settingsHeight + 20)}px`);
    $(".controls-top--container, controls-bottom--container, .controls-bottom--container--tab, .footer").each(function() {
        $(this).css("height", `${settingsHeight - ($(this).outerHeight() - parseFloat(window.getComputedStyle(this, null).getPropertyValue("height")))}px`);
    });
    $(".controls-bottom--container--tab").css("left", `calc(50% - ${($(".controls-bottom--container--tab").outerWidth() / 2)}px`);
    $(".controls-collectables--container").css({
        "top": `${(controlsHeight + 16)}px`,
        "margin-left": `-${(collectableControlsWidth + 20)}px`
    });
    $(".controls-collectables--container--tab").css({
        "width": `${collectableControlsWidth}px`,
        "top": `${(controlsHeight + 16)}px`,
        "margin-top": `${16 + (((collectableControlsHeight + 16) - $(".controls-collectables--container--tab").outerHeight()) / 2)}px`
    });
    $(".controls-playlist").css("max-width", `${window.innerWidth - 72}px`);
    
    const playlistControlsHeight = $(".controls-playlist").outerHeight();
    const playlistControlsWidth = $(".controls-playlist").outerWidth();
    $(".controls-playlist--container--tab").css({
        "bottom": `${104 + (((playlistControlsHeight + 16) - $(".controls-playlist--container--tab").outerHeight()) / 2)}px`,
    });
    $(".controls-playlist--container").css({
        "bottom": `${(playlistControlsHeight + 122)}px`,
        "margin-left": `${(playlistControlsWidth + 20)}px`
    });

    if (updateTabMargin) {
        if ($(".controls-bottom").hasClass("visible")) {
            $(".controls-bottom--container--tab, .audio-player-container, .footer").css("margin-top", `-${(settingsHeight + 8)}px`);
            $(".controls-playlist--container--tab").css("margin-bottom", `${(settingsHeight + 8)}px`);
            $(".controls-playlist--container").css("padding-bottom", `${settingsHeight + 8}px`);
        }
        if ($(".controls-collectables").hasClass("visible"))
            $(".controls-collectables--container--tab").css("margin-left", `-${(collectableControlsWidth + 8)}px`);
        if ($(".controls-playlist").hasClass("visible"))
            $(".controls-playlist--container--tab").css("margin-left", `${(playlistControlsWidth + 8)}px`);
        $(".modal").css("transition", "");
    }

    let modalMaxWidth;
    const modalLeftMargin = 28;
    let modalRightMargin;
    if ($(".controls-collectables").hasClass("visible")) {
        const collectableControlsWidth = $(".controls-collectables").outerWidth() + parseFloat($(".controls-collectables").css("margin-right")) + $(".controls-collectables--container--tab__button").outerWidth();
        modalMaxWidth = window.innerWidth - ((collectableControlsWidth + 8) + 28);
        modalRightMargin = collectableControlsWidth - 12;
    } else {
        modalMaxWidth = window.innerWidth - 28;
        modalRightMargin = 0;
    }

    $(".modal").css({
        "margin-top": `${(controlsHeight + 16)}px`,
        "height": `calc(100% - ${(controlsHeight + 16 + ($(".controls-bottom").hasClass("visible") ? settingsHeight + 8 : 0)) + ($(".controls-playlist").hasClass("visible") ? 200 : $(".audio-player-container").hasClass("open") ? 82 : 0)}px)`,
        "max-width": `${modalMaxWidth}px`,
        "margin-left": `${modalLeftMargin}px`,
        "margin-right": `${modalRightMargin}px`
    });
}

function closeModals() {
    for (let i = 0; i < 2; i++) {
        if ($(".modal:visible").length)
            $.modal.close();
    }
}

export function loadData(update, onSuccess, onFail) {
    let queryString = '';
    if (config.removedContentMode === 1)
        queryString = '?includeRemovedContent=true';
    if (urlSearchParams.has("adminKey"))
        queryString += `${queryString.length ? "&" : "?"}adminKey=${urlSearchParams.get("adminKey")}`;
    const loadData = () => $.get(`/data${queryString}`).done(data => onSuccess(data)).fail(onFail);
    const loadOrUpdateData = update => {
        if (update) {
            const req = { reset: update === 'reset' };
            $.post('/updateWorldData', req)
                .done(uwdResponse => {
                    if (uwdResponse.success) {
                        $.post('/updateMiscData', req)
                            .done(umdResponse => {
                                if (umdResponse.success)
                                    loadData();
                                else
                                    onFail(null, null, true);
                            }).fail(onFail);
                    } else
                        onFail(null, null, true);
                }).fail(onFail);
        } else
            loadData();
    };
    if (update)
        loadOrUpdateData(update);
    else
        $.post('/checkUpdateData')
            .done(function (data) {
                if (document.fonts.check("12px MS Gothic")) {
                    fontsLoaded = true;
                    loadOrUpdateData(data.update);
                } else {
                    document.fonts.onloadingdone = _ => fontsLoaded = true;
                    const fontsLoadedCheck = window.setInterval(function () {
                        if (fontsLoaded) {
                            window.clearInterval(fontsLoadedCheck);
                            loadOrUpdateData(data.update);
                        }
                    }, 100);
                }
            }).fail(onFail);
}

function reloadData(update) {
    const loadCallback = displayLoadingAnim($("#graphContainer"));
    loadData(update, function (data) {
        initWorldData(data.worldData);
        initVersionData(data.versionInfoData);
        initAuthorData(data.authorInfoData, data.versionInfoData);
        initEffectData(data.effectData);
        initMenuThemeData(data.menuThemeData);
        initWallpaperData(data.wallpaperData);
        initBgmTrackData(data.bgmTrackData);
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
let selectedVersionIndex = null;

let tempSelectedAuthor = null;
let tempSelectedVersionIndex = null;

let visibleTwoWayLinks = [];
let visibleOneWayLinks = [];
let hiddenLinks = [];
let linksTwoWayBuffered;
let linksOneWayBuffered;

let nodeObject;
let iconObject;
let nodeIconObject;

let icons3D;

const colorLinkSelected = new THREE.Color('red');
const nodeTextColors = ["#FFFFFF", "#AAAAAA", "#888888"];

let localizedNodeLabel;
let localizedPathNodeLabel;
let localizedNodeLabelVersionLastUpdated;
let localizedNodeLabelVersionLastUpdatedWithUpdateType;
let localizedNodeLabelVersionRemoved;
let localizedNodeLabelVersionUpdateTypes;
let localizedAuthorLabel;
let localizedVersionLabel;
let localizedEffectLabel;
let localizedWallpaperLabel;
let localizedBgmTrackLabel;
let localizedNodeIconNew;
let localizedVersionDetails;
let localizedVersionDisplayToggle;
let localizedSeparator;
let localizedDot;
let localizedComma;
let localizedBraces;
let localizedNA;

let iconLabel;

let raycaster, mousePos = { x: 0, y: 0 };

let localizedConns;

let effectsJP;

let config = {
    debug: false,
    username: null,
    lang: document.referrer && /\.jp/.test(document.referrer) ? "ja" : "en",
    uiTheme: "Default_Custom",
    fontStyle: 0,
    renderMode: 0,
    displayMode: 0,
    connMode: 0,
    labelMode: 1,
    removedContentMode: 0,
    pathMode: 1,
    sizeDiff: 1,
    stackSize: 20,
    versionDisplayToggles: getDefaultVersionDisplayToggles(),
    audioVolume: 0.65,
    bgmTrackInput: {},
    playlist: false,
    playlistIndex: -1,
    playlistShuffle: false,
    playlistRepeat: false,
    playlistBgmTrackIds: []
};

let lastUpdate, lastFullUpdate;

let audioPlayer;
let playlistShuffleIndexes = [];

let worldImageData = [];

function initGraph(renderMode, displayMode, paths) {

    is2d = !renderMode;

    const links = [];

    const addedLinks = [];

    const dagIgnore = {};

    const worldDepths = {};
    const worldRealDepths = {};
    const worldIsNew = {};
    const worldRemoved = {};

    iconTexts = [];

    for (let w of worldData) {
        worldScales[w.id] = 1 + (Math.round((w.size - minSize) / (maxSize - minSize) * 10 * (config.sizeDiff - 1)) / 10);
        worldIsNew[w.id] = (w.verAdded && w.verAdded.index === versionData.length - (missingVersionIndex >= 0 ? 1 : 0));
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
            const filteredPath = paths.find(p => !p.find(pi => filteredPathConnTypes & pi.connType));
            if (filteredPath)
                pathDepthLimit = filteredPath.length;
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
        const nexusWorldId = worldData.find(w => w.title === nexusWorldName).id;
        const nexusShortcutLinks = links.filter(l => l.target === nexusWorldId && l.connType & ConnType.EFFECT && !worldData[l.source].connections.filter(c => c.targetId === nexusWorldId).length);
        const nexusShortcutWorldIds = nexusShortcutLinks.map(l => l.source);
        
        for (let w of visibleWorldIds) {
            const world = worldData[w];
            let connections = world.connections;
            const dagIgnoreIds = dagIgnore[w] || (dagIgnore[w] = []);
            if (nexusShortcutWorldIds.indexOf(w) > -1) {
                const nexusShortcutLink = nexusShortcutLinks.find(l => l.source === w);
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
                const link = links.find(l => l.key === linkId);
                const connWorld = worldData[conn.targetId];
                const reverseLinkId = `${connWorld.id}_${w}`;
                const reverseConn = connWorld.connections.find(c => c.targetId === w);
                let hidden = false;
                if (conn.type & ConnType.NO_ENTRY) {
                    hidden = true;
                    dagIgnoreIds.push(connWorld.id);
                } else if (worldMinDepths[w] >= worldMinDepths[connWorld.id]) {
                    dagIgnoreIds.push(connWorld.id);
                    if (worldDepths[w] >= worldDepths[connWorld.id]) {
                        const sameDepth = worldDepths[w] === worldDepths[connWorld.id];
                        hidden = (!sameDepth && !reverseConn) || (reverseConn && !(reverseConn.type & ConnType.NO_ENTRY) && (!sameDepth || (!(conn.type & ConnType.ONE_WAY) && w > connWorld.id)));
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
                        connType: reverseConn
                            ? reverseConn.type
                            : conn.type & ConnType.ONE_WAY
                            ? ConnType.NO_ENTRY
                            : conn.type & ConnType.NO_ENTRY
                            ? ConnType.ONE_WAY
                            : 0,
                        typeParams: reverseConn ? reverseConn.typeParams : {},
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
                    const reverseConn = connWorld.connections.find(c => c.targetId === w);
                    hidden = (!sameDepth && !reverseConn) || (reverseConn && !(reverseConn.type & ConnType.NO_ENTRY) && (!sameDepth || (!(conn.type & ConnType.ONE_WAY) && w > connWorld.id)));
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
        if (connType & ConnType.SEASONAL)
            icons.push(getConnTypeIcon(ConnType.SEASONAL, l.typeParams[ConnType.SEASONAL]));
    });

    const images = (paths ? worldData.filter(w => visibleWorldIds.indexOf(w.id) > -1) : worldData).map(d => {
        const img = imageLoader.load(d.filename);
        img.id = d.id;
        img.rId = d.rId;
        img.title = getLocalizedLabel(d.title, d.titleJP);
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
        const isNew = worldIsNew[id];
        const removed = worldRemoved[id];
        const ret = { id, rId, index: n++, img, scale: scale, isNew: isNew, removed: removed };
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

    const radius = parseInt(Math.min(window.innerWidth, window.innerHeight) / 100);
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

    if (graph)
        disposeGraph();

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
            const box = new THREE.BoxGeometry(13 * scale, 9.75 * scale, is2d ? 1 : 13 * scale);
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
                const worldName = getLocalizedLabel(world.title, world.titleJP);
                const text = new SpriteText(worldName, 1.5, node.removed ? getNodeTextColor(node, ret.material.grayscale) : 'white');
                text.fontFace = 'MS Gothic';
                text.fontSize = 80;
                text.strokeWidth = is2d ? 1.5 : 2 - (scale - 1) * 0.1;
                text.strokeColor = 'black';
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

                let textLines = worldName.split(' ');
                for (let l = 0; l < textLines.length; l++) {
                    text.text = textLines[l];
                    if (text.scale.x * scale < 13 * scale) {
                        let mergeIndex = 0;
                        for (let l2 = l + 1; l2 < textLines.length; l2++) {
                            const mergedLine = textLines.slice(l, l2 + 1).join(' ');
                            text.text = mergedLine;
                            if (text.scale.x * scale < 13 * scale)
                                mergeIndex = l2;
                            else
                                break;
                        }
                        if (mergeIndex)
                            textLines = textLines.slice(0, l).concat([textLines.slice(l, mergeIndex + 1).join(' ')], textLines.slice(mergeIndex + 1));
                    } else if (textLines[l].indexOf('：') > -1)
                        textLines = textLines.slice(0, l).concat(textLines[l].replace(/：/g, '： ').split(' ')).concat(textLines.slice(l + 1));
                }
                
                text.text = textLines.join('\n');
                text.defaultScale = { 'x': text.scale.x, 'y': text.scale.y };
                text.material.transparent = true;
                text.material.opacity = ret.material.opacity;
                if (config.labelMode < 3)
                    text.visible = false;

                text.scale.x *= scale;
                text.scale.y *= scale;

                ret.add(text);
               
                if (worldIsNew[node.id]) {
                    const iconText = new SpriteText(is2d ? ` ${localizedNodeIconNew} ` : localizedNodeIconNew, 2, 'gold');
                    iconText.__graphObjType = 'label';
                    iconText.fontFace = 'MS Gothic';
                    iconText.fontSize = 80;
                    iconText.strokeWidth = 1;
                    iconText.strokeColor = '#4d4000';
                    iconText.backgroundColor = false;
    
                    if (is2d) {
                        iconText.material.depthTest = false;
                        iconText.renderOrder = world.id;
                    } else {
                        iconText.borderWidth = 1;
                        iconText.borderColor = 'transparent';
                    }
                    if (isWebGL2) {
                        iconText.renderOrder = 2;
                        iconText.material.depthWrite = false;
                    }
                    
                    iconText.defaultScale = { 'x': iconText.scale.x, 'y': iconText.scale.y };
                    iconText.material.transparent = true;
                    iconText.material.opacity = ret.material.opacity;
                    iconText.visible = isNodeLabelVisible(node);
                    iconText.scale.x *= scale;
                    iconText.scale.y *= scale;
    
                    if (is2d) {
                        iconText.position.set(7 * scale, 4.75 * scale, 0);
                        iconText.center.set(1, 1);
                    } else {
                        iconText.center.set(1 - ((6.5 * scale) / iconText.scale.x), 1 - ((4.875 * scale) / iconText.scale.y));
                    }
    
                    ret.add(iconText);
                }
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
                    const oneWayIcon = linkIcons.find(i => i.connType & ConnType.ONE_WAY);
                    oneWayIcon.material.map.repeat.x = link.source.x <= link.target.x ? 1 : -1;
                }
            }
        })
        .connMode(() => config.connMode)
        .nodeVal(node => node.width)
        .nodeLabel(node => {
            const world = worldData[node.id];
            let ret = (paths && node.depth !== node.minDepth ? localizedPathNodeLabel : localizedNodeLabel)
                .replace('{WORLD}', node.img.title).replace('{DEPTH}', node.depth).replace('{DEPTH_COLOR}', node.depthColor).replace('{AUTHOR}', world.author ? getAuthorDisplayName(world.author, true) : localizedNA)
                .replace('{VERSION_ADDED}', world.verAdded ? (getLocalizedLabel(world.verAdded.name, world.verAdded.nameJP, true)) : localizedNA);
            if (paths)
                ret = ret.replace('{MIN_DEPTH}', node.minDepth).replace('{MIN_DEPTH_COLOR}', node.minDepthColor);
            if (world.verUpdated) {
                const verUpdated = world.verUpdated[world.verUpdated.length - 1];
                let nodeLabelLastUpdated = (verUpdated.updateType ? localizedNodeLabelVersionLastUpdatedWithUpdateType : localizedNodeLabelVersionLastUpdated)
                    .replace('{VERSION_LAST_UPDATED}', getLocalizedLabel(verUpdated.verUpdated.name, verUpdated.verUpdated.nameJP, true));
                if (verUpdated.updateType)
                    nodeLabelLastUpdated = nodeLabelLastUpdated.replace('{VERSION_LAST_UPDATED_TYPE}', localizedNodeLabelVersionUpdateTypes[verUpdated.updateType]);
                ret += nodeLabelLastUpdated;
            }
            if (node.removed)
                ret += localizedNodeLabelVersionRemoved.replace('{VERSION_REMOVED}', world.verRemoved ? getLocalizedLabel(world.verRemoved.name, world.verRemoved.nameJP, true) : localizedNA);
            return ret;
        })
        .nodesPerStack(config.stackSize)
        .onNodeDragEnd(node => ['x', 'y'].concat(is2d ? [] : ['z']).forEach(c => node[`f${c}`] = node[c]))
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
            ['x', 'y'].concat(is2d ? [] : ['z']).forEach(d => node[`f${d}`] = node[d]);
            if (isCtrl || isShift)
                openWorldWikiPage(node.id, isShift);
            else
                trySelectNode(node);
        })
        .onNodeRightClick((node, ev) => {
            contextWorldId = node.id;
            $('.graph canvas').contextMenu({
                x: ev.x,
                y: ev.y
            });
        })
        .onBackgroundClick(node => {
            $('.js--search-world').removeClass('selected').val('');
            selectedWorldId = null;
            if (tempSelectedAuthor)
                tempSelectAuthor(null);
            if (tempSelectedVersionIndex)
                tempSelectVersion(0);
            highlightWorldSelection();
        })
        .cooldownTicks(400)
        // Deactivate existing forces
        // Add collision and bounding box forces
        .d3Force('collide', forceCollide(node => radius * worldScales[node.id]))
        .d3Force('box', () => {

            gData.nodes.forEach(node => {
                const x = node.x || 0, y = node.y || 0;

                // bounce on box walls
                if (Math.abs(x) > radius)
                    node.vx += 0.1 * (x > 0 ? -1 : 1);
                if (Math.abs(y) > radius)
                    node.vy += 0.1 * (y > 0 ? -1 : 1);

                if (!is2d) {
                    const z = node.z || 0;
                    if (Math.abs(z) > radius)
                        node.vz += 0.1 * (z > 0 ? -1 : 1);
                }
            });
        })
        .graphData(gData);

    document.querySelector(".controls-bottom--container--tab").style.display = '';
    document.querySelector(".controls-collectables--container--tab").style.display = '';
    document.querySelector(".controls-playlist--container--tab").style.display = '';

    document.removeEventListener('mousemove', onDocumentMouseMove, false);
    document.querySelector('#graph canvas').removeEventListener('wheel', clearTweens, false)

    const controls = graph.controls();
    controls.screenSpacePanning = true;

    if (is2d) {
        controls.maxPolarAngle = controls.minPolarAngle = Math.PI / 2;
        controls.maxAzimuthAngle = controls.minAzimuthAngle = 0;
        controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN
        };
        controls.touches = {
            ONE: THREE.TOUCH.PAN
        };
        controls.enableRotate = false;
    }

    controls.update();

     // when the mouse moves, call the given function
     document.addEventListener('mousemove', onDocumentMouseMove, false);
     document.querySelector('#graph canvas').addEventListener('wheel', clearTweens, false);

    (function () {
        let _animationCycle = graph._animationCycle
        graph._animationCycle = function () {
            onRender(is2d);
            _animationCycle.apply(this);
        };
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
        if (is2d) {
            makeNodeIconObject();
            updateNodeLabels2D();
        }
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

function disposeGraph() {
    graph.renderer().dispose();
    graph.scene().dispose();
}

const clock = new THREE.Clock();
let time = 0;
const dashLineSpeed = 20;
function onRender(is2d) {
    time -= clock.getDelta() * dashLineSpeed;
    if (!(isWebGL2 && is2d))
        updateNodeLabels(is2d, time * -1);
    if (isWebGL2) {
        updateIconPositions(is2d);
        if (is2d)
            updateNodeIconAnimation(time);
    }
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
    
    in float opacity;
    out float vOpacity;
    in float grayscale;
    out float vGrayscale;
    in float texIndex;
    out float vTexIndex;
    in vec2 uv;
    out vec2 vUv;

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
    
    in float opacity;
    out float vOpacity;
    in float grayscale;
    out float vGrayscale;
    in float texIndex;
    out float vTexIndex;
    in vec2 uv;
    out vec2 vUv;
   
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

const instanceNodeIconVS = `#version 300 es
    precision highp float;

    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    in mat4 instanceMatrix;
    in vec3 position;
    
    in float opacity;
    out float vOpacity;
    in vec2 uv;
    out vec2 vUv;

    void main() {
        vOpacity = opacity;
        vUv = vec2(uv.x, 1.0 - uv.y); // flip texture vertically, because of how it's stored
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const instanceFS = `#version 300 es
    precision highp float;
    precision highp int;
    precision highp sampler2DArray;

    in float vOpacity;
    in float vGrayscale;
    in float vTexIndex;
    in vec2 vUv;

    uniform sampler2DArray diffuse;
    out vec4 fragmentColor;

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
    in float vTexIndex;
    in vec2 vUv;

    uniform sampler2DArray diffuse;
    out vec4 fragmentColor;

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

const instanceNodeIconFS = `#version 300 es
    precision highp float;
    precision highp int;
    precision highp sampler2DArray;
    
    uniform float time;
    uniform sampler2DArray diffuse;
    in float vOpacity;
    in vec2 vUv;
    out vec4 fragmentColor;

    void main() {
        float modulo = mod(time, 50.0);
        if (modulo > 50.0) {
            discard;
        }
        vec4 temp = texture(diffuse, vec3(vUv, 0));
        if (modulo < 25.0) {
            temp.a = temp.a * vOpacity * (modulo / 25.0);
        } else {
            temp.a = temp.a * vOpacity * (1.0 - (modulo - 25.0) / 25.0);
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
        { type: ConnType.SEASONAL, params: { params: 'Spring' } },
        { type: ConnType.SEASONAL, params: { params: 'Summer' } },
        { type: ConnType.SEASONAL, params: { params: 'Fall' } },
        { type: ConnType.SEASONAL, params: { params: 'Winter' } },
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
    connTypes.forEach(connType => {
        const type = connType.hasOwnProperty('type') ? connType.type : connType;
        const params = connType.hasOwnProperty('params') ? connType.params : null;
        let char = getConnTypeChar(type, params);
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
            texIndexes[iconIndex] = connTypes.findIndex(ct => (ct.hasOwnProperty('type') ? ct.type : ct) === icon.type && (!ct.hasOwnProperty('params') || ct.params.params === icon.typeParams));
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
                if (texIndex == 0 || texIndex == 16) {
                    if (is2d) {
                        if (start.x > end.x) {
                            if (texIndex == 0)
                                unsortedIconTexIndexes[index] = 16;
                        } else if (texIndex == 16)
                            unsortedIconTexIndexes[index] = 0;
                    } else {
                        if (graph.graph2ScreenCoords(start.x, start.y, start.z).x > graph.graph2ScreenCoords(end.x, end.y, end.z).x) {
                            if (texIndex == 0)
                                unsortedIconTexIndexes[index] = 16;
                        } else if (texIndex == 16)
                            unsortedIconTexIndexes[index] = 0;
                    }
                }
                index++;
                iconIndex++;
            });
        });
        sortIconInstances(iconObject, unsortedIconOpacities, unsortedIconGrayscales, unsortedIconTexIndexes);
        iconObject.instanceMatrix.needsUpdate = true;
    }
}

function sortIconInstances(instanceObject, unsortedOpacities, unsortedGrayscales, unsortedTexIndexes) {
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
                    const worldName = getLocalizedLabel(world.title, world.titleJP);

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
        let iconIndex = 0;
        graph.graphData().nodes.forEach(node => {
            nodeObject.getMatrixAt(index, dummy.matrix);
            if (!is2d)
                dummy.position.set(node.x, node.y, node.z);
            else
                dummy.position.set(node.x, node.y, 0);
            const scale = worldScales[node.id];
            dummy.scale.set(13 * scale, 9.75 * scale, is2d ? 1 : 13 * scale);
            dummy.updateMatrix();
            nodeObject.setMatrixAt(index, dummy.matrix);
            index++;
            
            if (is2d && nodeIconObject && node.isNew) {
                nodeIconObject.getMatrixAt(iconIndex, dummy.matrix);
                dummy.position.set(node.x + (dummy.scale.x / 2) - (1.625 + (4 / 13)) * scale, node.y + (dummy.scale.y / 2) - 1.21875 * scale, 0);
                dummy.scale.set(13 * scale, 9.75 * scale, is2d ? 1 : 13 * scale);
                const x = new THREE.Vector3();
                x.setFromMatrixScale(dummy.matrix);
                dummy.updateMatrix();
                nodeIconObject.setMatrixAt(iconIndex, dummy.matrix);
                iconIndex++;
            }
        });
        nodeObject.instanceMatrix.needsUpdate = true;
        if (is2d && nodeIconObject)
            nodeIconObject.instanceMatrix.needsUpdate = true;
    }
}

function updateNodeLabels2D() {
    if (nodeObject) {
        let index = 0;
        let rIndex = 0;
        let iconIndex = 0;
        const nodes = graph.graphData().nodes;
        const totalNodeCount = nodes.length;
        const removedNodeCount = nodes.filter(n => n.removed).length;
        nodes.forEach(node => {
            if (isNodeLabelVisible(node)) {
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
            if (nodeIconObject && node.isNew)
                nodeIconObject.geometry.attributes.opacity.array[iconIndex++] = getNodeOpacity(node.id);
        });
        nodeObject.geometry.attributes.texIndex.needsUpdate = true;
        if (nodeIconObject)
            nodeIconObject.geometry.attributes.opacity.needsUpdate = true;
    }
}

function makeNodeIconObject() {
    const opacities = [];
    let iconCount = 0;

    iconCount = 0;
    graph.graphData().nodes.forEach(node => {
        if (node.isNew)
            opacities[iconCount++] = 1.0;
    });

    const buffer = new ArrayBuffer(nodeIconImgDimensions.x * nodeIconImgDimensions.y * 4);

    let nodeIconImgData = new Uint8ClampedArray(buffer);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = nodeIconImgDimensions.x;
    canvas.height = nodeIconImgDimensions.y;
    context.font = '50px MS Gothic';
    context.textAlign = 'right';
    context.textBaseline = 'top';
    context.fillStyle = 'gold';
    context.strokeStyle = '#4d4000';
    context.lineWidth = 5;
    context.strokeText(localizedNodeIconNew, nodeIconImgDimensions.x - 4, 2);
    context.fillText(localizedNodeIconNew, nodeIconImgDimensions.x - 4, 2);
    nodeIconImgData.set(context.getImageData(0, 0, nodeIconImgDimensions.x, nodeIconImgDimensions.y).data, 0);

    const texture = new THREE.DataTexture2DArray(nodeIconImgData, nodeIconImgDimensions.x, nodeIconImgDimensions.y, 1);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    const material = new THREE.RawShaderMaterial({
        uniforms: {
            diffuse: { value: texture },
            time: { value: 0 }
        },
        vertexShader: instanceNodeIconVS,
        fragmentShader: instanceNodeIconFS,
        transparent: true,
        depthTest: !is2d,
        depthWrite: false
    });

    const geometry = new THREE.PlaneBufferGeometry(0.25, 0.25);
    geometry.attributes.opacity = new THREE.InstancedBufferAttribute(new Float32Array(opacities), 1);

    nodeIconObject = new THREE.InstancedMesh(geometry, material, iconCount);
    nodeIconObject.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nodeIconObject.renderOrder = 1;
    graph.scene().add(nodeIconObject);
}
// END WEBGL2.0 SPECIFIC CODE

function getLocalizedNodeLabel(localizedNodeLabel, forPath) {
    return `<span class='node-label__world node-label__value'>{WORLD}</span><br>
            ${localizedNodeLabel.depth}<span class='node-label__value' style='color:{DEPTH_COLOR}'>{DEPTH}</span>
            ${forPath ? " <span class='node-label__value' style='color:{MIN_DEPTH_COLOR}'>({MIN_DEPTH})</span>" : ""}<br>
            ${localizedNodeLabel.author}<span class='node-label__value'>{AUTHOR}</span><br>
            ${localizedNodeLabel.versionAdded}<span class='node-label__value'>{VERSION_ADDED}</span>`;
}

function getLocalizedNodeLabelVersionLastUpdated(localizedNodeLabel, includeUpdateType) {
    return `<br><span class='node-label__last-updated'>
                <span>${localizedNodeLabel.versionLastUpdated}<span class='node-label__value'>{VERSION_LAST_UPDATED}</span></span>
                <span class='node-label__value node-label__last-updated__update-type'>${(includeUpdateType ? '{VERSION_LAST_UPDATED_TYPE}' : '')}</span>
            </span>`;
}

function getLocalizedNodeLabelVersionRemoved(localizedNodeLabel) {
    return `<br>${localizedNodeLabel.versionRemoved}<span class='node-label__value'>{VERSION_REMOVED}</span>`;
}

function getLocalizedNodeLabelVersionUpdateTypes(localizedNodeLabel) {
    const ret = {};
    const versionUpdateTypeKeys = Object.keys(versionUtils.VersionEntryUpdateType);
    const versionUpdateTypeCodes = Object.values(versionUtils.VersionEntryUpdateType);
    versionUpdateTypeCodes.forEach((vut, i) => {
        const key = versionUpdateTypeKeys[i];
        ret[vut] = localizedNodeLabel.versionUpdateType.hasOwnProperty(key)
            ? localizedNodeLabel.versionUpdateType[key]
            : "";
    });
    return ret;
}

function getLocalizedAuthorLabel(localizedAuthorLabel) {
    return `<span class='author-entry-tooltip__author tooltip__value'>{AUTHOR}</span><br>
            <span class='js--author-entry-tooltip__first-version tooltip__value'>{FIRST_VERSION}</span><span class='js--author-entry-tooltip__last-version'>${localizedSeparator}<span class='tooltip__value'>{LAST_VERSION}</span></span><br>
            ${localizedAuthorLabel.worldCount}<span class='tooltip__value'>{WORLD_COUNT}</span></span>`;
}

function getLocalizedVersionLabel(localizedVersionLabel) {
    return `<span class='version-entry-tooltip__version tooltip__value'>{VERSION}</span><br>
            ${localizedVersionLabel.authors}{AUTHORS}
            <br>${localizedVersionLabel.releaseDate}{RELEASE_DATE}
            <span class='js--version-entry-tooltip__world-count'><br>${localizedVersionLabel.worldCount}<span class='tooltip__value'>{WORLD_COUNT}</span></span>
            <span class='js--version-entry-tooltip__updated-world-count'><br>${localizedVersionLabel.updatedWorldCount}<span class='tooltip__value'>{UPDATED_WORLD_COUNT}</span></span>
            <span class='js--version-entry-tooltip__removed-world-count'><br>${localizedVersionLabel.removedWorldCount}<span class='tooltip__value'>{REMOVED_WORLD_COUNT}</span></span>`;
}

function getLocalizedVersionDetails(localizedVersionDetails) {
    const ret = {};
    const entryTypeKeys = Object.keys(versionUtils.VersionEntryType);
    const entryUpdateTypeKeys = Object.keys(versionUtils.VersionEntryUpdateType);
    
    const keys = Object.keys(localizedVersionDetails);

    for (let k of keys) {
        const keyIndex = entryTypeKeys.indexOf(k);
        if (keyIndex > -1) {
            const entryType = versionUtils.VersionEntryType[entryTypeKeys[keyIndex]];
            if (entryType === versionUtils.VersionEntryType.UPDATE) {
                ret[entryType] = {};
                const updateTypeKeys = Object.keys(localizedVersionDetails[k]).filter(k => k !== 'label');
                for (let utk of updateTypeKeys) {
                    const updateTypeKeyIndex = entryUpdateTypeKeys.indexOf(utk);
                    if (updateTypeKeyIndex > -1) {
                        const entryUpdateType = versionUtils.VersionEntryUpdateType[entryUpdateTypeKeys[updateTypeKeyIndex]];
                        ret[entryType][entryUpdateType] = localizedVersionDetails[k][utk];
                    }
                }
            } else {
                ret[entryType] = localizedVersionDetails[k];
            }
        }
    }

    return ret;
}

function getLocalizedEffectLabel(localizedEffectLabel) {
    return `<span class="effect-tooltip__effect tooltip__value">{EFFECT}</span><br>
            <span class="effect-tooltip__location">${localizedEffectLabel.location}<span class="tooltip__value">{LOCATION}</span><br></span>{METHOD}`;
}

function getLocalizedWallpaperLabel(localizedWallpaperLabel) {
    return `<span class="js--wallpaper-tooltip__wallpaper wallpaper-tooltip__wallpaper tooltip__value">${localizedWallpaperLabel.number}{WALLPAPER_ID}<span class="js--wallpaper-tooltip__title">${localizedWallpaperLabel.titleTemplate}</span></span><br>
            {METHOD}`;
}

function getLocalizedBgmTrackLabel(localizedBgmTrackLabel) {
    return `<span class="js--bgm-track-tooltip__bgm-track-id bgm-track-tooltip__bgm-track-id tooltip__value">{BGM_TRACK_ID}<br></span>
            <span class="js--bgm-track-tooltip__name bgm-track-tooltip__name tooltip__value">{NAME}</span><br>
            <span class="js--bgm-track-tooltip__location bgm-track-tooltip__location">${localizedBgmTrackLabel.location}<span class="tooltip__value">{LOCATION}</span><br></span>
            {NOTES}`;
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

function updateNodeLabels(is2d, time) {
    if (config.labelMode > 0 || !is2d) {
        const camera = graph.camera();
        const modTime = time % 50;
        const opacityMultiplier = (modTime < 25 ? modTime : 50 - modTime) / 25;
        graph.graphData().nodes.forEach(node => {
            const obj = node.__threeObj;
            if (obj) {
                const showLabel = isNodeLabelVisible(node);
                const text = obj.children[0];
                const scale = worldScales[node.id];
                const textOpacity = showLabel ? getNodeOpacity(node.id) : 0;
                let dir;
                if (!is2d && showLabel) {
                    dir = new THREE.Vector3();
                    dir.subVectors(camera.position, obj.getWorldPosition(dir)).normalize();
                }
                if (showLabel) {
                    if (!is2d) {
                        text.position.set(0, 0, 0);
                        text.translateOnAxis(dir, 10.5 * scale);
                    }
                    text.material.opacity = textOpacity;
                    text.color = getNodeTextColor(node);
                    text.scale.x = text.defaultScale.x * scale;
                    text.scale.y = text.defaultScale.y * scale;
                    
                    text.visible = true;
                } else
                    text.visible = false;

                if (((isWebGL2 && node.isNew && !is2d) || (!isWebGL2 && obj.children.length > 1))) {
                    const iconLabel = obj.children[1];
                    if (showLabel) {
                        if (!is2d) {
                            iconLabel.position.set(0, 0, 0);
                            iconLabel.translateOnAxis(dir, 9.75 * scale);
                        }
                        iconLabel.scale.x = iconLabel.defaultScale.x * scale;
                        iconLabel.scale.y = iconLabel.defaultScale.y * scale;
                        iconLabel.material.opacity = textOpacity * opacityMultiplier;
                        iconLabel.visible = true;
                    } else
                        iconLabel.visible = false;
                }
            }
        });
    }
}

function getNodeOpacity(id) {
    const author = tempSelectedAuthor || selectedAuthor;
    const versionIndex = tempSelectedVersionIndex || selectedVersionIndex;
    const filterForAuthor = author != null && worldData[id].author !== author;
    const filterForVersion = versionIndex && !versionUtils.isWorldInVersion(worldData[id], versionIndex, missingVersionIndex, tempSelectedVersionIndex);
    const opacity = ((selectedWorldId == null && !filterForAuthor && !filterForVersion)
        || id === selectedWorldId) && (!searchWorldIds.length || searchWorldIds.indexOf(id) > -1)
        ? 1
        : selectedWorldId != null && worldData[selectedWorldId].connections.find(c => c.targetId === id) || (!filterForAuthor && filterForVersion && !tempSelectedVersionIndex && versionIndex !== missingVersionIndex && !worldData[id].verAdded)
        ? 0.625
        : 0.1;
    return opacity;
}

function getNodeGrayscale(node) {
    if (!node.removed)
        return 0;

    const id = node.id;
    const author = tempSelectedAuthor || selectedAuthor;
    const versionIndex = tempSelectedVersionIndex || selectedVersionIndex;
    const grayscale = id === selectedWorldId || (versionIndex && !versionUtils.isWorldInVersion(worldData[id], versionIndex, missingVersionIndex, tempSelectedVersionIndex))
        ? 0
        : id === hoverWorldId || (author != null && worldData[id].author === author)
            || (searchWorldIds.length && searchWorldIds.indexOf(id) > -1) || (selectedWorldId != null && worldData[selectedWorldId].connections.find(c => c.targetId === id))
        ? 0.625
        : 1;
    return grayscale;
}

function getNodeTextColor(node, grayscale) {
    if (grayscale === undefined && node)
        grayscale = getNodeGrayscale(node);
    return nodeTextColors[!grayscale ? 0 : grayscale === 1 ? 2 : 1];
}

function isNodeLabelVisible(node) {
    return config.labelMode === 3 || (config.labelMode > 0 && ((config.labelMode === 1 && node.id === hoverWorldId) || (config.labelMode === 2 && node.id === selectedWorldId)));
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
                    if (link.source.x > link.target.x)
                        text.material.map.repeat.x = -1;
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
    iconLabel.innerHTML = '';
    iconLabel.id = 'iconLabel';
    iconLabel.className = 'scene-tooltip';
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

function updateNodeIconAnimation(time) {
    nodeIconObject.material.uniforms.time.value = time;
}

function updateLinkColors(linkData, bufferedObject, unfilteredLinkData) {
    const colors = bufferedObject.geometry.attributes.color.array;
    const opacities = bufferedObject.geometry.attributes.opacity.array;
    const author = tempSelectedAuthor || selectedAuthor;
    const versionIndex = tempSelectedVersionIndex || selectedVersionIndex;
    let index = 0;
    let opacityIndex = 0;
    linkData.forEach(link => {
        let color;
        let opacity;
        const grayscale = getLinkGrayscale(link);
        const sourceId = link.source.id !== undefined ? link.source.id : link.source;
        const targetId = link.target.id !== undefined ? link.target.id : link.target;
        const filterForAuthor = author != null && (worldData[sourceId].author !== author || worldData[targetId].author !== author);
        const filterForVersion = versionIndex && (!versionUtils.isWorldInVersion(worldData[sourceId], versionIndex, missingVersionIndex, tempSelectedVersionIndex) || !versionUtils.isWorldInVersion(worldData[targetId], versionIndex, missingVersionIndex, tempSelectedVersionIndex));
        if (selectedWorldId != null && (selectedWorldId === sourceId || selectedWorldId === targetId)) {
            opacity = 1.0;
            color = colorLinkSelected;
        } else if ((selectedWorldId == null && !filterForAuthor && !filterForVersion)
            && (!searchWorldIds.length || searchWorldIds.indexOf(sourceId) > -1 || searchWorldIds.indexOf(targetId) > -1)) {
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
    const author = tempSelectedAuthor || selectedAuthor;
    const versionIndex = tempSelectedVersionIndex || selectedVersionIndex;
    const filterForAuthor = author != null && (worldData[sourceId].author !== author || worldData[targetId].author !== author);
    const filterForVersion = versionIndex && (!versionUtils.isWorldInVersion(worldData[sourceId], versionIndex, missingVersionIndex, tempSelectedVersionIndex) || !versionUtils.isWorldInVersion(worldData[targetId], versionIndex, missingVersionIndex, tempSelectedVersionIndex));
    return ((selectedWorldId == null && !filterForAuthor && !filterForVersion) || (selectedWorldId != null && (selectedWorldId === sourceId || selectedWorldId === targetId)))
        && (!searchWorldIds.length || searchWorldIds.indexOf(sourceId) > -1 || searchWorldIds.indexOf(targetId) > -1)
        ? 1
        : (selectedWorldId != null && (selectedWorldId === sourceId || selectedWorldId === targetId)) || (!filterForAuthor && filterForVersion && !tempSelectedVersionIndex && versionIndex !== missingVersionIndex && (!worldData[sourceId].verAdded || !worldData[targetId].verAdded))
        ? 0.625
        : 0.1;
}

function getLinkGrayscale(link) {
    const sourceId = link.source.id !== undefined ? link.source.id : link.source;
    const targetId = link.target.id !== undefined ? link.target.id : link.target;
    const author = tempSelectedAuthor || selectedAuthor;
    const versionIndex = tempSelectedVersionIndex || selectedVersionIndex;
    const sourceWorld = worldData[sourceId];
    const targetWorld = worldData[targetId];

    if (!sourceWorld.removed && !targetWorld.removed)
        return 0;

    return sourceId === selectedWorldId || targetId === selectedWorldId
        ? 0
        : (sourceId === hoverWorldId || targetId === hoverWorldId) || (author != null && (sourceWorld.author === author || targetWorld.author === author))
            || (versionIndex && versionUtils.isWorldInVersion(sourceWorld, versionIndex, missingVersionIndex, tempSelectedVersionIndex) && versionUtils.isWorldInVersion(targetWorld, versionIndex, missingVersionIndex, tempSelectedVersionIndex))
            || (searchWorldIds.length && (searchWorldIds.indexOf(sourceId) > -1 || searchWorldIds.indexOf(targetId) > -1))
        ? 0.375
        : 0.85;
}

function getConnTypeIcon(connType, typeParams) {
    const useEn = getLangUsesEn(config.lang);
    const localizedConn = localizedConns[connType];
    const char = getConnTypeChar(connType, typeParams);
    const name = localizedConn.name;
    let description = localizedConn.description;
    if (description) {
        switch (connType) {
            case ConnType.EFFECT:
                description = typeParams && ((useEn && typeParams.params) || (!useEn && typeParams.paramsJP))
                    ? description.replace('{0}', getLocalizedLabel(typeParams.params, typeParams.paramsJP))
                    : null;
                break;
            case ConnType.CHANCE:
                description = typeParams && typeParams.params
                    ? description.replace('{0}', useEn ? typeParams.params : typeParams.params.replace('%', '％'))
                    : '';
                break;
            case ConnType.LOCKED_CONDITION:
            case ConnType.SEASONAL:
                description = typeParams && ((useEn && typeParams.params) || (!useEn && typeParams.paramsJP))
                    ? description.replace('{0}', getLocalizedLabel(typeParams.params, typeParams.paramsJP))
                    : '';
                break;
        }
    }
    return {
        type: connType,
        typeParams: typeParams ? typeParams.params : null,
        char: char,
        text: name + (description ? (useEn ? localizedSeparator : '：') + description : '')
    };
}

function getConnTypeChar(connType, typeParams) {
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
        case ConnType.SEASONAL:
            const seasonParam = typeParams ? typeParams.params : null;
            switch (seasonParam || "Summer") {
                case "Spring":
                    char = "🌸";
                    break;
                case "Summer":
                    char = "☀️";
                    break;
                case "Fall":
                    char = "🍂";
                    break;
                case "Winter":
                    char = "❄️";
                    break;
            }
            break;
        case ConnType.INACCESSIBLE:
            char = "🚫";
            break;
    }
    return char;
}

function tempSelectAuthor(author, ignoreChange) {
    tempSelectedAuthor = author;
    if (author && tempSelectedVersionIndex)
        tempSelectVersion(0, true);
    $('.js--author').toggleClass('temp-select', !!author).val(author || selectedAuthor || 'null');
    if (!ignoreChange)
        $('.js--author').trigger('change');
}

function tempSelectVersion(versionIndex, ignoreChange) {
    tempSelectedVersionIndex = versionIndex;
    if (versionIndex && tempSelectedAuthor != null)
        tempSelectAuthor(null, true);
    $('.js--version').toggleClass('temp-select', !!versionIndex).val(versionIndex || selectedVersionIndex || '0');
    if (!ignoreChange)
        $('.js--version').trigger('change');
}

function reloadGraph() {
    tempSelectAuthor(null, true);
    tempSelectVersion(0, true);
    const startWorld = startWorldId != null ? worldData[startWorldId] : null;
    const endWorld = endWorldId != null ? worldData[endWorldId] : null;
    const matchPaths = startWorld && endWorld && startWorld != endWorld
        ? findPath(startWorld.id, endWorld.id, true, ConnType.NO_ENTRY | ConnType.DEAD_END | ConnType.ISOLATED | ConnType.SHORTCUT, config.pathMode === 0 ? 3 : config.pathMode === 1 ? 5 : 10)
        : null;
    if (graph)
        graph._destructor();
    initGraph(config.renderMode, config.displayMode, matchPaths);
    if (urlSearchParams.has('location')) {
        const worldName = urlSearchParams.get('location');
        const node = graph.graphData().nodes.find(n => worldData[n.id].title === worldName);
        if (node) {
            window.setTimeout(function () {
                trySelectNode(node, true, true);
            }, 2000);
        }
    }
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
            if (matchPaths.slice(0, pathCount).filter(mp => mp.find(p => p.connType && (p.connType & ignoreTypes))).length === pathCount) {
                if (matchPaths.length > rootLimit) {
                    for (let mp = rootLimit + 1; mp < matchPaths.length; mp++) {
                        const path = matchPaths[mp];
                        if (!path.find(p => p.connType && (p.connType & ignoreTypes))) {
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
                const reverseConn = connWorld.connections.find(c => c.targetId === world.id);
                let reverseConnType = 0;
                let reverseConnTypeParams = {};
                if (reverseConn) {
                    reverseConnType = reverseConn.type;
                    reverseConnTypeParams = reverseConn.typeParams;
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
    const nexusWorldId = worldData.find(w => w.title === nexusWorldName).id;

    if (sourceId !== nexusWorldId) {
        isDebug && console.log("Searching for paths eligible for Eyeball Bomb Nexus shortcut...");
        const nexusPaths = existingMatchPaths.concat(matchPaths).filter(p => (p.length > targetId !== nexusWorldId ? 2 : 3) && p.find(w => w.id === nexusWorldId));
        if (nexusPaths.length) {
            isDebug && console.log("Found", nexusPaths.length, "paths eligible for Eyeball Bomb Nexus shortcut: creating shortcut paths");
            for (let nexusPath of nexusPaths) {
                const nexusWorldIndex = nexusPath.indexOf(nexusPath.find(w => w.id === nexusWorldId));
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
            let skipPath = pathWorldDepth > 0 && path.slice(0, pathWorldDepth).find(w => w.connType & ignoreTypeFlags);
            if (skipPath)
                continue;
        }

        if (ret === -1 || pathWorldDepth < ret)
            ret = pathWorldDepth;
    }

    return ret > -1 ? ret : findRealPathDepth(paths, worldId, pathWorldIds, worldDepthsMap, maxDepth, minDepth, ignoreTypeFlags);
}

function initLocalization(isInitial) {
    if (isInitial && urlSearchParams.has("lang")) {
        const urlLang = urlSearchParams.get("lang");
        if (/^(?:en|ja|zh|ko)$/.test(urlLang))
            config.lang = urlLang;
    }

    $("[data-localize]").localize("ui", {
        language: config.lang,
        pathPrefix: "/lang",
        callback: function (data, defaultCallback) {
            if (config.lang === 'ja' || config.lang === 'ru')
                massageLocalizedValues(data, true);
            data.footer.about = data.footer.about.replace("{VERSION}", "4.1.1");
            data.footer.lastUpdate = data.footer.lastUpdate.replace("{LAST_UPDATE}", isInitial ? "" : formatDate(lastUpdate, config.lang, true));
            data.footer.lastFullUpdate = data.footer.lastFullUpdate.replace("{LAST_FULL_UPDATE}", isInitial ? "" : formatDate(lastFullUpdate, config.lang, true));
            localizedSeparator = data.separator;
            localizedDot = data.dot;
            localizedComma = data.comma;
            localizedBraces = data.braces;
            localizedNA = data.na;
            localizedConns = data.conn;
            if (worldData)
                initContextMenu(data.contextMenu);
            localizedNodeLabel = getLocalizedNodeLabel(data.nodeLabel);
            localizedPathNodeLabel = getLocalizedNodeLabel(data.nodeLabel, true)
            localizedNodeLabelVersionLastUpdated = getLocalizedNodeLabelVersionLastUpdated(data.nodeLabel);
            localizedNodeLabelVersionLastUpdatedWithUpdateType = getLocalizedNodeLabelVersionLastUpdated(data.nodeLabel, true);
            localizedNodeLabelVersionRemoved = getLocalizedNodeLabelVersionRemoved(data.nodeLabel);
            localizedNodeLabelVersionUpdateTypes = getLocalizedNodeLabelVersionUpdateTypes(data.nodeLabel);
            localizedAuthorLabel = getLocalizedAuthorLabel(data.authorLabel);
            localizedVersionLabel = getLocalizedVersionLabel(data.versionLabel);
            localizedEffectLabel = getLocalizedEffectLabel(data.effectLabel);
            localizedWallpaperLabel = getLocalizedWallpaperLabel(data.wallpaperLabel);
            localizedBgmTrackLabel = getLocalizedBgmTrackLabel(data.bgmTrackLabel);
            localizedNodeIconNew = data.nodeIcon.new;
            localizedVersionDetails = getLocalizedVersionDetails(data.versionDetails);
            localizedVersionDisplayToggle = data.versionEntriesModal.versionDisplayToggle;

            if (isInitial) {
                Object.keys(data.settings.uiTheme.values).forEach(t => {
                    $(".js--ui-theme").append('<option data-localize="settings.uiTheme.values.' + t + '" value="' + t + '">' + data.settings.uiTheme.values[t] + '</option>');
                });
                $(".js--ui-theme").val(config.uiTheme).trigger("change");
            } else {
                initAuthorSelectOptions();
                initVersionSelectOptions();
            }
            window.setTimeout(() => updateControlsContainer(true), 0);
            defaultCallback(data);
        }
    });

    let helpLangIndex = helpLangs.indexOf(config.lang);
    if (helpLangIndex < 0)
        helpLangIndex = helpLangs.indexOf(getLangUsesEn(config.lang) ? 'en' : 'ja');
    const compatibleHelpLang = helpLangs[helpLangIndex];

    $(".js--help-modal__content--localized__text").each(function () {
        $(this).toggle($(this).data('lang') === compatibleHelpLang);
    });

    $('html').attr('lang', config.lang);

    $.localize("conn", {
        language: config.lang,
        pathPrefix: "/lang",
        callback: function (data) {
            localizedConns = data;
            if (config.lang === 'ja' || config.lang === 'ru')
                massageLocalizedValues(localizedConns);
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
        if (worldsByName) {
            $(".js--world-input").each(function() {
                const val = $(this).val();
                if (val && worldNames.indexOf(val) > -1) {
                    const world = worldsByName[worldNames[worldNames.indexOf(val)]];
                    $(this).val(getLocalizedLabel(world.title, world.titleJP));
                }
            });
        }

        worldsByName = _.keyBy(worldData, w => getLocalizedLabel(w.title, w.titleJP));

        worldNames = Object.keys(worldsByName);

        $(".js--path--world-input").each(function () {
            $(this).off("change").devbridgeAutocomplete("destroy");
            $(this).on("change", function () {
                const currentWorldId = $(this).is(".js--start-world") ? startWorldId : endWorldId;
                const currentWorld = worldData[currentWorldId];
                if (currentWorld != null && $(this).val() !== (getLocalizedLabel(currentWorld.title, currentWorld.titleJP))) {
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

        $(".js--author-entry").each(function () {
            const displayName = $(this).data(getLangUsesEn(config.lang) ? "displayName" : "displayNameJp");
            $(this).find('h1').text(displayName);
        });
    }
}

function massageLocalizedValues(data, isUI) {
    if (data) {
        Object.keys(data).forEach(function (key) {
            const value = data[key];
            if (value) {
                switch (typeof value) {
                    case "object":
                        massageLocalizedValues(value, isUI);
                        break;
                    case "string":
                        data[key] = getMassagedLocalizedValue(value, isUI);
                        break;
                }
            }
        });
    }
}

function getMassagedLocalizedValue(value, isUI) {
    switch (config.lang) {
        case "ja":
            if (isUI && value.indexOf(" ") > -1)
                return value.split(/ +/g).map(v => `<span class="jp-word-break">${v}</span>`).join("");
            break;
        case "ru":
            return value.replace(/([\u0400-\u04FF]+)/g, '<span class="ru-spacing-fix">$1</span>');
    }
    return value;
}

function initWorldSearch() {
    const $search = $(".js--search-world");
    $search.devbridgeAutocomplete("destroy");
    const visibleWorldNames = worldData ? worldData.filter(w => visibleWorldIds.indexOf(w.id) > -1).map(w => getLocalizedLabel(w.title, w.titleJP)) : [];
    if (selectedWorldId != null && visibleWorldIds.indexOf(selectedWorldId) === -1) {
        $search.removeClass("selected").val("");
        selectedWorldId = null;
    }
    $search.devbridgeAutocomplete({
        lookup: visibleWorldNames,
        triggerSelectOnValidInput: false,
        onSearchComplete: function (query, searchWorlds) {
            const selectedWorld = selectedWorldId != null ? worldData[selectedWorldId] : null;
            const selectedWorldName = selectedWorld ? getLocalizedLabel(selectedWorld.title, selectedWorld.titleJP) : null;
            searchWorldIds = searchWorlds.length && (!selectedWorld || (searchWorlds.length > 1 || searchWorlds.find(w => w.value !== selectedWorldName))) ? searchWorlds.map(w => worldsByName[w.value].id) : [];
            if (searchWorldIds.length && selectedWorld && (searchWorldIds.length !== 1 || selectedWorldId !== searchWorldIds[0])) {
                $search.removeClass("selected");
                selectedWorldId = null;
            }
            highlightWorldSelection();
        },
        onSelect: function (selectedWorld) {
            $search.addClass("selected");
            const worldId = worldsByName[selectedWorld.value].id;
            trySelectNode(graph.graphData().nodes.find(n => n.id === worldId), true, true);
        },
        onHide: function () {
           if (selectedWorldId != null) {
                const selectedWorld = worldData[selectedWorldId];
                const selectedWorldName = getLocalizedLabel(selectedWorld.title, selectedWorld.titleJP);
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

function initAuthorSelectOptions() {
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
        $opt.text(a ? getAuthorDisplayName(a) : localizedNA);
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

function initVersionSelectOptions() {
    const $versionSelect = $('.js--version');
    $versionSelect.find('option:not(:first-child)').remove();
    versionData.forEach(v => {
        const $opt = $('<option>');
        if (!v.addedWorldIds.length && !v.removedWorldIds.length && v.index !== missingVersionIndex)
            $opt.addClass('temp-select-only');
        $opt.val(v.index);
        $opt.text(getLocalizedLabel(v.name, v.nameJP, true));
        $versionSelect.append($opt);
    });
    if (!selectedVersionIndex)
        $versionSelect.val(0);
    else if (selectedVersionIndex) {
        const validVersionIndex = selectedVersionIndex && selectedVersionIndex <= versionData.length;
        if (!validVersionIndex)
            selectedVersionIndex = null;
        $versionSelect.val(validVersionIndex ? selectedVersionIndex : 0);
    }
}

function initContextMenu(localizedContextMenu) {
    $.contextMenu('destroy');

    const mapSubItems = {};
    const bgmSubItems = {};
    const menuItems = {
        wiki: {
            name: () => localizedContextMenu.items.wiki,
            callback: () => openWorldWikiPage(contextWorldId)
        },
        start: {
            name: () => localizedContextMenu.items.start,
            callback: function () {
                const world = worldData[contextWorldId];
                const worldName = getLocalizedLabel(world.title, world.titleJP);
                $('.js--start-world').val(worldName).trigger('change').devbridgeAutocomplete().select(0);
            }
        },
        end: {
            name: () => localizedContextMenu.items.end,
            callback: function () {
                const world = worldData[contextWorldId];
                const worldName = getLocalizedLabel(world.title, world.titleJP);
                $('.js--end-world').val(worldName).trigger('change').devbridgeAutocomplete().select(0);
            }
        },
        map: {
            name: () => localizedContextMenu.items.map,
            callback: function () {
                const world = worldData[contextWorldId];
                if (world.mapUrl.indexOf('|') === -1) {
                    const handle = window.open(world.mapUrl, '_blank', 'noreferrer');
                    if (handle)
                        handle.focus();
                }
            },
            visible: function () {
                const world = worldData[contextWorldId];
                return world.mapUrl && world.mapUrl.indexOf('|') === -1;
            }
        },
        maps: {
            name: () => localizedContextMenu.items.map,
            visible: function () {
                const world = worldData[contextWorldId];
                return world.mapUrl && world.mapUrl.indexOf('|') > -1;
            },
            items: mapSubItems
        },
        bgm: {
            name: () => localizedContextMenu.items.bgm.name,
            callback: function () {
                const world = worldData[contextWorldId];
                if (world.bgmUrl.indexOf('|') === -1) {
                    if (!isCtrl) {
                        const worldName = getLocalizedLabel(world.title, world.titleJP);
                        playBgm(world.bgmUrl, getBgmLabel(worldName, world.bgmLabel), world.filename, world.id);
                    } else {
                        const handle = window.open(world.bgmUrl, '_blank', 'noreferrer');
                        if (handle)
                            handle.focus();
                    }
                }
            },
            visible: function () {
                const world = worldData[contextWorldId];
                return world.bgmUrl && world.bgmUrl.indexOf('|') === -1;
            },
            disabled: () => !worldData[contextWorldId].bgmUrl
        },
        bgms: {
            name: () => localizedContextMenu.items.bgm.name,
            visible: function () {
                const world = worldData[contextWorldId];
                return world.bgmUrl && world.bgmUrl.indexOf('|') > -1;
            },
            items: bgmSubItems
        }
    };

    for (let world of worldData) {
        const worldId = world.id;
        const visibleFunc = () => contextWorldId === worldId;

        if (world.mapUrl && world.mapUrl.indexOf('|') > -1) {
            const mapUrls = world.mapUrl.split('|');
            const mapLabels = world.mapLabel.split('|');

            for (let m = 0; m < mapUrls.length; m++) {
                const mapIndex = m;
                mapSubItems[`map${worldId}_${mapIndex + 1}`] = {
                    name: mapLabels[mapIndex],
                    callback: function () {
                        const handle = window.open(mapUrls[mapIndex], '_blank', 'noreferrer');
                        if (handle)
                            handle.focus();
                    },
                    visible: visibleFunc
                };
            }
        }
        
        if (world.bgmUrl && world.bgmUrl.indexOf('|') > -1) {
            const worldName = getLocalizedLabel(world.title, world.titleJP);
            const bgmUrls = world.bgmUrl.split('|');
            const bgmLabels = getBgmLabels(world.bgmLabel.split('|'), localizedContextMenu.items.bgm);
            for (let b = 0; b < bgmUrls.length; b++) {
                const bgmIndex = b;
                bgmSubItems[`bgm${worldId}_${bgmIndex + 1}`] = {
                    name: bgmLabels[bgmIndex],
                    callback: function () {
                        const bgmUrl = bgmUrls[bgmIndex];
                        if (!isCtrl) {
                            playBgm(bgmUrl, getBgmLabel(worldName, world.bgmLabel.split('|')[bgmIndex]), world.filename, world.id);
                        } else {
                            const handle = window.open(bgmUrl, '_blank', 'noreferrer');
                            if (handle)
                                handle.focus();
                        }
                    },
                    visible: visibleFunc,
                    disabled: () => !bgmUrls[bgmIndex]
                };
            }
        }
    }

    $.contextMenu({
        selector: '.graph canvas', 
        trigger: 'none',
        items: menuItems
    });
}

function openWorldWikiPage(worldId, newWindow) {
    const world = worldData[worldId];
    window.open(!world.titleJP || world.removed || getLangUsesEn(config.lang)
        ? 'https://yume2kki.fandom.com/wiki/' + world.title
        : ('https://wikiwiki.jp/yume2kki-t/' + (world.titleJP.indexOf("：") > -1 ? world.titleJP.slice(0, world.titleJP.indexOf("：")) : world.titleJP)),
        "_blank", newWindow ? "width=" + window.outerWidth + ",height=" + window.outerHeight : "");
}

function initBgm(url, label, imageUrl, worldId, play, playlistIndex, playlist) {
    const loopAttribute = playlistIndex === undefined || playlistIndex === -1 ? ' loop' : '';
    const $bgmTrackLink = worldId != null ? $(`<a href="javascript:void(0);" class="js--world-node-link no-border" data-world-id="${worldId}"></a>`) : null;
    const $bgmTrackImage = $(`<img src="${imageUrl}" class="audio-player-image noselect" />`);
    $('.audio-player-image-container').empty().append(worldId != null ? $bgmTrackLink.append($bgmTrackImage) : $bgmTrackImage);
    $('.audio-player-player-container').empty().append(`
        <a href="javascript:void(0);" class="close-audio-player noselect">✖</a>
        <marquee class="audio-player-marquee" scrollamount="5">
            <label class="audio-player-label noselect">${label}</label>
        </marquee>
    `).append(`
        <div class="audio-player">
            <audio class="audio-source" crossorigin preload="none"${loopAttribute}></audio>
        </div>
    `);
    $('.audio-player-container').addClass('open');

    audioPlayer = new GreenAudioPlayer('.audio-player');

    const $loadingIndicator = $('.audio-player .loading');
    const $playBtn = $('.audio-player .play-pause-btn');
    const $prevBtn = $(`
        <div class="audio-player-playlist-btn prev-btn" aria-label="Previous" role="button">
            <svg width="18" height="24" viewBox="0 0 18 24" xmlns="http://www.w3.org/2000/svg">
                <path class="prev-btn__icon" d="m3 10v-10h-3v24h3v-10l13 10v-24" fill-rule="evenodd" />
            </svg>
        </div>
    `);
    const $nextBtn = $(`
        <div class="audio-player-playlist-btn next-btn" aria-label="Next" role="button">
            <svg width="18" height="24" viewBox="0 0 18 24" xmlns="http://www.w3.org/2000/svg">
                <path class="next-btn__icon" d="m15 10v-10h3v24h-3v-9l-15 9v-24" fill-rule="evenodd" />
            </svg>
        </div>
    `);
    const $favBtn = $(`
        <div class="audio-player-playlist-btn fav-btn" aria-label="Favourite" role="button">
            <svg width="24" height="24" viewBox="0 -1.5 24 24" xmlns="http://www.w3.org/2000/svg">
                <path class="fav-btn__icon" d="m22.2 2c-2.5-2.7-6.5-2.6-9.1 0.1l-1.1 1.3-1.1-1.3c-2.6-2.7-6.6-2.8-9-0.1h-0.1c-2.4 2.6-2.4 7 0.2 9.7l5.4 5.9 0.1 0.1 4.5 4.8 4.4-4.8h0.1l0.1-0.1 5.4-5.9c2.6-2.7 2.6-7.1 0.2-9.7z" fill-rule="evenodd" />
            </svg>
        </div>
    `);
    const $ignoreBtn = $(`
         <div class="audio-player-playlist-btn ignore-btn" aria-label="Ignore" role="button">
            <svg width="24" height="24" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path class="ignore-btn__icon" d="m9 0a9 9 90 1 0 9 9 9 9 90 0 0 -9 -9zm0 2.1a6.9 6.9 90 0 1 4.1 1.3l-9.7 9.7a6.9 6.9 90 0 1 5.6 -11zm0 13.8a6.9 6.9 90 0 1 -4.1 -1.3l9.6-9.6a6.9 6.9 90 0 1 -5.5 10.9z" fill-rule="evenodd"/>
            </svg>
        </div>
    `);
    const $shuffleBtn = $(`
        <div class="audio-player-playlist-btn shuffle-btn${config.playlistShuffle ? ' on' : ''}" aria-label="Shuffle" role="button">
            <svg width="24" height="24" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path class="shuffle-btn__icon" d="m0 2h7l5 11h3v-2l3 3.5-3 3.5v-2h-5l-5-11h-5m0 11h7l0.9-2-2-3-0.9 2h-5m10.6-5l1.4-3h3v2l3-3.5-3-3.5v2h-5l-0.9 2" fill-rule="evenodd" />
            </svg>
        </div>
    `);
    const $repeatBtn = $(`
        <div class="audio-player-playlist-btn repeat-btn${config.playlistRepeat ? ' on' : ''}" aria-label="Repeat" role="button">
            <svg width="24" height="24" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path class="repeat-btn__icon" d="m0 9v-7h15v-2l3 3.5-3 3.5v-2h-12v4zm18 0v7h-15v2l-3-3.5 3-3.5v2h12v-4z" fill-rule="evenodd"/>
            </svg>
        </div>
    `);
    const $playlistAddBtn = $(`
        <div class="audio-player-playlist-btn playlist-add-btn" aria-label="Add to Playlist" role="button">
            <svg width="24" height="24" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path class="playlist-add-btn__icon" d="m18 2h-18v-2h18zm0 5h-18v-2h18zm-11 5h-7v-2h7zm0 5h-7v-2h7zm8 1h-3v-3h-3v-3h3v-3h3v3h3v3h-3z" fill-rule="evenodd" />
            </svg>
        </div>
    `);
    const $volume = $('.audio-player .volume');
    const $mainHolder = $playBtn.parent().addClass('main-holder');
    const $leftHolder = $('<div class="holder left-holder"></div>');
    const $rightHolder = $('<div class="holder right-holder"></div>');
    
    $leftHolder.insertBefore($mainHolder);
    $leftHolder.append($favBtn);
    $ignoreBtn.insertAfter($favBtn);
    $shuffleBtn.insertBefore($loadingIndicator);
    $prevBtn.insertAfter($shuffleBtn);
    $nextBtn.insertAfter($playBtn);
    $repeatBtn.insertAfter($nextBtn);
    $volume.wrap($rightHolder);
    $playlistAddBtn.insertBefore($volume);

    $playBtn.addClass('display--none');

    audioPlayer.showLoadingIndicator();

    audioPlayer.player.addEventListener('canplay', function() {
        $('.audio-player .loading').addClass('display--none');
        $playBtn.removeClass('display--none');
    });

    const requestObj = new Request(url, {
        method: 'GET',
        referrerPolicy: 'no-referrer'
    });
    
    audioPlayer.player.volume = config.audioVolume;
    audioPlayer.player.addEventListener('volumechange', function() {
        const currentVolume = audioPlayer.player.volume;
        window.setTimeout(function () {
            if (audioPlayer.player.volume === currentVolume) {
                config.audioVolume = currentVolume;
                updateConfig(config);
            }
        }, 1000);
    });

    if (playlistIndex > -1) {
        if (url) {
            const bgmTrackId = getPlaylistBgmTrackIds()[playlistIndex];
            const $bgmTrackEntry = $(`.js--bgm-track[data-bgm-track-id='${bgmTrackId}']`);
            const $bgmTrackEntryInputControls = $bgmTrackEntry.parent().children('.js--bgm-track--collectable-entry--input-controls');
            const $bgmTrackEntryPlayControls = $bgmTrackEntry.parent().children('.js--bgm-track--collectable-entry--play-controls');
            const toggleEntryPlayingInList = function (playing) {
                if (!playlist) {
                    $bgmTrackEntryPlayControls.children('.js--bgm-track__play').toggleClass('display--none', playing).toggleClass('pressed', playing);
                    $bgmTrackEntryPlayControls.children('.js--bgm-track__pause').toggleClass('display--none', !playing).toggleClass('pressed', !playing);
                }
            };

            if (config.bgmTrackInput.hasOwnProperty(bgmTrackId)) {
                const input = config.bgmTrackInput[bgmTrackId];
                $favBtn.addClass(input ? 'on' : 'inactive');
                $ignoreBtn.addClass(input ? 'inactive' : 'on');
            }

            $('.js--playlist-item.playing').removeClass('playing');

            $('.js--bgm-track__pause:visible').addClass('display--none')
                .parent().children('.js--bgm-track__play').removeClass('display--none').removeClass('pressed');
            if (playlist)
                $(`.js--playlist-item:nth(${playlistIndex})`).addClass('playing');

            config.playlist = !!playlist;
            config.playlistIndex = playlistIndex;
            updateConfig(config);

            const updateBgmTrackInput = function() {
                const isFav = $(this).hasClass('fav-btn');
                const hasInput = config.bgmTrackInput.hasOwnProperty(bgmTrackId);
                if (!hasInput || !!config.bgmTrackInput[bgmTrackId] === isFav) {
                    if (hasInput)
                        delete config.bgmTrackInput[bgmTrackId];
                    else
                        config.bgmTrackInput[bgmTrackId] = isFav ? 1 : 0;
                    updateConfig(config);
                    if (isFav) {
                        if (hasInput)
                            removeFavBgmTrackEntry(bgmTrackId);
                        else
                            addFavBgmTrackEntry(bgmTrackId);
                    }
                    $(this).toggleClass('on', !hasInput);
                    (isFav ? $ignoreBtn : $favBtn).toggleClass('inactive', !hasInput);
                    $bgmTrackEntryInputControls.find(`.js--bgm-track__${isFav ? 'fav' : 'ignore'}`).toggleClass('on', !hasInput);
                    $bgmTrackEntryInputControls.find(`.js--bgm-track__${isFav ? 'ignore' : 'fav'}`).toggleClass('inactive', !hasInput);
                }
            };

            const playPrevTrack = function() {
                if (getPlaylistBgmTrackIds().length > 1) {
                    audioPlayer.player.src = '';
                    toggleEntryPlayingInList(false);
                    if (playPrevPlaylistBgmTrack(playlistIndex))
                        return;
                    toggleEntryPlayingInList(true);
                    audioPlayer.player.src = url;
                }
                GreenAudioPlayer.playPlayer(audioPlayer.player);
            };
            const playNextTrack = function() {
                if (getPlaylistBgmTrackIds().length > 1) {
                    audioPlayer.player.src = '';
                    toggleEntryPlayingInList(false);
                    if (playNextPlaylistBgmTrack(playlistIndex))
                        return;
                    toggleEntryPlayingInList(true);
                    audioPlayer.player.src = url;
                }
                GreenAudioPlayer.playPlayer(audioPlayer.player);
            };

            if (!playlist) {
                audioPlayer.player.addEventListener('play', () => toggleEntryPlayingInList(true));
                audioPlayer.player.addEventListener('pause', () => toggleEntryPlayingInList(false));
            }

            audioPlayer.player.addEventListener('ended', function () {
                if (config.playlistRepeat)
                    GreenAudioPlayer.playPlayer(audioPlayer.player);
                else
                    playNextTrack();
            });

            $prevBtn.on('click', playPrevTrack);
            $nextBtn.on('click', playNextTrack);
            $favBtn.on('click', updateBgmTrackInput);
            $ignoreBtn.on('click', updateBgmTrackInput);
            $shuffleBtn.on('click', function() {
                const shuffle = (config.playlistShuffle = !config.playlistShuffle);
                $(this).toggleClass('on', shuffle);
                if (shuffle)
                    updatePlaylistShuffleIndexes();
                updateConfig(config);
            });
            $repeatBtn.on('click', function() {
                const repeat = (config.playlistRepeat = !config.playlistRepeat);
                $(this).toggleClass('on', repeat);
                updateConfig(config);
            });
            
            if (!playlist)
                $playlistAddBtn.on('click', () => addPlaylistBgmTrack(bgmTrackId));
            else
                $playlistAddBtn.addClass('inactive');
        } else {
            audioPlayer.player.src = '';
            playNextPlaylistBgmTrack(playlistIndex);
            return;
        }
    } else {
        $('.audio-player-playlist-btn').addClass('inactive');

        if (config.playlist || config.playlistIndex > -1) {
            config.playlist = false;
            config.playlistIndex = -1;
            updateConfig(config);
        }

        if (!url)
            return;
    }

    const player = audioPlayer.player;

    fetch(requestObj).then(function (response) {
        if (!response.ok)
            $('.audio-player-label').text('ERROR');
        return response;
    }).then(async function (res) {
        const blob = await res.blob();
        if (player === audioPlayer.player) {
            const url = window.URL.createObjectURL(blob);
            player.src = url;
            $('.close-audio-player').on('click', function() {
                audioPlayer = null;
                config.playlistIndex = -1;
                updateConfig(config);
                $('.audio-player-container').removeClass('open');
                $('.audio-player-image-container, .audio-player-player-container').empty();
                if (!$('.controls-playlist').hasClass('visible'))
                    updateControlsContainer();
            });
            if (play)
                GreenAudioPlayer.playPlayer(player);
        }
    }).catch((err) => console.error(err));
}

function initBgmTrack(bgmTrack, play, playlistIndex, playlist) {
    const imageUrl = bgmTrack.worldId != null ? worldData[bgmTrack.worldId].images[bgmTrack.worldImageOrdinal] : getMissingBgmTrackUrl(bgmTrack.location);
    initBgm(bgmTrack.url, getBgmTrackLabel(bgmTrack), imageUrl, bgmTrack.worldId, play, playlistIndex, playlist);
}

function playBgm(url, label, imageUrl, worldId) {
    initBgm(url, label, imageUrl, worldId, true);
}

function playBgmTrack(bgmTrack, playlistIndex, playlist) {
    initBgmTrack(bgmTrack, true, playlistIndex, playlist);
}

function playPrevPlaylistBgmTrack(lastPlaylistIndex, attempts) {
    const wrapIndex = config.playlistShuffle ? lastPlaylistIndex === playlistShuffleIndexes[0] : lastPlaylistIndex <= 0;
    if (wrapIndex)
        updatePlaylistShuffleIndexes();
    const playlistIndex = config.playlistShuffle
        ? playlistShuffleIndexes[!wrapIndex ? playlistShuffleIndexes.indexOf(lastPlaylistIndex) - 1 : playlistShuffleIndexes.length - 1]
        : !wrapIndex ? lastPlaylistIndex - 1 : getPlaylistBgmTrackIds().length - 1;
    const playlistBgmTrackId = getPlaylistBgmTrackIds()[playlistIndex];
    const skipTrack = () => playPrevPlaylistBgmTrack(playlistIndex, attempts ? ++attempts : 1);
    if (bgmTrackIndexesById.hasOwnProperty(playlistBgmTrackId)) {
        const bgmTrack = bgmTrackData[bgmTrackIndexesById[playlistBgmTrackId]];
        if (bgmTrack.url && (config.playlist || !config.bgmTrackInput.hasOwnProperty(playlistBgmTrackId) || config.bgmTrackInput[playlistBgmTrackId])) {
            GreenAudioPlayer.stopOtherPlayers();
            playBgmTrack(bgmTrack, playlistIndex, config.playlist);
        } else
            skipTrack();
    } else if (attempts < getPlaylistBgmTrackIds().length)
        skipTrack();
    else
        return false;
    return true;
}

function playNextPlaylistBgmTrack(lastPlaylistIndex, attempts) {
    const wrapIndex = config.playlistShuffle ? lastPlaylistIndex === playlistShuffleIndexes[playlistShuffleIndexes.length - 1] : lastPlaylistIndex >= getPlaylistBgmTrackIds().length - 1;
    if (wrapIndex)
        updatePlaylistShuffleIndexes();
    const playlistIndex = config.playlistShuffle
        ? playlistShuffleIndexes[!wrapIndex ? playlistShuffleIndexes.indexOf(lastPlaylistIndex) + 1 : 0]
        : !wrapIndex ? lastPlaylistIndex + 1 : 0;
    const playlistBgmTrackId = getPlaylistBgmTrackIds()[playlistIndex];
    const skipTrack = () => playNextPlaylistBgmTrack(playlistIndex, attempts ? ++attempts : 1);
    if (bgmTrackIndexesById.hasOwnProperty(playlistBgmTrackId)) {
        const bgmTrack = bgmTrackData[bgmTrackIndexesById[playlistBgmTrackId]];
        if (bgmTrack.url && (config.playlist || !config.bgmTrackInput.hasOwnProperty(playlistBgmTrackId) || config.bgmTrackInput[playlistBgmTrackId])) {
            GreenAudioPlayer.stopOtherPlayers();
            playBgmTrack(bgmTrack, playlistIndex, config.playlist);
        } else
            skipTrack();
    } else if (attempts < getPlaylistBgmTrackIds().length)
        skipTrack();
    else
        return false;
    return true;
}

function pauseBgm() {
    const audioSources = document.getElementsByClassName('audio-source');
    if (audioSources.length)
        GreenAudioPlayer.pausePlayer(audioSources[0]);
    if (!config.playlist && config.playlistIndex > -1) {
        const $bgmTrackEntryControls = $(`.js--bgm-track[data-bgm-track-id='${bgmTrackIds[config.playlistIndex]}']`).parent().children('.js--bgm-track--collectable-entry--play-controls');
        $bgmTrackEntryControls.children('.js--bgm-track__pause').addClass('display--none');
        $bgmTrackEntryControls.children('.js--bgm-track__play').removeClass('display--none').removeClass('pressed');
    }
}

function getPlaylistBgmTrackIds() {
    return config.playlist ? config.playlistBgmTrackIds : bgmTrackIds;
}

function updatePlaylistShuffleIndexes(firstIndex) {
    if (config.playlistShuffle) {
        const playlistBgmTrackIds = getPlaylistBgmTrackIds();
        playlistShuffleIndexes = [];
        if (playlistBgmTrackIds.length) {
            const availableIndexes = [];
            if (firstIndex !== undefined)
                playlistShuffleIndexes.push(firstIndex);
            for (let i = 0; i < playlistBgmTrackIds.length; i++) {
                if (i !== firstIndex)
                    availableIndexes.push(i);
            }
            while (availableIndexes.length) {
                const randomIndex = Math.floor(Math.random() * availableIndexes.length);
                playlistShuffleIndexes.push(availableIndexes[randomIndex]);
                availableIndexes.splice(randomIndex, 1);
            }
        }
    }
}

function initPlaylist() {
    for (let bgmTrackId of config.playlistBgmTrackIds)
        addPlaylistBgmTrack(bgmTrackId, true);

    if (config.playlistBgmTrackIds.length) {
        $('.controls-playlist--container, .controls-playlist--container--tab').removeClass('display--none');
        if (config.playlist) {
            if (config.playlistIndex > -1 && config.playlistIndex < config.playlistBgmTrackIds.length) {
                const playlistBgmTrackId = config.playlistBgmTrackIds[config.playlistIndex];
                if (bgmTrackIndexesById.hasOwnProperty(playlistBgmTrackId))
                    initBgmTrack(bgmTrackData[bgmTrackIndexesById[playlistBgmTrackId]], false, config.playlistIndex, true);
            }
            updatePlaylistShuffleIndexes(config.playlistIndex);
        }
    }

    if (!config.playlist && config.playlistIndex > -1 && config.playlistIndex < bgmTrackIds.length) {
        const bgmTrackId = bgmTrackIds[config.playlistIndex];
        if (bgmTrackIndexesById.hasOwnProperty(bgmTrackId))
            initBgmTrack(bgmTrackData[bgmTrackIndexesById[bgmTrackId]], false, config.playlistIndex);
        updatePlaylistShuffleIndexes(config.playlistIndex);
    }
    
    if (!(config.playlistIndex > -1 && config.playlistIndex < getPlaylistBgmTrackIds().length) || (config.playlist && !config.playlistBgmTrackIds.length))
        updatePlaylistShuffleIndexes();
}

function addPlaylistBgmTrack(bgmTrackId, isInit) {
    const bgmTrack = bgmTrackIndexesById.hasOwnProperty(bgmTrackId) ? bgmTrackData[bgmTrackIndexesById[bgmTrackId]] : null;
    const imageUrl = bgmTrack && bgmTrack.worldId != null ? worldData[bgmTrack.worldId].images[bgmTrack.worldImageOrdinal] : getMissingBgmTrackUrl(bgmTrack ? bgmTrack.location : null);
    const trackLabel = bgmTrack && bgmTrack.trackNo < 1000 ? bgmTrack.trackNo.toString().padStart(3, 0) + (bgmTrack.variant ? ` ${bgmTrack.variant}` : '') : '';
    const trackLabelHtml = trackLabel ? `<h2 class="playlist-item__label noselect">${trackLabel}</h2>` : '';
    const $playlistItem = $(`
        <div class="js--playlist-item playlist-item" data-bgm-track-id="${bgmTrackId}">
            <div class="playlist-item__image-container">
                <img class="js--playlist-item__image playlist-item__image noselect" src="${imageUrl}" referrerpolicy="no-referrer" />
            </div>
            <a href="javascript:void(0);" class="js--remove-playlist-item playlist-item__remove-btn noselect">✖</a>
            ${trackLabelHtml}
        </div>
    `);
    $('.js--playlist').append($playlistItem);
    if (bgmTrack)
        $playlistItem.on('click', function () {
            if (bgmTrackIndexesById.hasOwnProperty(bgmTrackId)) {
                playBgmTrack(bgmTrackData[bgmTrackIndexesById[bgmTrackId]], $(this).index(), true);
                updatePlaylistShuffleIndexes($(this).index());
            }
        });
    $playlistItem.children('.js--remove-playlist-item').on('click', function () {
        removePlaylistBgmTrack($(this).parent('.js--playlist-item').index());
    });

    if (!isInit) {
        if (!config.playlistBgmTrackIds.length)
            $('.controls-playlist--container, .controls-playlist--container--tab').removeClass('display--none');
        if (!$('.controls-playlist').hasClass('visible'))
            $('.controls-playlist--container--tab__button').trigger('click');
        else
            updateControlsContainer(true);
        config.playlistBgmTrackIds.push(bgmTrackId);
        updatePlaylistShuffleIndexes();
        updateConfig(config);
    }
}

function removePlaylistBgmTrack(playlistIndex) {
    config.playlistBgmTrackIds.splice(playlistIndex, 1);
    if (playlistIndex < config.playlistIndex || playlistIndex === config.playlistBgmTrackIds.length)
        config.playlistIndex--;

    updatePlaylistShuffleIndexes();
    updateConfig(config);

    $(`.js--playlist-item:nth(${playlistIndex})`).remove();
    if (!config.playlistBgmTrackIds.length) {
        $('.controls-playlist--container, .controls-playlist--container--tab').addClass('display--none');
        if ($('.controls-playlist').hasClass('visible'))
            $('.controls-playlist--container--tab__button').trigger('click');
    } else
        updateControlsContainer(true);
}

function getMissingBgmTrackUrl(location) {
    if (location) {
        if (/Computer/.test(location))
            return 'https://static.wikia.nocookie.net/yume2kki/images/5/5b/Pc1.png';
        if (/Console/.test(location))
            return 'https://static.wikia.nocookie.net/yume2kki/images/e/ea/Console1.png';
        if (/Kura Puzzle/i.test(location))
            return 'https://static.wikia.nocookie.net/yume2kki/images/0/06/Minigame_Puzzle.png'
        if (/↑V↑/.test(location))
            return 'https://static.wikia.nocookie.net/yume2kki/images/d/de/Wavy1.jpg';
        if (/Plated Snow Country/i.test(location))
            return 'https://static.wikia.nocookie.net/yume2kki/images/e/e4/Minigame_snow_1.png';
        if (/Minigame B/i.test(location))
            return 'https://static.wikia.nocookie.net/yume2kki/images/b/b8/Minigame_RBY_game.png';
        if (/Bleak Future/i.test(location))
            return 'https://static.wikia.nocookie.net/yume2kki/images/a/ab/2kki-bedroom.png';
        if (/Painter\-kun/i.test(location))
            return 'https://static.wikia.nocookie.net/yume2kki/images/9/9b/Painter_painting.png';
    }

    return './images/title.png';
}

function getBgmLabels(bgmLabels, localizedBgm) {
    let ret;
    if (bgmLabels.length === 1)
        ret = bgmLabels;
    else {
        const namedTracksCount = bgmLabels.filter(l => !l.endsWith('^')).length;
        if (!namedTracksCount || !getLangUsesEn(config.lang))
            ret = bgmLabels.map(l => l.slice(0, l.indexOf('^')));
        else if (namedTracksCount === bgmLabels.length)
            ret = bgmLabels.map(l => l.slice(l.indexOf('^') + 1));
        else {
            ret = [];
            if (namedTracksCount === bgmLabels.length - 1) {
                for (let b in bgmLabels) {
                    const bgmLabel = bgmLabels[b];
                    const isNamedTrack = !bgmLabel.endsWith('^');
                    ret.push(isNamedTrack ? bgmLabel.slice(bgmLabel.indexOf('^') + 1) : (b > 0 ? bgmLabel.slice(0, -1) : localizedBgm.main));
                }
            } else {
                for (let b in bgmLabels) {
                    const bgmLabel = bgmLabels[b];
                    const isNamedTrack = !bgmLabel.endsWith('^');
                    let label = bgmLabel.slice(0, bgmLabel.indexOf('^'));
                    if (isNamedTrack)
                        label += ` (${bgmLabel.slice(bgmLabel.indexOf('^') + 1)})`;
                    ret.push(label);
                }
            }
        }
    }

    return ret;
}

function getBgmLabel(worldName, bgmLabel) {
    const separatorIndex = bgmLabel.indexOf('^');
    if (separatorIndex === bgmLabel.length - 1 || !getLangUsesEn(config.lang))
        return `${worldName}${localizedSeparator}${bgmLabel.slice(0, separatorIndex)}`;
    return `${worldName}${localizedSeparator}${bgmLabel.slice(separatorIndex + 1)}${localizedBraces.replace('{VALUE}', bgmLabel.slice(0, separatorIndex))})`;
}

function getBgmTrackLabel(bgmTrack) {
    let trackLabel = '';

    if (bgmTrack.trackNo < 1000) {
        trackLabel = bgmTrack.trackNo.toString().padStart(3, 0);
        if (bgmTrack.variant)
            trackLabel += ` ${bgmTrack.variant}`;
        trackLabel += localizedSeparator;
    }

    const location = getLocalizedLabel(bgmTrack.location, bgmTrack.locationJP);
    const name = bgmTrack.name;

    if (location) {
        trackLabel += location;
        if (name)
            trackLabel += `${localizedBraces.replace('{VALUE}', name)}`;
    } else
        trackLabel += name;

    return trackLabel;
}

function trySelectNode(node, forceFocus, ignoreSearch) {
    if (node == null)
        return false;
    if (!node.hasOwnProperty("id")) {
        node = graph.graphData().nodes.find(n => n.id === node);
        if (!node)
            return false;
    }
    const world = worldData[node.id];
    if ((node && (selectedWorldId == null || selectedWorldId !== node.id))) {
        if (!ignoreSearch)
            $(".js--search-world").addClass("selected").val(getLocalizedLabel(world.title, world.titleJP));
        if (forceFocus)
            focusNode(node);
    } else
        focusNode(node);
    selectedWorldId = world.id;
    highlightWorldSelection();
    return true;
}

function focusNode(node) {
    const scale = worldScales[node.id];
    if (!config.renderMode) {
        const camera = graph.camera();
        graph.cameraPosition({ x: node.x, y: node.y, z: 1000 }, node, 1000);
        const oldZoom = { zoom: camera.zoom };
        const newZoom = { zoom: 20 / scale };
        new TWEEN.Tween(oldZoom).to(newZoom, graph.controls().zoomSpeed * 1000).easing(TWEEN.Easing.Quadratic.Out).onUpdate(zoom => {
            camera.zoom = zoom.zoom;
            camera.updateProjectionMatrix();
        }).start();
    } else {
        const distance = 50 * scale;
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
        for (let link of links) {
            const linkOpacity = getLinkOpacity(link);
            const linkGrayscale = getLinkGrayscale(link);
            for (let icon of link.icons) {
                opacities[icon.id] = linkOpacity;
                grayscales[icon.id] = linkGrayscale;
                if (config.connMode === 0 && link.hidden)
                    opacities[icon.id] = 0;
            }
        }
        unsortedIconOpacities = opacities.slice();
        unsortedIconGrayscales = grayscales.slice();
        iconObject.geometry.attributes.opacity.needsUpdate = true;
        iconObject.geometry.attributes.grayscale.needsUpdate = true;
    } else {
        links.forEach(link => {
            if (icons3D[link.key] !== undefined) {
                const linkOpacity = getLinkOpacity(link);
                const linkGrayscale = getLinkGrayscale(link);
                for (let icon of icons3D[link.key]) {
                    icon.visible = true;
                    icon.material.opacity = linkOpacity;
                    icon.material.grayScale = linkGrayscale;
                    if (config.connMode === 0 && link.hidden)
                        icon.visible = false;
                }
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
            const settingsHeight = $(".controls-bottom").outerHeight() + 8;
            $(".controls-bottom").removeClass("visible").animateCss("slideOutDown", 250, function () {
                if (!$(this).hasClass("visible"))
                    $(this).css("opacity", 0);
            });
            $(".controls-bottom--container--tab, .audio-player-container, .footer").css("margin-top", "0px").animateCss("slideInDown", 300);
            $(".controls-playlist--container--tab").css("margin-bottom", "0px");
            $(".controls-playlist--container").css("margin-bottom", `-${settingsHeight}px`);
            $(".controls-playlist--container--tab, .controls-playlist--container").animateCss("slideInDown", 300);
            $(".modal").css("transition", "height 0.3s ease-out, margin-top 0.3s ease-out");
        } else {
            const settingsHeight = $(".controls-bottom").outerHeight() + 8;
            $(".controls-bottom").addClass("visible").css("opacity", 1).animateCss("slideInUp", 250);
            $(".controls-bottom--container--tab, .audio-player-container, .footer").css("margin-top", `-${settingsHeight}px`).animateCss("slideInUp", 250);
            $(".controls-playlist--container--tab").css("margin-bottom", `${settingsHeight}px`).animateCss("slideInUp", 250);
            $(".controls-playlist--container").css({ "margin-bottom": "0px", "padding-bottom": `${settingsHeight}px` }).animateCss("slideInUp", 250);
            $(".modal").css("transition", "height 0.25s ease-out, margin-top 0.25s ease-out");
        }
        updateControlsContainer();
    });

    $(".controls-collectables--container--tab__button").on("click", function() {
        if ($(".controls-collectables").hasClass("visible")) {
            $(".controls-collectables").removeClass("visible").animateCss("slideOutRight", 250, function () {
                if (!$(this).hasClass("visible"))
                    $(this).css("opacity", 0);
            });
            $(".controls-collectables--container--tab").css("margin-left", "0px").animateCss("slideInLeft", 300);
            $(".modal").css("transition", "max-width 0.3s ease-out, margin-left 0.3s ease-out, margin-right 0.3s ease-out");
        } else {
            $(".controls-collectables").addClass("visible").css("opacity", 1).animateCss("slideInRight", 250);
            $(".controls-collectables--container--tab").css("margin-left", "-" + ($(".controls-collectables").outerWidth() + 8) + "px").animateCss("slideInRight", 250);
            $(".modal").css("transition", "max-width 0.25s ease-out, margin-left 0.25s ease-out, margin-right 0.25s ease-out");
        }
        updateControlsContainer();
    });

    $(".controls-playlist--container--tab__button").on("click", function() {
        if ($(".controls-playlist").hasClass("visible")) {
            $(".controls-playlist").removeClass("visible").animateCss("slideOutLeft", 250, function () {
                if (!$(this).hasClass("visible"))
                    $(this).css("opacity", 0);
            });
            $(".controls-playlist--container--tab").css("margin-left", "0px").animateCss("slideInRight", 300);
            $(".modal").css("transition", "max-width 0.3s ease-out, margin-left 0.3s ease-out, margin-right 0.3s ease-out");
        } else {
            $(".controls-playlist").addClass("visible").css("opacity", 1).animateCss("slideInLeft", 250);
            $(".controls-playlist--container--tab").css("margin-left", ($(".controls-playlist").outerWidth() + 8) + "px").animateCss("slideInLeft", 250);
            $(".modal").css("transition", "max-width 0.25s ease-out, margin-left 0.25s ease-out, margin-right 0.25s ease-out");
        }
        updateControlsContainer();
    });

    updateControlsContainer(true);

    $(window).on("resize", updateControlsContainer).on("blur", function() {
        isShift = false;
        isCtrl = false;
    });

    const onModalShown = function() {
        const $modalContent = $(this).find(".modal__content");
        $modalContent.css("padding-right", $modalContent[0].scrollHeight > $modalContent[0].clientHeight ? "24px" : null);
    };

    $(document).on($.modal.OPEN, ".modal", onModalShown);

    $(document).on("click", ".checkbox-button", function() {
        const $checkbox = $(this).prev("input[type=checkbox].checkbox");
        $checkbox.prop("checked", !$checkbox.prop("checked")).trigger("change");
    });

    $(document).on("click", ".js--modal__controls--expand > .js--modal__controls--expand__link", function() {
        $(this).parent().next(".js--modal__controls").toggleClass("expanded");
    });

    $(".js--playlist").sortable({
        onEnd: function (e) {
            const oldIndex = e.oldIndex;
            const newIndex = e.newIndex;

            if (oldIndex !== newIndex) {
                const movedBgmTrackId = config.playlistBgmTrackIds[oldIndex];

                config.playlistBgmTrackIds.splice(oldIndex, 1);
                config.playlistBgmTrackIds.splice(newIndex, 0, movedBgmTrackId);

                if (oldIndex <= config.playlistIndex && newIndex > config.playlistIndex || newIndex <= config.playlistIndex && oldIndex > config.playlistIndex)
                    config.playlistIndex--;
                else if (oldIndex >= config.playlistIndex && newIndex < config.playlistIndex || newIndex >= config.playlistIndex && oldIndex < config.playlistIndex)
                    config.playlistIndex++;

                updateConfig(config);
            }
        }
    });
    
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

        closeModals();

        initLocalization();
        initVersionData();

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
            getFontShadow(config.uiTheme, function (shadow) {
                themeStyles.textContent = themeStyles.textContent.replace(/url\(\/images\/ui\/[a-zA-Z0-9\_]+\/(containerbg|border(?:2)?|arrow(?:up|down)|font\d)\.png\)/g, "url(/images/ui/" + config.uiTheme + "/$1.png)")
                    .replace(/background-color:( *)[^;!]*(!important)?;( *)\/\*basebg\*\//g, "background-color:$1" + color + "$2;$3/*basebg*/")
                    .replace(/background-color:( *)[^;!]*(!important)?;( *)\/\*altbg\*\//g, "background-color:$1" + altColor + "$2;$3/*altbg*/")
                    .replace(/(?:[#a-zA-Z0-9]+|rgba\([0-9]+, [0-9]+, [0-9]+, [0-9]+\))(;? *)\/\*shadow\*\//g, shadow + "$1/*shadow*/");
                $(".js--font-style").trigger("change");
                updateConfig(config);
            });
        });
    });

    $(".js--font-style").on("change", function() {
        config.fontStyle = parseInt($(this).val());
        const themeStyles = $(".js--theme-styles")[0];
        const defaultAltFontStyleIndex = !isYNTheme() ? 4 : 1;
        getFontColor(config.uiTheme, config.fontStyle, function (baseColor) {
            const altFontStyle = config.fontStyle !== defaultAltFontStyleIndex ? defaultAltFontStyleIndex : 0;
            const altColorCallback = function (altColor) {
                themeStyles.textContent = themeStyles.textContent = themeStyles.textContent = themeStyles.textContent
                    .replace(/url\(\/images\/ui\/([a-zA-Z0-9\_]+)\/font\d\.png\)( *!important)?;( *)\/\*base\*\//g, "url(/images/ui/$1/font" + (config.fontStyle + 1) + ".png)$2;$3/*base*/")
                    .replace(/url\(\/images\/ui\/([a-zA-Z0-9\_]+)\/font\d\.png\)( *!important)?;( *)\/\*alt\*\//g, "url(/images/ui/$1/font" + (altFontStyle + 1) + ".png)$2;$3/*alt*/")
                    .replace(/([^\-])((?:(?:background|border)\-)?color|fill):( *)[^;!]*(!important)?;( *)\/\*base\*\//g, "$1$2:$3" + baseColor + "$4;$5/*base*/")
                    .replace(/([^\-])((?:(?:background|border)\-)?color|fill):( *)[^;!]*(!important)?;( *)\/\*alt\*\//g, "$1$2:$3" + altColor + "$4;$5/*alt*/");
                updateConfig(config);
            };
            getFontColor(config.uiTheme, altFontStyle, function (altColor) {
                if (altColor !== baseColor)
                    altColorCallback(altColor);
                else {
                    const fallbackAltFontStyle = config.fontStyle !== defaultAltFontStyleIndex ? defaultAltFontStyleIndex + 1 : 1;
                    getFontColor(config.uiTheme, fallbackAltFontStyle, altColorCallback);
                }
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
        if (!isWebGL2 || !is2d) {
            graph.graphData().nodes.forEach(node => {
                const obj = node.__threeObj;
                if (obj) {
                    const showLabel = isNodeLabelVisible(node);
                    obj.children[0].visible = showLabel;
                    if (obj.children.length > 1)
                        obj.children[1].visible = showLabel;
                }
            });
        }
    });

    $(".js--removed-content-mode").on("change", function() {
        config.removedContentMode = parseInt($(this).val());
        $(".js--removed-content").toggleClass("display--none", !config.removedContentMode);
        updateConfig(config);
        if (worldData) {
            closeModals();
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
        const val = $(this).val() !== "null" ? $(this).val() || "" : null;
        if (!tempSelectedAuthor || !val) {
            if (tempSelectedAuthor && !val)
                tempSelectAuthor(null, true);
            selectedAuthor = val;
        } else
            tempSelectedAuthor = val;
        if (worldData)
            highlightWorldSelection();
    });

    $(".js--version").on("change", function() {
        const val = parseInt($(this).val());
        if (!tempSelectedVersionIndex || !val) {
            if (tempSelectedVersionIndex && !val)
                tempSelectVersion(0, true);
            selectedVersionIndex = val;
        } else
            tempSelectedVersionIndex = val;
        if (worldData)
            highlightWorldSelection();
    });

    $(".js--author-entries").on("click", function() {
        if (authorData && authorData.length) {
            if ($(".js--author-entries-modal:visible").length)
                $.modal.close();
            else
                $(".js--author-entries-modal").modal({
                    fadeDuration: 100,
                    closeClass: 'noselect',
                    closeText: '✖'
                });
        }
    });

    $(".js--version-entries").on("click", function() {
        if (versionData && versionData.length) {
            if ($(".js--version-entries-modal:visible").length)
                $.modal.close();
            else
                $(".js--version-entries-modal").modal({
                    fadeDuration: 100,
                    closeClass: 'noselect',
                    closeText: '✖'
                });
        }
    });

    $(".js--effects").on("click", function() {
        if (effectData && effectData.length) {
            if ($(".js--effects-modal:visible").length)
                $.modal.close();
            else
                $(".js--effects-modal").modal({
                    fadeDuration: 100,
                    closeClass: 'noselect',
                    closeText: '✖'
                });
        }
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

    $(".js--wallpapers").on("click", function() {
        if (wallpaperData && wallpaperData.length) {
            if ($(".js--wallpapers-modal:visible").length)
                $.modal.close();
            else
                $(".js--wallpapers-modal").modal({
                    fadeDuration: 100,
                    closeClass: 'noselect',
                    closeText: '✖'
                });
        }
    });

    $(".js--bgm-tracks").on("click", function() {
        if (bgmTrackData && bgmTrackData.length) {
            if ($(".js--bgm-tracks-modal:visible").length)
                $.modal.close();
            else
                $(".js--bgm-tracks-modal").modal({
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
        else if ($('.js--help-modal__content--localized').text())
            openHelpModal();
        else {
            $.get("/help", function (data) {
                const md = new Remarkable();
                data = data.split('---');
                let helpLangIndex = helpLangs.indexOf(config.lang);
                if (helpLangIndex < 0)
                    helpLangIndex = helpLangs.indexOf(getLangUsesEn(config.lang) ? 'en' : 'ja');
                const compatibleHelpLang = helpLangs[helpLangIndex];
                $('.js--help-modal__content--localized').empty();
                for (let l in helpLangs) {
                    const lang = helpLangs[l];
                    $('.js--help-modal__content--localized').append(`<div class="js--help-modal__content--localized__text"${lang !== compatibleHelpLang ? ' style="display: none;"' : ''} data-lang="${lang}">${getMassagedLocalizedValue(md.render(data[l]))}</div>`);
                }
                openHelpModal();
            });
        }
    });
}

function getLoadingGifName() {
    const rand = Math.floor(Math.random() * 255);
    if (rand > 64)
        return !isYNTheme() ? "urowalk" : "madowalk";
    if (rand > 24)
        return "urospin";
    if (rand > 8)
        return "urosleep";
    if (rand > 2)
        return "urodance";
    if (rand > 0)
        return "urobanana";
    return "urodance2";
}

function displayLoadingAnim($container) {
    const $existingLoadingContainer = $container.find(".loading-container");
    const $loadingContainer = $(`
        <div class="loading-container">
            <span class="loading-container__text loading-container__text--loading"><span data-localize="loading.label" class="loading-container__text__main">Loading</span><span data-localize="loading.space" class="loading-container__text__append">   </span></span>
            <span class="loading-container__text loading-container__text--error" data-localize="loading.error" style="display: none;"></span>
            <img src="images/${getLoadingGifName()}.gif" />
        </div>`);
    if ($existingLoadingContainer.length)
        $existingLoadingContainer.remove();
    const $content = $container.children();
    $content.addClass("display--none");
    $container.prepend($loadingContainer);

    let loadingFrameCount = 0;
    const updateLoadingText = () => {
        let loadingTextAppend = "";
        const loadingTextAppendChar = localizedDot;
        const loadingTextSpaceChar = getLangUsesEn(config.lang) ? " " : "　";
        for (let i = 0; i < 3; i++)
            loadingTextAppend += i < loadingFrameCount ? loadingTextAppendChar : loadingTextSpaceChar;
        $loadingContainer.find(".loading-container__text__append").text(loadingTextAppend);
        loadingFrameCount += loadingFrameCount < 3 ? 1 : -3;
    };
    updateLoadingText();
    const loadingTimer = window.setInterval(updateLoadingText, 300);

    return function (request, status, error) {
        if (error) {
            window.clearInterval(loadingTimer);
            $loadingContainer.find(".loading-container__text--loading").hide();
            $loadingContainer.find(".loading-container__text--error").show();
            $loadingContainer.find("img").attr("src", "images/urofaint.gif");
        } else {
            const marginTop = $content.css("marginTop");
            const offsetMarginTop = (($loadingContainer[0].offsetHeight * -1) + (marginTop ? parseInt(marginTop) : 0)) + "px";
            $loadingContainer.animateCss("fadeOut", 250);
            $content.css("marginTop", offsetMarginTop).removeClass("display--none").animateCss("fadeIn", 250, function() {
                window.clearInterval(loadingTimer);
                $content.css("marginTop", marginTop);
                $loadingContainer.remove();
            });
        }
    };
}

/* Admin */

let username = null;

function getMissingConnections() {
    const ret = [];
    const connData = {};
    
    for (let w of worldData) {
        connData[w.id] = [];
        worldData[w.id].connections.map(c => worldData[c.targetId]).forEach(c => connData[w.id].push(c.id));
    }

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

    const addConnTypePair = function(x, y) {
        expectedReverseConnTypes[x] = y;
        expectedReverseConnTypes[y] = x;
    };

    addConnTypePair(ConnType.ONE_WAY, ConnType.NO_ENTRY);
    addConnTypePair(ConnType.UNLOCK, ConnType.LOCKED);
    addConnTypePair(ConnType.DEAD_END, ConnType.ISOLATED);
    addConnTypePair(ConnType.SHORTCUT, ConnType.EXIT_POINT);
    
    for (let w of worldData) {
        for (let c of worldData[w.id].connections) {
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
        }
    }

    return ret;
}

function getMissingVersions() {
    const ret = [];

    for (let w of worldData) {
        if (!w.verAdded)
            ret.push(`${getWorldLinkForAdmin(w)} is missing version added`);
        if (w.removed && !w.verRemoved)
            ret.push(`${getWorldLinkForAdmin(w)} is missing version removed`);
    }

    return ret;
}

function getMissingLocationParams() {
    const ret = [];

    for (let w of worldData) {
        if (!w.titleJP || w.titleJP === "None")
            ret.push(`${getWorldLinkForAdmin(w)} is missing its Japanese name parameter`);
            
        for (let conn of w.connections) {
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
            if (conn.type & ConnType.SEASONAL) {
                if (!conn.typeParams || !conn.typeParams[ConnType.SEASONAL] || !conn.typeParams[ConnType.SEASONAL].params)
                    ret.push(`${getWorldLinkForAdmin(w)} is missing the season parameter for its connection to ${getWorldLinkForAdmin(connWorld)}`);
            }
        }
    }

    return ret;
}

function getMissingMapIds() {
    return worldData.filter(w => w.noMaps).map(w => `${getWorldLinkForAdmin(w)} has no associated Map IDs`);
}

function getMissingBgmUrls() {
    const ret = [];

    for (let w of worldData) {
        if (w.bgmLabel) {
            const bgmUrls = w.bgmUrl ? w.bgmUrl.split('|') : [ '' ];
            const bgmLabels = w.bgmLabel.split('|').map(l => l.endsWith('^') ? l.slice(0, -1) : l.replace(/\^(.*)/, ' ($1)'));
            for (let b of bgmLabels) {
                const bgmUrl = bgmUrls[b];
                if (!bgmUrl && b !== 'None')
                    ret.push(`${getWorldLinkForAdmin(w)} is missing the BGM URL for ${b}`);
            }
        }
    }

    return ret;
}

function getWorldLinkForAdmin(world) {
    const removedPrefix = world.removed ? '[REMOVED] ' : '';
    return `${removedPrefix}<a class="js--world-link world-link no-border" href="javascript:void(0);" data-world-id="${world.id}">${world.title}</a>`
}

let versionUpdateState;
const versionUpdateEntryEditHtml = `
    <span class="version-update__version__entry-edit display--none">
        <select class="version-update__version__entry-edit__entry-type">
            <option value="${versionUtils.VersionEntryType.ADD}">Add</option>
            <option value="${versionUtils.VersionEntryType.UPDATE}">Update</option>
            <option value="${versionUtils.VersionEntryType.REMOVE}">Remove</option>
        </select>
        <input type="text" class="version-update__version__entry-edit__world" />
        <select class="version-update__version__entry-edit__entry-update-type display--none">
            <option value="${versionUtils.VersionEntryUpdateType.CHANGE}">Change</option>
            <option value="${versionUtils.VersionEntryUpdateType.MINOR_CHANGE}">Minor Change</option>
            <option value="${versionUtils.VersionEntryUpdateType.MAJOR_CHANGE}">Major Change</option>
            <option value="${versionUtils.VersionEntryUpdateType.BUG_FIX}">Bug Fix</option>
            <option value="${versionUtils.VersionEntryUpdateType.ADD_CONTENT}">Add New Content</option>
            <option value="${versionUtils.VersionEntryUpdateType.REMOVE_CONTENT}">Remove Content</option>
            <option value="${versionUtils.VersionEntryUpdateType.LAYOUT_CHANGE}">Layout Change</option>
            <option value="${versionUtils.VersionEntryUpdateType.EXPANSION}">Expansion</option>
            <option value="${versionUtils.VersionEntryUpdateType.REDUCTION}">Reduction</option>
            <option value="${versionUtils.VersionEntryUpdateType.ADD_SUB_AREA}">Add Sub Area</option>
            <option value="${versionUtils.VersionEntryUpdateType.REMOVE_SUB_AREA}">Remove Sub Area</option>
            <option value="${versionUtils.VersionEntryUpdateType.CONNECTION_CHANGE}">Connection Change</option>
            <option value="${versionUtils.VersionEntryUpdateType.ADD_CONNECTION}">Add Connection</option>
            <option value="${versionUtils.VersionEntryUpdateType.REMOVE_CONNECTION}">Remove Connection</option>
            <option value="${versionUtils.VersionEntryUpdateType.BGM_CHANGE}">BGM Change</option>
            <option value="${versionUtils.VersionEntryUpdateType.EFFECT_CHANGE}">Effect-related Change</option>
            <option value="${versionUtils.VersionEntryUpdateType.REWORK}">Rework</option>
        </select>
        <a href="javascript:void(0);" class="js--version-update__version__entry__delete-btn icon-link no-border">🗑️</a>
    </span>
`;

function getWorldVersionInfo(worldId) {
    if (versionUpdateState.worldVerInfoCache.hasOwnProperty(worldId))
        return versionUpdateState.worldVerInfoCache[worldId];
    const world = worldData[worldId];
    const verAdded = world.verAdded ? world.verAdded.name : null;
    const verUpdated = world.verUpdated ? world.verUpdated.map(vu => `${vu.verUpdated.name}${(vu.updateType ? '-' : '')}${vu.updateType || ''}`).join(',') : null;
    const verRemoved = world.verRemoved ? world.verRemoved.name : null;
    //const verGaps = world.verGaps ? world.verGaps.map(vg => `${vg.verRemoved.name}-${vg.verReadded.name}`).join(',') : null;

    return {
        verAdded: verAdded,
        verUpdated: verUpdated,
        verRemoved: verRemoved,
        //verGaps: verGaps
    };
}

function initVersionUpdate() {
    versionUpdateState = {
        hasChanges: false,
        editVerIndex: null,
        worldVerInfoCache: {},
        updatedWorldVerInfo: {}
    };

    const $content = $('.js--version-update-modal__content');

    $content.empty();

    const $usernameInput = $(`
        <div class="control" style="margin-left:-20px">
            <label class="noselect">Username:</label>
            <input name="username" type="text" class="js--username-input" />
        </div>
    `).appendTo($content);
    $usernameInput.find('input').val(username);

    let versionNum = null;
    let subVersion = null;
    const $versionContainer = $('<div class="version-update__version-container"></div>').appendTo($content);
    let $subVersionContainer;
    let $patchVersionContainer;

    for (let v = 0; v < authoredVersionData.length - 1; v++) {
        const ver = authoredVersionData[v];

        const match = ver.name.match(versionUtils.versionPattern);
        if (match.length) {

            const versionEntries = versionUtils.getVersionEntries(ver, worldData);

            ver.addEntries = versionEntries.filter(v => v.type === versionUtils.VersionEntryType.ADD);
            ver.updateEntries = versionEntries.filter(v => v.type === versionUtils.VersionEntryType.UPDATE);
            ver.removeEntries = versionEntries.filter(v => v.type === versionUtils.VersionEntryType.REMOVE);

            const patchVersion = match[4];
            const $versionControls = $(`
                <span class="version-update__version__controls" data-ver-index="${ver.authoredIndex}">
                    <a href="javascript:void(0);" class="js--version-update__version__edit-btn icon-link no-border">✏️</a>
                    <a href="javascript:void(0);" class="js--version-update__version__cancel-btn icon-link no-border display--none">❌</a>
                    <a href="javascript:void(0);" class="js--version-update__version__save-btn icon-link no-border display--none">✅</a>
                </span>
            `);

            const newVersion = match[2] !== versionNum;

            if (newVersion) {
                versionNum = match[2];
                $versionContainer.append(`<h2><a href="javascript:void(0);" class="js--version-update__version-display-toggle no-border">${match[1] || ''}${match[2]}</a></h2>`);
                $subVersionContainer = $(`<div class="version-update__sub-version-container"${(v > 0 ? ' style="display: none;"' : '')}></div>`).appendTo($versionContainer);
            }
            
            if (newVersion || (match[3] || null) !== subVersion) {
                subVersion = match[3] || null;
                const $subVersionTitle = $('<div class="version-update__sub-version-title"></div>').appendTo($subVersionContainer);
                $subVersionTitle.append(`<h3>${match[1] || ''}${match[2]}${subVersion || ''}</h3>`);
                $patchVersionContainer = $('<div class="version-update__patch-version-container"></div>').appendTo($subVersionContainer);
            }
            
            const $ver = $(`<div class="version-update__version" data-ver-index="${ver.authoredIndex}"></div>`).prependTo($patchVersionContainer);
            const $entries = $('<ul class="version-update__version__entries"></ul>').appendTo($ver);

            if (patchVersion !== undefined) {
                const $patchVersionTitle = $('<div class="version-update__patch-version-title"></div>').prependTo($patchVersionContainer);
                $patchVersionTitle.append(`<h4>Patch ${patchVersion}</h4>`);
                $patchVersionTitle.append($versionControls);
            }
            else
                $subVersionContainer.children('.version-update__sub-version-title:last').append($versionControls);

            for (let ae of ver.addEntries) {
                const world = worldData[ae.worldId];
                const $entry = $(`
                    <li class="js--version-update__version__entry styled-list-item">
                        <span class="version-update__version__entry-view"></span>
                        ${versionUpdateEntryEditHtml}
                    </li>
                `);
                $entry.data('worldId', world.id);
                $entry.data('entryType', versionUtils.VersionEntryType.ADD);
                $entries.append($entry);
            }

            for (let ue of ver.updateEntries) {
                const world = worldData[ue.worldId];
                const $entry = $(`
                    <li class="js--version-update__version__entry styled-list-item">
                        <span class="version-update__version__entry-view"></span>
                        ${versionUpdateEntryEditHtml}
                    </li>
                `);
                $entry.data('worldId', world.id);
                $entry.data('entryType', versionUtils.VersionEntryType.UPDATE);
                $entry.data('entryUpdateType', ue.updateType);
                $entries.append($entry);
            }

            for (let re of ver.removeEntries) {
                const world = worldData[re.worldId];
                const $entry = $(`
                    <li class="js--version-update__version__entry styled-list-item">
                        <span class="version-update__version__entry-view"></span>
                        ${versionUpdateEntryEditHtml}
                    </li>
                `);
                $entry.data('worldId', world.id);
                $entry.data('entryType', versionUtils.VersionEntryType.REMOVE);
                $entries.append($entry);
            }

            $ver.append(`
                <li class="js--version-update__version__new-entry styled-list-item">
                    <span class="version-update__version__entry-edit display--none">
                        <a href="javascript:void(0);" class="js--version-update__version__entry__add-btn icon-link no-border">➕</a>
                    </span>
                </li>
            `);
        }
    }

    $('.js--version-update__version__entry').each(function () {
        const worldId = $(this).data('worldId');
        const entryText = worldId !== undefined && worldId != null
            ? getVersionDetailsEntryText(worldId, $(this).data('entryType'), $(this).data('entryUpdateType'))
            : 'Invalid Entry';
        $(this).children('.version-update__version__entry-view').text(entryText);
    });
}

function initVersionUpdateEvents() {
    $(document).on('change', '.version-update__version__entry-edit__entry-type', function () {
        $(this).parent().children('.version-update__version__entry-edit__entry-update-type')
            .toggleClass('display--none', parseInt($(this).val()) !== versionUtils.VersionEntryType.UPDATE);
    });

    $(document).on('click', '.js--version-update__version-display-toggle', function () {
        $(this).parent().next('.version-update__sub-version-container').toggle(250);
    });

    const worldNames = worldData.map(w => w.titleJP ? `${w.title} (${w.titleJP})` : w.title);
    const worldsByName = _.keyBy(worldData, w => w.titleJP ? `${w.title} (${w.titleJP})` : w.title);

    $(document).on('click', '.js--version-update__version__edit-btn', function () {
        const verIndex = $(this).parents('.version-update__version__controls').data('verIndex');

        versionUpdateState.editVerIndex = verIndex;

        const $editVer = $(`.version-update__version[data-ver-index=${verIndex}]`);
        $editVer.find('.version-update__version__entry-view').addClass('display--none');
        $editVer.find('.version-update__version__entry-edit').removeClass('display--none');

        $('.js--version-update__version__edit-btn').addClass('display--none');

        const $verControls = $(`.version-update__version__controls[data-ver-index=${verIndex}]`);
        $verControls.find('.js--version-update__version__cancel-btn, .js--version-update__version__save-btn').removeClass('display--none');

        $editVer.find('.version-update__version__entry-edit__world').each(function () {
            const $worldLookup = $(this);
            initVersionUpdateWorldLookup($worldLookup, worldNames, worldsByName);
        });

        $editVer.find('.js--version-update__version__entry').each(function () {
            const worldId = $(this).data('worldId');
            const entryType = $(this).data('entryType');
            const entryUpdateType = entryType === versionUtils.VersionEntryType.UPDATE ? $(this).data('entryUpdateType') : null;
           
            $(this).find('.version-update__version__entry-edit__entry-type').val(entryType);

            if (worldId !== undefined && worldId != null) {
                const world = worldData[worldId];
                $(this).find('.version-update__version__entry-edit__world').val(world.titleJP ? `${world.title} (${world.titleJP})` : world.title).data('id', worldId);
            }

            $(this).find('.version-update__version__entry-edit__entry-update-type').toggleClass('display--none', entryUpdateType == null).val(entryUpdateType);
        });
    });

    $(document).on('click', '.js--version-update__version__cancel-btn, .js--version-update__version__save-btn', function () {
        const isSave = $(this).hasClass('js--version-update__version__save-btn');
        const verIndex = $(this).parents('.version-update__version__controls').data('verIndex');
        const $editVer = $(`.version-update__version[data-ver-index=${verIndex}]`);
        const verName = authoredVersionData[verIndex - 1].name;
        
        const versionUpdateEntryUpdateWorldIds = isSave ? [] : null;
        const versionUpdateEntryWorldIds = isSave ? [] : null;
        const versionUpdateEntryUpdateFuncs = [];

        $editVer.find('.js--version-update__version__entry').each(function () {
            const $entryTypeSelect = $(this).find('.version-update__version__entry-edit__entry-type');
            const $worldInput = $(this).find('.version-update__version__entry-edit__world');
            const $entryUpdateTypeSelect = $(this).find('.version-update__version__entry-edit__entry-update-type');

            let changesMade = false;

            const isDeleted = $(this).hasClass('display--none');

            const lastWorldId = $(this).data('worldId');
            const worldId = !isSave || isDeleted ? lastWorldId : $worldInput.data('id');
            const hasWorldId = worldId !== undefined && worldId != null;

            if (hasWorldId || isDeleted || (lastWorldId !== undefined && lastWorldId != null)) {
                if (isSave) {

                    const entryType = isDeleted ? $(this).data('entryType') : parseInt($entryTypeSelect.val());
                    const entryUpdateType = isDeleted ? $(this).data('entryUpdateType') || ''
                        : entryType === versionUtils.VersionEntryType.UPDATE ? $entryUpdateTypeSelect.val() : '';

                    if (hasWorldId) {
                        if (!versionUpdateState.updatedWorldVerInfo.hasOwnProperty(worldId))
                            versionUpdateState.updatedWorldVerInfo[worldId] = getWorldVersionInfo(worldId);

                        const worldVerInfo = versionUpdateState.updatedWorldVerInfo[worldId];

                        const updateBaseVerPattern = new RegExp(`^${verName}(?:\\-[a-z\\-\\+]{1,2})?$`);
                        const updateVerPattern = new RegExp(`^${verName}${entryUpdateType ? '\\-' : ''}${entryUpdateType.replace(/([\+\-])/g, '\\$1')}$`);

                        if ((isDeleted || entryType !== versionUtils.VersionEntryType.ADD) && worldVerInfo.verAdded === verName) {
                            worldVerInfo.verAdded = null;
                            changesMade = true;
                        }

                        if ((isDeleted || entryType !== versionUtils.VersionEntryType.UPDATE) && worldVerInfo.verUpdated) {
                            const updateVers = worldVerInfo.verUpdated.split(',');
                            let matchFound = false;
                            const matchVer = updateVers.find(vu => updateBaseVerPattern.test(vu));
                            if (matchVer) {
                                updateVers.splice(updateVers.indexOf(matchVer), 1);
                                matchFound = true;
                            }
                            if (matchFound) {
                                worldVerInfo.verUpdated = updateVers.join(',');
                                changesMade = true;
                            }
                        }

                        if ((isDeleted || entryType !== versionUtils.VersionEntryType.REMOVE) && worldVerInfo.verRemoved === verName) {
                            worldVerInfo.verRemoved = null;
                            changesMade = true;
                        }

                        if (!isDeleted) {
                            switch (entryType) {
                                case versionUtils.VersionEntryType.ADD:
                                    if (worldVerInfo.verAdded == null) {
                                        worldVerInfo.verAdded = verName;
                                        changesMade = true;
                                    }
                                    break;
                                case versionUtils.VersionEntryType.UPDATE:
                                    const updateVerName = `${verName}${(entryUpdateType ? '-' : '')}${entryUpdateType}`;
                                    if (worldVerInfo.verUpdated) {
                                        if (!worldVerInfo.verUpdated.split(',').find(vu => updateVerPattern.test(vu))) {

                                            const updateVers = versionUtils.parseVersionsUpdated(worldVerInfo.verUpdated);
                                            const updateTypes = Object.values(versionUtils.VersionEntryUpdateType);

                                            const baseMatchVer = updateVers.find(vu => vu.verUpdated === verName);

                                            if (baseMatchVer)
                                                baseMatchVer.updateType = entryUpdateType;
                                            else {
                                                updateVers.push({
                                                    verUpdated: verName,
                                                    updateType: entryUpdateType
                                                });
                                            
                                                updateVers.sort(function (vu1, vu2) {
                                                    let ret = versionUtils.compareVersionNames(vu1.verUpdated, vu2.verUpdated);
                                                    if (ret === 0)
                                                        ret = updateTypes.indexOf(vu1.updateType) < updateTypes.indexOf(vu2.updateType) ? -1 : 1;
                                                    return ret;
                                                });
                                            }
                                            
                                            worldVerInfo.verUpdated = updateVers.map(vu => `${vu.verUpdated}${(vu.updateType ? '-' : '')}${vu.updateType}`).join(',');
                                            changesMade = true;
                                        }
                                    } else {
                                        worldVerInfo.verUpdated = updateVerName;
                                        changesMade = true;
                                    }
                                    break;
                                case versionUtils.VersionEntryType.REMOVE:
                                    if (worldVerInfo.verRemoved == null) {
                                        worldVerInfo.verRemoved = verName;
                                        changesMade = true;
                                    }
                                    break;
                            }
                        }
                    }

                    if (changesMade && versionUpdateEntryUpdateWorldIds.indexOf(worldId) === -1)
                        versionUpdateEntryUpdateWorldIds.push(worldId);

                    versionUpdateEntryWorldIds.push(hasWorldId ? worldId : null);
                    versionUpdateEntryUpdateFuncs.push(changesMade ? getVersionUpdateEntryUpdateFunc($(this), entryType, worldId, entryUpdateType) : getVersionUpdateEntryCancelFunc($(this), lastWorldId));
                }
            } else
                $(this).remove();
        });

        const finishEditCallback = function (updatedLocations) {
            if (isSave && updatedLocations.length) {
                if (!versionUpdateState.hasChanges) {
                    versionUpdateState.hasChanges = true;
                    $('.js--version-update-modal').on($.modal.AFTER_CLOSE, onCloseVersionUpdateModalWithChanges);
                }
            }

            $editVer.find('.js--version-update__version__entry').each(function (i) {
                if (isSave) {
                    const worldId = versionUpdateEntryWorldIds[i];
                    let updateFunc;
                    if (worldId != null && updatedLocations.indexOf(worldData[worldId].title) > -1) {
                        updateFunc = versionUpdateEntryUpdateFuncs[i];
                        versionUpdateState.worldVerInfoCache[worldId] = versionUpdateState.updatedWorldVerInfo[worldId];
                    } else
                        updateFunc = getVersionUpdateEntryCancelFunc($(this), worldId);
                    updateFunc();
                } else
                    $(this).removeClass('display--none');
            });

            versionUpdateState.editVerIndex = null;
            versionUpdateState.updatedWorldVerInfo = {};

            $('.js--version-update__version__cancel-btn, .js--version-update__version__save-btn').addClass('display--none');
            $('.js--version-update__version__edit-btn').removeClass('display--none');

            $editVer.find('.version-update__version__entry-edit').addClass('display--none');
            $editVer.find('.version-update__version__entry-view').removeClass('display--none');

            $editVer.find('.version-update__version__entry-edit__world').devbridgeAutocomplete('destroy');
        };

        if (isSave) {
            if (versionUpdateEntryUpdateWorldIds.length) {
                const user = $('.js--username-input').val();
                const data = {
                    adminKey: urlSearchParams.get('adminKey'),
                    user: user,
                    version: verName,
                    entries: versionUpdateEntryUpdateWorldIds.map(w => $.extend({ location: worldData[w].title }, versionUpdateState.updatedWorldVerInfo[w]))
                };
                $.post('/updateLocationVersions', data, function (data) {
                    finishEditCallback(data.success ? data.updatedLocations : []);
                    if (data.success && config.username !== user) {
                        config.username = user;
                        updateConfig(config);
                    }
                });
            } else
                finishEditCallback([]);
        } else
            finishEditCallback([]);
    });

    $(document).on('click', '.js--version-update__version__entry__delete-btn', function () {
        const $entry = $(this).parents('.js--version-update__version__entry');
        const worldId = $entry.data('worldId');
        if (worldId !== undefined && worldId != null)
            $entry.addClass('display--none');
        else
            $entry.remove();
    });

    $(document).on('click', '.js--version-update__version__entry__add-btn', function () {
        const $editVer = $(this).parents('.version-update__version');
        const $entryEdit = $(versionUpdateEntryEditHtml);
        const $entry = $(`
            <li class="js--version-update__version__entry styled-list-item">
                <span class="version-update__version__entry-view display--none"></span>
            </li>
        `).append($entryEdit.removeClass('display--none'));
        $editVer.find('.version-update__version__entries').append($entry);
        initVersionUpdateWorldLookup($entry.find('.version-update__version__entry-edit__world'), worldNames, worldsByName);
    });
}

function getVersionUpdateEntryUpdateFunc($entry, entryType, worldId, entryUpdateType) {
    return function () {
        if ($entry.hasClass('display--none'))
            $entry.remove();
        else {
            $entry.data('entryType', entryType);
            $entry.data('worldId', worldId);
            $entry.data('entryUpdateType', entryUpdateType);

            $entry.children('.version-update__version__entry-view').text(getVersionDetailsEntryText(worldId, entryType, entryUpdateType));
        }
    };
}

function getVersionUpdateEntryCancelFunc($entry, w) {
    const worldId = w;
    return function () {
        if (worldId !== undefined && worldId != null)
            $entry.removeClass('display--none');
        else
            $entry.remove();
    };
}

function initVersionUpdateWorldLookup($worldLookup, worldNames, worldsByName) {
    $worldLookup.devbridgeAutocomplete({
        lookup: worldNames,
        onSelect: function (selectedWorld) {
            $worldLookup.data('id', worldsByName[selectedWorld.value].id);
        }
    });
}

function onCloseVersionUpdateModalWithChanges() {
    reloadData(true);
    $(this).off($.modal.AFTER_CLOSE, onCloseVersionUpdateModalWithChanges);
}

function initAdminControls() {
    $('.js--check-data-issues').on('click', function() {
        if ($('.js--data-issues-modal:visible').length) {
            $.modal.close();
            return;
        }

        $('.js--data-issues-modal').modal({
            fadeDuration: 100,
            closeClass: 'noselect',
            closeText: '✖'
        });

        const dataIssues = {
            'missing-conns': {
                data: getMissingConnections(),
                emptyMessage: 'No missing connections found'
            },
            'invalid-conn-pairs': {
                data: getInvalidConnectionPairs(),
                emptyMessage: 'No invalid connection pairs found'
            },
            'missing-versions': {
                data: getMissingVersions(),
                emptyMessage: 'No missing versions found'
            },
            'missing-location-params': {
                data: getMissingLocationParams(),
                emptyMessage: 'No missing location parameters found'
            },
            'missing-map-ids': {
                data: getMissingMapIds(),
                emptyMessage: 'No locations with missing map IDs found'
            },
            'missing-bgm-urls': {
                data: getMissingBgmUrls(),
                emptyMessage: 'No missing BGM URLs found'
            }
        };

        Object.keys(dataIssues).forEach(di => {
            const data = dataIssues[di].data;
            const $dataList = $('<ul></ul>');
            if (data.length) {
                for (let d of data)
                    $dataList.append(`<li class="styled-list-item">${d}</li>`);
            } else
                $dataList.append(`<li class="styled-list-item">${dataIssues[di].emptyMessage}</li>`);
            $(`.js--data-issues__${di}`).html($dataList);
        });
    });

    $('.js--version-update').on('click', function () {
        if ($('.js--version-update-modal:visible').length) {
            $.modal.close();
            return;
        }

        $('.js--version-update-modal').modal({
            fadeDuration: 100,
            closeClass: 'noselect',
            closeText: '✖',
        });

        initVersionUpdate();
    });

    initVersionUpdateEvents();

    $('.js--update-data, .js--reset-data').on('click', function() {
        closeModals();
        const isReset = $(this).hasClass('js--reset-data');
        reloadData(isReset ? 'reset' : true);
    });

    $(document).on('click', 'a.js--world-link', function () {
        openWorldWikiPage($(this).data('worldId'), isShift);
    });

    $(document).on('click', 'a.js--world-node-link', function () {
        trySelectNode($(this).data('worldId'), true, true);
    });
}

/* End Admin */

$(function () {
    loadOrInitConfig();

    const loadCallback = displayLoadingAnim($('#graphContainer'));

    initControls();

    initLocalization(true);

    loadData(false, function (data) {
        initWorldData(data.worldData);
        initVersionData(data.versionInfoData);
        initAuthorData(data.authorInfoData, data.versionInfoData);
        initEffectData(data.effectData);
        initMenuThemeData(data.menuThemeData);
        initWallpaperData(data.wallpaperData);
        initBgmTrackData(data.bgmTrackData);
        initPlaylist();
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