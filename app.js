const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
const _ = require('lodash');
const superagent = require('superagent');
const fs = require('fs');
const download = require('image-downloader');
const mysql = require('mysql');
const ConnType = require('./src/conn-type').ConnType;
const versionUtils = require('./src/version-utils');
const appConfig = process.env.ADMIN_KEY ?
    {
        ADMIN_KEY: process.env.ADMIN_KEY,
        BOT_USERNAME: process.env.BOT_USERNAME,
        BOT_PASSWORD: process.env.BOT_PASSWORD
    } : require('./config/app.config.js');
const apiUrl = 'https://yume2kki.fandom.com/api.php';
const isRemote = Boolean(process.env.DATABASE_URL);
const defaultPathIgnoreConnTypeFlags = ConnType.NO_ENTRY | ConnType.LOCKED | ConnType.DEAD_END | ConnType.ISOLATED | ConnType.LOCKED_CONDITION | ConnType.EXIT_POINT;

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
            database: database,
            typeCast: handleTypeCasting
        });
    } else {
        const dbConfig = require("./config/db.config.js");
    
        ret = mysql.createPool({
            host: dbConfig.HOST,
            user: dbConfig.USER,
            password: dbConfig.PASSWORD,
            database: dbConfig.DB,
            typeCast: handleTypeCasting
        });
    }
    return ret;
}

function handleTypeCasting(field, useDefaultTypeCasting) {
    if ((field.type === "BIT") && (field.length === 1)) {
        const bytes = field.buffer();
        return bytes[0] === 1;
    }

    return useDefaultTypeCasting();
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
                author VARCHAR(100) NULL,
                depth INT NOT NULL,
                filename VARCHAR(255) NOT NULL,
                mapUrl VARCHAR(1000) NULL,
                mapLabel VARCHAR(1000) NULL,
                verAdded VARCHAR(20) NULL,
                verRemoved VARCHAR(20) NULL,
                verUpdated VARCHAR(1000) NULL,
                verGaps VARCHAR(255) NULL,
                removed BIT NOT NULL
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
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS menu_themes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                menuThemeId INT NOT NULL,
                filename VARCHAR(255) NOT NULL
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS menu_theme_locations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                menuThemeId INT NOT NULL,
                worldId INT NULL,
                method VARCHAR(1000) NULL,
                methodJP VARCHAR(1000) NULL,
                filename VARCHAR(255) NULL,
                removed BIT NOT NULL,
                FOREIGN KEY (menuThemeId)
                    REFERENCES menu_themes (id)
                    ON DELETE CASCADE,
                FOREIGN KEY (worldId)
                    REFERENCES worlds (id)
                    ON DELETE CASCADE
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS author_info (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                nameJP VARCHAR(100) NULL
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS version_info (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(20) NOT NULL,
                authors VARCHAR(255) NULL,
                releaseDate DATETIME NULL
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

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_, res) => res.sendFile('index.html', { root: '.' }));

app.get('/help', (_, res) => res.sendFile('README.md', { root: '.' }));

const startLocation = "Urotsuki's Room";

const batchSize = 20;

app.get('/data', function(req, res) {
    getConnPool().then(pool => {
        const callback = function () {
            getWorldData(pool, false, !req.query.hasOwnProperty('includeRemovedContent') || !req.query.includeRemovedContent).then(worldData => {
                getAuthorInfoData(pool).then(authorInfoData => {
                    getVersionInfoData(pool, worldData).then(versionInfoData => {
                        getMenuThemeData(pool, worldData, !req.query.hasOwnProperty('includeRemovedContent') || !req.query.includeRemovedContent).then(menuThemeData => {
                            pool.query('SELECT lastUpdate, lastFullUpdate FROM updates', (err, rows) => {
                                if (err) console.error(err);
                                const row = rows.length ? rows[0] : null;
                                const lastUpdate = row ? row.lastUpdate : null;
                                const lastFullUpdate = row ? row.lastFullUpdate : null;
                                const isAdmin = req.query.hasOwnProperty('adminKey') && req.query.adminKey === appConfig.ADMIN_KEY;

                                if (Math.random() * 255 < 1)
                                    updateWorldDataForChance(worldData);
                
                                res.json({
                                    worldData: worldData,
                                    authorInfoData: authorInfoData,
                                    versionInfoData: versionInfoData,
                                    menuThemeData: menuThemeData,
                                    lastUpdate: lastUpdate,
                                    lastFullUpdate: lastFullUpdate,
                                    isAdmin: isAdmin
                                });
                                pool.end();
                            });
                        }).catch(err => console.error(err));
                    }).catch(err => console.error(err));
                }).catch(err => console.error(err));
            }).catch(err => console.error(err));
        };
        if (req.query.hasOwnProperty('update') && req.query.update) {
            if (req.query.update === 'reset') {
                populateWorldData(pool).then(() => getWorldData(pool, true).then(worldData => {
                    updateMapData(pool, worldData).then(() => {
                        updateAuthorInfoData(pool).then(() => {
                            updateVersionInfoData(pool).then(() => {
                                updateMenuThemeData(pool, worldData).then(() => {
                                    pool.query('UPDATE updates SET lastUpdate=NOW(), lastFullUpdate=NOW()', (err) => {
                                        if (err) console.error(err);
                                        callback();
                                    });
                                }).catch(err => console.error(err));
                            }).catch(err => console.error(err));
                        }).catch(err => console.error(err));
                    }).catch(err => console.error(err));
                }).catch(err => console.error(err))).catch(err => console.error(err));
            } else {
                pool.query('SELECT lastUpdate FROM updates', (err, rows) => {
                    if (err) console.error(err);
                    if (rows.length) {
                        getWorldData(pool, true).then(worldData => {
                            getUpdatedWorldNames(worldData.map(w => w.title), rows[0].lastUpdate)
                                .then(updatedWorldNames => populateWorldData(pool, worldData, updatedWorldNames)
                                    .then(worldData => {
                                        checkUpdateMapData(pool, worldData, rows[0].lastUpdate).then(() => {
                                            checkUpdateAuthorInfoData(pool, rows[0].lastUpdate).then(() => {
                                                checkUpdateVersionInfoData(pool, rows[0].lastUpdate).then(() => {
                                                    checkUpdateMenuThemeData(pool, worldData, rows[0].lastUpdate).then(() => {
                                                        pool.query('UPDATE updates SET lastUpdate=NOW()', err => {
                                                            if (err) console.error(err);
                                                            callback();
                                                        });
                                                    }).catch(err => console.error(err));
                                                }).catch(err => console.error(err));
                                            }).catch(err => console.error(err));
                                        }).catch(err => console.error(err));
                                    }).catch(err => console.error(err)))
                                .catch(err => console.error(err));
                        }).catch(err => console.error(err));
                    } else
                        callback();
                });
            }
        } else
            checkUpdateData(pool).then(() => callback()).catch(err => console.error(err));
    }).catch(err => console.error(err));
});

function getWorldData(pool, preserveIds, excludeRemovedContent) {
    return new Promise((resolve, reject) => {
        const worldDataById = {};
        pool.query('SELECT id, title, titleJP, author, depth, filename, mapUrl, mapLabel, verAdded, verRemoved, verUpdated, verGaps, removed FROM worlds' + (excludeRemovedContent ? ' where removed = 0' : ''), (err, rows) => {
            if (err) return reject(err);
            for (let row of rows) {
                worldDataById[row.id] = {
                    id: row.id,
                    title: row.title,
                    titleJP: row.titleJP,
                    author: row.author,
                    depth: row.depth,
                    filename: row.filename,
                    mapUrl: row.mapUrl,
                    mapLabel: row.mapLabel,
                    verAdded: row.verAdded,
                    verRemoved: row.verRemoved,
                    verUpdated: row.verUpdated,
                    verGaps: row.verGaps,
                    removed: !!row.removed,
                    connections: []
                };
            }

            const worldData = Object.values(worldDataById);
            if (!preserveIds) {
                for (let d in worldData) {
                    const world = worldData[d];
                    world.id = parseInt(d);
                    if (!world.author)
                        world.author = '';
                    if (world.verUpdated)
                        world.verUpdated = versionUtils.parseVersionsUpdated(world.verUpdated);
                    if (world.verGaps)
                        world.verGaps = versionUtils.parseVersionGaps(world.verGaps);
                    if (!isRemote)
                        world.filename = `./images/worlds/${world.filename}`;
                }
            }
            
            pool.query('SELECT id, sourceId, targetId, type FROM conns', (err, rows) => {
                if (err) return reject(err);
                const connsById = {};
                const connSourceIds = {};
                const connTargetIds = {};
                for (let row of rows) {
                    if (excludeRemovedContent && row.type & ConnType.INACCESSIBLE)
                        continue;
                    const sourceWorld = worldDataById[row.sourceId];
                    const targetWorld = worldDataById[row.targetId];
                    if (sourceWorld == null || targetWorld == null)
                        continue;
                    const conn = {
                        targetId: targetWorld.id,
                        type: row.type,
                        typeParams: {}
                    };
                    connsById[row.id] = conn;
                    connSourceIds[row.id] = row.sourceId;
                    connTargetIds[row.id] = row.targetId;
                    sourceWorld.connections.push(conn);
                }

                pool.query('SELECT connId, type, params, paramsJP FROM conn_type_params', (err, rows) => {
                    if (err) return reject(err);
                    for (let row of rows) {
                        const conn = connsById[row.connId];
                        if (!conn)
                            continue;
                        conn.typeParams[row.type] = {
                            params: row.params,
                            paramsJP: row.paramsJP
                        };
                    }
                    pool.query('SELECT w.id, ROUND(SUM((m.width * m.height) / mwm.worldCount)) AS size FROM world_maps wm JOIN worlds w ON w.id = wm.worldId' + (excludeRemovedContent ? ' AND w.removed = 0' : '')
                        + ' JOIN maps m ON m.id = wm.mapId JOIN (SELECT mw.mapId, COUNT(DISTINCT mw.worldId) worldCount FROM world_maps mw JOIN worlds mww ON mww.id = mw.worldId' + (excludeRemovedContent ? ' WHERE mww.removed = 0' : '')
                        + ' GROUP BY mw.mapId) mwm ON mwm.mapId = m.id GROUP BY w.id', (err, rows) => {
                        if (err) return reject(err);
                        for (let row of rows)
                            worldDataById[row.id].size = row.size;
                        const missingMapWorlds = worldData.filter(w => !w.size);
                        if (missingMapWorlds.length) {
                            pool.query('SELECT ROUND(AVG(width)) * ROUND(AVG(height)) size FROM maps', (err, rows) => {
                                if (err) return reject(err);
                                const avgSize = rows[0].size;
                                missingMapWorlds.forEach(w => {
                                    w.size = avgSize;
                                    w.noMaps = true;
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

function getAuthorInfoData(pool) {
    return new Promise((resolve, reject) => {
        const authorInfoData = [];
        pool.query('SELECT id, name, nameJP FROM author_info', (err, rows) => {
            if (err) return reject(err);
            for (let row of rows) {
                authorInfoData.push({
                    name: row.name,
                    nameJP: row.nameJP
                });
            }
            
            resolve(authorInfoData);
        });
    });
}

function getVersionInfoData(pool, worldData) {
    return new Promise((resolve, reject) => {
        const versionInfoData = [];
        pool.query('SELECT id, name, authors, releaseDate FROM version_info', (err, rows) => {
            if (err) return reject(err);

            const uniqueWorldVersionNames = versionUtils.getUniqueWorldVersionNames(worldData);

            for (let row of rows) {
                if (row.authors || uniqueWorldVersionNames.indexOf(row.name) > -1)
                    versionInfoData.push({
                        name: row.name,
                        authors: row.authors,
                        releaseDate: row.releaseDate
                    });
            }

            versionInfoData.sort(function (vi1, vi2) {
                return versionUtils.compareVersionNames(vi2.name, vi1.name);
            });
            
            resolve(versionInfoData);
        });
    });
}

function getMenuThemeData(pool, worldData, excludeRemovedContent) {
    return new Promise((resolve, reject) => {
        const menuThemeDataById = {};
        pool.query('SELECT id, menuThemeId, filename FROM menu_themes ORDER BY menuThemeId', (err, rows) => {
            if (err) return reject(err);
            for (let row of rows) {
                menuThemeDataById[row.id] = {
                    id: row.id,
                    menuThemeId: row.menuThemeId,
                    filename: row.filename,
                    locations: []
                };
            }
            
            pool.query('SELECT l.menuThemeId, w.title, l.method, l.methodJP, l.filename, l.removed FROM menu_theme_locations l LEFT JOIN worlds w ON w.id = l.worldId' + (excludeRemovedContent ? ' where l.removed = 0' : ''), (err, rows) => {
                if (err) return reject(err);

                const worldDataByName = _.keyBy(worldData, w => w.title);

                let l = 0;

                for (let row of rows) {
                    const menuTheme = menuThemeDataById[row.menuThemeId];
                    if (menuTheme == null)
                        continue;
                    const world = row.title ? worldDataByName[row.title] : null;
                    const location = {
                        id: l++,
                        worldId: world ? world.id : null,
                        method: row.method,
                        methodJP: row.methodJP,
                        filename: row.filename,
                        removed: row.removed
                    };
                    menuTheme.locations.push(location);
                }

                resolve(_.sortBy(Object.values(menuThemeDataById), m => m.menuThemeId > -1 ? m.menuThemeId : 999));
            });
        });
    });
}

function checkUpdateData(pool) {
    return new Promise((resolve, reject) => {
        pool.query('SELECT lastFullUpdate FROM updates WHERE DATE_ADD(lastFullUpdate, INTERVAL 1 WEEK) < NOW()', (err, rows) => {
            if (err) return reject(err);
            if (rows.length) {
                pool.query('UPDATE updates SET lastUpdate=NOW(), lastFullUpdate=NOW()', (err) => {
                    populateWorldData(pool).then(worldData => {
                        if (err) console.error(err);
                        updateMapData(pool, worldData).then(() => {
                            updateMenuThemeData(pool, worldData).then(() => resolve()).catch(err => reject(err));
                        }).catch(err => reject(err));
                    }).catch(err => reject(err));
                });
            } else {
                pool.query('SELECT lastUpdate FROM updates WHERE DATE_ADD(lastUpdate, INTERVAL 1 HOUR) < NOW()', (err, rows) => {
                    if (err) return reject(err);
                    if (rows.length) {
                        pool.query('UPDATE updates SET lastUpdate=NOW()', err => {
                            if (err) return reject(err);
                            getWorldData(pool, true).then(worldData => {
                                getUpdatedWorldNames(worldData.map(w => w.title), rows[0].lastUpdate)
                                    .then(updatedWorldNames => populateWorldData(pool, worldData, updatedWorldNames)
                                        .then(worldData => {
                                            checkUpdateMapData(pool, worldData, rows[0].lastUpdate).then(() => {
                                                checkUpdateAuthorInfoData(pool, rows[0].lastUpdate).then(() => {
                                                    checkUpdateVersionInfoData(pool, rows[0].lastUpdate).then(() => {
                                                        checkUpdateMenuThemeData(pool, worldData, rows[0].lastUpdate).then(() => resolve()).catch(err => reject(err));
                                                    }).catch(err => reject(err));
                                                }).catch(err => reject(err));
                                            }).catch(err => reject(err));
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
        superagent.get(apiUrl)
            .query({ action: 'query', list: 'recentchanges', rcdir: 'newer', rcstart: lastUpdate.toISOString(), rclimit: 500, format: 'json' })
            .end((err, res) => {
                if (err) return reject(err);
                const data = JSON.parse(res.text);
                const changes = data.query.recentchanges;
                for (let change of changes)
                    recentChanges.push(change);
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

function checkUpdatePage(pageTitle, lastUpdate) {
    return new Promise((resolve, reject) => {
        superagent.get(apiUrl)
            .query({ action: 'query', titles: pageTitle, prop: 'revisions', format: 'json' })
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
                            resolve(true);
                            return;
                        }
                    }
                }
                resolve(false);
            });
    });
}

function checkUpdateMapData(pool, worldData, lastUpdate) {
    return new Promise((resolve, reject) => {
        checkUpdatePage("Map IDs", lastUpdate).then(needsUpdate => {
            if (needsUpdate)
                updateMapData(pool, worldData).then(() => resolve()).catch(err => reject(err));
            else
                resolve();
        }).catch(err => reject(err));
    });
}

function checkUpdateAuthorInfoData(pool, lastUpdate) {
    return new Promise((resolve, reject) => {
        checkUpdatePage("Authors", lastUpdate).then(needsUpdate => {
            if (needsUpdate)
                updateAuthorInfoData(pool).then(() => resolve()).catch(err => reject(err));
            else
                resolve();
        }).catch(err => reject(err));
    });
}

function checkUpdateVersionInfoData(pool, lastUpdate) {
    return new Promise((resolve, reject) => {
        checkUpdatePage("Version History", lastUpdate).then(needsUpdate => {
            if (needsUpdate)
                updateVersionInfoData(pool).then(() => resolve()).catch(err => reject(err));
            else
                resolve();
        }).catch(err => reject(err));
    });
}

function checkUpdateMenuThemeData(pool, worldData, lastUpdate) {
    return new Promise((resolve, reject) => {
        checkUpdatePage("Menu Themes", lastUpdate).then(needsUpdate => {
            if (needsUpdate)
                updateMenuThemeData(pool, worldData).then(() => resolve()).catch(err => reject(err));
            else
                resolve();
        }).catch(err => reject(err));
    });
}

function populateWorldData(pool, worldData, updatedWorldNames, continueKey, worlds) {
    if (!worldData)
        worldData = [];
    return new Promise((resolve, reject) => {
        const query = { action: 'query', list: 'categorymembers', cmtitle: 'Category:Locations', cmlimit: 500, format: 'json' };
        if (continueKey)
            query.cmcontinue = continueKey;
        superagent.get(apiUrl)
            .query(query)
            .end((err, res) => {
            if (err) return reject(err);
            const data = JSON.parse(res.text);
            const locations = data.query.categorymembers;

            worlds = worlds ? worlds.concat(locations) : locations;

            if (data.continue)
                populateWorldData(pool, worldData, updatedWorldNames, data.continue.cmcontinue, worlds).then(wd => resolve(wd)).catch(err => reject(err));
            else
            {
                const newWorldNames = [];
                const batches = [];
                for (let b = 0; b * batchSize < worlds.length; b++)
                    batches.push(populateWorldDataSub(pool, worldData, worlds, b, updatedWorldNames, newWorldNames));
                Promise.all(batches).then(() => {
                    const worldDataByName = _.keyBy(worldData, w => w.title);
                    const callback = function (updatedWorldData) {
                        updateConns(pool, _.keyBy(worldData, w => w.title)).then(() => {
                            updateConnTypeParams(pool, worldData).then(() => {
                                updateWorldDepths(pool, _.sortBy(worldData, [ 'id' ])).then(() => {
                                    deleteRemovedWorlds(pool);
                                    resolve(worldData);
                                }).catch(err => reject(err));
                            }).catch(err => reject(err));
                        }).catch(err => reject(err));
                    };
                    if (newWorldNames.length) {
                        const newWorldBatches = [];
                        const newWorldConnWorldNames = [];
                        for (let newWorldName of newWorldNames) {
                            const newWorld = worldDataByName[newWorldName];
                            const newWorldConns = newWorld.connections;
                            for (let newWorldConn of newWorldConns) {
                                const newWorldConnTargetName = newWorldConn.location;
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
            }
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
                if (!updatedWorldNames || (newWorld = (existingWorldNames.indexOf(world.title) === -1))) {
                    worldData.push(world);
                    if (newWorld)
                        updatedNewWorldNames.push(world.title);
                } else {
                    const existingWorld = worldDataByName[world.title];
                    existingWorld.titleJP = world.titleJP;
                    existingWorld.author = world.author;
                    existingWorld.connections = world.connections;
                    existingWorld.filename = world.filename;
                    existingWorld.mapUrl = world.mapUrl;
                    existingWorld.mapLabel = world.mapLabel;
                    existingWorld.removed = world.removed;
                }
            }
            pool.query('SELECT id, title, titleJP, author, filename, mapUrl, mapLabel, verAdded, verRemoved, verUpdated, verGaps, removed FROM worlds', (err, rows) => {
                if (err) return reject(err);
                for (let row of rows) {
                    const worldName = row.title;
                    if (worldNames.indexOf(worldName) > -1) {
                        const world = newWorldsByName[worldName];
                        world.id = row.id;
                        if (row.titleJP !== world.titleJP || row.author !== world.author || row.filename !== world.filename ||
                            row.mapUrl !== world.mapUrl || row.mapLabel !== world.mapLabel ||
                            row.verAdded !== world.verAdded || row.verRemoved !== world.verRemoved ||
                            row.verUpdated !== world.verUpdated || row.verGaps !== world.verGaps || row.removed !== world.removed)
                            updatedWorlds.push(world);
                    }
                    delete newWorldsByName[worldName];
                }
                const insertCallback = function() {
                    if (updatedWorlds.length) {
                        const updateWorlds = [];
                        for (let updatedWorld of updatedWorlds)
                            updateWorlds.push(updateWorldInfo(pool, updatedWorld).catch(err => console.error(err)));
                        Promise.allSettled(updateWorlds).finally(() => resolve());
                    } else
                        resolve();
                };
                const newWorldNames = Object.keys(newWorldsByName);
                if (newWorldNames.length) {
                    let i = 0;
                    let worldsQuery = 'INSERT INTO worlds (title, titleJP, author, depth, filename, mapUrl, mapLabel, verAdded, verRemoved, verUpdated, verGaps, removed) VALUES ';
                    for (const w in newWorldsByName) {
                        const newWorld = newWorldsByName[w];
                        if (i++)
                            worldsQuery += ", ";
                        const title = newWorld.title.replace(/'/g, "''");
                        const titleJPValue = newWorld.titleJP ? `'${newWorld.titleJP}'` : 'NULL';
                        const authorValue = newWorld.author ? `'${newWorld.author}'` : 'NULL';
                        const mapUrlValue = newWorld.mapUrl ? `'${newWorld.mapUrl}'` : 'NULL';
                        const mapLabelValue = newWorld.mapLabel ? `'${newWorld.mapLabel.replace(/'/g, "''")}'` : 'NULL';
                        const verAddedValue = newWorld.verAdded ? `'${newWorld.verAdded}'` : 'NULL';
                        const verRemovedValue = newWorld.verRemoved ? `'${newWorld.verRemoved}'` : 'NULL';
                        const verUpdatedValue = newWorld.verUpdated ? `'${newWorld.verUpdated}'` : 'NULL';
                        const verGapsValue = newWorld.verGaps ? `'${newWorld.verGaps}'` : 'NULL';
                        const removedValue = newWorld.removed ? '1' : '0';
                        worldsQuery += `('${title}', ${titleJPValue}, ${authorValue}, 0, '${newWorld.filename.replace(/'/g, "''")}', ${mapUrlValue}, ${mapLabelValue}, ${verAddedValue}, ${verRemovedValue}, ${verUpdatedValue}, ${verGapsValue}, ${removedValue})`;
                    }
                    pool.query(worldsQuery, (err, _) => {
                        if (err) return reject(err);
                        const worldRowIdsQuery = `SELECT r.id FROM (SELECT id FROM worlds WHERE title IN ('${newWorldNames.map(w => w.replace(/'/g, "''")).join("', '")}') ORDER BY id DESC) r ORDER BY 1`;
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
        superagent.get(apiUrl)
            .query({ action: 'query', pageids: pageIds.join("|"), prop: "categories", cllimit: 100, format: "json" })
            .end((err, res) => {
            if (err) return reject(err);
            const query = JSON.parse(res.text).query;
            if (!query)
                reject("Query results are empty");
            worlds = query.pages;
            const getWorldsBaseWorldData = [];
            for (let pageId of pageIds)
                getWorldsBaseWorldData.push(getWorldBaseWorldData(worlds, parseInt(pageId)).catch(err => { }));
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
        else if (categories)
            world.removed = !!categories.find(c => c.title ===  "Category:Removed Content");
        else
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
        const titleJPValue = world.titleJP ? `'${world.titleJP}'` : 'NULL';
        const authorValue = world.author ? `'${world.author}'` : 'NULL';
        const mapUrlValue = world.mapUrl ? `'${world.mapUrl}'` : 'NULL';
        const mapLabelValue = world.mapLabel ? `'${world.mapLabel.replace(/'/g, "''")}'` : 'NULL';
        const verAddedValue = world.verAdded ? `'${world.verAdded}'` : 'NULL';
        const verRemovedValue = world.verRemoved ? `'${world.verRemoved}'` : 'NULL';
        const verUpdatedValue = world.verUpdated ? `'${world.verUpdated}'` : 'NULL';
        const verGapsValue = world.verGaps ? `'${world.verGaps}'` : 'NULL';
        const removedValue = world.removed ? '1' : '0';
        if (world.filename)
            pool.query(`UPDATE worlds SET titleJP=${titleJPValue}, author=${authorValue}, filename='${world.filename.replace(/'/g, "''")}', mapUrl=${mapUrlValue}, mapLabel=${mapLabelValue}, verAdded=${verAddedValue}, verRemoved=${verRemovedValue}, verUpdated=${verUpdatedValue}, verGaps=${verGapsValue}, removed=${removedValue} WHERE id=${world.id}`, (err, _) => {
                if (err) return reject(err);
                resolve();
            });
        else
            reject(`Invalid world image URL for world '${world.title}'`);
    });
}

function updateConns(pool, worldDataByName) {
    return new Promise((resolve, reject) => {
        const newConnsByKey = {};
        const existingUpdatedConns = [];
        const removedConnIds = [];
        const worldNames = Object.keys(worldDataByName);
        for (let w in worldDataByName) {
            const world = worldDataByName[w];
            for (let conn of world.connections) {
                if (conn.targetId || worldNames.indexOf(conn.location) > -1) {
                    conn.sourceId = world.id;
                    if (!conn.targetId)
                        conn.targetId = worldDataByName[conn.location].id;
                    const key = `${conn.sourceId}_${conn.targetId}`;
                    newConnsByKey[key] = conn;
                }
            }
        }
        pool.query('SELECT id, sourceId, targetId, type FROM conns', (err, rows) => {
            if (err) return reject(err);
            for (let row of rows) {
                const key = `${row.sourceId}_${row.targetId}`;
                if (newConnsByKey.hasOwnProperty(key)) {
                    const conn = newConnsByKey[key];
                    conn.id = row.id;
                    if (conn.type != row.type) {
                        existingUpdatedConns.push(conn);
                    }
                } else
                    removedConnIds.push(row.id);
                delete newConnsByKey[key];
            }
            const existingUpdatedConnsByType = _.groupBy(existingUpdatedConns, 'type');
            const existingUpdatedConnTypes = Object.keys(existingUpdatedConnsByType);
            const connsCallback = function () {
                if (existingUpdatedConnTypes.length) {
                    let updateConns = [];
                    for (let type of existingUpdatedConnTypes)
                        updateConns.push(updateConnsOfType(pool, type, existingUpdatedConnsByType[type]).catch(err => console.error(err)));
                    Promise.allSettled(updateConns).finally(() => resolve());
                } else
                    resolve();
            };

            const callback = function () {
                const newConnKeys = Object.keys(newConnsByKey);
                if (newConnKeys.length) {
                    let i = 0;
                    let connsQuery = 'INSERT INTO conns (sourceId, targetId, type) VALUES ';
                    for (let c in newConnsByKey) {
                        const conn = newConnsByKey[c];
                        if (i++)
                            connsQuery += ', ';
                        connsQuery += `(${conn.sourceId}, ${conn.targetId}, ${conn.type})`;
                    }
                    pool.query(connsQuery, (err, res) => {
                        if (err) return reject(err);
                        const insertedRows = res.affectedRows;
                        const connRowIdsQuery = `SELECT r.id FROM (SELECT id FROM conns ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                        pool.query(connRowIdsQuery, (err, rows) => {
                            if (err) return reject(err);
                            for (let r in rows)
                                newConnsByKey[newConnKeys[r]].id = rows[r].id;
                            connsCallback();
                        });
                    });
                } else
                    connsCallback();
            };

            if (removedConnIds.length)
                deleteRemovedConns(pool, removedConnIds).then(() => callback()).catch(err => reject(err));
            else
                callback();
        });
    });
}

function updateConnsOfType(pool, type, conns) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let updateConnsQuery = `UPDATE conns SET type=${type} WHERE id IN (`;
        for (let conn of conns) {
            if (i++)
                updateConnsQuery += ', ';
            updateConnsQuery += conn.id;
        }
        updateConnsQuery += ')';
        pool.query(updateConnsQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedConns(pool, removedConnIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteConnsQuery = 'DELETE FROM conns WHERE id IN (';
        for (let connId of removedConnIds) {
            if (i++)
                deleteConnsQuery += ', ';
            deleteConnsQuery += connId;
        }
        deleteConnsQuery += ')';
        pool.query(deleteConnsQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
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
            for (let row of rows) {
                if (newConnTypeParams[row.connId][row.type]) {
                    const newConnTypeParam = newConnTypeParams[row.connId][row.type];
                    if (newConnTypeParam.params !== row.params || (newConnTypeParam.paramsJP && newConnTypeParam.paramsJP !== row.paramsJP)) {
                        const updatedConnTypeParam = _.cloneDeep(newConnTypeParam);
                        updatedConnTypeParam.connId = row.connId;
                        updatedConnTypeParam.type = row.type;
                        updatedConnTypeParams.push(updatedConnTypeParam);
                    }
                } else
                    removedConnTypeParamIds.push(row.id);
                delete newConnTypeParams[row.connId][row.type];
            }

            const updateConnTypeParamsCallback = function () {
                if (removedConnTypeParamIds.length)
                    deleteRemovedConnTypeParams(pool, removedConnTypeParamIds).then(() => resolve()).catch(err => reject(err));
                else
                    resolve();
            };

            const connTypeParamsCallback = function () {
                if (updatedConnTypeParams.length) {
                    const updateExistingConnTypeParams = [];
                    for (let connTypeParam of updatedConnTypeParams)
                        updateExistingConnTypeParams.push(updateConnTypeParam(pool, connTypeParam));
                    Promise.all(updateExistingConnTypeParams).then(() => updateConnTypeParamsCallback()).catch(err => reject(err));
                } else
                    updateConnTypeParamsCallback();
            };

            let i = 0;
            let connTypeParamsQuery = 'INSERT INTO conn_type_params (connId, type, params, paramsJP) VALUES ';
            for (let c in newConnTypeParams) {
                const connConnTypeParams = newConnTypeParams[c];
                for (let t in connConnTypeParams) {
                    const connTypeParam = connConnTypeParams[t];
                    const params = `'${connTypeParam.params.replace(/'/g, "''")}'`;
                    const paramsJP = connTypeParam.paramsJP ? `'${connTypeParam.paramsJP.replace(/'/g, "''")}'` : 'NULL';
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
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteConnTypeParamsQuery = 'DELETE FROM conn_type_params WHERE id IN (';
        for (let connTypeParamId of removedConnTypeParamIds) {
            if (i++)
                deleteConnTypeParamsQuery += ', ';
            deleteConnTypeParamsQuery += connTypeParamId;
        }
        deleteConnTypeParamsQuery += ')';
        pool.query(deleteConnTypeParamsQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function updateWorldDepths(pool, worldData) {
    return new Promise((resolve, reject) => {
        const depthMap = {};

        for (let world of worldData)
            depthMap[world.title] = -1;

        const worldDataById = _.keyBy(worldData, w => w.id);
        const worldDataByName = _.keyBy(worldData, w => w.title);

        calcDepth(worldData, worldDataById, depthMap, null, 0, defaultPathIgnoreConnTypeFlags);

        let ignoreTypeFlags = defaultPathIgnoreConnTypeFlags;
        let anyDepthFound;
        
        while (true) {
            anyDepthFound = false;
            
            missingDepthWorlds = worldData.filter(w => depthMap[w.title] === -1 && w.title !== startLocation);
            missingDepthWorlds.forEach(w => anyDepthFound |= resolveMissingDepths(worldData, worldDataById, worldDataByName, depthMap, w, ignoreTypeFlags));

            if (missingDepthWorlds.length) {
                if (!anyDepthFound) {
                    if (ignoreTypeFlags & ConnType.LOCKED_CONDITION)
                        ignoreTypeFlags ^= ConnType.LOCKED_CONDITION;
                    else if (ignoreTypeFlags & ConnType.LOCKED)
                        ignoreTypeFlags ^= ConnType.LOCKED;
                    else if (ignoreTypeFlags & ConnType.EXIT_POINT)
                        ignoreTypeFlags ^= ConnType.EXIT_POINT;
                    else if (ignoreTypeFlags & ConnType.DEAD_END || ignoreTypeFlags & ConnType.ISOLATED)
                        ignoreTypeFlags ^= ConnType.DEAD_END | ConnType.ISOLATED;
                    else if (ignoreTypeFlags & ConnType.NO_ENTRY)
                        ignoreTypeFlags ^= ConnType.NO_ENTRY;
                    else
                        break;
                }
            } else
                break;
        }

        for (let world of worldData) {
            if (world.depth === undefined)
                world.depth = 1;
        }

        const worldsByDepth = _.groupBy(worldData, 'depth');

        if (Object.keys(worldsByDepth).length) {
            const updateWorldsOfDepths = [];
            const worldDepths = Object.keys(worldsByDepth);
            for (let depth of worldDepths)
                updateWorldsOfDepths.push(updateWorldsOfDepth(pool, depth, worldsByDepth[depth]));
            Promise.all(updateWorldsOfDepths).then(() => resolve()).catch(err => reject(err));
        } else
            resolve();
    });
}

function calcDepth(worldData, worldDataById, depthMap, world, depth, ignoreTypeFlags, targetWorldName, removed) {
    const worldDataByName = _.keyBy(worldData, w => w.title);
    const worldNames = Object.keys(worldDataByName);
    let currentWorld;
    if (depth > 0)
        currentWorld = world;
    else {
        currentWorld = worldDataByName[startLocation];
        currentWorld.depth = depthMap[currentWorld.title] = depth;
    }
    for (let conn of currentWorld.connections) {
        const targetWorld = worldDataById[conn.targetId];
        const w = targetWorld ? targetWorld.title : conn.location;
        if (worldNames.indexOf(w) > -1 && (!targetWorldName || w === targetWorldName)) {
            if (conn.type & ignoreTypeFlags)
                continue;
            const connWorld = worldDataByName[w];
            if ((removed && !connWorld.removed) || (!removed && (!connWorld.removed && conn.type & ConnType.INACCESSIBLE)))
                continue;
            const d = depthMap[w];
            if (d === -1 || d > depth + 1) {
                connWorld.depth = depthMap[w] = depth + 1;
                if (!targetWorldName)
                    calcDepth(worldData, worldDataById, depthMap, connWorld, depth + 1, defaultPathIgnoreConnTypeFlags, null, removed || connWorld.removed);
            }
        }
    }
    return depth;
}

function resolveMissingDepths(worldData, worldDataById, worldDataByName, depthMap, world, ignoreTypeFlags) {
    const worldNames = Object.keys(worldDataByName);
    const conns = world.connections.filter(c => c.targetId ? worldDataById[c.targetId] : worldNames.indexOf(c.location) > -1);

    for (let c of conns) {
        let sourceWorld = c.targetId ? worldDataById[c.targetId] : worldDataByName[c.location];
        if (!sourceWorld.removed && c.type & ConnType.INACCESSIBLE)
            continue;
        if (sourceWorld.depth !== undefined)
            calcDepth(worldData, worldDataById, depthMap, sourceWorld, depthMap[sourceWorld.title], ignoreTypeFlags, world.title, sourceWorld.removed);
    }

    if (depthMap[world.title] > -1) {
        conns.filter(c => depthMap[c.location ? c.location : worldDataById[c.targetId].title] === -1)
            .forEach(c => resolveMissingDepths(worldData, worldDataById, worldDataByName, depthMap, c.targetId ? worldDataById[c.targetId] : worldDataByName[c.location], ignoreTypeFlags));
        return true;
    }

    return false;
}

function updateWorldsOfDepth(pool, depth, worlds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let updateDepthsQuery = `UPDATE worlds SET depth=${depth} WHERE id IN (`;
        for (let world of worlds) {
            if (i++)
                updateDepthsQuery += ", ";
            updateDepthsQuery += world.id;
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
        if (err) return console.error(err);
    });
}

function updateMapData(pool, worldData) {
    return new Promise((resolve, reject) => {
        getMapData(worldData).then(mapData => {
            updateMaps(pool, mapData).then(() => {
                const mapsByMapId = _.keyBy(mapData, m => m.mapId);
                const newWorldMapsByKey = {};
                const existingWorldMaps = [];
                const removedWorldMapIds = [];
                for (let world of worldData) {
                    for (let mapId of world.mapIds) {
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
                    for (let row of rows) {
                        const key = `${row.worldId}_${row.mapId}`;
                        if (Object.keys(newWorldMapsByKey).indexOf(key) > -1) {
                            const worldMap = newWorldMapsByKey[key];
                            worldMap.id = row.id;
                            existingWorldMaps.push(worldMap);
                        } else
                            removedWorldMapIds.push(row.id);
                        delete newWorldMapsByKey[key];
                    }

                    const callback = function () {
                        const newWorldMapKeys = Object.keys(newWorldMapsByKey);
                    
                        if (newWorldMapKeys.length) {
                            let i = 0;
                            let worldMapsQuery = 'INSERT INTO world_maps (worldId, mapId) VALUES ';
                            for (let m in newWorldMapsByKey) {
                                const worldMap = newWorldMapsByKey[m];
                                if (i++)
                                    worldMapsQuery += ', ';
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
                    };

                    if (removedWorldMapIds.length)
                        deleteRemovedWorldMaps(pool, removedWorldMapIds).then(() => callback()).catch(err => reject(err));
                    else
                        callback();
                });
            }).catch(err => reject(err));
        }).catch(err => reject(err));
    });
}

function getMapData(worldData) {
    return new Promise((resolve, reject) => {
        superagent.get('https://yume2kki.fandom.com/wiki/Map_IDs', function (err, res) {
            if (err) return reject(err);
            worldData.forEach(w => w.mapIds = []);
            const worldDataByName = _.keyBy(worldData, w => w.title);
            const mapIdTablesHtml = res.text.slice(res.text.indexOf('<table '), res.text.lastIndexOf('</table>'));
            const rawMapData = mapIdTablesHtml.split('<td>#').slice(1).map(t => {
                const ret = t.replace(/\n/g, '').split('</td><td>').slice(0, 6);
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
            const removedMapIds = [];

            for (let row of rows) {
                const mapId = row.mapId;
                if (mapIds.indexOf(mapId) > -1) {
                    const map = mapDataByMapId[mapId];
                    map.id = row.id;
                    if (row.width !== map.width || row.height !== map.height)
                        updatedMaps.push(map);
                } else
                    removedMapIds.push(row.id);
                delete newMapsByMapId[mapId];
            }

            const insertCallback = function () {
                if (updatedMaps.length) {
                    const updateMaps = [];
                    for (let map of updatedMaps)
                        updateMaps.push(updateMap(pool, map).catch(err => console.error(err)));
                    Promise.allSettled(updateMaps).finally(() => resolve());
                } else
                    resolve();
            };

            const callback = function () {
                const newMapIds = Object.keys(newMapsByMapId);
                if (newMapIds.length) {
                    let i = 0;
                    let mapsQuery = 'INSERT INTO maps (mapId, width, height) VALUES ';
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
            };

            if (removedMapIds.length)
                deleteRemovedMaps(pool, removedMapIds).then(() => callback()).catch(err => reject(err));
            else
                callback();
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

function deleteRemovedMaps(pool, removedMapIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteMapsQuery = 'DELETE FROM maps WHERE id IN (';
        for (let mapId of removedMapIds) {
            if (i++)
                deleteMapsQuery += ', ';
            deleteMapsQuery += mapId;
        }
        deleteMapsQuery += ')';
        pool.query(deleteMapsQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedWorldMaps(pool, removedWorldMapIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteWorldMapsQuery = 'DELETE FROM world_maps WHERE id IN (';
        for (let worldMapId of removedWorldMapIds) {
            if (i++)
                deleteWorldMapsQuery += ', ';
            deleteWorldMapsQuery += worldMapId;
        }
        deleteWorldMapsQuery += ')';
        pool.query(deleteWorldMapsQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function updateAuthorInfoData(pool) {
    return new Promise((resolve, reject) => {
        getAuthorInfoWikiData().then(authorInfoData => {
            updateAuthorInfo(pool, authorInfoData).then(() => resolve(authorInfoData)).catch(err => reject(err));
        }).catch(err => reject(err));
    });
}

function getAuthorInfoWikiData() {
    return new Promise((resolve, reject) => {
        superagent.get('https://yume2kki.fandom.com/wiki/Authors', function (err, res) {
            if (err) return reject(err);
            const authorSectionsHtml = res.text.split('data-jp-name="');
            const authorInfo = [];

            for (let a = 0; a < authorSectionsHtml.length - 1; a++) {
                const section = authorSectionsHtml[a];
                const nextSection = authorSectionsHtml[a + 1];
                let searchIndex = section.indexOf('<b>', section.lastIndexOf(' class="mw-headline" ')) + 2;
                if (searchIndex < 2)
                    continue;
                if (section.slice(0, section.indexOf('</b>', searchIndex)).indexOf('</a', searchIndex) > -1)
                    searchIndex = section.indexOf('<a', searchIndex) + 2;

                const authorName = section.slice(section.indexOf('>', searchIndex) + 1, section.indexOf('<', searchIndex));
                const authorNameJP = nextSection.slice(0, nextSection.indexOf('"'));
                authorInfo.push({
                    name: authorName,
                    nameJP: authorNameJP
                });
            }
            
            resolve(authorInfo);
        });
    });
}

function updateAuthorInfo(pool, authorInfo) {
    return new Promise((resolve, reject) => {
        pool.query('SELECT id, name, nameJP FROM author_info', (err, rows) => {
            if (err) return reject(err);
            const authorInfoByName = _.keyBy(authorInfo, a => a.name);
            const newAuthorInfoByName = _.keyBy(authorInfo, a => a.name);
            const updatedAuthorInfo = [];
            const removedAuthorInfoIds = [];
            for (let row of rows) {
                const name = row.name;
                if (authorInfoByName.hasOwnProperty(name)) {
                    const author = authorInfoByName[name]
                    author.id = row.id;
                    if (row.nameJP !== author.nameJP)
                        updatedAuthorInfo.push(author);
                } else
                    removedAuthorInfoIds.push(row.id);
                delete newAuthorInfoByName[name];
            }

            const insertCallback = function () {
                if (updatedAuthorInfo.length) {
                    const updateAuthorInfo = [];
                    for (let author of updatedAuthorInfo)
                        updateAuthorInfo.push(updateAuthor(pool, author).catch(err => console.error(err)));
                    Promise.allSettled(updateAuthorInfo).finally(() => resolve());
                } else
                    resolve();
            };

            const callback = function () {
                const newAuthorNames = Object.keys(newAuthorInfoByName);
                if (newAuthorNames.length) {
                    let i = 0;
                    let authorInfoQuery = 'INSERT INTO author_info (name, nameJP) VALUES ';
                    for (let a in newAuthorInfoByName) {
                        const newAuthorInfo = newAuthorInfoByName[a];
                        if (i++)
                            authorInfoQuery += ", ";
                        const nameJP = newAuthorInfo.nameJP ? `'${newAuthorInfo.nameJP}'` : 'NULL';
                        authorInfoQuery += `('${newAuthorInfo.name}', ${nameJP})`;
                    }
                    pool.query(authorInfoQuery, (err, res) => {
                        if (err) return reject(err);
                        const insertedRows = res.affectedRows;
                        const authorInfoRowIdsQuery = `SELECT r.id FROM (SELECT id FROM author_info ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                        pool.query(authorInfoRowIdsQuery, (err, rows) => {
                            if (err) return reject(err);
                            for (let r in rows)
                                newAuthorInfoByName[newAuthorNames[r]].id = rows[r].id;
                            insertCallback();
                        });
                    });
                } else
                    insertCallback();
            };

            if (removedAuthorInfoIds.length)
                deleteRemovedAuthorInfo(pool, removedAuthorInfoIds).then(() => callback()).catch(err => reject(err));
            else
                callback();
        });
    });
}

function updateAuthor(pool, author) {
    return new Promise((resolve, reject) => {
        const nameJP = author.nameJP ? `'${author.nameJP}'` : 'NULL';
        pool.query(`UPDATE author_info SET nameJP=${nameJP} WHERE id=${author.id}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedAuthorInfo(pool, removedAuthorInfoIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteAuthorInfoQuery = 'DELETE FROM author_info WHERE id IN (';
        for (let authorInfoId of removedAuthorInfoIds) {
            if (i++)
                deleteAuthorInfoQuery += ', ';
            deleteAuthorInfoQuery += authorInfoId;
        }
        deleteAuthorInfoQuery += ')';
        pool.query(deleteAuthorInfoQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function updateVersionInfoData(pool) {
    return new Promise((resolve, reject) => {
        getVersionInfoWikiData().then(versionInfoData => {
            updateVersionInfo(pool, versionInfoData).then(() => resolve(versionInfoData)).catch(err => reject(err));
        }).catch(err => reject(err));
    });
}

function getVersionInfoWikiData(url) {
    const root = !url;
    if (root)
        url = 'https://yume2kki.fandom.com/wiki/Version_History';
    
    return new Promise((resolve, reject) => {
        superagent.get(url, function (err, res) {
            if (err) return reject(err);
            const versionSectionsHtml = res.text.split('article-table');
            const versionInfo = [];
            const populateVersionInfo = function () {
                for (let a = 0; a < versionSectionsHtml.length - 1; a++) {
                    const section = versionSectionsHtml[a];
                    const nextSection = versionSectionsHtml[a + 1].slice(0, versionSectionsHtml[a + 1].indexOf('</table>'));
    
                    const versionNameSearchIndex = section.lastIndexOf(' class="mw-headline" ');
                    let versionName = section.slice(section.indexOf('>', versionNameSearchIndex) + 1, section.indexOf('<', versionNameSearchIndex)).replace(/^[^0-9]*/i, '');

                    if (versionName.indexOf('~') > -1)
                        versionName = versionName.slice(versionName.indexOf('~') + 1);

                    const patchSectionsHtml = nextSection.split('Authors:');

                    for (let p = 0; p < patchSectionsHtml.length - 1; p++) {
                        const patchSection = patchSectionsHtml[p + 1];
                        const authors = [];
                        let releaseDateIndex = patchSection.search(/release date:/i);

                        const authorsSection = patchSection.slice(0, patchSection.indexOf('</td>'));
                        let cursor = authorsSection.indexOf('<a ') + 3;
        
                        while (cursor > 2 && cursor < releaseDateIndex) {
                            const author = authorsSection.slice(authorsSection.indexOf('>', cursor) + 1, authorsSection.indexOf('</a>', cursor));
                            if (author !== '<?>')
                                authors.push(author);
                            cursor = authorsSection.indexOf('<a ', cursor) + 3;
                        }
        
                        let releaseDate = null;
        
                        if (releaseDateIndex > -1) {
                            const releaseDateSection = patchSection.slice(patchSection.slice(releaseDateIndex).search(/[0-9]/) + releaseDateIndex);
                            releaseDate = new Date(releaseDateSection.slice(0, releaseDateSection.search(/[^0-9\/]/)));
                        }

                        const patchNo = versionName !== '0.113' ? p : (p - 1);
        
                        versionInfo.push({
                            name: `${versionName}${(p ? ` patch ${patchNo}` : '')}`,
                            authors: authors.length ? authors.join(',') : null,
                            releaseDate: releaseDate
                        });
                    }
                }

                if (root)
                    versionInfo.sort(function (v1, v2) {
                        return versionUtils.compareVersionNames(v1.name, v2.name);
                    });
                resolve(versionInfo);
            };

            if (root)
            {
                const populateOldVersionInfo = [];
                let cursor = versionSectionsHtml[0].indexOf('<a href="/wiki/Version_History/') + 30;

                while (cursor >= 30) {
                    populateOldVersionInfo.push(getVersionInfoWikiData(`${url}${versionSectionsHtml[0].slice(cursor, versionSectionsHtml[0].indexOf('"', cursor))}`).then(oldVersionInfo => oldVersionInfo.forEach(vi => versionInfo.push(vi))).catch(err => console.error(err)));
                    cursor = versionSectionsHtml[0].indexOf('<a href="/wiki/Version_History/', cursor) + 30;
                }

                if (populateOldVersionInfo.length)
                    Promise.allSettled(populateOldVersionInfo).finally(() => populateVersionInfo());
                else
                    populateVersionInfo();
            } else
                populateVersionInfo();
        });
    });
}

function updateVersionInfo(pool, versionInfo) {
    return new Promise((resolve, reject) => {
        pool.query('SELECT id, name, authors, releaseDate FROM version_info', (err, rows) => {
            if (err) return reject(err);
            const versionInfoByName = _.keyBy(versionInfo, a => a.name);
            const newVersionInfoByName = _.keyBy(versionInfo, a => a.name);
            const updatedVersionInfo = [];
            const removedVersionInfoIds = [];
            for (let row of rows) {
                const name = row.name;
                if (versionInfoByName.hasOwnProperty(name)) {
                    const version = versionInfoByName[name]
                    version.id = row.id;
                    if (row.authors !== version.authors
                        || (row.releaseDate && !isNaN(row.releaseDate) ? row.releaseDate.toDateString() : '') !== (version.releaseDate && !isNaN(version.releaseDate) ? version.releaseDate.toDateString() : ''))
                        updatedVersionInfo.push(version);
                } else
                    removedVersionInfoIds.push(row.id);
                delete newVersionInfoByName[name];
            }

            const insertCallback = function () {
                if (updatedVersionInfo.length) {
                    const updateVersionInfo = [];
                    for (let version of updatedVersionInfo)
                        updateVersionInfo.push(updateVersion(pool, version).catch(err => console.error(err)));
                    Promise.allSettled(updateVersionInfo).finally(() => resolve());
                } else
                    resolve();
            };

            const callback = function () {
                const newVersionNames = Object.keys(newVersionInfoByName);
                if (newVersionNames.length) {
                    let i = 0;
                    let versionInfoQuery = 'INSERT INTO version_info (name, authors, releaseDate) VALUES ';
                    for (let a in newVersionInfoByName) {
                        const newVersionInfo = newVersionInfoByName[a];
                        if (i++)
                            versionInfoQuery += ", ";
                        const authors = newVersionInfo.authors ? `'${newVersionInfo.authors}'` : 'NULL';
                        const releaseDate = newVersionInfo.releaseDate && !isNaN(newVersionInfo.releaseDate) ? `'${newVersionInfo.releaseDate.toISOString().slice(0, 19).replace('T', ' ')}'` : 'NULL';
                        versionInfoQuery += `('${newVersionInfo.name}', ${authors}, ${releaseDate})`;
                    }
                    pool.query(versionInfoQuery, (err, res) => {
                        if (err) return reject(err);
                        const insertedRows = res.affectedRows;
                        const versionInfoRowIdsQuery = `SELECT r.id FROM (SELECT id FROM version_info ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                        pool.query(versionInfoRowIdsQuery, (err, rows) => {
                            if (err) return reject(err);
                            for (let r in rows)
                                newVersionInfoByName[newVersionNames[r]].id = rows[r].id;
                            insertCallback();
                        });
                    });
                } else
                    insertCallback();
            };

            if (removedVersionInfoIds.length)
                deleteRemovedVersionInfo(pool, removedVersionInfoIds).then(() => callback()).catch(err => reject(err));
            else
                callback();
        });
    });
}

function updateVersion(pool, version) {
    return new Promise((resolve, reject) => {
        const authors = version.authors ? `'${version.authors}'` : 'NULL';
        const releaseDate = version.releaseDate && !isNaN(version.releaseDate) ? `'${version.releaseDate.toISOString().slice(0, 19).replace('T', ' ')}'` : 'NULL';
        pool.query(`UPDATE version_info SET authors=${authors}, releaseDate=${releaseDate} WHERE id=${version.id}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedVersionInfo(pool, removedVersionInfoIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteVersionInfoQuery = 'DELETE FROM version_info WHERE id IN (';
        for (let versionInfoId of removedVersionInfoIds) {
            if (i++)
                deleteVersionInfoQuery += ', ';
            deleteVersionInfoQuery += versionInfoId;
        }
        deleteVersionInfoQuery += ')';
        pool.query(deleteVersionInfoQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function updateMenuThemeData(pool, worldData) {
    return new Promise((resolve, reject) => {
        getMenuThemeWikiData(worldData).then(menuThemeData => {
            updateMenuThemes(pool, menuThemeData).then(() => {
                const menuThemesById = _.keyBy(menuThemeData, m => m.id);
                const newMenuThemeLocationsByKey = {};
                const existingMenuThemeLocations = [];
                const existingUpdatedMenuThemeLocations = [];
                const removedMenuThemeLocationIds = [];
                
                for (let menuTheme of menuThemeData) {
                    for (let location of menuTheme.locations) {
                        const worldId = location.worldId != null ? location.worldId : '';
                        const key = `${menuTheme.menuThemeId}_${worldId}`;
                        location.menuThemeId = menuTheme.id;
                        newMenuThemeLocationsByKey[key] = location;
                    }
                }
                pool.query('SELECT id, menuThemeId, worldId, method, methodJP, filename, removed FROM menu_theme_locations', (err, rows) => {
                    if (err) return reject(err);
                    for (let row of rows) {
                        const worldId = row.worldId != null ? row.worldId : '';
                        const key = `${menuThemesById[row.menuThemeId].menuThemeId}_${worldId}`;
                        if (newMenuThemeLocationsByKey.hasOwnProperty(key)) {
                            const location = newMenuThemeLocationsByKey[key];
                            location.id = row.id;
                            existingMenuThemeLocations.push(location);
                            if (row.filename !== location.filename || row.method !== location.method || row.methodJP !== location.methodJP || row.removed !== location.removed)
                                existingUpdatedMenuThemeLocations.push(location);
                        } else
                            removedMenuThemeLocationIds.push(row.id);
                        delete newMenuThemeLocationsByKey[key];
                    }

                    const insertCallback = function () {
                        if (existingUpdatedMenuThemeLocations.length) {
                            const updateMenuThemeLocations = [];
                            for (let location of existingUpdatedMenuThemeLocations)
                                updateMenuThemeLocations.push(updateMenuThemeLocation(pool, location).catch(err => console.error(err)));
                            Promise.allSettled(updateMenuThemeLocations).finally(() => resolve());
                        } else
                            resolve();
                    };

                    const callback = function () {
                        const newMenuThemeLocationKeys = Object.keys(newMenuThemeLocationsByKey);
                    
                        if (newMenuThemeLocationKeys.length) {
                            let i = 0;
                            let menuThemeLocationsQuery = 'INSERT INTO menu_theme_locations (menuThemeId, worldId, method, methodJP, filename, removed) VALUES ';
                            for (let m in newMenuThemeLocationsByKey) {
                                const location = newMenuThemeLocationsByKey[m];
                                if (i++)
                                    menuThemeLocationsQuery += ", ";
                                const worldId = location.worldId != null ? `'${location.worldId}'` : 'NULL';
                                const method = location.method != null ? `'${location.method.replace(/'/g, "''")}'` : 'NULL';
                                const methodJP = location.methodJP != null ? `'${location.methodJP.replace(/'/g, "''")}'` : 'NULL';
                                const filename = location.filename != null ? `'${location.filename.replace(/'/g, "''")}'` : 'NULL';
                                const removed = location.removed ? '1' : '0';
                                menuThemeLocationsQuery += `(${location.menuThemeId}, ${worldId}, ${method}, ${methodJP}, ${filename}, ${removed})`;
                            }
                            pool.query(menuThemeLocationsQuery, (err, res) => {
                                if (err) return reject(err);
                                const insertedRows = res.affectedRows;
                                const menuThemeLocationRowIdsQuery = `SELECT r.id FROM (SELECT id FROM menu_theme_locations ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                                pool.query(menuThemeLocationRowIdsQuery, (err, rows) => {
                                    if (err) return reject(err);
                                    for (let r in rows)
                                        newMenuThemeLocationsByKey[newMenuThemeLocationKeys[r]].id = rows[r].id;
                                    insertCallback();
                                });
                            });
                        } else
                            insertCallback();
                    };

                    if (removedMenuThemeLocationIds.length)
                        deleteRemovedMenuThemeLocations(pool, removedMenuThemeLocationIds).then(() => callback()).catch(err => reject(err));
                    else
                        callback();
                });
            }).catch(err => reject(err));
        }).catch(err => reject(err));
    });
}

function getMenuThemeWikiData(worldData) {
    return new Promise((resolve, reject) => {
        superagent.get('https://yume2kki.fandom.com/wiki/Menu_Themes', function (err, res) {
            if (err) return reject(err);
            const worldDataByName = _.keyBy(worldData, w => w.title);
            const menuThemeTablesHtml = res.text.slice(res.text.indexOf('<table '), res.text.lastIndexOf('</table>'));
            const menuThemeDataRows = menuThemeTablesHtml.split('<tr>').slice(2);
            const rawMenuThemeData = [];
            let removedIndex = 999;
            for (let m = 0; m < menuThemeDataRows.length; m++) {
                const ret = menuThemeDataRows[m].replace(/\n/g, '').split('</td><td>').slice(0, 4);
                if (ret[3].indexOf('</table>') > -1 && m < menuThemeDataRows.length - 1) {
                    removedIndex = m;
                    m++;
                }
                ret[3] = ret[3].slice(0, ret[3].indexOf('</td>'));
                rawMenuThemeData.push(ret);
            }
            const menuThemeData = [];
            const menuThemeLocationKeys = [];
            for (let m = 0; m < rawMenuThemeData.length; m++) {
                const data = rawMenuThemeData[m];
                const location = {
                    worldId: null,
                    method: data[2],
                    methodJP: null,
                    filename: null,
                    removed: m > removedIndex
                };
                const worldNameStartIndex = data[1].indexOf('<a href="/wiki/') + 15;
                if (worldNameStartIndex > -1) {
                    const worldNameEndIndex = data[1].indexOf('"', worldNameStartIndex);
                    const worldName = data[1].slice(worldNameStartIndex, worldNameEndIndex).replace(/%26/g, "&").replace(/%27/g, "'").replace(/\_/g, " ").replace(/#.*/, "");
                    if (worldDataByName[worldName])
                        location.worldId = worldDataByName[worldName].id;
                }
                const locationImageIndex = data[3].indexOf('<img ');
                if (locationImageIndex > -1) {
                    const locationImageSrcIndex = data[3].indexOf(' data-src="', locationImageIndex) > -1
                        ? data[3].indexOf(' data-src="', locationImageIndex) + 11
                        : data[3].indexOf(' src="', locationImageIndex) + 6;
                    const locationImageUrl = data[3].slice(locationImageSrcIndex, data[3].indexOf('"', locationImageSrcIndex));
                    location.filename = locationImageUrl.slice(0, locationImageUrl.indexOf("/", locationImageUrl.lastIndexOf(".")));
                }

                const keyWorldId = location.worldId != null ? location.worldId : '';

                let i = 0;
                let themeMatch;

                while ((themeMatch = data[0].slice(i).match(/Theme ((?:\-)?\d+)/)) != null) {
                    i += (themeMatch.index + themeMatch[0].length);
                    const menuThemeId = parseInt(themeMatch[1]);
                    const key = `${menuThemeId}_${keyWorldId}`;
                    if (menuThemeLocationKeys.indexOf(key) > -1)
                        continue;
                    let menuTheme;
                    const existingMenuTheme = menuThemeData.find(m => m.menuThemeId === menuThemeId);
                    if (existingMenuTheme)
                        menuTheme = existingMenuTheme;
                    else {
                        const imageIndex = data[0].slice(0, i).lastIndexOf('<img ');
                        if (imageIndex === -1)
                            continue;
                        const imageSrcIndex = data[0].indexOf(' src="', imageIndex) + 6;
                        const imageUrl = data[0].slice(imageSrcIndex, data[0].indexOf('"', imageSrcIndex));
                        menuTheme = {
                            menuThemeId: menuThemeId,
                            filename: imageUrl.slice(0, imageUrl.indexOf("/", imageUrl.lastIndexOf("."))),
                            locations: []
                        };
                        menuThemeData.push(menuTheme);
                    }
                    menuTheme.locations.push(_.cloneDeep(location));
                    menuThemeLocationKeys.push(key);
                }
            }
            addMenuThemeDataJPMethods(menuThemeData).then(() => resolve(menuThemeData)).catch(err => reject(err));
        });
    });
}

function addMenuThemeDataJPMethods(menuThemeData, removed) {
    return new Promise((resolve, reject) => {
        let url = 'https://wikiwiki.jp/yume2kki-t/%E5%8F%8E%E9%9B%86%E8%A6%81%E7%B4%A0/%E3%83%A1%E3%83%8B%E3%83%A5%E3%83%BC%E3%82%BF%E3%82%A4%E3%83%97%E3%81%AE%E8%A7%A3%E6%94%BE%E6%9D%A1%E4%BB%B6';
        if (removed)
            url = 'https://web.archive.org/web/20200508042816/' + url;
        superagent.get(url, function (err, res) {
            if (err) return reject(err);
            const menuThemesByMenuThemeId = _.keyBy(menuThemeData, m => m.menuThemeId);
            const menuThemeTablesHtml = res.text.slice(res.text.indexOf('<table><thead>', res.text.indexOf('<div class="container-wrapper"')), res.text.lastIndexOf('</table>'));
            const menuThemeDataRows = menuThemeTablesHtml.split('<tr>').slice(2);
            let endOfTable = false;

            for (let m = 0; m < menuThemeDataRows.length; m++) {
                const data = menuThemeDataRows[m].split('</td><td').slice(0, 2);
                if (data[1].indexOf('</table>') > -1) {
                    m++;
                    endOfTable = true;
                }
                let menuThemeId = data[0].slice(data[0].lastIndexOf('>') + 1);
                if (menuThemeId === '--')
                    menuThemeId = '-1';
                if (menuThemesByMenuThemeId.hasOwnProperty(menuThemeId)) {
                    const location = menuThemesByMenuThemeId[menuThemeId].locations.find(l => l.removed === !!removed);
                    if (location) {
                        const methodJP = data[1].slice(data[1].indexOf('>') + 1, data[1].indexOf('</td>'));
                        location.methodJP = methodJP;
                    }
                }
                if (menuThemeId === '-1' || (removed && endOfTable))
                    break;
            }

            if (removed)
                resolve();
            else
                addMenuThemeDataJPMethods(menuThemeData, true).then(() => resolve()).catch(err => reject(err));
        });
    });
}

function updateMenuThemes(pool, menuThemeData) {
    return new Promise((resolve, reject) => {
        pool.query('SELECT id, menuThemeId, filename FROM menu_themes', (err, rows) => {
            if (err) return reject(err);
            const menuThemeDataByMenuThemeId = _.keyBy(menuThemeData, m => m.menuThemeId);
            const newMenuThemesByMenuThemeId = _.keyBy(menuThemeData, m => m.menuThemeId);
            const updatedMenuThemes = [];
            const removedMenuThemeIds = [];
            for (let row of rows) {
                const menuThemeId = row.menuThemeId;
                if (menuThemeDataByMenuThemeId.hasOwnProperty(menuThemeId)) {
                    const menuTheme = menuThemeDataByMenuThemeId[menuThemeId];
                    menuTheme.id = row.id;
                    if (row.filename !== menuTheme.filename)
                        updatedMenuThemes.push(menuTheme);
                } else
                    removedMenuThemeIds.push(row.id);
                delete newMenuThemesByMenuThemeId[menuThemeId];
            }

            const insertCallback = function () {
                if (updatedMenuThemes.length) {
                    const updateMenuThemes = [];
                    for (let menuTheme of updatedMenuThemes)
                        updateMenuThemes.push(updateMenuTheme(pool, menuTheme).catch(err => console.error(err)));
                    Promise.allSettled(updateMenuThemes).finally(() => resolve());
                } else
                    resolve();
            };

            const callback = function () {
                const newMenuThemeIds = Object.keys(newMenuThemesByMenuThemeId);
                if (newMenuThemeIds.length) {
                    let i = 0;
                    let menuThemesQuery = 'INSERT INTO menu_themes (menuThemeId, filename) VALUES ';
                    for (let m in newMenuThemesByMenuThemeId) {
                        const newMenuTheme = newMenuThemesByMenuThemeId[m];
                        if (i++)
                            menuThemesQuery += ", ";
                        menuThemesQuery += `(${newMenuTheme.menuThemeId}, '${newMenuTheme.filename.replace(/'/g, "''")}')`;
                    }
                    pool.query(menuThemesQuery, (err, res) => {
                        if (err) return reject(err);
                        const insertedRows = res.affectedRows;
                        const menuThemeRowIdsQuery = `SELECT r.id FROM (SELECT id FROM menu_themes ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                        pool.query(menuThemeRowIdsQuery, (err, rows) => {
                            if (err) return reject(err);
                            for (let r in rows)
                                newMenuThemesByMenuThemeId[newMenuThemeIds[r]].id = rows[r].id;
                            insertCallback();
                        });
                    });
                } else
                    insertCallback();
            };

            if (removedMenuThemeIds.length)
                deleteRemovedMenuThemes(pool, removedMenuThemeIds).then(() => callback()).catch(err => reject(err));
            else
                callback();
        });
    });
}

function updateMenuTheme(pool, menuTheme) {
    return new Promise((resolve, reject) => {
        pool.query(`UPDATE menu_themes SET filename='${menuTheme.filename.replace(/'/g, "''")}' WHERE id=${menuTheme.id}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function updateMenuThemeLocation(pool, location) {
    return new Promise((resolve, reject) => {
        const method = location.method ? `'${location.method.replace(/'/g, "''")}'` : 'NULL';
        const methodJP = location.methodJP ? `'${location.methodJP.replace(/'/g, "''")}'` : 'NULL';
        const filename = location.filename ? `'${location.filename.replace(/'/g, "''")}'` : 'NULL';
        const removed = location.removed ? '1' : '0';
        pool.query(`UPDATE menu_theme_locations SET method=${method}, methodJP=${methodJP}, filename=${filename}, removed=${removed} WHERE id=${location.id}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedMenuThemes(pool, removedMenuThemeIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteMenuThemesQuery = 'DELETE FROM menu_themes WHERE id IN (';
        for (let menuThemeId of removedMenuThemeIds) {
            if (i++)
                deleteMenuThemesQuery += ', ';
            deleteMenuThemesQuery += menuThemeId;
        }
        deleteMenuThemesQuery += ')';
        pool.query(deleteMenuThemesQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedMenuThemeLocations(pool, removedMenuThemeLocationIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteMenuThemeLocationsQuery = 'DELETE FROM menu_theme_locations WHERE id IN (';
        for (let menuThemeLocationId of removedMenuThemeLocationIds) {
            if (i++)
                deleteMenuThemeLocationsQuery += ', ';
            deleteMenuThemeLocationsQuery += menuThemeLocationId;
        }
        deleteMenuThemeLocationsQuery += ')';
        pool.query(deleteMenuThemeLocationsQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function getWorldInfo(worldName) {
    return new Promise((resolve, reject) => {
        superagent.get('https://yume2kki.fandom.com/wiki/' + worldName, function (err, res) {
            if (err) return reject(err);
            worldName = worldName.replace(/\_/g, ' ');
            let imageUrl = res.text.split('<a href="https://static.wikia.nocookie.net')[1];
            imageUrl = "https://static.wikia.nocookie.net" + imageUrl.slice(0, imageUrl.indexOf('"'));
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
            const mapUrlAndLabel = getMapUrlAndLabel(res.text);
            resolve({
                titleJP: getTitleJP(res.text),
                connections: getConnections(res.text),
                author: getAuthor(res.text),
                filename: filename,
                mapUrl: mapUrlAndLabel && mapUrlAndLabel.mapUrl,
                mapLabel: mapUrlAndLabel && mapUrlAndLabel.mapLabel,
                verAdded: getVerAdded(res.text),
                verRemoved: getVerRemoved(res.text),
                verUpdated: getVerUpdated(res.text),
                verGaps: getVerGaps(res.text)
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

function getAuthor(html) {
    let authorLabelIndex = html.indexOf("<b>Author</b>");
    if (authorLabelIndex === -1)
        authorLabelIndex = html.indexOf("<b>Primary Author</b>");
    if (authorLabelIndex === -1)
        return null;
    const authorIndex = html.indexOf(">", html.indexOf("<a ", authorLabelIndex)) + 1;
    const ret = html.slice(authorIndex, html.indexOf("</a>", authorIndex));
    if (ret === 'Author Unknown')
        return null;
    return ret;
}

function getMapUrlAndLabel(html) {
    const mapUrls = [];
    const mapLabels = [];
    const revisionText = "/revision/latest";
    let figureIndex = html.indexOf("<figure");
    
    while (figureIndex > -1)
    {
        const figureHtml = html.slice(figureIndex, html.indexOf("</figure", figureIndex));
        const figCaptionIndex = figureHtml.indexOf("<figcaption");
        if (figCaptionIndex > -1) {
            const captionIndex = figureHtml.indexOf("<p ", figCaptionIndex);
            const labelIndex = figureHtml.indexOf(">", captionIndex) + 1;
            const label = figureHtml.slice(labelIndex, figureHtml.indexOf("</p>", labelIndex));
            if (/map/gi.test(label)) {
                const urlIndex = figureHtml.indexOf("https://static.wikia.nocookie.net/");
                if (urlIndex > -1) {
                    const revisionIndex = figureHtml.indexOf(revisionText, urlIndex);
                    if (revisionIndex > -1)
                    {
                        mapUrls.push(figureHtml.slice(urlIndex, revisionIndex + revisionText.length));
                        mapLabels.push(label);
                    }
                }
            }
        }
        figureIndex = html.indexOf("<figure", figureIndex + 1);
    }

    return mapUrls.length ? { mapUrl: mapUrls.join("|"), mapLabel: mapLabels.join("|") } : null;
}

function getConnections(html) {
    const ret = [];
    html = html.slice(html.indexOf("<b>Connecting Areas</b>"), html.indexOf("<b>BGM</b>"));
    const areas = html.split(/(?:<p>|<br \/>)<a href="/);
    let removed = false;

    if (areas.length > 1) {
        for (let a = 0; a < areas.length; a++) {
            const areaText = areas[a];
            if (a) {
                let connType = 0;
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
                if (areaText.indexOf(">LockedCondition<") > -1) {
                    connType |= ConnType.LOCKED_CONDITION;
                    if (areaText.indexOf("data-lock-params=\"") > -1) {
                        const paramsIndex = areaText.indexOf("data-lock-params=\"") + 18;
                        let paramsText = decodeHtml(areaText.slice(paramsIndex, areaText.indexOf("\"", paramsIndex)));
                        if (paramsText === "{{{3}}}")
                            paramsText = "";
                        else {
                            paramsText = paramsText.replace(/^Require(s|d) (to )?/, "").replace(/\.$/, "");
                            paramsText = paramsText.substring(0, 1).toUpperCase() + paramsText.slice(1);
                        }
                        if (paramsText) {
                            params[ConnType.LOCKED_CONDITION] = { params: paramsText };
                            if (areaText.indexOf("data-lock-params-jp=\"") > -1) {
                                const paramsJPIndex = areaText.indexOf("data-lock-params-jp=\"") + 21;
                                params[ConnType.LOCKED_CONDITION].paramsJP = decodeHtml(areaText.slice(paramsJPIndex, areaText.indexOf("\"", paramsJPIndex)));
                            }
                        }
                    }
                }
                if (areaText.indexOf(">Shortcut<") > -1)
                    connType |= ConnType.SHORTCUT;
                else if (areaText.indexOf(">ExitPoint<") > -1)
                    connType |= ConnType.EXIT_POINT;
                if (areaText.indexOf(">DeadEnd<") > -1)
                    connType |= ConnType.DEAD_END;
                else if (areaText.indexOf(">Return<") > -1)
                    connType |= ConnType.ISOLATED;
                if (areaText.indexOf("✨") > -1) {
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
                        let paramsText = areaText.slice(paramsIndex, areaText.indexOf("\"", paramsIndex)).trim();
                        if (paramsText.indexOf("%") > -1)
                            paramsText = paramsText.slice(0, paramsText.indexOf("%"));
                        if (/^[\d\.]+ ?(?:[\-\~]{1} ?[\d\.]+)?$/.test(paramsText))
                            params[ConnType.CHANCE] = { params: paramsText + "%" };
                    }
                }
                if (removed)
                    connType |= ConnType.INACCESSIBLE;
                ret.push({
                    location: unescape(decodeURI(areaText.slice(urlIndex, areaText.indexOf('"', urlIndex)).replace(/\_/g, " ").replace(/#.*/, ""))),
                    type: connType,
                    typeParams: params
                });
            }
            if (!removed && areaText.indexOf("<b>Removed Connections</b>") > -1)
                removed = true;
        }
    }
    
    return ret;
}

function getVerAdded(html) {
    const verAddedIndex = html.indexOf("data-ver-added=\"");
    if (verAddedIndex === -1)
        return null;
    const ret = html.slice(verAddedIndex + 16, html.indexOf("\"", verAddedIndex + 16));
    return ret !== "x.x" ? ret : null;
}

function getVerRemoved(html) {
    const verRemovedIndex = html.indexOf("data-ver-removed=\"");
    if (verRemovedIndex === -1)
        return null;
    return html.slice(verRemovedIndex + 18, html.indexOf("\"", verRemovedIndex + 18));
}

function getVerUpdated(html) {
    const verUpdatedIndex = html.indexOf("data-ver-updated=\"");
    if (verUpdatedIndex === -1)
        return null;
    return versionUtils.validateVersionsUpdated(html.slice(verUpdatedIndex + 18, html.indexOf("\"", verUpdatedIndex + 18)).replace(/, +/g, ","));
}

function getVerGaps(html) {
    const verGapsIndex = html.indexOf("data-ver-gaps=\"");
    if (verGapsIndex === -1)
        return null;
    return versionUtils.validateVersionGaps(html.slice(verGapsIndex + 15, html.indexOf("\"", verGapsIndex + 15)).replace(/, +/g, ","));
}

function decodeHtml(html) {
    return html.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}

app.post('/updateLocationVersions', function(req, res) {
    if (req.body.hasOwnProperty('adminKey') && req.body.adminKey === appConfig.ADMIN_KEY && req.body.hasOwnProperty('version') && req.body.hasOwnProperty('entries')) {
        const entries = req.body.entries;
        const getPageContent = [];
        const updateEntries = [];
        const updatedLocations = [];

        const request = superagent.agent();

        getCsrfToken(request).then(csrfToken => {
            for (let e = 0; e < entries.length; e++) {
                const entry = entries[e];
                getPageContent.push(
                    getLocationPageContent(entry.location).then(content => {
                        updateEntries.push(updateLocationPageVersionInfo(request, entry, content, req.body.version, req.body.user || 'Anonymous', csrfToken)
                            .then(success => success && updatedLocations.push(entry.location))
                            .catch(err => console.error(err)));
                    }).catch(err => console.error(err))
                );
            }
            Promise.allSettled(getPageContent).finally(() => {
                Promise.allSettled(updateEntries).finally(() => {
                    res.json({
                        success: true,
                        updatedLocations: updatedLocations
                    });
                });
            });
        }).catch(err => console.error(err));
    } else
        res.json({
            success: false
        });
});

function getLocationPageContent(location) {
    return new Promise((resolve, reject) => {
        const query = { action: 'query', titles: location, prop: 'revisions', rvslots: '*', rvprop: 'content', formatversion: 2, format: 'json' };
        superagent.get(apiUrl)
            .query(query)
            .end((err, res) => {
                if (err) return reject(err);
                const data = JSON.parse(res.text);
                resolve(data.query.pages[0].revisions[0].slots.main.content);
            });
    });
}

function updateLocationPageVersionInfo(request, entry, content, version, user, csrfToken) {
    return new Promise((resolve, reject) => {
        const versionUpdatedContent = getVersionUpdatedLocationContent(entry, content);
        const data = {
            action: 'edit',
            title: entry.location,
            summary: `Yume 2kki Explorer admin update for version ${version} on behalf of ${user}`,
            minor: true,
            bot: true,
            nocreate: true,
            text: versionUpdatedContent,
            token: csrfToken,
            format: 'json'
        };
        request.post(apiUrl)
            .type('form')
            .send(data)
            .then(res => {
                const data = JSON.parse(res.text);
                if (data.edit)
                    resolve(data.edit.result === 'Success');
                else if (data.error)
                    reject(data.error);
            }, err => reject(err));
    });
}

function getVersionMetadataPattern(paramName, isRemove) {
    const suffix = isRemove
        ? '(?:\\n|(?=\\||$))'
        : '(?=\\n|\\||$)';
    return new RegExp(`\\|${paramName}.*?${suffix}`);
}

function getVersionUpdatedLocationContent(entry, content) {
    const locationBoxSectionStartIndex = content.indexOf('{{') + 2;

    if (locationBoxSectionStartIndex < 2)
        return content;

    let locationBoxSectionEndIndex = locationBoxSectionStartIndex - 2;
    let braceDepth = 1;

    do {
        const braceOpenIndex = content.indexOf('{{', locationBoxSectionEndIndex + 2);
        const braceCloseIndex = content.indexOf('}}', locationBoxSectionEndIndex + 2);

        if (braceCloseIndex === -1)
            return content;

        if (braceOpenIndex > -1 && braceOpenIndex < braceCloseIndex) {
            braceDepth++;
            locationBoxSectionEndIndex = braceOpenIndex;
        } else {
            braceDepth--;
            locationBoxSectionEndIndex = braceCloseIndex;
        }
    } while (braceDepth);

    let locationBoxSection = content.slice(locationBoxSectionStartIndex, locationBoxSectionEndIndex);

    if (locationBoxSection.indexOf('|VersionAdded') > -1)
        locationBoxSection = locationBoxSection.replace(getVersionMetadataPattern('VersionAdded', !entry.verAdded), entry.verAdded ? `|VersionAdded = ${entry.verAdded}` : '');
    else if (entry.verAdded)
        locationBoxSection += `|VersionAdded = ${entry.verAdded}\n`;

    if (locationBoxSection.indexOf('|VersionsUpdated') > -1)
        locationBoxSection = locationBoxSection.replace(getVersionMetadataPattern('VersionsUpdated', !entry.verUpdated), entry.verUpdated ? `|VersionsUpdated = ${entry.verUpdated}` : '');
    else if (entry.verUpdated)
        locationBoxSection += `|VersionsUpdated = ${entry.verUpdated}\n`;

    if (locationBoxSection.indexOf('|VersionRemoved') > -1)
        locationBoxSection = locationBoxSection.replace(getVersionMetadataPattern('VersionRemoved', !entry.verRemoved), entry.verRemoved ? `|VersionRemoved = ${entry.verRemoved}` : '');
    else if (entry.verRemoved)
        locationBoxSection += `|VersionRemoved = ${entry.verRemoved}\n`;

    /*if (locationBoxSection.indexOf('|VersionGaps') > -1)
        locationBoxSection = locationBoxSection.replace(getVersionMetadataPattern('VersionGaps', !entry.verGaps), entry.verGaps ? `|VersionGaps = ${entry.verGaps}` : '');
    else if (entry.verGaps)
        locationBoxSection += `|VersionGaps = ${entry.verGaps}\n`;*/

    return `${content.slice(0, locationBoxSectionStartIndex)}${locationBoxSection}${content.slice(locationBoxSectionEndIndex)}`;
}

function getCsrfToken(request) {
    const query = {
        action: 'query',
        meta: 'tokens',
        format: 'json'
    };

    return new Promise((resolve, reject) => {
        sendLoginRequest(request).then(() => {
            request.get(apiUrl)
                .query(query)
                .end((err, res) => {
                    if (err) return reject(err);
                    const data = JSON.parse(res.text);
                    resolve(data.query.tokens.csrftoken);
                });
        }).catch(err => reject(err));
    });
}

function sendLoginRequest(request) {
    return new Promise((resolve, reject) => {
        getLoginToken(request).then(loginToken => {
            const data = {
                action: 'login',
                lgname: appConfig.BOT_USERNAME,
                lgpassword: appConfig.BOT_PASSWORD,
                lgtoken: loginToken,
                format: 'json'
            };
            request.post(apiUrl)
                .type('form')
                .send(data)
                .then(() => resolve(), err => reject(err));
        }).catch(err => reject(err));
    });
}

function getLoginToken(request) {
    const query = {
        action: 'query',
        meta: 'tokens',
        type: 'login',
        format: 'json'
    };

    return new Promise((resolve, reject) => {
        request.get(apiUrl)
            .query(query)
            .end((err, res) => {
                if (err) return reject(err);
                const data = JSON.parse(res.text);
                resolve(data.query.tokens.logintoken);
            });
    });
}

function updateWorldDataForChance(worldData) {
    const matchWorld = worldData.find(w => enc(w.title) === '00070001140010100110000990010400032000830011600114001010010100116');
    if (matchWorld)
        matchWorld.title = dec('65314652936531465313653246532400032653166532165325653176532665331653216532765326');
}

function enc(str) {
    return str.split('').map(s => (s.charCodeAt(0) + '').padStart(5, 0).slice(0, 5)).join('');
}

function dec(str) {
    let ret = '';
    for (let c = 0; c < str.length; c += 5)
        ret += String.fromCharCode(str.slice(c, c + 5));
    return ret;
}

app.listen(port, () => console.log(`Yume 2kki Explorer app listening on port ${port}`));