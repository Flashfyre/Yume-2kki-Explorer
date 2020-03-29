const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
const _ = require('lodash');
const superagent = require('superagent');
const fs = require('fs');
const download = require('image-downloader');
const mysql = require("mysql");
const ConnType = require("./public/js/conn-type.js").ConnType;
const isRemote = Boolean(process.env.DATABASE_URL);
const defaultPathIgnoreConnTypeFlags = ConnType.NO_ENTRY | ConnType.LOCKED | ConnType.DEAD_END | ConnType.ISOLATED | ConnType.LOCKED_CONDITION;

let dbInitialized = false;

function initConnPool() {
    let ret;
    if (isRemote) {
        const dbUrl = process.env.DATABASE_URL.slice(process.env.DATABASE_URL.indexOf("mysql://") + 8);
        const user = dbUrl.slice(0, dbUrl.indexOf(":"));
        const password = dbUrl.slice(dbUrl.indexOf(":") + 1, dbUrl.indexOf("@"));
        const host = dbUrl.slice(dbUrl.indexOf("@") + 1, dbUrl.indexOf("/"));
        const database = dbUrl.slice(dbUrl.indexOf("/") + 1, dbUrl.indexOf("?") > -1 ? dbUrl.indexOf("?") : dbUrl.length);
        ret = mysql.createPool({
            host: host,
            user: user,
            password: password,
            database: database
        });
    } else {
        const dbConfig = require("./config/db.config.js");
    
        ret = mysql.createPool({
            host: dbConfig.HOST,
            user: dbConfig.USER,
            password: dbConfig.PASSWORD,
            database: dbConfig.DB
        });
    }
    return ret;
}

function initDb(pool) {
    return new Promise((resolve, reject) => {
        if (!pool)
            return reject("Pool must not be null");

        queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS updates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                lastUpdate DATETIME NULL,
                lastFullUpdate DATETIME NULL
            )`).then(() => queryAsPromise(pool,
            `INSERT INTO updates (lastUpdate, lastFullUpdate)
                SELECT null, null FROM updates
                WHERE id NOT IN (SELECT id FROM updates)`
            )).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS worlds (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                titleJP VARCHAR(255) NULL,
                depth INT NOT NULL,
                filename VARCHAR(255) NOT NULL
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS conns (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sourceId INT NOT NULL,
                targetId INT NOT NULL,
                type SMALLINT NOT NULL,
                CONSTRAINT fk_sourceId
                    FOREIGN KEY (sourceId) 
                    REFERENCES worlds (id),
                CONSTRAINT fk_targetId
                    FOREIGN KEY (targetId) 
                    REFERENCES worlds (id)
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS conn_type_params (
                id INT AUTO_INCREMENT PRIMARY KEY,
                connId INT NOT NULL,
                type SMALLINT NOT NULL,
                params VARCHAR(1000) NOT NULL,
                paramsJP VARCHAR(1000) NULL,
                FOREIGN KEY (connId)
                    REFERENCES conns (id)
                    ON DELETE CASCADE
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS maps (
                id INT AUTO_INCREMENT PRIMARY KEY,
                mapId CHAR(4) NOT NULL,
                width INT NOT NULL,
                height INT NOT NULL
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS world_maps (
                id INT AUTO_INCREMENT PRIMARY KEY,
                worldId INT NOT NULL,
                mapId INT NOT NULL,
                FOREIGN KEY (worldId)
                    REFERENCES worlds (id)
                    ON DELETE CASCADE,
                FOREIGN KEY (mapId)
                    REFERENCES maps (id)
                    ON DELETE CASCADE
            )`)).then(() => {
                dbInitialized = true;
                resolve(pool);
            }).catch(err => reject(err));
    });
}

function queryAsPromise(pool, sql) {
    return new Promise((resolve, reject) => {
        pool.query(sql, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function getConnPool() {
    return new Promise((resolve, reject) => {
        let pool = initConnPool();

        if (!dbInitialized)
            initDb(pool).then(() => resolve(pool)).catch(err => reject(err));
        else
            resolve(pool);
    });
}

app.use(express.static('public'))

app.get('/', (_, res) => res.sendFile('index.html', { root: '.' }))

const startLocation = "Urotsuki's Room";

const batchSize = 20;

app.get('/worlds', function(req, res) {
    getConnPool().then(pool => {
        const callback = function (worldData) {
            res.json(worldData);
            pool.end();
        };
        if (req.query.hasOwnProperty("update") && req.query.update) {
            populateWorldData(pool).then(() => getWorldData(pool, true).then(worldData => {
                updateMapData(pool, worldData).then(() => {
                    pool.query("UPDATE updates SET lastUpdate=NOW(), lastFullUpdate=NOW()", (err) => {
                        if (err) console.error(err);
                        getWorldData(pool).then(wd => callback(wd)).catch(err => console.error(err));
                    });
                }).catch(err => console.error(err));
            }).catch(err => console.error(err))).catch(err => console.error(err));
        } else {
            checkUpdateData(pool).then(() => getWorldData(pool).then(wd => callback(wd)).catch(err => console.error(err))).catch(err => console.error(err));
        }
    }).catch(err => console.error(err));
});

function getWorldData(pool, preserveIds) {
    return new Promise((resolve, reject) => {
        const worldDataById = {};
        pool.query('SELECT id, title, titleJP, depth, filename FROM worlds', (err, rows) => {
            if (err) return reject(err);
            for (let r in rows) {
                const row = rows[r];
                worldDataById[row.id] = {
                    id: row.id,
                    title: row.title,
                    titleJP: row.titleJP,
                    depth: row.depth,
                    filename: row.filename,
                    connections: []
                };
            }
            const worldData = Object.values(worldDataById);
            if (!preserveIds) {
                for (let d in worldData) {
                    worldData[d].id = parseInt(d);
                    if (!isRemote)
                        worldData[d].filename = `./images/worlds/${worldData[d].filename}`;
                }
            }
                
            pool.query('SELECT id, sourceId, targetId, type FROM conns', (err, rows) => {
                if (err) return reject(err);
                const connsById = {};
                for (let r in rows) {
                    const row = rows[r];
                    const conn = {
                        targetId: worldDataById[row.targetId].id,
                        type: row.type,
                        typeParams: {}
                    };
                    connsById[row.id] = conn;
                    worldDataById[row.sourceId].connections.push(conn);
                }
                pool.query('SELECT connId, type, params, paramsJP FROM conn_type_params', (err, rows) => {
                    if (err) return reject(err);
                    for (let r in rows) {
                        const row = rows[r];
                        connsById[row.connId].typeParams[row.type] = {
                            params: row.params,
                            paramsJP: row.paramsJP
                        };
                    }
                    pool.query('SELECT w.id, ROUND(SUM((m.width * m.height) / mwm.worldCount)) AS size FROM world_maps wm JOIN worlds w ON w.id = wm.worldId JOIN maps m ON m.id = wm.mapId JOIN (SELECT mw.mapId, COUNT(DISTINCT mw.worldId) worldCount FROM world_maps mw GROUP BY mw.mapId) mwm ON mwm.mapId = m.id GROUP BY w.id', (err, rows) => {
                        if (err) return reject(err);
                        for (let r in rows) {
                            const row = rows[r];
                            worldDataById[row.id].size = row.size;
                        }
                        const missingMapWorlds = worldData.filter(w => !w.size);
                        if (missingMapWorlds.length) {
                            pool.query('SELECT ROUND(AVG(width)) * ROUND(AVG(height)) size FROM maps', (err, rows) => {
                                if (err) return reject(err);
                                const avgSize = rows[0].size;
                                missingMapWorlds.forEach(w => {
                                    w.size = avgSize;
                                });
                                resolve(worldData);
                            });
                        } else
                            resolve(worldData);
                    });
                });
            });
        });
    });
}

function checkUpdateData(pool) {
    return new Promise((resolve, reject) => {
        pool.query("SELECT lastFullUpdate FROM updates WHERE DATE_ADD(lastFullUpdate, INTERVAL 1 WEEK) < NOW()", (err, rows) => {
            if (err) return reject(err);
            if (rows.length) {
                pool.query("UPDATE updates SET lastUpdate=NOW(), lastFullUpdate=NOW()", (err) => {
                    populateWorldData(pool).then(worldData => {
                        if (err) console.error(err);
                        updateMapData(pool, worldData).then(() => {
                            resolve();
                        }).catch(err => reject(err));
                    }).catch(err => reject(err));
                });
            } else {
                pool.query("SELECT lastUpdate FROM updates WHERE DATE_ADD(lastUpdate, INTERVAL 1 HOUR) < NOW()", (err, rows) => {
                    if (err) return reject(err);
                    if (rows.length) {
                        pool.query("UPDATE updates SET lastUpdate=NOW()", err => {
                            if (err) return reject(err);
                            getWorldData(pool, true).then(worldData => {
                                getUpdatedWorldNames(worldData.map(w => w.title), rows[0].lastUpdate)
                                    .then(updatedWorldNames => populateWorldData(pool, worldData, updatedWorldNames)
                                        .then(worldData => {
                                            checkUpdateMapData(pool, worldData, rows[0].lastUpdate).then(() => resolve()).catch(err => reject(err));
                                        }).catch(err => reject(err)))
                                    .catch(err => reject(err));
                            }).catch(err => reject(err));
                        });
                    } else
                        resolve();
                });
            }
        });
    });
}

function getUpdatedWorldNames(worldNames, lastUpdate) {
    return new Promise((resolve, reject) => {
        let recentChanges = [];
        populateRecentChanges(recentChanges, lastUpdate).then(() => resolve(_.uniq(recentChanges.map(c => c.title).filter(w => worldNames.indexOf(w) > -1)))).catch(err => reject(err));
    });
}

function populateRecentChanges(recentChanges, lastUpdate) {
    return new Promise((resolve, reject) => {
        superagent.get('https://yume2kki.fandom.com/api.php')
            .query({ action: 'query', list: 'recentchanges', rcdir: 'newer', rcstart: lastUpdate.toISOString(), rclimit: 500, format: 'json' })
            .end((err, res) => {
                if (err) return reject(err);
                const data = JSON.parse(res.text);
                const changes = data.query.recentchanges;
                for (let c in changes)
                    recentChanges.push(changes[c]);
                if (!changes.length || changes.length < 500)
                    resolve();
                else {
                    const lastDate = new Date(changes[changes.length - 1].timestamp);
                    lastDate.setTime(lastDate.getTime() + 1000);
                    populateRecentChanges(recentChanges, lastDate).then(() => resolve()).catch(err => reject(err));
                }
            });
    });
}

function checkUpdateMapData(pool, worldData, lastUpdate) {
    return new Promise((resolve, reject) => {
        superagent.get('https://yume2kki.fandom.com/api.php')
            .query({ action: 'query', titles: 'Map IDs', prop: 'revisions', format: 'json' })
            .end((err, res) => {
                if (err) return reject(err);
                const data = JSON.parse(res.text);
                const pages = data.query.pages;
                const pageIds = Object.keys(pages);
                if (pageIds.length) {
                    const revisions = pages[pageIds[0]].revisions;
                    if (revisions.length) {
                        const revDate = new Date(revisions[0].timestamp);
                        if (lastUpdate < revDate) {
                            updateMapData(pool, worldData).then(() => resolve()).catch(err => reject(err));
                            return;
                        }
                    }
                }
                resolve();
            });
    });
}

function populateWorldData(pool, worldData, updatedWorldNames) {
    if (!worldData)
        worldData = [];
    const newWorldNames = [];
    return new Promise((resolve, reject) => {
        superagent.get('https://yume2kki.fandom.com/api.php')
            .query({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Locations', cmlimit: 500, format: 'json' })
            .end((err, res) => {
            if (err) return reject(err)
            const data = JSON.parse(res.text);
            const worlds = data.query.categorymembers;
            const batches = [];
            for (let b = 0; b * batchSize < worlds.length; b++)
                batches.push(populateWorldDataSub(pool, worldData, worlds, b, updatedWorldNames, newWorldNames));
            Promise.all(batches).then(() => {
                const worldDataByName = _.keyBy(worldData, w => w.title);
                const callback = function (updatedWorldData) {
                    updateConns(pool, worldDataByName).then(() => {
                        updateConnTypeParams(pool, worldData).then(() => {
                            updateWorldDepths(pool, worldData).then(() => {
                                deleteRemovedWorlds(pool);
                                resolve(worldData);
                            }).catch(err => reject(err));
                        }).catch(err => reject(err));
                    }).catch(err => reject(err));
                };
                if (newWorldNames.length) {
                    const newWorldBatches = [];
                    const newWorldConnWorldNames = [];
                    for (let w in newWorldNames) {
                        const newWorld = worldDataByName[newWorldNames[w]];
                        const newWorldConns = newWorld.connections;
                        for (let c in newWorldConns) {
                            const newWorldConnTargetName = newWorldConns[c].location;
                            if (updatedWorldNames.indexOf(newWorldConnTargetName) === -1 && newWorldConnWorldNames.indexOf(newWorldConnTargetName) === -1)
                                newWorldConnWorldNames.push(newWorldConnTargetName);
                        }
                    }
                    for (let b = 0; b * batchSize < worlds.length; b++)
                        newWorldBatches.push(populateWorldDataSub(pool, worldData, worlds, b, newWorldConnWorldNames, []));
                    Promise.all(newWorldBatches).then(() => {
                        const allUpdatedWorldNames = updatedWorldNames.concat(newWorldConnWorldNames);
                        callback(worldData.filter(w => allUpdatedWorldNames.indexOf(w.title) > -1));
                    }).catch(err => reject(err));
                } else
                    callback(updatedWorldNames ? worldData.filter(w => updatedWorldNames.indexOf(w.title) > -1) : worldData);
            }).catch(err => reject(err));
        });
    });
}

function populateWorldDataSub(pool, worldData, worlds, batchIndex, updatedWorldNames, updatedNewWorldNames) {
    const existingWorldNames = worldData.map(w => w.title);
    return new Promise((resolve, reject) => {
        const worldsKeyed = _.keyBy(worlds.slice(batchIndex * batchSize, Math.min((batchIndex + 1) * batchSize, worlds.length)).filter(w => !updatedWorldNames || (updatedWorldNames.indexOf(w.title) > -1) || existingWorldNames.indexOf(w.title) === -1), w => w.pageid);
        if (!Object.keys(worldsKeyed).length)
            return resolve();
        getBaseWorldData(worldsKeyed).then(data => {
            const worldDataByName = _.keyBy(worldData, w => w.title);
            const newWorldsByName = _.keyBy(Object.values(data), w => w.title);
            const updatedWorlds = [];
            const worldNames = Object.keys(newWorldsByName);
            for (let d in data) {
                const world = data[d];
                let newWorld;
                if (!updatedWorldNames || (newWorld = existingWorldNames.indexOf(world.title) === -1)) {
                    worldData.push(world);
                    if (newWorld)
                        updatedNewWorldNames.push(world.title);
                } else {
                    const existingWorld = worldDataByName[world.title];
                    existingWorld.titleJP = world.titleJP;
                    existingWorld.connections = world.connections;
                    existingWorld.filename = world.filename;
                }
            }
            pool.query('SELECT id, title, titleJP, filename FROM worlds', (err, rows) => {
                if (err) return reject(err);
                for (let r in rows) {
                    const worldName = rows[r].title;
                    if (worldNames.indexOf(worldName) > -1) {
                        const world = newWorldsByName[worldName];
                        world.id = rows[r].id;
                        if (rows[r].titleJP !== world.titleJP || rows[r].filename !== world.filename)
                            updatedWorlds.push(world);
                    }
                    delete newWorldsByName[worldName];
                }
                const insertCallback = function() {
                    if (updatedWorlds.length) {
                        const updateWorlds = [];
                        for (let w in updatedWorlds)
                            updateWorlds.push(updateWorldInfo(pool, updatedWorlds[w]).catch(err => console.error(err)));
                        Promise.allSettled(updateWorlds).finally(() => resolve());
                    } else
                        resolve();
                };
                const newWorldNames = Object.keys(newWorldsByName);
                if (newWorldNames.length) {
                    let i = 0;
                    let worldsQuery = "INSERT INTO worlds (title, titleJP, depth, filename) VALUES "
                    for (const w in newWorldsByName) {
                        const newWorld = newWorldsByName[w];
                        if (i++)
                            worldsQuery += ", ";
                        const title = newWorld.title.replace(/'/g, "''");
                        const titleJPValue = newWorld.titleJP ? `'${newWorld.titleJP}'` : "NULL";
                        worldsQuery += `('${title}', ${titleJPValue}, 0, '${newWorld.filename.replace(/'/g, "''")}')`;
                    }
                    pool.query(worldsQuery, (error, res) => {
                        if (error) return reject(err);
                        const insertedRows = res.affectedRows;
                        const worldRowIdsQuery = `SELECT r.id FROM (SELECT id FROM worlds ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                        pool.query(worldRowIdsQuery, (err, rows) => {
                            if (err) return reject(err);
                            for (let r in rows)
                                newWorldsByName[newWorldNames[r]].id = rows[r].id;
                            insertCallback();
                        });
                    });
                } else
                    insertCallback();
            });
        }).catch(err => reject(err));
    });
}

function getBaseWorldData(worlds) {
    return new Promise((resolve, reject) => {
        const pageIds = Object.keys(worlds);
        superagent.get('https://yume2kki.fandom.com/api.php')
            .query({ action: 'query', pageids: pageIds.join("|"), prop: "categories", cllimit: 50, format: "json" })
            .end((err, res) => {
            if (err) return reject(err);
            const query = JSON.parse(res.text).query;
            if (!query)
                reject("Query results are empty");
            worlds = query.pages;
            const getWorldsBaseWorldData = [];
            for (let p in pageIds) {
                const pageId = parseInt(pageIds[p]);
                getWorldsBaseWorldData.push(getWorldBaseWorldData(worlds, pageId).catch(err => { }));
            }
            Promise.allSettled(getWorldsBaseWorldData).finally(() => resolve(worlds));
        });
    });
}

function getWorldBaseWorldData(worlds, pageId) {
    return new Promise((resolve, reject) => {
        let world = worlds[parseInt(pageId)];
        const categories = world.categories;
        let skip = false;
        if (world.title.indexOf("Board Thread") > -1 || world.title === "Dream Worlds")
            skip = true;
        else if (categories) {
            for (let c in categories) {
                if (categories[c].title === "Category:Removed Content") {
                    skip = true;
                    break;
                }
            }
        } else
            skip = true;
        if (skip) {
            delete worlds[pageId];
            return reject(`World ${world.title} was removed`);
        }
        delete world.pageid;
        delete world.categories;
        delete world.ns;
        getWorldInfo(world.title).then(worldInfo => {
            world = _.extend(world, worldInfo);
            worlds[pageId] = world;
            resolve();
        }).catch(err => reject(err));
    });
}

function updateWorldInfo(pool, world) {
    return new Promise((resolve, reject) => {
        pool.query(`UPDATE worlds SET titleJP='${world.titleJP}', filename='${world.filename.replace(/'/g, "''")}' WHERE id=${world.id}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function updateConns(pool, worldDataByName) {
    return new Promise((resolve, reject) => {
        const newConnsByKey = {};
        const existingConns = [];
        const removedConnIds = [];
        const worldNames = Object.keys(worldDataByName);
        for (let w in worldDataByName) {
            const world = worldDataByName[w];
            for (let c in world.connections) {
                const conn = world.connections[c];
                if (conn.targetId || worldNames.indexOf(conn.location) > -1) {
                    conn.sourceId = world.id;
                    if (!conn.targetId)
                        conn.targetId = worldDataByName[conn.location].id;
                    const key = `${conn.sourceId}_${conn.targetId}`;
                    newConnsByKey[key] = conn;
                }
            }
        }
        pool.query('SELECT id, sourceId, targetId FROM conns', (err, rows) => {
            if (err) return reject(err);
            for (let r in rows) {
                const key = `${rows[r].sourceId}_${rows[r].targetId}`;
                if (Object.keys(newConnsByKey).indexOf(key) > -1) {
                    const conn = newConnsByKey[key];
                    conn.id = rows[r].id;
                    existingConns.push(conn);
                } else
                    removedConnIds.push(rows[r].id);
                delete newConnsByKey[key];
            }
            const existingConnsByType = _.groupBy(existingConns, 'type');
            const existingConnTypes = Object.keys(existingConnsByType);
            const connsCallback = function () {
                if (existingConnTypes.length) {
                    let updateConns = [];
                    for (let t in existingConnTypes) {
                        const type = existingConnTypes[t];
                        updateConns.push(updateConnsOfType(pool, type, existingConnsByType[type]).catch(err => console.error(err)));
                    }
                    Promise.allSettled(updateConns).finally(() => resolve());
                } else
                    resolve();
            };
            if (removedConnIds.length)
                deleteRemovedConns(pool, removedConnIds);
            const newConnKeys = Object.keys(newConnsByKey);
            
            if (newConnKeys.length) {
                let i = 0;
                let connsQuery = "INSERT INTO conns (sourceId, targetId, type) VALUES "
                for (let c in newConnsByKey) {
                    const conn = newConnsByKey[c];
                    if (i++)
                        connsQuery += ", ";
                    connsQuery += `(${conn.sourceId}, ${conn.targetId}, ${conn.type})`;
                }
                pool.query(connsQuery, (err, res) => {
                    if (err) return reject(err);
                    const insertedRows = res.affectedRows;
                    const connRowIdsQuery = `SELECT r.id FROM (SELECT id FROM conns ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                    pool.query(connRowIdsQuery, (err, rows) => {
                        if (err) return reject(err);
                        for (let r in rows) {
                            newConnsByKey[newConnKeys[r]].id = rows[r].id;
                        }
                        connsCallback();
                    });
                });
            } else
                connsCallback();
        });
    });
}

function updateConnsOfType(pool, type, conns) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let updateConnsQuery = `UPDATE conns SET type=${type} WHERE id IN (`
        for (let c in conns) {
            if (i++)
                updateConnsQuery += ", ";
            updateConnsQuery += conns[c].id;
        }
        updateConnsQuery += ")";
        pool.query(updateConnsQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedConns(pool, removedConnIds) {
    let i = 0;
    let deleteConnsQuery = "DELETE FROM conns WHERE id IN (";
    for (let c in removedConnIds) {
        if (i++)
            deleteConnsQuery += ", ";
        deleteConnsQuery += removedConnIds[c];
    }
    deleteConnsQuery += ")";
    pool.query(deleteConnsQuery, (err, _) => {
        if (err) return console.error(err);
    });
}

function updateConnTypeParams(pool, worldData) {
    const newConnTypeParams = {};
    worldData.map(w => w.connections).flat().forEach(c => {
        newConnTypeParams[c.id] = c.typeParams;
    });
    const updatedConnTypeParams = [];
    const removedConnTypeParamIds = [];
    return new Promise((resolve, reject) => {
        pool.query('SELECT id, connId, type, params, paramsJP FROM conn_type_params', (err, rows) => {
            if (err) return reject(err);
            for (let r in rows) {
                const row = rows[r];
                if (newConnTypeParams[row.connId][row.type]) {
                    const newConnTypeParam = newConnTypeParams[row.connId][row.type];
                    if (newConnTypeParam.params !== row.params || (newConnTypeParam.paramsJP && newConnTypeParam.paramsJP !== row.paramsJP)) {
                        const updatedConnTypeParam = _.cloneDeep(newConnTypeParam);
                        updatedConnTypeParam.connId = row.connId;
                        updatedConnTypeParam.type = row.type;
                        updatedConnTypeParams.push(updatedConnTypeParam);
                    }
                } else {
                    removedConnTypeParamIds.push(row.id);
                }
                delete newConnTypeParams[row.connId][row.type];
            }
            const connTypeParamsCallback = function () {
                if (updatedConnTypeParams.length) {
                    const updateExistingConnTypeParams = [];
                    for (let p in updatedConnTypeParams)
                        updateExistingConnTypeParams.push(updateConnTypeParam(pool, updatedConnTypeParams[p]));
                    Promise.all(updateExistingConnTypeParams).then(() => resolve()).catch(err => reject(err));
                } else
                    resolve();
            };
            let i = 0;
            let connTypeParamsQuery = "INSERT INTO conn_type_params (connId, type, params, paramsJP) VALUES ";
            for (let c in newConnTypeParams) {
                const connConnTypeParams = newConnTypeParams[c];
                for (let t in connConnTypeParams) {
                    const connTypeParam = connConnTypeParams[t];
                    const params = `'${connTypeParam.params.replace(/'/g, "''")}'`;
                    const paramsJP = connTypeParam.paramsJP ? `'${connTypeParam.paramsJP.replace(/'/g, "''")}'` : "NULL";
                    if (i++)
                        connTypeParamsQuery += ", ";
                    connTypeParamsQuery += `(${c}, ${t}, ${params}, ${paramsJP})`;
                }
            }
            if (i > 0) {
                pool.query(connTypeParamsQuery, (err, _) => {
                    if (err) return reject(err);
                    connTypeParamsCallback();
                });
            } else
                connTypeParamsCallback();
            if (removedConnTypeParamIds.length)
                deleteRemovedConnTypeParams(pool, removedConnTypeParamIds);
        });
    });
}

function updateConnTypeParam(pool, connTypeParam) {
    return new Promise((resolve, reject) => {
        const params = `'${connTypeParam.params.replace(/'/g, "''")}'`;
        const paramsJP = connTypeParam.paramsJP ? `'${connTypeParam.paramsJP.replace(/'/g, "''")}'` : "NULL";
        pool.query(`UPDATE conn_type_params SET params=${params}, paramsJP=${paramsJP} WHERE connId=${connTypeParam.connId} AND type=${connTypeParam.type}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedConnTypeParams(pool, removedConnTypeParamIds) {
    let i = 0;
    let deleteConnTypeParamsQuery = "DELETE FROM conn_type_params WHERE id IN (";
    for (let c in removedConnTypeParamIds) {
        if (i++)
            deleteConnTypeParamsQuery += ", ";
        deleteConnTypeParamsQuery += removedConnTypeParamIds[c];
    }
    deleteConnTypeParamsQuery += ")";
    pool.query(deleteConnTypeParamsQuery, (err, _) => {
        if (err) return console.error(err);
    });
}

function updateWorldDepths(pool, worldData) {
    return new Promise((resolve, reject) => {
        const depthMap = {};

        for (let w in worldData)
            depthMap[worldData[w].title] = -1;

        const worldDataById = _.keyBy(worldData, w => w.id);
        const worldDataByName = _.keyBy(worldData, w => w.title);

        calcDepth(worldData, worldDataById, depthMap, null, 0, defaultPathIgnoreConnTypeFlags);

        const worldNames = Object.keys(worldDataByName);

        worldData.filter(w => depthMap[w.title] === -1).forEach(w => {
            w.connections.filter(c => worldNames.indexOf(c.location) > -1).forEach(c => {
                let sourceWorld = worldDataByName[c.location];
                let ignoreTypeFlags = defaultPathIgnoreConnTypeFlags;
                if (sourceWorld.depth !== undefined) {
                    do {
                        if (ignoreTypeFlags & ConnType.LOCKED || ignoreTypeFlags & ConnType.LOCKED_CONDITION)
                            ignoreTypeFlags ^= ConnType.LOCKED | ConnType.LOCKED_CONDITION;
                        else if (ignoreTypeFlags & ConnType.DEAD_END)
                            ignoreTypeFlags ^= ConnType.DEAD_END | ConnType.ISOLATED;
                        else
                            break;
                        calcDepth(worldData, worldDataById, depthMap, sourceWorld, sourceWorld.depth, ignoreTypeFlags, w.title);
                    } while (depthMap[w.title] === -1);
                }
            });
        });

        for (let w in worldData) {
            if (worldData[w].depth === undefined)
                worldData[w].depth = 1;
        }

        const worldsByDepth = _.groupBy(worldData, 'depth');

        if (Object.keys(worldsByDepth).length) {
            const updateWorldsOfDepths = [];
            const worldDepths = Object.keys(worldsByDepth);
            for (let d in worldDepths) {
                const depth = worldDepths[d];
                updateWorldsOfDepths.push(updateWorldsOfDepth(pool, depth, worldsByDepth[depth]));
            }
            Promise.all(updateWorldsOfDepths).then(() => resolve()).catch(err => reject(err));
        } else
            resolve();
    });
}

function calcDepth(worldData, worldDataById, depthMap, world, depth, ignoreTypeFlags, targetWorldName) {
    const worldDataByName = _.keyBy(worldData, w => w.title);
    const worldNames = Object.keys(worldDataByName);
    let currentWorld;
    if (depth > 0)
        currentWorld = world;
    else {
        currentWorld = worldDataByName[startLocation];
        currentWorld.depth = depthMap[currentWorld.title] = depth;
    }
    for (let c in currentWorld.connections) {
        const conn = currentWorld.connections[c];
        const w = conn.targetId ? worldDataById[conn.targetId].title : conn.location;
        if (worldNames.indexOf(w) > -1 && (!targetWorldName || w === targetWorldName)) {
            if (conn.type & ignoreTypeFlags)
                continue;
            const d = depthMap[w];
            if (d === -1 || d > depth + 1) {
                worldDataByName[w].depth = depthMap[w] = depth + 1;
                if (!targetWorldName)
                    calcDepth(worldData, worldDataById, depthMap, worldDataByName[w], depth + 1, defaultPathIgnoreConnTypeFlags);
            }
        }/* else if (!targetWorldName) {
            const dc = currentWorld.title + " -> " + w;
            console.log("DEAD CONNECTION: ", dc);
        }*/
    }
    return depth;
}

function updateWorldsOfDepth(pool, depth, worlds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let updateDepthsQuery = `UPDATE worlds SET depth=${depth} WHERE id IN (`
        for (let w in worlds) {
            if (i++)
                updateDepthsQuery += ", ";
            updateDepthsQuery += worlds[w].id;
        }
        updateDepthsQuery += ")";
        pool.query(updateDepthsQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedWorlds(pool) {
    pool.query('DELETE w FROM worlds w WHERE NOT EXISTS(SELECT c.id FROM conns c WHERE w.id IN (c.sourceId, c.targetId))', (err, _) => {
        if (err) return console.log(err);
    });
}

function updateMapData(pool, worldData) {
    return new Promise((resolve, reject) => {
        getMapData(pool, worldData).then(mapData => {
            updateMaps(pool, mapData).then(() => {
                const mapsByMapId = _.keyBy(mapData, m => m.mapId);
                const newWorldMapsByKey = {};
                const existingWorldMaps = [];
                const removedWorldMapIds = [];
                for (let w in worldData) {
                    const world = worldData[w];
                    for (let m in world.mapIds) {
                        const mapId = world.mapIds[m];
                        const map = mapsByMapId[mapId];
                        const key = `${world.id}_${map.id}`;
                        newWorldMapsByKey[key] = {
                            worldId: world.id,
                            mapId: map.id
                        };
                    }
                }
                pool.query('SELECT id, worldId, mapId FROM world_maps', (err, rows) => {
                    if (err) return reject(err);
                    for (let r in rows) {
                        const key = `${rows[r].worldId}_${rows[r].mapId}`;
                        if (Object.keys(newWorldMapsByKey).indexOf(key) > -1) {
                            const worldMap = newWorldMapsByKey[key];
                            worldMap.id = rows[r].id;
                            existingWorldMaps.push(worldMap);
                        } else
                            removedWorldMapIds.push(rows[r].id);
                        delete newWorldMapsByKey[key];
                    }

                    if (removedWorldMapIds.length)
                        deleteRemovedWorldMaps(pool, removedWorldMapIds);
                    const newWorldMapKeys = Object.keys(newWorldMapsByKey);
                    
                    if (newWorldMapKeys.length) {
                        let i = 0;
                        let worldMapsQuery = "INSERT INTO world_maps (worldId, mapId) VALUES "
                        for (let m in newWorldMapsByKey) {
                            const worldMap = newWorldMapsByKey[m];
                            if (i++)
                                worldMapsQuery += ", ";
                            worldMapsQuery += `(${worldMap.worldId}, ${worldMap.mapId})`;
                        }
                        pool.query(worldMapsQuery, (err, res) => {
                            if (err) return reject(err);
                            const insertedRows = res.affectedRows;
                            const worldMapRowIdsQuery = `SELECT r.id FROM (SELECT id FROM world_maps ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                            pool.query(worldMapRowIdsQuery, (err, rows) => {
                                if (err) return reject(err);
                                for (let r in rows)
                                    newWorldMapsByKey[newWorldMapKeys[r]].id = rows[r].id;
                                resolve();
                            });
                        });
                    } else
                        resolve();
                });
            }).catch(err => reject(err));
        }).catch(err => reject(err));
    });
}

function getMapData(pool, worldData) {
    return new Promise((resolve, reject) => {
        superagent.get('https://yume2kki.fandom.com/wiki/Map_IDs', function (err, res) {
            if (err) return reject(err);
            worldData.forEach(w => w.mapIds = []);
            const worldDataByName = _.keyBy(worldData, w => w.title);
            const mapIdTablesHtml = res.text.slice(res.text.indexOf('<table '), res.text.lastIndexOf('</table>'));
            const rawMapData = mapIdTablesHtml.split('<td>#').slice(1).map(t => {
                const ret = t.split('</td><td>').slice(0, 6);
                ret[5] = ret[5].slice(0, ret[5].indexOf('</td>'));
                return ret;
            });
            const mapData = [];
            rawMapData.forEach(m => {
                if (m[3].indexOf('Accessible') > -1) {
                    const map = {};
                    map.mapId = m[0].slice(0, 4);
                    m[2].split('<br />').map(w => {
                        const worldNameStartIndex = w.indexOf('<a href="/wiki/') + 15;
                        if (worldNameStartIndex > -1) {
                            const worldNameEndIndex = w.indexOf('"', worldNameStartIndex);
                            const worldName = w.slice(worldNameStartIndex, worldNameEndIndex).replace(/%26/g, "&").replace(/%27/g, "'").replace(/\_/g, " ").replace(/#.*/, "");
                            if (worldDataByName[worldName])
                                worldDataByName[worldName].mapIds.push(map.mapId);
                        }
                    });
                    map.width = parseInt(m[4]);
                    map.height = parseInt(m[5]);
                    mapData.push(map);
                }
            });
            resolve(mapData);
        });
    });
}

function updateMaps(pool, mapData) {
    return new Promise((resolve, reject) => {
        pool.query('SELECT id, mapId, width, height FROM maps', (err, rows) => {
            if (err) return reject(err);
            const mapDataByMapId = _.keyBy(mapData, m => m.mapId);
            const newMapsByMapId = _.keyBy(mapData, m => m.mapId);
            const mapIds = Object.keys(mapDataByMapId);
            const updatedMaps = [];
            for (let r in rows) {
                const mapId = rows[r].mapId;
                if (mapIds.indexOf(mapId) > -1) {
                    const map = mapDataByMapId[mapId];
                    map.id = rows[r].id;
                    if (rows[r].width !== map.width || rows[r].height !== map.height)
                        updatedMaps.push(map);
                }
                delete newMapsByMapId[mapId];
            }
            const insertCallback = function() {
                if (updatedMaps.length) {
                    const updateMaps = [];
                    for (let m in updatedMaps)
                        updateMaps.push(updateMap(pool, updatedMaps[m]).catch(err => console.error(err)));
                    Promise.allSettled(updateMaps).finally(() => resolve());
                } else
                    resolve();
            };
            const newMapIds = Object.keys(newMapsByMapId);
            if (newMapIds.length) {
                let i = 0;
                let mapsQuery = "INSERT INTO maps (mapId, width, height) VALUES "
                for (let m in newMapsByMapId) {
                    const newMap = newMapsByMapId[m];
                    if (i++)
                        mapsQuery += ", ";
                    mapsQuery += `('${newMap.mapId}', ${newMap.width}, ${newMap.height})`;
                }
                pool.query(mapsQuery, (err, res) => {
                    if (err) return reject(err);
                    const insertedRows = res.affectedRows;
                    const mapRowIdsQuery = `SELECT r.id FROM (SELECT id FROM maps ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                    pool.query(mapRowIdsQuery, (err, rows) => {
                        if (err) return reject(err);
                        for (let r in rows)
                            newMapsByMapId[newMapIds[r]].id = rows[r].id;
                        insertCallback();
                    });
                });
            } else
                insertCallback();
        });
    });
}

function updateMap(pool, map) {
    return new Promise((resolve, reject) => {
        pool.query(`UPDATE maps SET width=${map.width}, height=${map.height} WHERE id=${map.id}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedWorldMaps(pool, removedWorldMapIds) {
    let i = 0;
    let deleteWorldMapsQuery = "DELETE FROM world_maps WHERE id IN (";
    for (let m in removedWorldMapIds) {
        if (i++)
            deleteWorldMapsQuery += ", ";
        deleteWorldMapsQuery += removedWorldMapIds[m];
    }
    deleteWorldMapsQuery += ")";
    pool.query(deleteWorldMapsQuery, (err, _) => {
        if (err) return console.log(err);
    });
}

function getWorldInfo(worldName) {
    return new Promise((resolve, reject) => {
        superagent.get('https://yume2kki.fandom.com/wiki/' + worldName, function (err, res) {
            if (err) return reject(err);
            worldName = worldName.replace(/\_/g, " ");
            let imageUrl = res.text.split(';"> <a href="https://vignette.wikia.nocookie.net')[1];
            imageUrl = "https://vignette.wikia.nocookie.net" + imageUrl.slice(0, imageUrl.indexOf('"'));
            const ext = imageUrl.slice(imageUrl.lastIndexOf("."), imageUrl.indexOf("/", imageUrl.lastIndexOf(".")));
            let filename;
            if (isRemote)
                filename = imageUrl.slice(0, imageUrl.indexOf("/", imageUrl.lastIndexOf(".")));
            else {
                filename = worldName + ext;
                try {
                    if (!fs.existsSync("./public/images/worlds/" + filename))
                        downloadImage(imageUrl, filename);
                } catch (err) {
                    console.error(err)
                }
                
            }
            resolve({
                titleJP: getTitleJP(res.text),
                connections: getConnections(res.text),
                filename: filename
            });
        });
    });
}

function downloadImage(imageUrl, filename) {
    options = {
        url: imageUrl,
        dest: 'public/images/worlds/' + filename
    };
    
    download.image(options)
        .then(({ filename, image }) => {
            console.log('Saved to', filename);
        })
        .catch((err) => console.error(err));
}

function getTitleJP(html) {
    const jpNameIndex = html.indexOf("data-jp-name=\"");
    if (jpNameIndex === -1)
        return null;
    return html.slice(jpNameIndex + 14, html.indexOf("\"", jpNameIndex + 14));
}

function getConnections(html) {
    const ret = [];
    html = html.slice(html.indexOf("<b>Connecting Areas</b>"), html.indexOf("<b>BGM</b>"));
    const areas = html.split(/(?:<p>|<br \/>)<a href="/);
    if (areas.length > 1) {
        for (let a = 1; a < areas.length; a++) {
            let connType = 0;
            const areaText = areas[a];
            const urlIndex = areaText.indexOf("/wiki/") + 6;
            let params = {};
            if (areaText.indexOf(">NoReturn<") > -1)
                connType |= ConnType.ONE_WAY;
            else if (areaText.indexOf(">NoEntry<") > -1)
                connType |= ConnType.NO_ENTRY;
            if (areaText.indexOf(">Unlock<") > -1)
                connType |= ConnType.UNLOCK;
            else if (areaText.indexOf(">Locked<") > -1)
                connType |= ConnType.LOCKED;
            else if (areaText.indexOf(">LockedCondition<") > -1) {
                connType |= ConnType.LOCKED_CONDITION;
                if (areaText.indexOf("data-lock-params=\"") > -1) {
                    const paramsIndex = areaText.indexOf("data-lock-params=\"") + 18;
                    let paramsText = areaText.slice(paramsIndex, areaText.indexOf("\"", paramsIndex));
                    if (paramsText === "&#123;&#123;&#123;3}}}")
                        paramsText = "";
                    else {
                        paramsText = paramsText.replace(/^Requires (to )?/, "").replace(/.$/, "");
                        paramsText = paramsText.substring(0, 1).toUpperCase() + paramsText.slice(1);
                    }
                    if (paramsText) {
                        params[ConnType.LOCKED_CONDITION] = { params: paramsText };
                        if (areaText.indexOf("data-lock-params-jp=\"") > -1) {
                            const paramsJPIndex = areaText.indexOf("data-lock-params-jp=\"") + 21;
                            params[ConnType.LOCKED_CONDITION].paramsJP = areaText.slice(paramsJPIndex, areaText.indexOf("\"", paramsJPIndex));
                        }
                    }
                }
            }
            if (areaText.indexOf(">DeadEnd<") > -1)
                connType |= ConnType.DEAD_END;
            else if (areaText.indexOf(">Return<") > -1)
                connType |= ConnType.ISOLATED;
            if (areaText.indexOf("effect") > -1) {
                connType |= ConnType.EFFECT;
                if (areaText.indexOf("data-effect-params=\"") > -1) {
                    const paramsIndex = areaText.indexOf("data-effect-params=\"") + 20;
                    params[ConnType.EFFECT] = { params: areaText.slice(paramsIndex, areaText.indexOf("\"", paramsIndex)).replace(/<br ?\/>|(?:,|;)(?: ?(?:and|or) )?| (?:and|or) /g, ",") };
                }
            }
            if (areaText.indexOf(">Chance<") > -1) {
                connType |= ConnType.CHANCE;
                if (areaText.indexOf("data-chance-params=\"") > -1) {
                    const paramsIndex = areaText.indexOf("data-chance-params=\"") + 20;
                    let paramsText = areaText.slice(paramsIndex, areaText.indexOf("\"", paramsIndex));
                    if (paramsText.indexOf("%") > -1)
                        paramsText = paramsText.slice(0, paramsText.indexOf("%"));
                    if (!isNaN(paramsText) && parseFloat(paramsText) > 0)
                        params[ConnType.CHANCE] = { params: paramsText + "%" };
                }
            }
            ret.push({
                location: areaText.slice(urlIndex, areaText.indexOf('"', urlIndex)).replace(/%26/g, "&").replace(/%27/g, "'").replace(/\_/g, " ").replace(/#.*/, ""),
                type: connType,
                typeParams: params
            });
        }
    }
    return ret;
}

app.listen(port, () => console.log(`2kki app listening on port ${port}!`))