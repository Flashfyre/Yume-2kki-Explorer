const $ = require('jquery');
const _ = require('lodash')._;
const ConnType = require('./conn-type').ConnType;

class PathFinder {
    constructor(worldData, isDebug, defaultPathIgnoreConnTypeFlags, ignoreNexusConns, effectsJP) {
        this.worldData = worldData;
        this.isDebug = isDebug;
        this.defaultPathIgnoreConnTypeFlags = defaultPathIgnoreConnTypeFlags;
        this.ignoreNexusConns = ignoreNexusConns;
        this.effectsJP = effectsJP;
    }

    findPath(s, t, isRoot, ignoreTypeFlags, limit, existingMatchPaths) {
        const startTime = performance.now();

        const checkedSourceNodes = [s];
        const checkedTargetNodes = [t];

        const source = this.worldData[s];
        const target = this.worldData[t];

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
                const sourceConns = this.traverseConns(checkedSourceNodes, sourcePath, nextGenSourceWorlds, sourceWorld, ignoreTypeFlags, true);
                _.assign(sourcePaths, sourceConns);
            }
            for (let targetWorld of targetWorlds) {
                const targetPath = targetPaths[targetWorld.id];
                //delete targetPaths[targetWorld.id];
                const targetConns = this.traverseConns(checkedTargetNodes, targetPath, nextGenTargetWorlds, targetWorld, ignoreTypeFlags, false);
                _.assign(targetPaths, targetConns);
            }

            genIndex++;

            /*let checkedSourceIds = Object.keys(sourcePaths).map(id => parseInt(id));
            let checkedTargetIds = Object.keys(targetPaths).map(id => parseInt(id));*/

            _.filter(checkedSourceNodes, id => {
                const ret = _.indexOf(checkedTargetNodes, id) !== -1;
                if (ret) {
                    let skip = false;

                    let sourcePath = _.cloneDeep(sourcePaths[id]);
                    let targetPath = _.cloneDeep(targetPaths[id]);

                    if (sourcePath[sourcePath.length - 1].id === id && targetPath[targetPath.length - 1].id === id)
                        sourcePath = sourcePath.slice(0, -1);

                    let loopWorldIds, sourcePathIds, targetPathIds;
                    while ((loopWorldIds = _.intersectionWith((sourcePathIds = sourcePath.map(sp => sp.id)), (targetPathIds = targetPath.map(tp => tp.id)), _.isEqual)).length) {
                        //console.log("Loop found", this.worldData[loopWorldIds[0]].title, JSON.stringify(sourcePath.map(function(p) { return this.worldData[p].title})), JSON.stringify(targetPath.map(function(p) { return this.worldData[p].title})));
                        sourcePath = sourcePath.slice(0, sourcePathIds.indexOf(loopWorldIds[0]));
                        targetPath = targetPath.slice(0, targetPathIds.indexOf(loopWorldIds[0]) + 1);
                        //console.log("Loop fixed", this.worldData[loopWorldIds[0]].title, JSON.stringify(sourcePath.map(function(p) { return this.worldData[p].title})), JSON.stringify(targetPath.map(function(p) { return this.worldData[p].title})));
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

        this.isDebug && console.log("Found", matchPaths.length, "matching path(s) in", Math.round((endTime - startTime) * 10) / 10, "ms");
        if (!matchPaths.length) {
            if (this.ignoreNexusConns || !this.tryAddNexusPath(matchPaths, existingMatchPaths, s, t)) {
                this.isDebug && console.log("Marking route as inaccessible");
                matchPaths = [[{ id: s, connType: ConnType.INACCESSIBLE }, { id: t, connType: null }]];
            }
            return matchPaths;
        } else if (isRoot) {
            const rootLimit = Math.min(5, limit);
            const ignoreTypesList = [ConnType.CHANCE, ConnType.EFFECT, ConnType.LOCKED | ConnType.LOCKED_CONDITION | ConnType.EXIT_POINT];
            const pathCount = Math.min(matchPaths.length, rootLimit);
            let ignoreTypes = 0;
            for (let ignoreType of ignoreTypesList)
                ignoreTypes |= ignoreType;
            matchPaths = _.sortBy(matchPaths, ['length']);
            this.isDebug && console.log("Looking for unconditionally accessible path...");
            let accessiblePathIndex = -1;
            for (let it = 0; it <= ignoreTypesList.length; it++) {
                const ignoreType = it < ignoreTypesList.length ? ignoreTypesList[it] : 0;
                if (matchPaths.slice(0, pathCount).filter(mp => mp.find(p => p.connType && (p.connType & ignoreTypes))).length === pathCount) {
                    if (matchPaths.length > rootLimit) {
                        for (let mp = rootLimit + 1; mp < matchPaths.length; mp++) {
                            const path = matchPaths[mp];
                            if (!path.find(p => p.connType && (p.connType & ignoreTypes))) {
                                this.isDebug && console.log("Found unconditionally accessible path at index", mp);
                                if (mp >= rootLimit) {
                                    this.isDebug && console.log("Truncating paths to limit of", limit, "with unconditionally accessible path as last element");
                                    matchPaths = matchPaths.slice(0, rootLimit - 1).concat([path]);
                                }
                                accessiblePathIndex = rootLimit - 1;
                                break;
                            }
                        }
                        if (accessiblePathIndex > -1)
                            break;
                    }
                    let additionalPaths = this.findPath(s, t, false, ignoreTypeFlags | ignoreTypes, Math.max(1, Math.min(rootLimit, rootLimit - pathCount)), matchPaths);
                    if (additionalPaths.length && !(additionalPaths[0][0].connType & ConnType.INACCESSIBLE)) {
                        additionalPaths = _.sortBy(additionalPaths, ['length']);
                        if (this.isDebug) {
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
                    this.isDebug && console.log("Truncating array of", matchPaths.length, "paths to root limit of", rootLimit);
                    matchPaths = matchPaths.slice(0, rootLimit);
                }
                if (addAdditionalPaths) {
                    this.isDebug && console.log("Searching for additional paths...");
                    const additionalPaths = this.findPath(s, t, false, this.defaultPathIgnoreConnTypeFlags, limit - rootLimit, existingMatchPaths.concat(matchPaths));
                    if (additionalPaths.length && !(additionalPaths[0][0].connType & ConnType.INACCESSIBLE)) {
                        for (let ap of additionalPaths)
                            matchPaths.push(ap);
                        matchPaths = _.sortBy(matchPaths, ['length']);
                    }
                }
            }

            if (!this.ignoreNexusConns && this.tryAddNexusPath(matchPaths, existingMatchPaths, s, t))
                limit++;
        }

        matchPaths = _.sortBy(matchPaths, ['length']);
        if (matchPaths.length > limit) {
            this.isDebug && console.log("Truncating array of", matchPaths.length, "paths to limit of", limit);
            matchPaths = matchPaths.slice(0, limit);
        }

        return matchPaths;
    }

    traverseConns(checkedNodes, path, nextGenWorlds, world, ignoreTypeFlags, isSource) {
        const ret = {};
        const conns = world.connections;
        for (let conn of conns) {
            let connType = conn.type;
            let typeParams = conn.typeParams;
            if (isSource && connType & ignoreTypeFlags)
                continue;
            const connWorld = this.worldData[conn.targetId];
            if (!connWorld)
                console.log(conn, world, this.worldData[conn.targetId]);
            if (!path)
                console.log(path, world, conn, this.worldData[conn.targetId])
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
                nextGenWorlds.push(this.worldData[id]);
            }
        }
        return ret;
    }

    tryAddNexusPath(matchPaths, existingMatchPaths, sourceId, targetId) {
        const nexusWorldName = "The Nexus";
        const nexusWorldId = this.worldData.find(w => w.title === nexusWorldName).id;

        if (sourceId !== nexusWorldId) {
            this.isDebug && console.log("Searching for paths eligible for Eyeball Bomb Nexus shortcut...");
            const nexusPaths = existingMatchPaths.concat(matchPaths).filter(p => (p.length > targetId !== nexusWorldId ? 2 : 3) && p.find(w => w.id === nexusWorldId));
            if (nexusPaths.length) {
                this.isDebug && console.log("Found", nexusPaths.length, "paths eligible for Eyeball Bomb Nexus shortcut: creating shortcut paths");
                for (let nexusPath of nexusPaths) {
                    const nexusWorldIndex = nexusPath.indexOf(nexusPath.find(w => w.id === nexusWorldId));
                    const nexusShortcutPath = _.cloneDeep([nexusPath[0]].concat(nexusPath.slice(nexusWorldIndex)));
                    const nexusSource = nexusShortcutPath[0];
                    nexusSource.connType = (nexusWorldIndex > 1 ? ConnType.ONE_WAY : 0) | ConnType.EFFECT;
                    nexusSource.typeParams = {};
                    nexusSource.typeParams[ConnType.EFFECT] = {
                        params: 'Eyeball Bomb',
                        paramsJP: this.effectsJP ? this.effectsJP['Eyeball Bomb'] : null
                    };
                    matchPaths.push(nexusShortcutPath);
                    return true;
                }
            }
        }

        return false;
    }

    findRealPathDepth(paths, worldId, pathWorldIds, worldDepthsMap, maxDepth, minDepth, ignoreTypeFlags) {
        let ret = -1;

        if (minDepth == maxDepth)
            return minDepth;

        if (!ignoreTypeFlags)
            ignoreTypeFlags = this.defaultPathIgnoreConnTypeFlags;
        else if (ignoreTypeFlags & ConnType.LOCKED || ignoreTypeFlags & ConnType.LOCKED_CONDITION || ignoreTypeFlags & ConnType.EXIT_POINT)
            ignoreTypeFlags ^= ConnType.LOCKED | ConnType.LOCKED_CONDITION | ConnType.EXIT_POINT;
        else if (ignoreTypeFlags & ConnType.DEAD_END)
            ignoreTypeFlags ^= ConnType.DEAD_END | ConnType.ISOLATED;
        else
            return minDepth;

        for (let p in paths) {
            if (worldDepthsMap[p] === -1)
                continue;

            const path = paths[p];
            const pathWorldDepth = pathWorldIds[p].indexOf(worldId);

            if (pathWorldDepth) {
                let skipPath = pathWorldDepth > 0 && path.slice(0, pathWorldDepth).find(w => w.connType & ignoreTypeFlags);
                if (skipPath)
                    continue;
            }

            if (ret === -1 || pathWorldDepth < ret)
                ret = pathWorldDepth;
        }

        return ret > -1 ? ret : this.findRealPathDepth(paths, worldId, pathWorldIds, worldDepthsMap, maxDepth, minDepth, ignoreTypeFlags);
    }
}

if (typeof exports === "object")
  module.exports = {
      PathFinder
  };