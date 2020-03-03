const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
const { exec } = require("child_process");
const _ = require('lodash');
const superagent = require('superagent');
const fs = require('fs');
const xmlJs = require('xml-js');
const download = require('image-downloader');
const mysql = require("mysql");
const ConnType = require("./public/js/conn-type.js").ConnType;
const defaultPathIgnoreConnTypeFlags = ConnType.NO_ENTRY | ConnType.LOCKED | ConnType.DEAD_END | ConnType.ISOLATED | ConnType.LOCKED_CONDITION;

let dbInitialized = false;

function initConnPool() {
    let ret;
    if (process.env.DATABASE_URL) {
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
            `CREATE TABLE IF NOT EXISTS worlds (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                titleJP VARCHAR(255) NULL,
                depth INT NOT NULL,
                filename VARCHAR(255) NOT NULL
            )`).then(() => queryAsPromise(pool,
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
            `CREATE TABLE IF NOT EXISTS maps (
                id INT AUTO_INCREMENT PRIMARY KEY,
                worldId INT NOT NULL,
                mapId CHAR(4) NOT NULL,
                width INT NOT NULL,
                height INT NOT NULL,
                special BIT NOT NULL,
                FOREIGN KEY (worldId)
                    REFERENCES worlds (id)
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
            populateWorldData(pool).then(worldData => {
                if (worldData.length)
                    updateMaps(pool, worldData).then(() => {
                        console.log(worldData);
                        getWorldData(pool).then(callback);
                    }).catch(err => console.error(err));
                else
                    getWorldData(pool).then(callback).catch(err => console.error(err));
            });
        } else {
            getWorldData(pool).then(callback).catch(err => console.error(err));
        }
    }).catch(err => console.error(err));
});

function getWorldData(pool) {
    return new Promise((resolve, reject) => {
        const worldDataById = {};
        pool.query('SELECT id, title, titleJP, depth, filename FROM worlds', (err, rows) => {
            if (err) return reject(err);
            for (let r in rows) {
                const row = rows[r];
                worldDataById[row.id] = {
                    title: row.title,
                    titleJP: row.titleJP,
                    depth: row.depth,
                    filename: row.filename,
                    connections: []
                };
            }
            const worldData = Object.values(worldDataById);
            for (let d in worldData)
                worldData[d].id = parseInt(d);
            pool.query('SELECT sourceId, targetId, type FROM conns', (err, rows) => {
                if (err) return reject(err);
                for (let r in rows) {
                    const row = rows[r];
                    worldDataById[row.sourceId].connections.push({
                        targetId: worldDataById[row.targetId].id,
                        type: row.type
                    });
                }
                pool.query('SELECT w.id, ROUND(SUM((m.width * m.height) / mwm.worldCount)) AS size FROM maps m JOIN worlds w ON w.id = m.worldId JOIN (SELECT mw.mapId, COUNT(DISTINCT mw.worldId) worldCount FROM maps mw GROUP BY mw.mapId) mwm ON mwm.mapId = m.mapId WHERE m.special = 0 IS NOT NULL GROUP BY w.id', (err, rows) => {
                    if (err) return reject(err);
                    for (let r in rows) {
                        const row = rows[r];
                        worldDataById[row.id].size = row.size;
                    }
                    resolve(worldData);
                });
            });
        });
    });
}

function populateWorldData(pool) {
    return new Promise((resolve, reject) => {
        const worldData = [];
        superagent.get('https://yume2kki.fandom.com/api.php')
            .query({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Locations', cmlimit: 500, format: 'json' })
            .end((err, res) => {
            if (err) return reject(err)
            const data = JSON.parse(res.text);
            const worlds = data.query.categorymembers;
            const batches = [];
            for (let b = 0; b * batchSize < worlds.length; b++)
                batches.push(populateWorldDataSub(pool, worldData, worlds, b));
            Promise.all(batches).then(() => {
                const worldDataByName = _.keyBy(worldData, (w) => w.title);
                updateConns(pool, worldDataByName).then(() => {
                    updateWorldDepths(pool, worldData).then(() => {
                        deleteRemovedWorlds(pool);
                        resolve(worldData);
                    }).catch(err => reject(err));
                }).catch(err => reject(err));
            }).catch(err => reject(err));
        });
    });
}

function populateWorldDataSub(pool, worldData, worlds, batchIndex) {
    return new Promise((resolve, reject) => {
        const worldsKeyed = _.keyBy(worlds.slice(batchIndex * batchSize, Math.min((batchIndex + 1) * batchSize, worlds.length)), w => w.pageid);
        getBaseWorldData(worldsKeyed).then(data => {
            const newWorldsByName = _.keyBy(Object.values(data), (w) => w.title);
            const updatedWorlds = [];
            const worldNames = Object.keys(newWorldsByName);
            for (let d in data)
                worldData.push(data[d]);
            pool.query('SELECT id, title, titleJP FROM worlds', (err, rows) => {
                if (err) return reject(err);
                for (let r in rows) {
                    const worldName = rows[r].title;
                    if (worldNames.indexOf(worldName) > -1) {
                        const world = newWorldsByName[worldName];
                        world.id = rows[r].id;
                        if (rows[r].titleJP !== world.titleJP)
                            updatedWorlds.push(world);
                    }
                    delete newWorldsByName[worldName];
                }
                const insertCallback = function() {
                    if (updatedWorlds.length) {
                        const updateWorlds = [];
                        for (let w in updatedWorlds)
                            updateWorlds.push(updateWorldInfo(pool, updatedWorlds[w]).catch(err => console.error(err)));
                        Promise.allSettled().finally(() => resolve());
                    } else
                        resolve();
                };
                const newWorldNames = Object.keys(newWorldsByName);
                if (newWorldNames.length) {
                    let i = 0;
                    let worldsQuery = "INSERT INTO worlds (title, titleJP, depth, filename) VALUES "
                    for (const w in newWorldsByName) {
                        const newWorld = newWorldsByName[w];
                        if (i++) {
                            worldsQuery += ", ";
                        }
                        worldsQuery += `('${newWorld.title.replace("'", "''")}', '${newWorld.titleJP}', 0, '${newWorld.filename.replace("'", "''")}')`;
                    }
                    pool.query(worldsQuery, (error, res) => {
                        if (error) return reject(err);
                        const insertedRows = res.affectedRows;
                        const worldRowIdsQuery = `SELECT r.id FROM (SELECT id FROM worlds ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                        pool.query(worldRowIdsQuery, (err, rows) => {
                            if (err) return reject(err);
                            for (let r in rows) {
                                newWorldsByName[newWorldNames[r]].id = rows[r].id;
                            }
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
                getWorldsBaseWorldData.push(getWorldBaseWorldData(worlds, pageId));
            }
            Promise.allSettled(getWorldsBaseWorldData).then(() => resolve(worlds));
        });
    });
}

function getWorldBaseWorldData(worlds, pageId) {
    return new Promise((resolve, reject) => {
        const world = worlds[parseInt(pageId)];
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
        } else {
            skip = true;
        }
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
        pool.query(`UPDATE worlds SET titleJP='${world.titleJP}' WHERE id=${world.id}`, (err, _) => {
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
                if (worldNames.indexOf(conn.location) > -1) {
                    conn.sourceId = world.id;
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
                } else {
                    removedConnIds.push(rows[r].id);
                }
                delete newConnsByKey[key];
            }
            const existingConnsByType = _.groupBy(existingConns, 'type');
            const existingConnTypes = Object.keys(existingConnsByType);
            const connsCallback = function () {
                if (existingConnTypes.length) {
                    let updateConns = [];
                    for (let t in existingConnTypes) {
                        const type = existingConnTypes[t];
                        updateConns.push(updateConnsOfType(pool, type, existingConnsByType[type]));
                    }
                    Promise.allSettled(updateConns).then(() => resolve()).catch(err => reject(err));
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
        console.log("UPDATE TYPE=", type, "FOR", conns.length, "CONNS");
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

function updateWorldDepths(pool, worldData) {
    return new Promise((resolve, reject) => {
        const depthMap = {};

        for (let w in worldData) {
            depthMap[worldData[w].title] = -1;
        }

        calcDepth(worldData, depthMap, null, 0, defaultPathIgnoreConnTypeFlags);

        let worldDataByName = _.keyBy(worldData, w => w.title);
        let worldNames = Object.keys(worldDataByName);

        worldData.filter(w => depthMap[w.title] === -1).forEach(w => {
            w.connections.filter(c => worldNames.indexOf(c.location) > -1).forEach(c => {
                let sourceWorld = worldDataByName[c.location];
                let ignoreTypeFlags = defaultPathIgnoreConnTypeFlags;
                do {
                    if (ignoreTypeFlags & ConnType.LOCKED)
                        ignoreTypeFlags ^= ConnType.LOCKED | ConnType.LOCKED_CONDITION;
                    else if (ignoreTypeFlags & ConnType.DEAD_END)
                        ignoreTypeFlags ^= ConnType.DEAD_END | ConnType.ISOLATED;
                    else if (ignoreTypeFlags & ConnType.NO_ENTRY)
                        ignoreTypeFlags ^= ConnType.NO_ENTRY;
                    else
                        break;
                    calcDepth(worldData, depthMap, sourceWorld, sourceWorld.depth, ignoreTypeFlags, w.title);
                } while (depthMap[w.title] === -1);
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

function calcDepth(worldData, depthMap, world, depth, ignoreTypeFlags, targetWorldName) {
    const worldDataByName = _.keyBy(worldData, (w) => w.title);
    const worldNames = Object.keys(worldDataByName);
    let currentWorld;
    if (depth > 0) {
        currentWorld = world;
    } else {
        currentWorld = worldDataByName[startLocation];
        currentWorld.depth = depthMap[currentWorld.title] = depth;
    }
    for (let c in currentWorld.connections) {
        const conn = currentWorld.connections[c];
        const w = conn.location;
        if (worldNames.indexOf(w) > -1 && (!targetWorldName || w === targetWorldName)) {
            if (conn.type & ignoreTypeFlags)
                continue;
            const d = depthMap[w];
            if (d === -1 || d > depth + 1) {
                worldDataByName[w].depth = depthMap[w] = depth + 1;
                if (!targetWorldName)
                    calcDepth(worldData, depthMap, worldDataByName[w], depth + 1, defaultPathIgnoreConnTypeFlags);
            }
        } else if (!targetWorldName) {
            const dc = world.title + " -> " + w;
            console.log("DEAD CONNECTION: ", dc);
        }
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

function updateMaps(pool, worldData) {
    return new Promise((resolve, reject) => {
        const updateMapsOfWorlds = [];
        for (let w in worldData) {
            const world = worldData[w];
            updateMapsOfWorlds.push(updateMapsOfWorld(pool, world));
        }
        Promise.all(updateMapsOfWorlds).then(() => resolve()).catch(err => reject(err));
    });
}

function updateMapsOfWorld(pool, world) {
    return new Promise((resolve, reject) => {
        const newMapIds = [];
        const existingMapIds = [];
        const removedIds = [];
        const mapIds = world.mapIds;
        pool.query(`SELECT id, mapId FROM maps WHERE worldId = ${world.id}`, (err, rows) => {
            if (err) return reject(err);
            for (let r in rows) {
                if (mapIds.indexOf(rows[r].mapId) > -1) {
                    existingMapIds.push(rows[r].mapId);
                } else {
                    removedIds.push(rows[r].id);
                }
            }
            mapIds.map(id => {
                if (existingMapIds.indexOf(id) === -1) {
                    newMapIds.push(id);
                }
            });
            if (newMapIds.length)
                processMaps(pool, world.id, newMapIds).then(() => resolve()).catch(err => reject(err));
            else
                resolve();
            if (removedIds.length)
                deleteRemovedMaps(pool, removedIds);
        });
    });
}

function processMaps(pool, worldId, mapIds) {
    return new Promise(resolve => {
        const processMapOfIds = [];
        for (let m in mapIds) {
            processMapOfIds.push(processMap(pool, worldId, mapIds[m]).catch(err => console.error(err)));
        }
        Promise.allSettled(processMapOfIds).finally(() => resolve());
    });
}

function processMap(pool, worldId, mapId) {
    return new Promise((resolve, reject) => {
        exec(`..\\..\\tools\\lcf2xml.exe ../in/Map${mapId}.lmu`, {
            cwd: './maps/out/'
        }, (err) => {
            if (err) return reject(err);
            const insertMapCallback = function (width, height) {
                pool.query(`INSERT INTO maps (worldId, mapId, width, height, special) VALUES (${worldId}, '${mapId}', ${width}, ${height}, 0)`, (err, _) => {
                    if (err) return reject(err);
                    resolve();
                });
            };
            fs.readFile(`./maps/out/Map${mapId}.emu`, function(err, data) {
                if (err) return reject(err);
                let json;
                try {
                    json = JSON.parse(xmlJs.xml2json(data, {compact: true, spaces: 4}));
                } catch (error) {
                    console.log(error, worldId, mapId);
                    return resolve();
                }
                const map = json.LMU.Map;
                insertMapCallback(parseInt(map.width._text), parseInt(map.height._text));
            });
        });
    });
}

function deleteRemovedMaps(pool, removedMapIds) {
    let i = 0;
    let deleteMapsQuery = "DELETE FROM maps WHERE id IN (";
    for (let m in removedMapIds) {
        if (i++)
            deleteMapsQuery += ", ";
        deleteMapsQuery += removedMapIds[m];
    }
    deleteMapsQuery += ")";
    pool.query(deleteMapsQuery, (err, _) => {
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
            try {
                if (!fs.existsSync("./public/images/worlds/" + worldName + ext)) {
                    downloadImage(imageUrl, worldName + ext);
                }
            } catch (err) {
                console.error(err)
            }
            resolve({
                titleJP: getTitleJP(res.text),
                connections: getConnections(res.text),
                mapIds: getMapIds(res.text).filter(id => !isNaN(id) && id.length === 4),
                filename: worldName + ext
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
            if (areaText.indexOf(">NoReturn<") > -1)
                connType |= ConnType.ONE_WAY;
            else if (areaText.indexOf(">NoEntry<") > -1)
                connType |= ConnType.NO_ENTRY;
            if (areaText.indexOf(">Unlock<") > -1)
                connType |= ConnType.UNLOCK;
            else if (areaText.indexOf(">Locked<") > -1)
                connType |= ConnType.LOCKED;
                else if (areaText.indexOf(">LockedCondition<") > -1)
                connType |= ConnType.LOCKED_CONDITION;
            if (areaText.indexOf(">DeadEnd<") > -1)
                connType |= ConnType.DEAD_END;
            else if (areaText.indexOf(">Return<") > -1)
                connType |= ConnType.ISOLATED;
            if (areaText.indexOf("effect") > -1)
                connType |= ConnType.EFFECT;
            if (areaText.indexOf(">Chance<") > -1)
                connType |= ConnType.CHANCE;
            ret.push({
                location: areaText.slice(urlIndex, areaText.indexOf('"', urlIndex)).replace(/%26/g, "&").replace(/%27/g, "'").replace(/\_/g, " ").replace(/#.*/, ""),
                type: connType
            });
        }
    }
    return ret;
}

function getMapIds(html) {
    html = html.slice(html.indexOf("<b>Map ID</b>"), html.indexOf("<b>Author</b>"));
    return html.slice(html.indexOf("<p>") + 3, html.indexOf("</p>")).trim().split(", ");
}

app.listen(port, () => console.log(`2kki app listening on port ${port}!`))