const _ = require('lodash')._;

const VersionEntryType = {
    ADD: 1,
    REMOVE: 2,
    UPDATE: 3
};

const VersionEntryUpdateType = {
    CHANGE: '',
    MINOR_CHANGE: '-',
    MAJOR_CHANGE: '+',
    BUG_FIX: 'b',
    ADD_CONTENT: '++',
    REMOVE_CONTENT: '--',
    LAYOUT_CHANGE: 'l',
    EXPANSION: 'a+',
    REDUCTION: 'a-',
    ADD_SUB_AREA: 's+',
    REMOVE_SUB_AREA: 's-',
    CONNECTION_CHANGE: 'c',
    ADD_CONNECTION: 'c+',
    REMOVE_CONNECTION: 'c-',
    BGM_CHANGE: 'm',
    EFFECT_CHANGE: 'ef',
    REWORK: 'rw'
};

const versionPattern = /^(pre\-)?(\d+\.\d+)([a-z])?(?:[0-9])?(?: patch (\d+))?/;
const versionUpdatedPattern = /^(pre\-)?(\d+\.\d+)([a-z])?(?:[0-9])?(?: patch (\d+))?(?:\-[a-z\-\+]{1,2})?/;
const versionRangePattern = /^(pre\-)?(\d+\.\d+)([a-z])?(?:[0-9])?(?: patch (\d+))?\-(pre\-)?(\d+\.\d+)([a-z])?(?:[0-9])?(?: patch (\d+))?/;

function compareVersionNames(v1, v2) {
    if (v1 === v2)
        return 0;

    const match1 = v1.match(versionPattern);
    const match2 = v2.match(versionPattern);

    if (match1 != null && match2 != null) {
        let verNum1 = parseFloat(match1[2]);
        let verNum2 = parseFloat(match2[2]);

        if (verNum1 === verNum2) {

            let subVer1 = match1[3];
            let subVer2 = match2[3];

            if (subVer1 !== undefined && subVer2 !== undefined) {
                subVer1 = subVer1.toLowerCase();
                subVer2 = subVer2.toLowerCase();
                if (subVer1 !== subVer2)
                    return subVer1 < subVer2 ? -1 : 1;
            } else if (subVer2 != null)
                return -1;
            else if (subVer1 != null)
                return 1;

            let patchVer1 = match1[4];
            let patchVer2 = match2[4];

            if (patchVer1 !== undefined && patchVer2 !== undefined) {
                patchVer1 = parseInt(patchVer1);
                patchVer2 = parseInt(patchVer2);
                if (patchVer1 !== patchVer2)
                    return patchVer1 < patchVer2 ? -1 : 1;
            } else if (patchVer2 != null)
                return -1;
            else if (patchVer1 != null)
                return 1;
        } else
            return verNum1 < verNum2 ? -1 : 1;
        if (match1[1] !== undefined) {
            if (match2[1] === undefined)
                return -1;
        } else if (match2[1] !== undefined)
            return 1;
    } else if (match2 != null)
        return -1;
    else if (match1 != null)
        return 1;
    
    return 0;
}

function getVersionSortFunction(getVersion, getId, versions) {
    return function (o1, o2) {
        const v1 = getVersion(o1);
        const v2 = getVersion(o2);

        if ((v1 && v1.index === -1) || (v2 && v2.index === -1))
            return compareVersionNames(v2 ? v2.name : '9.99', v1 ? v1.name : '9.99');

        if ((v1 ? v1.index : -1) === (v2 ? v2.index : -1)) {
            const o1Id = getId(o1);
            const o2Id = getId(o2);
            return o1Id < o2Id ? -1 : o1Id > o2Id ? 1 : 0;
        }

        const versionNames = versions.map(v => v.name);
        let v1Index = v1 ? versionNames.indexOf(v1.name) : 999;
        let v2Index = v2 ? versionNames.indexOf(v2.name) : 999;

        if (v1Index === v2Index)
            return 0;

        return v2Index > -1 ? v1Index > -1 ? v1Index < v2Index ? -1 : 1 : -1 : 1;
    }
}

function validateVersionsUpdated(versionsUpdated) {
    const ret = versionsUpdated.split(',').filter(vu => versionUpdatedPattern.test(vu)).join(',');
    return ret.length ? ret : null;
}

function parseVersionsUpdated(versionsUpdated) {
    return versionsUpdated.split(',').map(vu => {
        const dashIndex = vu.indexOf('-');
        return {
            verUpdated: dashIndex > -1 ? vu.slice(0, dashIndex) : vu,
            updateType: dashIndex > -1 ? vu.slice(dashIndex + 1) : ''
        };
    });
}

function validateVersionGaps(versionGaps) {
    const ret = versionGaps.split(',').filter(vg => versionRangePattern.test(vg)).join(',');
    return ret.length ? ret : null;
}

function parseVersionGaps(versionGaps) {
    return versionGaps.split(',').map(vg => {
        const dashIndex = vg.indexOf('-');
        return {
            verRemoved: vg.slice(0, dashIndex),
            verReadded: vg.slice(dashIndex + 1)
        };
    });
}

function parseVersionNames(versionNames) {
    const ret = [];
    for (let v = 0; v < versionNames.length; v++) {
        const name = versionNames[v];
        ret.push(getEmptyVersion(versionNames.length - v, name));
    }
    return ret;
}

function getEmptyVersion(index, name, nameJP) {
    if (!nameJP && name)
        nameJP = getVersionNameJP(name);
    return {
        index: index,
        name: name,
        nameJP: nameJP,
        authors: [],
        releaseDate: null,
        addedWorldIds: [],
        updatedWorldIds: [],
        removedWorldIds: []
    };
}

function getVersionNameJP(versionName) {
    return versionName.replace('patch ', 'パッチ').replace(/^(?:pre\-)(.*)/, '$1前');
}

function getMissingVersion(index) {
    return getEmptyVersion(index, 'N/A', '不明');
}

function getUniqueWorldVersionNames(worldData) {
    return _.uniq(
        worldData.filter(w => w.verAdded).map(w => w.verAdded).concat(
            worldData.filter(w => w.verRemoved).map(w => w.verRemoved)).concat(_.flatten(worldData.filter(w => w.verUpdated).map(w => w.verUpdated.map(vu => vu.verUpdated)))).concat(
                _.flatten(worldData.filter(w => w.verGaps).map(w => _.flatten(w.verGaps.map(vg => [vg.verRemoved, vg.verReadded]))))
            )
        );
}

function isWorldInVersion(world, versionIndex, missingVersionIndex, limitVersion) {
    if (!world.verAdded)
        return versionIndex === missingVersionIndex;
    else if (versionIndex === missingVersionIndex)
        return false;

    if (limitVersion)
        return world.verAdded.index === versionIndex || (world.verUpdated && world.verUpdated.map(vu => vu.verUpdated.index).indexOf(versionIndex) > -1)
            || (world.verRemoved && world.verRemoved.index === versionIndex)
            || (world.verGaps && world.verGaps.filter(vg => vg.verRemoved.index === versionIndex || vg.verReadded.index === versionIndex).length);

    if (world.verAdded.index > versionIndex || (world.verRemoved && world.verRemoved.index >= versionIndex))
        return false;

    if (world.verGaps) {
        for (let vg of world.verGaps) {
            if (versionIndex >= vg.verRemoved && versionIndex < vg.verReadded)
                return false;
        }
    }

    return true;
}

function isVersionNew(version) {
    return version && Math.floor((new Date().getTime() - version.releaseDate) / (24 * 3600 * 1000)) < 7;
}

function getVersionEntries(version, worldData) {
    const addEntries = [];
    const updateEntries = [];
    const removeEntries = [];

    for (let aw of version.addedWorldIds) {
        const world = worldData[aw];
        addEntries.push(getVersionEntry(world, VersionEntryType.ADD));
    }

    for (let uw of version.updatedWorldIds) {
        const world = worldData[uw];
        const verUpdated = world.verUpdated.find(vu => vu.verUpdated.authoredIndex === version.authoredIndex);
        updateEntries.push(getVersionEntry(world, VersionEntryType.UPDATE, verUpdated.updateType));
    }

    for (let rw of version.removedWorldIds) {
        const world = worldData[rw];
        removeEntries.push(getVersionEntry(world, VersionEntryType.REMOVE));
    }

    return addEntries.concat(updateEntries).concat(removeEntries);
}

function getVersionEntry(world, type, updateType) {
    return {
        worldId: world.id,
        type: type,
        updateType: type === VersionEntryType.UPDATE && updateType ? updateType : ''
    };
}

if (typeof exports === "object")
    module.exports = {
        VersionEntryType,
        VersionEntryUpdateType,
        versionPattern,
        versionRangePattern,
        compareVersionNames,
        getVersionSortFunction,
        validateVersionsUpdated,
        validateVersionGaps,
        parseVersionsUpdated,
        parseVersionGaps,
        parseVersionNames,
        getEmptyVersion,
        getVersionNameJP,
        getMissingVersion,
        getUniqueWorldVersionNames,
        isVersionNew,
        isWorldInVersion,
        getVersionEntries,
        getVersionEntry
    };