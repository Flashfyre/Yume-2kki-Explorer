const { Worker, isMainThread, parentPort } = require('worker_threads');

const express = require('express');
const app = isMainThread ? express() : null;
const port = 5000;
const _ = require('lodash');
const superagent = require('superagent');
const fs = require('fs');
const download = require('image-downloader');
const mysql = require('mysql');
const { performance } = require('perf_hooks');
const ConnType = require('./src/conn-type').ConnType;
const versionUtils = require('./src/version-utils');
const appConfig = process.env.ADMIN_KEY ?
    {
        ADMIN_KEY: process.env.ADMIN_KEY,
        BOT_USERNAME: process.env.BOT_USERNAME,
        BOT_PASSWORD: process.env.BOT_PASSWORD
    } : require('./config/app.config.js');
const apiUrl = 'https://yume.wiki/api.php';
const apiTitlePrefix = 'Yume 2kki:';
const isRemote = Boolean(process.env.DATABASE_NAME || process.env.DATABASE_URL);
const defaultPathIgnoreConnTypeFlags = ConnType.NO_ENTRY | ConnType.LOCKED | ConnType.DEAD_END | ConnType.ISOLATED | ConnType.LOCKED_CONDITION | ConnType.EXIT_POINT;
const minDepthPathIgnoreConnTypeFlags = ConnType.NO_ENTRY | ConnType.DEAD_END | ConnType.ISOLATED;
const startLocation = "Urotsuki's Room";

let dbInitialized = false;

let updateWorker = isMainThread ? new Worker('./app.js') : null;
let updating = false;
let updateTask = null;
var updateTaskStartTime;

function initConnPool() {
    let ret;
    if (isRemote) {
        if (process.platform === 'linux') {
            ret = mysql.createPool({
                socketPath: '/run/mysqld/mysqld.sock',
                user: process.env.DATABASE_USER,
                password: process.env.DATABASE_PASS,
                database: process.env.DATABASE_NAME,
                typeCast: handleTypeCasting
            });
        } else {
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
        }
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
                WHERE NOT EXISTS (SELECT 1 FROM updates)`
            )).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS worlds (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                titleJP VARCHAR(255) NULL,
                author VARCHAR(100) NULL,
                depth INT NOT NULL,
                minDepth INT NOT NULL,
                filename VARCHAR(255) NOT NULL,
                mapUrl VARCHAR(1000) NULL,
                mapLabel VARCHAR(1000) NULL,
                bgmUrl VARCHAR(2000) NULL,
                bgmLabel VARCHAR(1000) NULL,
                verAdded VARCHAR(20) NULL,
                verRemoved VARCHAR(20) NULL,
                verUpdated VARCHAR(1000) NULL,
                verGaps VARCHAR(255) NULL,
                fgColor VARCHAR(20) NULL,
                bgColor VARCHAR(20) NULL,
                removed BIT NOT NULL,
                secret BIT NOT NULL
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
            `CREATE TABLE IF NOT EXISTS world_images (
                id INT AUTO_INCREMENT PRIMARY KEY,
                worldId INT NOT NULL,
                filename VARCHAR(255) NOT NULL,
                ordinal SMALLINT NOT NULL
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS effects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                nameJP VARCHAR(255) NULL,
                worldId INT NULL,
                ordinal SMALLINT NOT NULL,
                filename VARCHAR(255) NOT NULL,
                method VARCHAR(2000) NULL,
                methodJP VARCHAR(1000) NULL,
                FOREIGN KEY (worldId)
                    REFERENCES worlds (id)
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
            `CREATE TABLE IF NOT EXISTS wallpapers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                wallpaperId INT NOT NULL,
                name VARCHAR(255) NULL,
                nameJP VARCHAR(255) NULL,
                worldId INT NULL,
                filename VARCHAR(255) NOT NULL,
                method VARCHAR(2000) NULL,
                methodJP VARCHAR(1000) NULL,
                removed BIT NOT NULL,
                FOREIGN KEY (worldId)
                    REFERENCES worlds (id)
                    ON DELETE CASCADE
            )`)).then(() => queryAsPromise(pool,
            `CREATE TABLE IF NOT EXISTS bgm_tracks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                trackNo SMALLINT NOT NULL,
                variant VARCHAR(1) NULL,
                name VARCHAR(255) NOT NULL,
                location VARCHAR(255) NULL,
                locationJP VARCHAR(255) NULL,
                worldId INT NULL,
                worldImageOrdinal SMALLINT NOT NULL,
                url VARCHAR(510) NULL,
                notes VARCHAR(2000) NULL,
                notesJP VARCHAR(1000) NULL,
                removed BIT NOT NULL,
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

function queryWithRetry(pool, query, callback, retryCount) {
    if (!retryCount)
        retryCount = 0;
    pool.query(query, (err, rows) => {
        if (err && ++retryCount < 20)
            setTimeout(() => queryWithRetry(pool, query, callback, retryCount), 1000);
        else
            callback(err, rows);
    });
}

if (isMainThread) {
    app.use(express.static('public'));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get('/', (_, res) => res.sendFile('index.html', { root: '.' }));

    app.get('/location', (_, res) => res.sendFile('location.html', { root: '.' }));

    app.get('/help', (_, res) => res.sendFile('README.md', { root: '.' }));

    app.get('/data', function(req, res) {
        getConnPool().then(pool => {
            getData(req, pool)
                .then(data => res.json(data))
                .catch(err => console.error(err))
                .finally(() => pool.end());
        }).catch(err => console.error(err));
    });

    app.get('/locationData', function(req, res) {
        getConnPool().then(pool => {
            getLocationData(req, pool)
                .then(data => res.json(data))
                .catch(err => console.error(err))
                .finally(() => pool.end());
        }).catch(err => console.error(err));
    });

    app.post('/checkUpdateData', function(_req, res) {
        getConnPool().then(pool => {
            const callback = function (update) {
                res.json({
                    update: update
                });
                pool.end();
            };
            pool.query('SELECT lastFullUpdate FROM updates WHERE DATE_ADD(lastFullUpdate, INTERVAL 1 WEEK) < NOW()', (err, rows) => {
                if (err) console.error(err);
                if (rows && rows.length)
                    callback('reset');
                else {
                    pool.query('SELECT lastUpdate FROM updates WHERE DATE_ADD(lastUpdate, INTERVAL 6 HOUR) < NOW()', (err, rows) => {
                        if (err) console.error(err);
                        callback(rows && rows.length);
                    });
                }
            });
        }).catch(err => console.error(err));
    });

    app.post('/updateData', function(req, res) {
        if (!updating) {
            updateWorker.postMessage({ reset: req.body.reset });
            setUpdateTask('init');
            updating = true;
        }

        res.end();
    });

    app.post('/pollUpdate', function (_req, res) {
        res.json({
            task: updateTask,
            done: !updating
        });
    });

    async function resetWorker() {
        if (!isMainThread) return;

        await updateWorker?.terminate();
        updateWorker = new Worker('./app.js');
        updateWorker.on('message', message => {
            if (message.hasOwnProperty('success')) {
                if (!message.success) 
                    console.warn(`Data update failed`); 
                updating = false;
                setUpdateTask(null);
            } else if (message.hasOwnProperty('updateTask'))
                setUpdateTask(message.updateTask);
        });
        updateWorker.on('error', err => {
            console.error(err);
            updating = false;
            setUpdateTask(null);
        });
        updateWorker.on('exit', code => {
            updating = false;
            setUpdateTask(null);
            if (code) {
                console.error(`Update thread exited code ${code}, restarting`);
                resetWorker();
            }
        });
    }

    resetWorker();
}

function getData(req, pool) {
    const excludeRemovedContent = !req.query.hasOwnProperty('includeRemovedContent') || !req.query.includeRemovedContent;
    return new Promise((resolve, reject) => {
        getWorldData(pool, false, excludeRemovedContent).then(worldData => {
            getAuthorInfoData(pool).then(authorInfoData => {
                getVersionInfoData(pool, worldData).then(versionInfoData => {
                    getEffectData(pool, worldData).then(effectData => {
                        getMenuThemeData(pool, worldData, excludeRemovedContent).then(menuThemeData => {
                            getWallpaperData(pool, worldData, excludeRemovedContent).then(wallpaperData => {
                                getBgmTrackData(pool, worldData, excludeRemovedContent).then(bgmTrackData => {
                                    pool.query('SELECT lastUpdate, lastFullUpdate FROM updates', (err, rows) => {
                                        if (err) reject(err);
                                        const row = rows && rows.length ? rows[0] : null;
                                        const lastUpdate = row ? row.lastUpdate : null;
                                        const lastFullUpdate = row ? row.lastFullUpdate : null;
                                        const isAdmin = req.query.hasOwnProperty('adminKey') && req.query.adminKey === appConfig.ADMIN_KEY;

                                        if (Math.random() * 255 < 1)
                                            updateWorldDataForChance(worldData);
                        
                                        resolve({
                                            worldData: worldData,
                                            authorInfoData: authorInfoData,
                                            versionInfoData: versionInfoData,
                                            effectData: effectData,
                                            menuThemeData: menuThemeData,
                                            wallpaperData: wallpaperData,
                                            bgmTrackData: bgmTrackData,
                                            lastUpdate: lastUpdate,
                                            lastFullUpdate: lastFullUpdate,
                                            isAdmin: isAdmin
                                        });
                                    });
                                }).catch(err => reject(err));
                            }).catch(err => reject(err));
                        }).catch(err => reject(err));
                    }).catch(err => reject(err));
                }).catch(err => reject(err));
            }).catch(err => reject(err));
        }).catch(err => reject(err));
    });
}

function getLocationData(req, pool) {
    return new Promise((resolve, reject) => {
        getLocationWorldData(pool, (req.query.locationNames || '').split('|').map(l => l.replace(/'/g, "''")), (req.query.hiddenConnLocationNames || '').split('|').map(l => l.replace(/'/g, "''"))).then(worldData => {
            getMaxWorldDepth(pool).then(maxDepth => {
                getAuthorInfoData(pool).then(authorInfoData => {
                    getVersionInfoData(pool, worldData).then(versionInfoData => {
                        getEffectData(pool, worldData).then(effectData => {
                            pool.query('SELECT lastUpdate, lastFullUpdate FROM updates', (err, rows) => {
                                if (err) reject(err);
                                const row = rows && rows.length ? rows[0] : null;
                                const lastUpdate = row ? row.lastUpdate : null;
                                const lastFullUpdate = row ? row.lastFullUpdate : null;
                
                                resolve({
                                    worldData: worldData,
                                    maxDepth: maxDepth,
                                    authorInfoData: authorInfoData,
                                    versionInfoData: versionInfoData,
                                    effectData: effectData,
                                    lastUpdate: lastUpdate,
                                    lastFullUpdate: lastFullUpdate
                                });
                            });
                        }).catch(err => reject(err));
                    }).catch(err => reject(err));
                }).catch(err => reject(err));
            }).catch(err => reject(err));
        }).catch(err => reject(err));
    });
}

function getWorldData(pool, preserveIds, excludeRemovedContent) {
    return new Promise((resolve, reject) => {
        const worldDataById = {};
        pool.query('SELECT id, title, titleJP, author, depth, minDepth, filename, mapUrl, mapLabel, bgmUrl, bgmLabel, verAdded, verRemoved, verUpdated, verGaps, removed FROM worlds' + (excludeRemovedContent ? ' WHERE removed = 0' : ''), (err, rows) => {
            if (err) return reject(err);
            for (let row of rows) {
                worldDataById[row.id] = {
                    id: row.id,
                    title: row.title,
                    titleJP: row.titleJP,
                    author: row.author,
                    depth: row.depth,
                    minDepth: row.minDepth,
                    filename: row.filename,
                    mapUrl: row.mapUrl,
                    mapLabel: row.mapLabel,
                    bgmUrl: row.bgmUrl,
                    bgmLabel: row.bgmLabel,
                    verAdded: row.verAdded,
                    verRemoved: row.verRemoved,
                    verUpdated: row.verUpdated,
                    verGaps: row.verGaps,
                    removed: !!row.removed,
                    connections: [],
                    images: []
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
                        world.filename = `./images/worlds/${world.filename.slice(0, world.filename.indexOf('|'))}`;
                }
            }
            
            pool.query('SELECT id, sourceId, targetId, type FROM conns', (err, rows) => {
                if (err) return reject(err);
                const connsById = {};
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

                    pool.query('SELECT wi.id, wi.worldId, wi.filename FROM world_images wi ' + (excludeRemovedContent ? ' JOIN worlds w ON w.id = wi.worldId AND w.removed = 0 ' : '') + 'ORDER BY wi.worldId, wi.ordinal', (err, rows) => {
                        if (err) return reject(err);
                        for (let row of rows) {
                            if (worldDataById[row.worldId])
                                worldDataById[row.worldId].images.push(row.filename);
                        }

                        pool.query('SELECT w.id, ROUND(SUM((m.width * m.height) / mwm.worldCount)) AS size FROM world_maps wm JOIN worlds w ON w.id = wm.worldId' + (excludeRemovedContent ? ' AND w.removed = 0' : '')
                            + ' JOIN maps m ON m.id = wm.mapId JOIN (SELECT mw.mapId, COUNT(DISTINCT mw.worldId) worldCount FROM world_maps mw JOIN worlds mww ON mww.id = mw.worldId' + (excludeRemovedContent ? ' WHERE mww.removed = 0' : '')
                            + ' GROUP BY mw.mapId) mwm ON mwm.mapId = m.id GROUP BY w.id', (err, rows) => {
                            if (err) return reject(err);
                            for (let row of rows) {
                                if (worldDataById[row.id])
                                    worldDataById[row.id].size = row.size;
                            }
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
    });
}

function getLocationWorldData(pool, locationNames, hiddenConnLocationNames) {
    return new Promise((resolve, reject) => {
        const worldDataById = {};
        pool.query(`SELECT id, title, titleJP, author, depth, minDepth, filename, mapUrl, mapLabel, bgmUrl, bgmLabel, verAdded, verRemoved, verUpdated, verGaps, removed FROM worlds WHERE title IN ('${locationNames.join(`', '`)}') AND removed = 0`, (err, rows) => {
            if (err) return reject(err);
            if (!rows.length) {
                resolve([]);
                return;
            }

            const getWorldFromRow = row => {
                return {
                    id: row.id,
                    title: row.title,
                    titleJP: row.titleJP,
                    author: row.author,
                    depth: row.depth,
                    minDepth: row.minDepth,
                    filename: row.filename,
                    mapUrl: row.mapUrl,
                    mapLabel: row.mapLabel,
                    bgmUrl: row.bgmUrl,
                    bgmLabel: row.bgmLabel,
                    verAdded: row.verAdded,
                    verRemoved: row.verRemoved,
                    verUpdated: row.verUpdated,
                    verGaps: row.verGaps,
                    removed: !!row.removed,
                    connections: [],
                    images: [],
                    size: 1,
                    noMaps: true,
                    hidden: false,
                    secret: !!row.secret
                };
            };

            for (let row of rows)
                worldDataById[row.id] = getWorldFromRow(row);

            const worldIdsClause = Object.keys(worldDataById).join(', ');

            pool.query(`SELECT w.id, w.title, w.titleJP, w.author, w.depth, w.minDepth, w.filename, w.mapUrl, w.mapLabel, w.bgmUrl, w.bgmLabel, w.verAdded, w.verRemoved, w.verUpdated, w.verGaps, w.removed, w.secret
                FROM worlds w
                JOIN conns c ON c.targetId = w.id AND c.sourceId IN (${worldIdsClause})
                WHERE w.removed = 0`, (err, rows) => {
                if (err) return reject(err);

                for (let row of rows) {
                    const connWorld = getWorldFromRow(row);
                    if (hiddenConnLocationNames.indexOf(connWorld.title) > -1) {
                        if (connWorld.secret)
                            continue;
                        connWorld.hidden = true;
                    }
                    worldDataById[row.id] = connWorld;
                }

                const worldData = Object.values(worldDataById);

                 for (let d in worldData) {
                    const world = worldData[d];
                    world.id = parseInt(d);
                    if (!world.author)
                        world.author = '';
                    if (world.verUpdated)
                        world.verUpdated = versionUtils.parseVersionsUpdated(world.verUpdated);
                    if (world.verGaps)
                        world.verGaps = versionUtils.parseVersionGaps(world.verGaps);
                    if (!isRemote && world.filename.indexOf('|') > -1)
                        world.filename = `./images/worlds/${world.filename.slice(0, world.filename.indexOf('|'))}`;
                }

                pool.query(`SELECT c.id, c.sourceId, c.targetId, c.type
                    FROM conns c
                    WHERE c.sourceId IN (${worldIdsClause}) OR c.targetId IN (${worldIdsClause})`, (err, rows) => {
                    if (err) return reject(err);
                    const connsById = {};
                    for (let row of rows) {
                        if (row.type & ConnType.INACCESSIBLE)
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
                        sourceWorld.connections.push(conn);
                    }

                    pool.query(`SELECT ctp.connId, ctp.type, ctp.params, ctp.paramsJP FROM conn_type_params ctp JOIN conns c ON c.id = ctp.connId WHERE c.sourceId IN (${worldIdsClause}) OR c.targetId IN (${worldIdsClause})`, (err, rows) => {
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

                        resolve(worldData);
                    });
                });
            });
        });
    });
}

function getMaxWorldDepth(pool) {
    return new Promise((resolve, reject) => {
        pool.query('SELECT MAX(depth) AS maxDepth FROM worlds WHERE removed = 0', (err, rows) => {
            if (err) return reject(err);
            if (rows.length) {
                resolve(rows[0].maxDepth);
                return;
            }
            
            resolve(0);
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

function getEffectData(pool, worldData) {
    return new Promise((resolve, reject) => {
        const effectDataById = {};
        pool.query('SELECT e.id, e.name, e.nameJP, w.title, e.ordinal, e.filename, e.method, e.methodJP FROM effects e LEFT JOIN worlds w ON w.id = e.worldId ORDER BY e.ordinal', (err, rows) => {
            if (err) return reject(err);
            const worldDataByName = _.keyBy(worldData, w => w.title);
            for (let row of rows) {
                const world = row.title ? worldDataByName[row.title] : null;
                effectDataById[row.id] = {
                    id: row.id,
                    name: row.name,
                    nameJP: row.nameJP,
                    worldId: world ? world.id : null,
                    ordinal: row.ordinal,
                    filename: row.filename,
                    method: row.method,
                    methodJP: row.methodJP
                };
            }

            resolve(_.sortBy(Object.values(effectDataById), e => e.ordinal));
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
            
            pool.query('SELECT l.menuThemeId, w.title, l.method, l.methodJP, l.filename, l.removed FROM menu_theme_locations l LEFT JOIN worlds w ON w.id = l.worldId' + (excludeRemovedContent ? ' WHERE l.removed = 0' : ''), (err, rows) => {
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

function getWallpaperData(pool, worldData, excludeRemovedContent) {
    return new Promise((resolve, reject) => {
        const wallpaperDataById = {};
        pool.query('SELECT wp.id, wp.wallpaperId, wp.name, wp.nameJP, w.title, wp.filename, wp.method, wp.methodJP, wp.removed FROM wallpapers wp LEFT JOIN worlds w ON w.id = wp.worldId' + (excludeRemovedContent ? ' WHERE wp.removed = 0' : ''), (err, rows) => {
            if (err) return reject(err);
            const worldDataByName = _.keyBy(worldData, w => w.title);
            for (let row of rows) {
                const world = row.title ? worldDataByName[row.title] : null;
                wallpaperDataById[row.id] = {
                    id: row.id,
                    wallpaperId: row.wallpaperId,
                    name: row.name,
                    nameJP: row.nameJP,
                    worldId: world ? world.id : null,
                    filename: row.filename,
                    method: row.method,
                    methodJP: row.methodJP,
                    removed: row.removed
                };
            }

            resolve(_.sortBy(Object.values(wallpaperDataById), wp => wp.wallpaperId));
        });
    });
}

function getBgmTrackData(pool, worldData, excludeRemovedContent) {
    return new Promise((resolve, reject) => {
        const bgmTrackDataById = {};
        pool.query('SELECT t.id, t.trackNo, t.variant, t.name, t.location, t.locationJP, w.title, t.worldImageOrdinal, t.url, t.notes, t.notesJP, t.removed FROM bgm_tracks t LEFT JOIN worlds w ON w.id = t.worldId' + (excludeRemovedContent ? ' WHERE t.removed = 0' : ''), (err, rows) => {
            if (err) return reject(err);
            const worldDataByName = _.keyBy(worldData, w => w.title);
            for (let row of rows) {
                const world = row.title ? worldDataByName[row.title] : null;
                bgmTrackDataById[row.id] = {
                    id: row.id,
                    trackNo: row.trackNo,
                    variant: row.variant,
                    name: row.name,
                    location: row.location,
                    locationJP: row.locationJP,
                    worldId: world ? world.id : null,
                    worldImageOrdinal: row.worldImageOrdinal,
                    url: row.url,
                    notes: row.notes,
                    notesJP: row.notesJP,
                    removed: row.removed
                };
            }

            resolve(_.sortBy(Object.values(bgmTrackDataById), [ 'trackNo', 'variant' ]));
        });
    });
}

function getUpdatedWorldNames(worldNames, lastUpdate) {
    return new Promise((resolve, reject) => {
        const recentChanges = [];
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
                for (let change of changes) {
                    if (change.title.startsWith(apiTitlePrefix))
                        recentChanges.push(change);
                }
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
            .query({ action: 'query', titles: `${apiTitlePrefix}${pageTitle}`, prop: 'revisions', format: 'json' })
            .end((err, res) => {
                if (err) return reject(err);
                const data = JSON.parse(res.text);
                const pages = data.query.pages;
                const pageIds = Object.keys(pages);
                if (pageIds.length) {
                    for (let pageId of pageIds) {
                        const page = pages[pageId];
                        if (page.hasOwnProperty('missing'))
                            continue;
                        const revisions = page.revisions;
                        if (revisions.length) {
                            const revDate = new Date(revisions[0].timestamp);
                            if (lastUpdate < revDate) {
                                resolve(true);
                                return;
                            }
                        }
                    }
                }
                resolve(false);
            });
    });
}

function checkUpdateMapData(pool, worldData, lastUpdate) {
    return new Promise((resolve, reject) => {
        checkUpdatePage("Map IDs/0000-0400|Map IDs/0401-0800|Map IDs/0801-1200|Map IDs/1201-1600|Map IDs/1601-2000|Map IDs/2001-2400|Map IDs/2401-2800|Map IDs/2801-3200", lastUpdate).then(needsUpdate => {
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

function checkUpdateEffectData(pool, worldData, lastUpdate) {
    return new Promise((resolve, reject) => {
        checkUpdatePage("Effects", lastUpdate).then(needsUpdate => {
            if (needsUpdate)
                updateEffectData(pool, worldData).then(() => resolve()).catch(err => reject(err));
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

function checkUpdateWallpaperData(pool, worldData, lastUpdate) {
    return new Promise((resolve, reject) => {
        checkUpdatePage("Wallpaper_Guide", lastUpdate).then(needsUpdate => {
            if (needsUpdate)
                updateWallpaperData(pool, worldData).then(() => resolve()).catch(err => reject(err));
            else
                resolve();
        }).catch(err => reject(err));
    });
}

function checkUpdateBgmTrackData(pool, worldData, lastUpdate) {
    return new Promise((resolve, reject) => {
        checkUpdatePage("Soundtrack/001-100|Soundtrack/101-200|Soundtrack/201-300|Soundtrack/301-400|Soundtrack/401-500|Soundtrack/501-600|Soundtrack/601-700|Soundtrack/701-800|Soundtrack/801-900|Soundtrack/901-1000|Soundtrack/Miscellaneous", lastUpdate).then(needsUpdate => {
            if (needsUpdate)
                updateBgmTrackData(pool, worldData).then(() => resolve()).catch(err => reject(err));
            else
                resolve();
        }).catch(err => reject(err));
    });
}

function populateWorldData(pool, worldData, updatedWorldNames) {
    if (!worldData)
        worldData = [];
    return new Promise((resolve, reject) => {
        setUpdateTask('fetchWorldData');
        const fetchWorldData = continueKey => {
            superagent.get(`https://wrapper.yume.wiki/locations?game=2kki${continueKey ? `&continueKey=${continueKey}` : ''}`, (err, res) => {
                if (err) return reject(err);
                const data = JSON.parse(res.text);

                for (let l of data.locations) {
                    const encodedFilename = encodeURI(l.locationImage);
                    let filename = encodedFilename;

                    if (!isRemote && filename) {
                        const ext = filename.slice(filename.lastIndexOf('.'));
                        const localFilename = `${l.title}${ext}`;
                        filename = `${localFilename}|${filename}`;
                        try {
                            if (!fs.existsSync(`./public/images/worlds/${localFilename}`))
                                downloadImage(encodedFilename, localFilename)
                                    .catch(err => reject(err));
                        } catch (err) {
                            reject(err);
                        }
                    }

                    worldData.push({
                        title: l.title,
                        titleJP: l.originalName,
                        connections: [],
                        filename: filename,
                        author: l.primaryAuthor,
                        bgColor: l.backgroundColor,
                        fgColor: l.fontColor,
                        bgmUrl: l.bgms.length ? l.bgms.map(b => b.path).join('|') : null,
                        bgmLabel: l.bgms.length ? l.bgms.map(b => `${b.title || ''}^${b.label || ''}`).join('|') : null,
                        mapUrl: l.locationMaps.length ? l.locationMaps.map(l => l.path).join('|') : null,
                        mapLabel: l.locationMaps.length ? l.locationMaps.map(l => l.caption).join('|') : null,
                        verAdded: l.versionAdded,
                        verUpdated: l.versionUpdated,
                        verGaps: l.versionGaps.length ? l.versionGaps.join(',') : null,
                        verRemoved: l.versionRemoved || null,
                        removed: !!l.versionRemoved
                    });
                }

                if (data.continueKey)
                    fetchWorldData(data.continueKey);
                else {
                    populateWorldConnData(worldData).then(() => {
                        updateWorlds(pool, worldData).then(() => {
                            updateConns(pool, _.keyBy(worldData, w => w.title)).then(() => {
                                updateConnTypeParams(pool, worldData).then(() => {
                                    updateWorldImages(pool, worldData, updatedWorldNames).then(() => {
                                        updateWorldDepths(pool, _.sortBy(worldData, [ 'id' ])).then(() => {
                                            deleteRemovedWorlds(pool).then(() => resolve(worldData));
                                        });
                                    });
                                });
                            });
                        });
                    }).catch(err => reject(err));
                }
            });
        };
        fetchWorldData();
    });
}

function populateWorldConnData(worldData) {
    const worldDataByName = _.keyBy(worldData, w => w.title);
    return new Promise((resolve, reject) => {
        setUpdateTask('fetchConnData');
        const fetchConnData = continueKey => {
            superagent.get(`https://wrapper.yume.wiki/connections?game=2kki${continueKey ? `&continueKey=${continueKey}` : ''}`, (err, res) => {
                if (err) return reject(err);
                const data = JSON.parse(res.text);
                
                for (let conn of data.connections) {
                    if (worldDataByName[conn.origin] && !conn.isRemoved)
                        worldDataByName[conn.origin].connections.push(parseWorldConn(conn));
                }

                if (data.continueKey)
                    fetchConnData(data.continueKey);
                else
                    resolve();
            });
        };
        fetchConnData();
    });
}

function parseWorldConn(conn) {
    const ret = {
        location: conn.destination,
        type: 0,
        typeParams: {}
    };

    for (let attr of conn.attributes) {
        switch (attr) {
            case "No Return":
                ret.type |= ConnType.ONE_WAY;
                break;
            case "No Entry":
                ret.type |= ConnType.NO_ENTRY;
                break;
            case "Unlockable":
                ret.type |= ConnType.UNLOCK;
                break;
            case "Locked":
                ret.type |= ConnType.LOCKED;
                break;
            case "Conditional":
                ret.type |= ConnType.LOCKED_CONDITION;
                let conditionText = conn.unlockCondition.replace(/^Require(s|d) (to )?/, "").replace(/\.$/, "");
                conditionText = conditionText.substring(0, 1).toUpperCase() + conditionText.slice(1);
                ret.typeParams[ConnType.LOCKED_CONDITION] = { params: conditionText };
                break;
            case "Shortcut":
                ret.type |= ConnType.SHORTCUT;
                break;
            case "Exit Point":
                ret.type |= ConnType.EXIT_POINT;
                break;
            case "Dead End":
                ret.type |= ConnType.DEAD_END;
                break;
            case "Needs Effect":
                ret.type |= ConnType.EFFECT;
                ret.typeParams[ConnType.EFFECT] = { params: conn.effectsNeeded.join(',') };
                break;
            case "Chance":
                ret.type |= ConnType.CHANCE;
                // TODO: Implement chanceDescription
                ret.typeParams[ConnType.CHANCE] = { params: conn.chancePercentage };
                break;
            case "Seasonal":
                ret.type |= ConnType.SEASONAL;
                const connSeason = conn.seasonAvailable;
                let connSeasonJP;
                switch (conn.seasonAvailable) {
                    case "Spring":
                        connSeasonJP = "春";
                        break;
                    case "Summer":
                        connSeasonJP = "夏";
                        break;
                    case "Fall":
                        connSeasonJP = "秋";
                        break;
                    case "Winter":
                        connSeasonJP = "冬";
                        break;
                }
                ret.typeParams[ConnType.SEASONAL] = { params: connSeason, paramsJP: connSeasonJP };
                break;
        }
    }

    return ret;
}

function updateWorldInfo(pool, world) {
    return new Promise((resolve, reject) => {
        const titleJPValue = world.titleJP ? `'${world.titleJP}'` : 'NULL';
        const authorValue = world.author ? `'${world.author}'` : 'NULL';
        const mapUrlValue = world.mapUrl ? `'${world.mapUrl.replace(/'/g, "''")}'` : 'NULL';
        const mapLabelValue = world.mapLabel ? `'${world.mapLabel.replace(/'/g, "''")}'` : 'NULL';
        const bgmUrlValue = world.bgmUrl ? `'${world.bgmUrl.replace(/'/g, "''")}'` : 'NULL';
        const bgmLabelValue = world.bgmLabel ? `'${world.bgmLabel.replace(/'/g, "''")}'` : 'NULL';
        const verAddedValue = world.verAdded ? `'${world.verAdded}'` : 'NULL';
        const verRemovedValue = world.verRemoved ? `'${world.verRemoved}'` : 'NULL';
        const verUpdatedValue = world.verUpdated ? `'${world.verUpdated}'` : 'NULL';
        const verGapsValue = world.verGaps ? `'${world.verGaps}'` : 'NULL';
        const fgColorValue = world.fgColor ? `'${world.fgColor}'` : 'NULL';
        const bgColorValue = world.bgColor ? `'${world.bgColor}'` : 'NULL';
        const removedValue = world.removed ? '1' : '0';
        if (world.filename)
            pool.query(`UPDATE worlds SET titleJP=${titleJPValue}, author=${authorValue}, filename='${world.filename.replace(/'/g, "''")}', mapUrl=${mapUrlValue}, mapLabel=${mapLabelValue}, bgmUrl=${bgmUrlValue}, bgmLabel=${bgmLabelValue}, verAdded=${verAddedValue}, verRemoved=${verRemovedValue}, verUpdated=${verUpdatedValue}, verGaps=${verGapsValue}, fgColor=${fgColorValue}, bgColor=${bgColorValue}, removed=${removedValue} WHERE id=${world.id}`,
            (err, _) => {
                if (err) return reject(err);
                resolve();
            });
        else
            reject(`Invalid world image URL for world '${world.title}'`);
    });
}

function updateWorlds(pool, worldData) {
    const newWorldsByName = _.keyBy(Object.values(worldData), w => w.title);
    const updatedWorlds = [];
    const worldNames = Object.keys(newWorldsByName);

    return new Promise((resolve, reject) => {
        setUpdateTask('updateWorldData');
        pool.query('SELECT id, title, titleJP, author, filename, mapUrl, mapLabel, bgmUrl, bgmLabel, verAdded, verRemoved, verUpdated, verGaps, fgColor, bgColor, removed FROM worlds', (err, rows) => {
            if (err) return reject(err);
            for (let row of rows) {
                const worldName = row.title;
                if (worldNames.indexOf(worldName) > -1) {
                    const world = newWorldsByName[worldName];
                    world.id = row.id;
                    if (row.titleJP !== world.titleJP || row.author !== world.author || row.filename !== world.filename ||
                        row.mapUrl !== world.mapUrl || row.mapLabel !== world.mapLabel ||
                        row.bgmUrl !== world.bgmUrl || row.bgmLabel !== world.bgmLabel ||
                        row.verAdded !== world.verAdded || row.verRemoved !== world.verRemoved ||
                        row.verUpdated !== world.verUpdated || row.verGaps !== world.verGaps ||
                        row.fgColor !== world.fgColor || row.bgColor !== world.bgColor || row.removed !== world.removed)
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
                let worldsQuery = 'INSERT INTO worlds (title, titleJP, author, depth, minDepth, filename, mapUrl, mapLabel, bgmUrl, bgmLabel, verAdded, verRemoved, verUpdated, verGaps, fgColor, bgColor, removed, secret) VALUES ';
                for (const w in newWorldsByName) {
                    const newWorld = newWorldsByName[w];
                    if (i++)
                        worldsQuery += ", ";
                    const title = newWorld.title.replace(/'/g, "''");
                    const titleJPValue = newWorld.titleJP ? `'${newWorld.titleJP}'` : 'NULL';
                    const authorValue = newWorld.author ? `'${newWorld.author}'` : 'NULL';
                    const mapUrlValue = newWorld.mapUrl ? `'${newWorld.mapUrl.replace(/'/g, "''")}'` : 'NULL';
                    const mapLabelValue = newWorld.mapLabel ? `'${newWorld.mapLabel.replace(/'/g, "''")}'` : 'NULL';
                    const bgmUrlValue = newWorld.bgmUrl ? `'${newWorld.bgmUrl.replace(/'/g, "''")}'` : 'NULL';
                    const bgmLabelValue = newWorld.bgmLabel ? `'${newWorld.bgmLabel.replace(/'/g, "''")}'` : 'NULL';
                    const verAddedValue = newWorld.verAdded ? `'${newWorld.verAdded}'` : 'NULL';
                    const verRemovedValue = newWorld.verRemoved ? `'${newWorld.verRemoved}'` : 'NULL';
                    const verUpdatedValue = newWorld.verUpdated ? `'${newWorld.verUpdated}'` : 'NULL';
                    const verGapsValue = newWorld.verGaps ? `'${newWorld.verGaps}'` : 'NULL';
                    const fgColorValue = newWorld.fgColor ? `'${newWorld.fgColor}'` : 'NULL';
                    const bgColorValue = newWorld.bgColor ? `'${newWorld.bgColor}'` : 'NULL';
                    const removedValue = newWorld.removed ? '1' : '0';
                    worldsQuery += `('${title}', ${titleJPValue}, ${authorValue}, 0, 0, '${newWorld.filename.replace(/'/g, "''")}', ${mapUrlValue}, ${mapLabelValue}, ${bgmUrlValue}, ${bgmLabelValue}, ${verAddedValue}, ${verRemovedValue}, ${verUpdatedValue}, ${verGapsValue}, ${fgColorValue}, ${bgColorValue}, ${removedValue}, 0)`;
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
    });
}

function updateConns(pool, worldDataByName) {
    return new Promise((resolve, reject) => {
        setUpdateTask('updateConns');
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
        if (c.id)
            newConnTypeParams[c.id] = c.typeParams;
    });
    const updatedConnTypeParams = [];
    const removedConnTypeParamIds = [];
    return new Promise((resolve, reject) => {
        setUpdateTask('updateConnTypeParams');
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

function updateWorldImages(pool, worldData, updatedWorldNames) {
    return new Promise((resolve, reject) => {
        getAllWorldImageData(worldData, updatedWorldNames).then(worldImageData => {
            setUpdateTask('updateWorldImageData');
            pool.query('SELECT wi.id, wi.worldId, w.title, wi.filename, wi.ordinal FROM world_images wi JOIN worlds w ON w.id = wi.worldId', (err, rows) => {
                if (err) return reject(err);
                const worldImageDataByWorldImageId = _.keyBy(worldImageData, wi => `${wi.worldId}_${wi.filename}`);
                const newWorldImagesByWorldImageId = _.keyBy(worldImageData, wi => `${wi.worldId}_${wi.filename}`);
                const updatedWorldImages = [];
                const removedWorldImageIds  = [];
                for (let row of rows) {
                    const worldImageId = `${row.worldId}_${row.filename}`;
                    if (worldImageDataByWorldImageId.hasOwnProperty(worldImageId)) {
                        const worldImage = worldImageDataByWorldImageId[worldImageId];
                        worldImage.id = row.id;
                        if (row.ordinal !== worldImage.ordinal) {
                            worldImage.oldOrdinal = row.ordinal;
                            updatedWorldImages.push(worldImage);
                        }
                    } else if (!updatedWorldNames || updatedWorldNames.indexOf(row.title) > -1)
                        removedWorldImageIds.push(row.id);
                    delete newWorldImagesByWorldImageId[worldImageId];
                }
    
                const insertCallback = function () {
                    if (updatedWorldImages.length) {
                        const updateWorldImages = [];
                        for (let worldImage of updatedWorldImages)
                            updateWorldImages.push(updateWorldImage(pool, worldImage).catch(err => console.error(err)));
                        Promise.allSettled(updateWorldImages).finally(() => resolve());
                    } else
                        resolve();
                };
    
                const callback = function () {
                    const newWorldImageIds = Object.keys(newWorldImagesByWorldImageId);
                    if (newWorldImageIds.length) {
                        let i = 0;
                        let worldImagesQuery = 'INSERT INTO world_images (worldId, filename, ordinal) VALUES ';
                        for (let wi in newWorldImagesByWorldImageId) {
                            const newWorldImage = newWorldImagesByWorldImageId[wi];
                            if (i++)
                                worldImagesQuery += ", ";
                            const worldId = newWorldImage.worldId;
                            const filename = newWorldImage.filename;
                            const ordinal = newWorldImage.ordinal;
                            worldImagesQuery += `(${worldId}, '${filename}', ${ordinal})`;
                        }
                        pool.query(worldImagesQuery, (err, res) => {
                            if (err) return reject(err);
                            const insertedRows = res.affectedRows;
                            const worldImageRowIdsQuery = `SELECT r.id FROM (SELECT id FROM world_images ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                            pool.query(worldImageRowIdsQuery, (err, rows) => {
                                if (err) return reject(err);
                                for (let r in rows)
                                    newWorldImagesByWorldImageId[newWorldImageIds[r]].id = rows[r].id;
                                insertCallback();
                            });
                        });
                    } else
                        insertCallback();
                };
    
                if (removedWorldImageIds.length)
                    deleteRemovedWorldImages(pool, removedWorldImageIds).then(() => callback()).catch(err => reject(err));
                else
                    callback();
            });
        }).catch(err => reject(err));
    });
}

function getAllWorldImageData(worldData, updatedWorldNames) {
    const worldDataByName = _.keyBy(worldData, w => w.title);
    return new Promise((resolve) => {
        setUpdateTask('fetchWorldImageData');
        const fetchWorldImageData = (worldImageData, continueKey) => {
            superagent.get(`https://wrapper.yume.wiki/images?game=2kki${continueKey ? `&continueKey=${continueKey}` : ''}`, (err, res) => {
                if (err) return reject(err);
                if (!worldImageData)
                    worldImageData = [];
                const data = JSON.parse(res.text);

                for (let locationImage of data.locationImages) {
                    if (updatedWorldNames && updatedWorldNames.indexOf(locationImage.title) === -1)
                        continue;
                    const world = worldDataByName[locationImage.title];
                    if (!world)
                        continue;
                    let i = 0;
                    for (let image of locationImage.images) {
                        let filename = world.filename;
                        if (filename.indexOf('|') > -1)
                            filename = filename.slice(filename.indexOf('|') + 1);
                        const baseImageUrl = image.url.indexOf('/thumb') > -1
                            ? image.url.slice(0, image.url.lastIndexOf('/')).replace('/thumb', '')
                            : image.url;
                        if (baseImageUrl === filename)
                            continue;
                        const aspectRatio = image.width / image.height;
                        if (aspectRatio < 1.25 || aspectRatio > 1.4)
                            continue;
                        
                        worldImageData.push({
                            worldId: worldDataByName[locationImage.title].id,
                            ordinal: ++i,
                            filename: image.url
                        });
                    }
                }

                if (data.continueKey)
                    fetchWorldImageData(worldImageData, data.continueKey);
                else
                    resolve(worldImageData);
            });
        };
        fetchWorldImageData();
    });
}

function updateWorldImage(pool, worldImage) {
    return new Promise((resolve, reject) => {
        pool.query(`UPDATE bgm_tracks SET worldImageOrdinal=${worldImage.ordinal} WHERE worldId=${worldImage.worldId} AND worldImageOrdinal=${worldImage.oldOrdinal}`, (err, _) => {
            if (err) return reject(err);
            pool.query(`UPDATE world_images SET ordinal=${worldImage.ordinal} WHERE id=${worldImage.id}`, (err, _) => {
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

function deleteRemovedWorldImages(pool, removedWorldImageIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteWorldImagesQuery = 'DELETE FROM world_images WHERE id IN (';
        for (let worldImageId of removedWorldImageIds) {
            if (i++)
                deleteWorldImagesQuery += ', ';
            deleteWorldImagesQuery += worldImageId;
        }
        deleteWorldImagesQuery += ')';
        pool.query(deleteWorldImagesQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function updateWorldDepths(pool, worldData) {
    return new Promise((resolve, reject) => {
        setUpdateTask('updateWorldDepths');

        const depthMap = {};
        const minDepthMap = {};

        for (let world of worldData) {
            depthMap[world.title] = -1;
            minDepthMap[world.title] = -1;
        }

        const worldDataById = _.keyBy(worldData, w => w.id);

        calcDepth(worldData, worldDataById, depthMap, null, 0, defaultPathIgnoreConnTypeFlags, 'depth');
        calcDepth(worldData, worldDataById, minDepthMap, null, 0, minDepthPathIgnoreConnTypeFlags, 'minDepth');

        const worldsByDepth = _.groupBy(worldData, 'depth');
        const worldsByMinDepth = _.groupBy(worldData, 'minDepth');

        if (Object.keys(worldsByDepth).length) {
            const updateWorldsOfDepths = [];
            const worldDepths = Object.keys(worldsByDepth);
            const worldMinDepths = Object.keys(worldsByMinDepth);
            for (let depth of worldDepths)
                updateWorldsOfDepths.push(updateWorldsOfDepth(pool, depth, worldsByDepth[depth]));
            for (let minDepth of worldMinDepths)
                updateWorldsOfDepths.push(updateWorldsOfDepth(pool, minDepth, worldsByMinDepth[minDepth], true));
            Promise.all(updateWorldsOfDepths).then(() => resolve()).catch(err => reject(err));
        } else
            resolve();
    });
}

function calcDepth(worldData, worldDataById, depthMap, world, depth, ignoreTypeFlags, depthProp, targetWorldName, removed) {
    const worldDataByName = _.keyBy(worldData, w => w.title);
    const worldNames = Object.keys(worldDataByName);
    let currentWorld;
    if (depth > 0)
        currentWorld = world;
    else {
        currentWorld = worldDataByName[startLocation];
        currentWorld[depthProp] = depthMap[currentWorld.title] = depth;
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
                connWorld[depthProp] = depthMap[w] = depth + 1;
                if (!targetWorldName)
                    calcDepth(worldData, worldDataById, depthMap, connWorld, depth + 1, ignoreTypeFlags, depthProp, null, removed || connWorld.removed);
            }
        }
    }

    if (world === null) {
        const worldDataByName = _.keyBy(worldData, w => w.title);

        let anyDepthFound;
        
        while (true) {
            anyDepthFound = false;
            
            missingDepthWorlds = worldData.filter(w => depthMap[w.title] === -1 && w.title !== startLocation);
            missingDepthWorlds.forEach(w => anyDepthFound |= resolveMissingDepths(worldData, worldDataById, worldDataByName, depthMap, w, ignoreTypeFlags, depthProp));

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
            if (world[depthProp] === undefined)
                world[depthProp] = 1;
        }
    }

    return depth;
}

function resolveMissingDepths(worldData, worldDataById, worldDataByName, depthMap, world, ignoreTypeFlags, depthProp) {
    const worldNames = Object.keys(worldDataByName);
    const conns = world.connections.filter(c => c.targetId ? worldDataById[c.targetId] : worldNames.indexOf(c.location) > -1);

    for (let c of conns) {
        let sourceWorld = c.targetId ? worldDataById[c.targetId] : worldDataByName[c.location];
        if (!sourceWorld.removed && c.type & ConnType.INACCESSIBLE)
            continue;
        if (sourceWorld[depthProp] !== undefined)
            calcDepth(worldData, worldDataById, depthMap, sourceWorld, depthMap[sourceWorld.title], ignoreTypeFlags, depthProp, world.title, sourceWorld.removed);
    }

    if (depthMap[world.title] > -1) {
        conns.filter(c => depthMap[c.location ? c.location : worldDataById[c.targetId].title] === -1)
            .forEach(c => resolveMissingDepths(worldData, worldDataById, worldDataByName, depthMap, c.targetId ? worldDataById[c.targetId] : worldDataByName[c.location], ignoreTypeFlags, depthProp));
        return true;
    }

    return false;
}

function updateWorldsOfDepth(pool, depth, worlds, isMinDepth) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let updateDepthsQuery = `UPDATE worlds SET ${isMinDepth ? 'minDepth' : 'depth'}=${depth} WHERE id IN (`;
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
    return new Promise((resolve, reject) => {
        setUpdateTask('cleanupWorldData');
        pool.query('DELETE w FROM worlds w WHERE NOT EXISTS(SELECT c.id FROM conns c WHERE w.id IN (c.sourceId, c.targetId))', (err, _) => {
            if (err) return reject(err);
            resolve();
        });
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

function getMapData(worldData, url) {
    const root = !url;
    if (root)
        url = 'https://yume.wiki/2kki/Map_IDs/0000-0400';

    return new Promise((resolve, reject) => {
        if (root)
            setUpdateTask('fetchMapData');
        superagent.get(url, function (err, res) {
            if (err) return reject(err);
            if (root)
                worldData.forEach(w => w.mapIds = []);
            const worldDataByName = _.keyBy(worldData, w => w.title);
            const mapIdTablesHtml = sliceHtml(res.text, res.text.indexOf('<table '), res.text.lastIndexOf('</table>'));
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
                        const worldNameStartIndex = w.indexOf('<a href="/2kki/') + 15;
                        if (worldNameStartIndex > -1) {
                            const worldNameEndIndex = w.indexOf('"', worldNameStartIndex);
                            const worldName = sanitizeWorldName(w.slice(worldNameStartIndex, worldNameEndIndex));
                            if (worldDataByName[worldName])
                                worldDataByName[worldName].mapIds.push(map.mapId);
                        }
                    });
                    map.width = parseInt(m[4]);
                    map.height = parseInt(m[5]);
                    mapData.push(map);
                }
            });

            if (root)
            {
                const getTabMapData = [];
                let cursor = res.text.indexOf('<a href="/2kki/Map_IDs/') + 23;

                while (cursor >= 23) {
                    const tabUrl = `${url.slice(0, -9)}${sliceHtml(res.text, cursor, res.text.indexOf('"', cursor))}`;
                    if (tabUrl !== url)
                        getTabMapData.push(getMapData(worldData, tabUrl)
                            .then(tabMapData => tabMapData.forEach(map => mapData.push(map)))
                            .catch(err => console.error(err)));
                    cursor = res.text.indexOf('<a href="/2kki/Map_IDs/', cursor) + 23;
                }

                if (getTabMapData.length)
                    Promise.allSettled(getTabMapData).finally(() => resolve(mapData));
                else
                    resolve(mapData);
            } else
                resolve(mapData);
        });
    });
}

function updateMaps(pool, mapData) {
    return new Promise((resolve, reject) => {
        setUpdateTask('updateMapData');
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
        setUpdateTask('fetchAuthorInfoData');
        superagent.get('https://yume.wiki/2kki/Authors', function (err, res) {
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
        setUpdateTask('updateAuthorInfoData');
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
        url = 'https://yume.wiki/2kki/Version_History';
    
    return new Promise((resolve, reject) => {
        if (root)
            setUpdateTask('fetchVersionInfoData');
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
                let cursor = versionSectionsHtml[0].indexOf('<a href="/2kki/Version_History/') + 30;

                while (cursor >= 30) {
                    populateOldVersionInfo.push(getVersionInfoWikiData(`${url}${versionSectionsHtml[0].slice(cursor, versionSectionsHtml[0].indexOf('"', cursor))}`).then(oldVersionInfo => oldVersionInfo.forEach(vi => versionInfo.push(vi))).catch(err => console.error(err)));
                    cursor = versionSectionsHtml[0].indexOf('<a href="/2kki/Version_History/', cursor) + 30;
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
        setUpdateTask('updateVersionInfoData');
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

function updateEffectData(pool, worldData) {
    return new Promise((resolve, reject) => {
        getEffectWikiData(worldData).then(effectData => {
            setUpdateTask('updateEffectData');
            pool.query('SELECT id, name, nameJP, worldId, ordinal, filename, method, methodJP FROM effects', (err, rows) => {
                if (err) return reject(err);
                const effectDataByName = _.keyBy(effectData, e => e.name);
                const newEffectsByName = _.keyBy(effectData, e => e.name);
                const updatedEffects = [];
                const removedEffectIds  = [];
                for (let row of rows) {
                    const effectName = row.name;
                    if (effectDataByName.hasOwnProperty(effectName)) {
                        const effect = effectDataByName[effectName];
                        effect.id = row.id;
                        if (row.nameJP !== effect.nameJP || row.worldId !== effect.worldId || row.ordinal !== effect.ordinal ||
                            row.filename !== effect.filename || row.method !== effect.method || row.methodJP !== effect.methodJP)
                            updatedEffects.push(effect);
                    } else
                        removedEffectIds.push(row.id);
                    delete newEffectsByName[effectName];
                }
    
                const insertCallback = function () {
                    if (updatedEffects.length) {
                        const updateEffects = [];
                        for (let effect of updatedEffects)
                            updateEffects.push(updateEffect(pool, effect).catch(err => console.error(err)));
                        Promise.allSettled(updateEffects).finally(() => resolve());
                    } else
                        resolve();
                };
    
                const callback = function () {
                    const newEffectNames = Object.keys(newEffectsByName);
                    if (newEffectNames.length) {
                        let i = 0;
                        let effectsQuery = 'INSERT INTO effects (name, nameJP, worldId, ordinal, filename, method, methodJP) VALUES ';
                        for (let e in newEffectsByName) {
                            const newEffect = newEffectsByName[e];
                            if (i++)
                                effectsQuery += ", ";
                            const name = newEffect.name.replace(/'/g, "''");
                            const nameJP = newEffect.nameJP ? `'${newEffect.nameJP}'` : 'NULL';
                            const worldId = newEffect.worldId != null ? `${newEffect.worldId}` : 'NULL';
                            const ordinal = newEffect.ordinal;
                            const filename = newEffect.filename.replace(/'/g, "''");
                            const method = newEffect.method ? `'${newEffect.method.replace(/'/g, "''")}'` : 'NULL';
                            const methodJP = newEffect.methodJP ? `'${newEffect.methodJP.replace(/'/g, "''")}'` : 'NULL';
                            effectsQuery += `('${name}', ${nameJP}, ${worldId}, ${ordinal}, '${filename}', ${method}, ${methodJP})`;
                        }
                        pool.query(effectsQuery, (err, res) => {
                            if (err) return reject(err);
                            const insertedRows = res.affectedRows;
                            const effectRowIdsQuery = `SELECT r.id FROM (SELECT id FROM effects ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                            pool.query(effectRowIdsQuery, (err, rows) => {
                                if (err) return reject(err);
                                for (let r in rows)
                                    newEffectsByName[newEffectNames[r]].id = rows[r].id;
                                insertCallback();
                            });
                        });
                    } else
                        insertCallback();
                };
    
                if (removedEffectIds.length)
                    deleteRemovedEffects(pool, removedEffectIds).then(() => callback()).catch(err => reject(err));
                else
                    callback();
            });
        }).catch(err => reject(err));
    });
}

function getEffectWikiData(worldData) {
    return new Promise((resolve, reject) => {
        setUpdateTask('fetchEffectData');
        superagent.get('https://yume.wiki/2kki/Effects', function (err, res) {
            if (err) return reject(err);
            const effectSectionsHtml = res.text.split('<h3>');
            const effectData = [];

            let i = 0;

            for (let e = 1; e < effectSectionsHtml.length - 1; e++) {
                const section = effectSectionsHtml[e];
                const nameMatch = /<b>([^<]+)</.exec(section);
                if (!nameMatch)
                    continue;
                const effectName = nameMatch[1];
                if (effectName === 'Instructions')
                    break;
                const filenameMatch = /(\/images\/.*?\.png)"/i.exec(section);
                if (!filenameMatch)
                    continue;
                const filename = `https://yume.wiki${filenameMatch[1]}`;
                const nameJPMatch = /（([^）]+)）/.exec(section);
                const effectNameJP = nameJPMatch ? nameJPMatch[1] : null;
                const methodMatch = /<b>Location:<\/b>(.*)/.exec(section);
                const method = methodMatch ? methodMatch[1].replace(/&#160;/, ' ').trim() : null;
                const worldNameMatch = method ? /<a .*?href="\/2kki\/([^"]+)"/.exec(method) : null;
                const worldName = worldNameMatch ? sanitizeWorldName(worldNameMatch[1]).trim() : null;
                const worldMatches = worldName ? worldData.filter(w => w.title === worldName) : [];
                const worldId = worldMatches.length ? worldMatches[0].id : null;

                effectData.push({
                    name: effectName,
                    nameJP: effectNameJP,
                    worldId: worldId,
                    ordinal: i++,
                    filename: filename,
                    method: method,
                    methodJP: null
                });
            }

            setUpdateTask('fetchEffectDataJP');
            const addEffectDataJPMethods = effectData.filter(e => e.nameJP).map(e => addEffectDataJPMethod(e).catch(err => console.error(err)));
            Promise.allSettled(addEffectDataJPMethods).finally(() => resolve(effectData));
        });
    });
}

function addEffectDataJPMethod(effect) {
    return new Promise((resolve, reject) => {
        let url = `https://wikiwiki.jp/yume2kki-t/${encodeURI(effect.nameJP)}`;
        superagent.get(url, function (err, res) {
            if (err) return reject(err);
            const methodMatch = /<th>備考<\/th><td>(.*?)<\/td><\/tr>/.exec(res.text);
            let method = null;
            if (methodMatch) {
                method = methodMatch[1].replace(/<a .*?>\?<\/a>/g, '');

                const routeWorlds = [];
                const routeSectionMatch = /<th>ルート例<\/th>.*?<\/tr>/.exec(res.text);
                if (routeSectionMatch) {
                    const routeSection = routeSectionMatch[0];
                    const routeWorldRegex = /(?:<a [^>]+>)([^<]+)</g;
                   
                    let routeWorldMatch;
                    while ((routeWorldMatch = routeWorldRegex.exec(routeSection)))
                        routeWorlds.push(routeWorldMatch[1]);
                    for (let routeWorld of routeWorlds)
                        method = method.replace(routeWorld, `<a href="#">${routeWorld}</a>`);
                }
                
                effect.methodJP = method;
            }

            resolve();
        });
    });
}

function updateEffect(pool, effect) {
    return new Promise((resolve, reject) => {
        const nameJP = effect.nameJP ? `'${effect.nameJP}'` : 'NULL';
        const worldId = effect.worldId != null ? `${effect.worldId}` : 'NULL';
        const ordinal = effect.ordinal;
        const filename = effect.filename.replace(/'/g, "''");
        const method = effect.method ? `'${effect.method.replace(/'/g, "''")}'` : 'NULL';
        const methodJP = effect.methodJP ? `'${effect.methodJP.replace(/'/g, "''")}'` : 'NULL';
        pool.query(`UPDATE effects SET nameJP=${nameJP}, worldId=${worldId}, ordinal=${ordinal}, filename='${filename}', method=${method}, methodJP=${methodJP} WHERE id=${effect.id}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedEffects(pool, removedEffectIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteEffectsQuery = 'DELETE FROM effects WHERE id IN (';
        for (let effectId of removedEffectIds) {
            if (i++)
                deleteEffectsQuery += ', ';
            deleteEffectsQuery += effectId;
        }
        deleteEffectsQuery += ')';
        pool.query(deleteEffectsQuery, (err, _) => {
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
                                const worldId = location.worldId != null ? `${location.worldId}` : 'NULL';
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
        setUpdateTask('fetchMenuThemeData');
        superagent.get('https://yume.wiki/2kki/Menu_Themes', function (err, res) {
            if (err) return reject(err);
            const worldDataByName = _.keyBy(worldData, w => w.title);
            const menuThemeTablesHtml = sliceHtml(res.text, res.text.indexOf('<table '), res.text.lastIndexOf('</table>'));
            const menuThemeDataRows = menuThemeTablesHtml.split('<tr>').slice(2);
            const rawMenuThemeData = [];
            let removedIndex = 999;
            for (let m = 0; m < menuThemeDataRows.length; m++) {
                const ret = menuThemeDataRows[m].replace(/\n/g, '').split(/<\/td><td(?:>| rowspan="\d">)/).slice(0, 4);
                if (ret.length === 4) {
                    if (ret[3].indexOf('</table>') > -1 && m < menuThemeDataRows.length - 1) {
                        removedIndex = m;
                        m++;
                    }
                    ret[3] = ret[3].slice(0, ret[3].indexOf('</td>'));
                }
                for (let r = ret.length; r < 4; r++)
                    ret[r] = rawMenuThemeData[rawMenuThemeData.length - 1][r];
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
                    removed: m >= removedIndex
                };
                const worldNameStartIndex = data[1].indexOf('<a href="/2kki/') + 15;
                if (worldNameStartIndex > -1) {
                    const worldNameEndIndex = data[1].indexOf('"', worldNameStartIndex);
                    const worldName = sanitizeWorldName(data[1].slice(worldNameStartIndex, worldNameEndIndex));
                    if (worldDataByName[worldName])
                        location.worldId = worldDataByName[worldName].id;
                }
                const locationImageIndex = data[3].indexOf('<img ');
                if (locationImageIndex > -1) {
                    const locationImageSrcIndex = data[3].indexOf(' data-src="', locationImageIndex) > -1
                        ? data[3].indexOf(' data-src="', locationImageIndex) + 11
                        : data[3].indexOf(' src="', locationImageIndex) + 6;
                    const locationImageUrl = data[3].slice(locationImageSrcIndex, data[3].indexOf('"', locationImageSrcIndex));
                    location.filename = `https://yume.wiki${locationImageUrl.slice(0, locationImageUrl.lastIndexOf("/")).replace('thumb/', '')}`;
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
                            filename: `https://yume.wiki${imageUrl}`,
                            locations: []
                        };
                        menuThemeData.push(menuTheme);
                    }
                    menuTheme.locations.push(_.cloneDeep(location));
                    menuThemeLocationKeys.push(key);
                }
            }
            addMenuThemeDataJPMethods(menuThemeData).catch(err => console.error(err)).finally(() => resolve(menuThemeData));
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
            const menuThemeTablesHtml = sliceHtml(res.text, res.text.indexOf('<table><thead>', res.text.indexOf('<div class="container-wrapper"')), res.text.lastIndexOf('</table>'));
            const menuThemeDataRows = menuThemeTablesHtml.split('<tr>').slice(2);
            let endOfTable = false;

            for (let m = 0; m < menuThemeDataRows.length; m++) {
                const data = menuThemeDataRows[m].split('</td><td').slice(0, 2);
                if (!data.length || data[0].indexOf('<th') > -1)
                    continue; // skip the page headers (1ページ目, 2ページ目, etc.)
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
                addMenuThemeDataJPMethods(menuThemeData, true).catch(err => reject(err)).finally(() => resolve());
        });
    });
}

function updateMenuThemes(pool, menuThemeData) {
    return new Promise((resolve, reject) => {
        setUpdateTask('updateMenuThemeData');
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

function updateWallpaperData(pool, worldData) {
    return new Promise((resolve, reject) => {
        getWallpaperWikiData(worldData).then(wallpaperData => {
            setUpdateTask('updateWallpaperData');
            pool.query('SELECT id, wallpaperId, name, nameJP, worldId, filename, method, methodJP, removed FROM wallpapers', (err, rows) => {
                if (err) return reject(err);
                const wallpaperDataByWpId = _.keyBy(wallpaperData, wp => wp.wallpaperId);
                const newWallpapersByWpId = _.keyBy(wallpaperData, wp => wp.wallpaperId);
                const updatedWallpapers = [];
                const removedWallpaperIds  = [];
                for (let row of rows) {
                    const wallpaperId = row.wallpaperId;
                    if (wallpaperDataByWpId.hasOwnProperty(wallpaperId)) {
                        const wallpaper = wallpaperDataByWpId[wallpaperId];
                        wallpaper.id = row.id;
                        if (row.name !== wallpaper.name || row.nameJP !== wallpaper.nameJP || row.worldId !== wallpaper.worldId ||
                            row.filename !== wallpaper.filename || row.method !== wallpaper.method || row.methodJP !== wallpaper.methodJP ||
                            row.removed !== wallpaper.removed)
                            updatedWallpapers.push(wallpaper);
                    } else
                        removedWallpaperIds.push(row.id);
                    delete newWallpapersByWpId[wallpaperId];
                }
    
                const insertCallback = function () {
                    if (updatedWallpapers.length) {
                        const updateWallpapers = [];
                        for (let wallpaper of updatedWallpapers)
                            updateWallpapers.push(updateWallpaper(pool, wallpaper).catch(err => console.error(err)));
                        Promise.allSettled(updateWallpapers).finally(() => resolve());
                    } else
                        resolve();
                };
    
                const callback = function () {
                    const newWallpaperIds = Object.keys(newWallpapersByWpId);
                    if (newWallpaperIds.length) {
                        let i = 0;
                        let wallpapersQuery = 'INSERT INTO wallpapers (wallpaperId, name, nameJP, worldId, filename, method, methodJP, removed) VALUES ';
                        for (let wp in newWallpapersByWpId) {
                            const newWallpaper = newWallpapersByWpId[wp];
                            if (i++)
                                wallpapersQuery += ", ";
                            const wallpaperId = newWallpaper.wallpaperId;
                            const name = newWallpaper.name ? `'${newWallpaper.name.replace(/'/g, "''")}'` : 'NULL';
                            const nameJP = newWallpaper.nameJP ? `'${newWallpaper.nameJP}'` : 'NULL';
                            const worldId = newWallpaper.worldId != null ? `${newWallpaper.worldId}` : 'NULL';
                            const filename = newWallpaper.filename.replace(/'/g, "''");
                            const method = newWallpaper.method ? `'${newWallpaper.method.replace(/'/g, "''")}'` : 'NULL';
                            const methodJP = newWallpaper.methodJP ? `'${newWallpaper.methodJP.replace(/'/g, "''")}'` : 'NULL';
                            const removed = newWallpaper.removed ? '1' : '0';
                            wallpapersQuery += `('${wallpaperId}', ${name}, ${nameJP}, ${worldId}, '${filename}', ${method}, ${methodJP}, ${removed})`;
                        }
                        pool.query(wallpapersQuery, (err, res) => {
                            if (err) return reject(err);
                            const insertedRows = res.affectedRows;
                            const wallpaperRowIdsQuery = `SELECT r.id FROM (SELECT id FROM wallpapers ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                            pool.query(wallpaperRowIdsQuery, (err, rows) => {
                                if (err) return reject(err);
                                for (let r in rows)
                                    newWallpapersByWpId[newWallpaperIds[r]].id = rows[r].id;
                                insertCallback();
                            });
                        });
                    } else
                        insertCallback();
                };
    
                if (removedWallpaperIds.length)
                    deleteRemovedWallpapers(pool, removedWallpaperIds).then(() => callback()).catch(err => reject(err));
                else
                    callback();
            });
        }).catch(err => reject(err));
    });
}

function getWallpaperWikiData(worldData) {
    return new Promise((resolve, reject) => {
        setUpdateTask('fetchWallpaperData');
        superagent.get('https://yume.wiki/2kki/Wallpaper_Guide', function (err, res) {
            if (err) return reject(err);
            const specHtml = sliceHtml(res.text, res.text.indexOf('id="Specifications"'), res.text.indexOf('id="Removed_or_modified_wallpapers"'));
            const wallpaperSectionsHtml = res.text.split('"gallerybox"');
            const wallpaperRegex = /<img .*?src="(\/images\/thumb\/.*?)\/\d+px\-.*?\.png".*?#(\d+)(?: \- "([^"]+)"|<\/b>).*? \- (.*?)<\/p>/i;
            const removedWallpaperRegex = /<img .*?src="(\/images\/thumb\/.*?)\/\d+px\-.*?\.png".*?<b>.*?"(.*?)".*? \- (.*?[^#]+#(\d+).*?)<\/div>/i;
            const wallpaperData = [];
            let removedFlag = false;

            for (let wp = 1; wp < wallpaperSectionsHtml.length - 1; wp++) {
                const section = wallpaperSectionsHtml[wp].replace(/\n/g, '');
                let wallpaperId;
                let name = null;
                let filename;
                let method;
                const removed = removedFlag;
                if (!removed) {
                    if (section.indexOf('id="Removed_or_modified_wallpapers"') > 1)
                        removedFlag = true;
                    
                    const wallpaperMatch = wallpaperRegex.exec(section);
                    if (!wallpaperMatch || isNaN(wallpaperMatch[2]))
                        continue;
                    
                    wallpaperId = parseInt(wallpaperMatch[2]);
                    name = wallpaperMatch[3] ? wallpaperMatch[3].trim() : null;
                    filename = `https://yume.wiki${wallpaperMatch[1].replace('/thumb', '')}`;
                    method = wallpaperMatch[4].trim();
                } else {
                    const removedWallpaperMatch = removedWallpaperRegex.exec(section);
                    if (!removedWallpaperMatch || isNaN(removedWallpaperMatch[4]))
                        continue;

                    wallpaperId = parseInt(removedWallpaperMatch[4]) + 1000;
                    name = removedWallpaperMatch[2];
                    filename = `https://yume.wiki${removedWallpaperMatch[1].replace('/thumb', '')}`;
                    method = removedWallpaperMatch[3].replace(/<a id="notetext\_.*?<\/a>/g, '').trim();
                }

                const worldLinkRegex = /"\/2kki\/([^"]+)"/g;
                let worldLinkMatch;
                let worldId = null;

                while ((worldLinkMatch = worldLinkRegex.exec(method))) {
                    if (worldLinkMatch) {
                        const worldName = sanitizeWorldName(worldLinkMatch[1]);
                        const worldMatches = worldName ? worldData.filter(w => w.title === worldName) : [];
                        if (worldMatches.length) {
                            worldId = worldMatches[0].id;
                            break;
                        }
                    }
                }

                const methodSpecLinkRegex = /<a href="#Wallpaper\_.*?<\/a>/;
                const hasSpec = !removed && methodSpecLinkRegex.test(method);
                let spec = '';

                if (hasSpec) {
                    const specRegex = new RegExp(`id="Wallpaper\_#${wallpaperId}".*([\\s\\S]*?)<.*?h3`);
                    const specMatch = specRegex.exec(specHtml);
                    if (specMatch)
                        spec = '<br>' + specMatch[1].trim();
                }

                method = (method + spec).replace(/<a .*?>(.*?)<\/a>/g, '<a href="#">$1</a>');

                wallpaperData.push({
                    wallpaperId: wallpaperId,
                    name: name,
                    nameJP: null,
                    worldId: worldId,
                    filename: filename,
                    method: method,
                    methodJP: null,
                    removed: removed
                });
            }

            addWallpaperDataJPMethods(wallpaperData).catch(err => console.error(err)).finally(() => resolve(wallpaperData));
        });
    });
}

function addWallpaperDataJPMethods(wallpaperData) {
    return new Promise((resolve, reject) => {
        superagent.get('https://wikiwiki.jp/yume2kki-t/%E5%8F%8E%E9%9B%86%E8%A6%81%E7%B4%A0/%E3%83%91%E3%82%BD%E3%82%B3%E3%83%B3%E3%81%AE%E5%A3%81%E7%B4%99%E3%81%AE%E8%A7%A3%E6%94%BE%E6%9D%A1%E4%BB%B6', function (err, res) {
            if (err) return reject(err);
            const dataHtml = sliceHtml(res.text, res.text.indexOf('No.</th>'), res.text.indexOf('</table>', res.text.lastIndexOf('No.</th>')));
            const wallpaperRegex = /<tr>.*?>(\d+)<\/td><td [^>]+>(.*?)<\/td><\/tr>/g;
            let wallpaperMatch;
            while ((wallpaperMatch = wallpaperRegex.exec(dataHtml))) {
                const wallpaperId = parseInt(wallpaperMatch[1]);
                const methodJP = wallpaperMatch[2].replace(/<a .*?>\?<\/a>/g, '').replace(/<[^>]+>/g, '');
                const wallpaperMatches = wallpaperData.filter(wp => wp.wallpaperId === wallpaperId);
                if (wallpaperMatches.length)
                    wallpaperMatches[0].methodJP = methodJP;
            }

            resolve();
        });
    });
}

function updateWallpaper(pool, wallpaper) {
    return new Promise((resolve, reject) => {
        const name = wallpaper.name ? `'${wallpaper.name.replace(/'/g, "''")}'` : 'NULL';
        const nameJP = wallpaper.nameJP ? `'${wallpaper.nameJP}'` : 'NULL';
        const worldId = wallpaper.worldId != null ? `${wallpaper.worldId}` : 'NULL';
        const filename = wallpaper.filename.replace(/'/g, "''");
        const method = wallpaper.method ? `'${wallpaper.method.replace(/'/g, "''")}'` : 'NULL';
        const methodJP = wallpaper.methodJP ? `'${wallpaper.methodJP.replace(/'/g, "''")}'` : 'NULL';
        const removed = wallpaper.removed ? '1' : '0';
        pool.query(`UPDATE wallpapers SET name=${name}, nameJP=${nameJP}, worldId=${worldId}, filename='${filename}', method=${method}, methodJP=${methodJP}, removed=${removed} WHERE id=${wallpaper.id}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedWallpapers(pool, removedWallpaperIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteWallpapersQuery = 'DELETE FROM wallpapers WHERE id IN (';
        for (let wallpaperId of removedWallpaperIds) {
            if (i++)
                deleteWallpapersQuery += ', ';
            deleteWallpapersQuery += wallpaperId;
        }
        deleteWallpapersQuery += ')';
        pool.query(deleteWallpapersQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function updateBgmTrackData(pool, worldData) {
    return new Promise((resolve, reject) => {
        getBgmTrackWikiData(worldData).then(bgmTrackData => {
            setUpdateTask('updateBgmTrackData');
            pool.query('SELECT id, trackNo, variant, name, location, locationJP, worldId, url, notes, notesJP, removed FROM bgm_tracks', (err, rows) => {
                if (err) return reject(err);
                const bgmTrackDataByTrackId = _.keyBy(bgmTrackData, t => `${t.trackNo}${t.variant}`);
                const newBgmTracksByTrackId = _.keyBy(bgmTrackData, t => `${t.trackNo}${t.variant}`);
                const updatedBgmTracks = [];
                const removedBgmTrackIds  = [];
                for (let row of rows) {
                    const bgmTrackId = `${row.trackNo}${row.variant}`;
                    if (bgmTrackDataByTrackId.hasOwnProperty(bgmTrackId)) {
                        const bgmTrack = bgmTrackDataByTrackId[bgmTrackId];
                        bgmTrack.id = row.id;
                        if (row.name !== bgmTrack.name || row.location !== bgmTrack.location || row.locationJP !== bgmTrack.locationJP || row.worldId !== bgmTrack.worldId
                            || row.url !== bgmTrack.url || row.notes !== bgmTrack.notes || row.notesJP !== bgmTrack.notesJP || row.removed !== bgmTrack.removed)
                            updatedBgmTracks.push(bgmTrack);
                    } else
                        removedBgmTrackIds.push(row.id);
                    delete newBgmTracksByTrackId[bgmTrackId];
                }
    
                const insertCallback = function () {
                    if (updatedBgmTracks.length) {
                        const updateBgmTracks = [];
                        for (let bgmTrack of updatedBgmTracks)
                            updateBgmTracks.push(updateBgmTrack(pool, bgmTrack).catch(err => console.error(err)));
                        Promise.allSettled(updateBgmTracks).finally(() => resolve());
                    } else
                        resolve();
                };
    
                const callback = function () {
                    const newBgmTrackIds = Object.keys(newBgmTracksByTrackId);
                    if (newBgmTrackIds.length) {
                        let i = 0;
                        let bgmTracksQuery = 'INSERT INTO bgm_tracks (trackNo, variant, name, location, locationJP, worldId, worldImageOrdinal, url, notes, notesJP, removed) VALUES ';
                        for (let t in newBgmTracksByTrackId) {
                            const newBgmTrack = newBgmTracksByTrackId[t];
                            if (i++)
                                bgmTracksQuery += ", ";
                            const trackNo = newBgmTrack.trackNo;
                            const variant = newBgmTrack.variant ? `'${newBgmTrack.variant}'` : 'NULL';
                            const name = `'${newBgmTrack.name.replace(/'/g, "''")}'`;
                            const location = newBgmTrack.location ? `'${newBgmTrack.location.replace(/'/g, "''").replace(/&#160;/, ' ')}'` : 'NULL';
                            const locationJP = newBgmTrack.locationJP ? `'${newBgmTrack.locationJP}'` : 'NULL';
                            const worldId = newBgmTrack.worldId != null ? `${newBgmTrack.worldId}` : 'NULL';
                            const url = newBgmTrack.url ? `'${newBgmTrack.url.replace(/'/g, "''")}'` : 'NULL';
                            const notes = newBgmTrack.notes ? `'${newBgmTrack.notes.replace(/'/g, "''")}'` : 'NULL';
                            const notesJP = newBgmTrack.notesJP ? `'${newBgmTrack.notesJP}'` : 'NULL';
                            const removed = newBgmTrack.removed ? '1' : '0';
                            bgmTracksQuery += `(${trackNo}, ${variant}, ${name}, ${location}, ${locationJP}, ${worldId}, 0, ${url}, ${notes}, ${notesJP}, ${removed})`;
                        }
                        pool.query(bgmTracksQuery, (err, res) => {
                            if (err) return reject(err);
                            const insertedRows = res.affectedRows;
                            const bgmTrackRowIdsQuery = `SELECT r.id FROM (SELECT id FROM bgm_tracks ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                            pool.query(bgmTrackRowIdsQuery, (err, rows) => {
                                if (err) return reject(err);
                                for (let r in rows)
                                    newBgmTracksByTrackId[newBgmTrackIds[r]].id = rows[r].id;
                                insertCallback();
                            });
                        });
                    } else
                        insertCallback();
                };
    
                if (removedBgmTrackIds.length)
                    deleteRemovedBgmTracks(pool, removedBgmTrackIds).then(() => callback()).catch(err => reject(err));
                else
                    callback();
            });
        }).catch(err => reject(err));
    });
}

function getBgmTrackWikiData(worldData, url) {
    const root = !url;
    if (root)
        url = 'https://yume.wiki/2kki/Soundtrack/001-100';
        
    return new Promise((resolve, reject) => {
        if (root)
            setUpdateTask('fetchBgmTrackData');
        superagent.get(url, function (err, res) {
            if (err) return reject(err);
            const tableRowRegex = /<tr>[.\s\S]*?<\/tr>/g;
            const tablesHtml = sliceHtml(res.text, res.text.indexOf('</table>') + 8, res.text.indexOf('class="page-footer"'));
            const unnumberedIndex = tablesHtml.indexOf('id="Unnumbered_Tracks"');
            const unusedIndex = tablesHtml.indexOf('id="Unused_Tracks"');
            const bgmTrackRegexTrackNoPart = '<td>(\\d{3})(?: ([A-Z]))?<\\/td>';
            const bgmTrackRegexSkippableTextPart = '<td(?: colspan="\\d+")?(?: rowspan="(\\d+)")?(?: colspan="\\d+")?>(.*?)<\\/td>';
            const bgmTrackRegexSkippableUrlPart = '<td(?: colspan="\\d+")?(?: rowspan="(\\d+)")?(?: colspan="\\d+")?>(?:.*?<audio src="(.*?)"[^>]*>)?.*?<\\/td>';
            const bgmTrackRegexSkippedPart = '()()';
            const bgmTrackRegexes = [];
            for (let f = 0; f < 32; f++) {
                const trackNoPart = f & 16 ? bgmTrackRegexSkippedPart : bgmTrackRegexTrackNoPart;
                const namePart = f & 1 ? bgmTrackRegexSkippedPart : bgmTrackRegexSkippableTextPart;
                const locationPart = f & 2 ? bgmTrackRegexSkippedPart : bgmTrackRegexSkippableTextPart;
                const urlPart = f & 4 ? bgmTrackRegexSkippedPart : bgmTrackRegexSkippableUrlPart;
                const notesPart = f & 8 ? bgmTrackRegexSkippedPart : bgmTrackRegexSkippableTextPart;
                bgmTrackRegexes[f] = new RegExp(`<tr>${trackNoPart}${namePart}${locationPart}${urlPart}${notesPart}<\\/tr>`);
            }

            const bgmTrackData = [];
            let unnumberedFlag = false;
            let unusedFlag = false;

            let tableRowMatch;
            let nameColSkip = 0;
            let locationColSkip = 0;
            let urlColSkip = 0;
            let notesColSkip = 0;
            
            let name;
            let location;
            let worldId;
            let bgmUrl;

            let i;
            
            while ((tableRowMatch = tableRowRegex.exec(tablesHtml))) {
                if (!unnumberedFlag && unnumberedIndex > -1 && tableRowMatch.index > unnumberedIndex) {
                    unnumberedFlag = true;
                    i = 1000;
                } else {
                    if (!unusedFlag && unusedIndex > -1 && tableRowMatch.index > unusedIndex) {
                        unusedFlag = true;
                        i = 2000;
                    } else
                        i++;
                }
                const tableRowHtml = tableRowMatch[0].replace(/\n/g, '');
                const regexIndex = (nameColSkip === 0 ? 0 : 1) | (locationColSkip === 0 ? 0 : 2) | (urlColSkip === 0 ? 0 : 4) | (notesColSkip === 0 ? 0 : 8) | (!unnumberedFlag ? 0 : 16);
                const trackDataMatch = bgmTrackRegexes[regexIndex].exec(tableRowHtml);
                if (trackDataMatch) {
                    const trackNo = !unnumberedFlag ? parseInt(trackDataMatch[1]) : i;
                    const variant = (!unnumberedFlag && trackDataMatch[2]) || null;

                    const newNameColSkip = trackDataMatch[3] ? parseInt(trackDataMatch[3]) - 1 : 0;
                    if (!newNameColSkip && nameColSkip > 0)
                        nameColSkip--;
                    else {
                        name = trackDataMatch[4] || null;
                        if (newNameColSkip)
                            nameColSkip = newNameColSkip;
                    }

                    const newLocationColSkip = trackDataMatch[5] ? parseInt(trackDataMatch[5]) - 1 : 0;
                    if (!newLocationColSkip && locationColSkip > 0)
                        locationColSkip--;
                    else {
                        location = trackDataMatch[6] || null;
                        worldId = null;
                        if (location) {
                            let worldLinkMatch;
                                
                            const worldLinkRegex = /"\/2kki\/([^"#]+)(?:#[^"]+)?"/g;
                            while ((worldLinkMatch = worldLinkRegex.exec(location))) {
                                const worldName = sanitizeWorldName(worldLinkMatch[1]);
                                const worldMatches = worldName ? worldData.filter(w => w.title === worldName) : [];
                                if (worldMatches.length) {
                                    worldId = worldMatches[0].id;
                                    break;
                                }
                            }
                            
                            location = location.replace(/<a .*?>(.*?)<\/a>/g, '<a href="#">$1</a>');
                        }
                        if (newLocationColSkip)
                            locationColSkip = newLocationColSkip;
                    }

                    const newUrlColSkip = trackDataMatch[7] ? parseInt(trackDataMatch[7]) - 1 : 0;
                    if (!newUrlColSkip && urlColSkip > 0)
                        urlColSkip--;
                    else {
                        bgmUrl = trackDataMatch[8] ? decodeURI(trackDataMatch[8]) : null;
                        if (bgmUrl && bgmUrl.startsWith('/'))
                            bgmUrl = `https://yume.wiki${bgmUrl}`;
                        if (newUrlColSkip)
                            urlColSkip = newUrlColSkip;
                    }

                    const newNotesColSkip = trackDataMatch[9] ? parseInt(trackDataMatch[9]) - 1 : 0;
                    if (!newNotesColSkip && notesColSkip > 0)
                        notesColSkip--;
                    else {
                        notes = trackDataMatch[10] ? trackDataMatch[10].replace(/<a .*?>(.*?)<\/a>/g, '<a href="#">$1</a>') : null;
                        if (newNotesColSkip)
                            notesColSkip = newNotesColSkip;
                    }

                    if (name)
                        bgmTrackData.push({
                            trackNo: trackNo,
                            variant: variant,
                            name: name,
                            location: location,
                            locationJP: null,
                            worldId: worldId,
                            url: bgmUrl,
                            notes: notes,
                            notesJP: null,
                            removed: unusedFlag
                        });
                } else {
                    if (nameColSkip > 0)
                        nameColSkip--;
                    if (locationColSkip > 0)
                        locationColSkip--;
                    if (urlColSkip > 0)
                        urlColSkip--;
                    if (notesColSkip > 0)
                        notesColSkip--;
                }
            }

            if (root)
            {
                const getTabBgmTrackData = [];
                let cursor = res.text.indexOf('<a href="/2kki/Soundtrack/') + 26;
                while (cursor >= 26) {
                    const tabUrl = `${url.slice(0, url.lastIndexOf('/') + 1)}${sliceHtml(res.text, cursor, res.text.indexOf('"', cursor))}`;
                    if (tabUrl !== url) {
                        getTabBgmTrackData.push(getBgmTrackWikiData(worldData, tabUrl)
                            .then(tabBgmTrackData => tabBgmTrackData.forEach(bgmTrack => bgmTrackData.push(bgmTrack)))
                            .catch(err => console.error(err)));
                    }
                    cursor = res.text.indexOf('<a href="/2kki/Soundtrack/', cursor) + 26;
                }

                if (getTabBgmTrackData.length)
                    Promise.allSettled(getTabBgmTrackData).finally(() => {
                        const updateIndirectBgmTrackUrls = bgmTrackData.filter(t => t.url && t.url.startsWith('/2kki/'))
                            .map(t => getIndirectBgmTrackUrl(t).then(u => t.url = u)
                                .catch(err => {
                                    if (err)
                                        console.error(err);
                                    t.url = null;
                                })
                            );

                        Promise.allSettled(updateIndirectBgmTrackUrls).finally(() => {
                            addBgmTrackDataJPLocationsAndNotes(bgmTrackData).catch(err => console.error(err)).finally(() => resolve(bgmTrackData));
                        });
                    });
                else
                    resolve(bgmTrackData);
            } else
                resolve(bgmTrackData);
        });
    });
}

function getIndirectBgmTrackUrl(bgmTrack) {
    return new Promise((resolve, reject) => {
        const indirectUrlMatch = /\/2kki\/(File:.*)/.exec(bgmTrack.url);
        if (!indirectUrlMatch)
            reject();
        const query = { action: 'query', titles: indirectUrlMatch[1], prop: 'imageinfo', iiprop: 'url', format: 'json' };
        superagent.get(apiUrl)
            .query(query)
            .end((err, res) => {
                if (err) return reject(err);
                const revisionText = "/revision/latest";
                const data = JSON.parse(res.text);
                const pages = data.query.pages;
                const fullUrl = pages[Object.keys(pages)[0]].imageinfo[0].url;
                const revisionIndex = fullUrl.indexOf(revisionText);
                if (revisionIndex === -1)
                    reject();
                resolve(fullUrl.slice(0, revisionIndex));
            });
    });
}

function addBgmTrackDataJPLocationsAndNotes(bgmTrackData) {
    return new Promise((resolve, reject) => {
        superagent.get('https://wikiwiki.jp/yume2kki-t/%E5%8F%8E%E9%9B%86%E8%A6%81%E7%B4%A0/SR%E5%88%86%E5%AE%A4%E3%81%AE%E6%9B%B2%E3%83%BB%E6%BC%94%E5%87%BA%E3%81%AE%E8%A7%A3%E6%94%BE%E6%9D%A1%E4%BB%B6', function (err, res) {
            if (err) return reject(err);
            const dataHtml = res.text.slice(res.text.indexOf('No.</th>'), res.text.indexOf('</table>', res.text.lastIndexOf('No.</th>')));
            const bgmTrackRegex = /<tr>.*?>(\d+)?<\/td><td [^>]+>([A-Z])?<\/td><td [^>]+>([.\s\S]*?)<\/td><\/tr>/g;
            let bgmTrackMatch;
            let trackNo;

            while ((bgmTrackMatch = bgmTrackRegex.exec(dataHtml))) {
                if (bgmTrackMatch[1])
                    trackNo = parseInt(bgmTrackMatch[1]);
                const variant = bgmTrackMatch[2] || null;
                let locationJP = bgmTrackMatch[3].replace(/\n/g, '');
                let notesJP = null;
                const noteTextMatch = /<a id="notetext\_.*?data\-tippy\-content="(.*?)&lt;div .*?<\/a>/g.exec(locationJP);
                if (noteTextMatch) {
                    notesJP = noteTextMatch[1].replace(/&lt;.*?&gt;/g, '');
                    locationJP = locationJP.slice(0, noteTextMatch.index);
                }
                locationJP = locationJP.replace(/<a .*?>(.*?)<\/a>/g, '<a href="#">$1</a>').replace(/<[^>]+>/g, '');
                const bgmTrackMatches = bgmTrackData.filter(t => t.trackNo === trackNo && t.variant === variant);
                if (bgmTrackMatches.length) {
                    const bgmTrack = bgmTrackMatches[0];
                    bgmTrack.locationJP = locationJP;
                    bgmTrack.notesJP = notesJP;
                }
            }

            resolve();
        });
    });
}

function updateBgmTrack(pool, bgmTrack) {
    return new Promise((resolve, reject) => {
        const name = `'${bgmTrack.name.replace(/'/g, "''")}'`;
        const location = bgmTrack.location ? `'${bgmTrack.location.replace(/'/g, "''")}'` : 'NULL';
        const locationJP = bgmTrack.locationJP ? `'${bgmTrack.locationJP}'` : 'NULL';
        const worldId = bgmTrack.worldId != null ? `${bgmTrack.worldId}` : 'NULL';
        const url = bgmTrack.url ? `'${bgmTrack.url.replace(/'/g, "''")}'` : 'NULL';
        const notes = bgmTrack.notes ? `'${bgmTrack.notes.replace(/'/g, "''")}'` : 'NULL';
        const notesJP = bgmTrack.notesJP ? `'${bgmTrack.notesJP}'` : 'NULL';
        const removed = bgmTrack.removed ? '1' : '0';
        pool.query(`UPDATE bgm_tracks SET name=${name}, location=${location}, locationJP=${locationJP}, worldId=${worldId}, url=${url}, notes=${notes}, notesJP=${notesJP}, removed=${removed} WHERE id=${bgmTrack.id}`, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteRemovedBgmTracks(pool, removedBgmTrackIds) {
    return new Promise((resolve, reject) => {
        let i = 0;
        let deleteBgmTracksQuery = 'DELETE FROM bgm_tracks WHERE id IN (';
        for (let bgmTrackId of removedBgmTrackIds) {
            if (i++)
                deleteBgmTracksQuery += ', ';
            deleteBgmTracksQuery += bgmTrackId;
        }
        deleteBgmTracksQuery += ')';
        pool.query(deleteBgmTracksQuery, (err, _) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function downloadImage(imageUrl, filename) {
    return new Promise((resolve, reject) => {
        const options = {
            url: imageUrl,
            dest: 'public/images/worlds/' + filename
        };
        
        return download.image(options)
            .then(({ filename }) => {
                console.log('Saved to', filename);
                resolve();
            })
            .catch((err) => reject(err));
    });
}

if (isMainThread) {
    app.post('/updateBgmTrackWorldImageOrdinal', function(req, res) {
        if (req.body.hasOwnProperty('bgmTrackId') && req.body.hasOwnProperty('ordinal')) {
            getConnPool().then(pool => {
                pool.query(`UPDATE bgm_tracks SET worldImageOrdinal=${req.body.ordinal} WHERE id=${req.body.bgmTrackId}`, (err, _) => {
                    if (err) console.error(err);
                    res.json({
                        success: !err
                    });
                    pool.end();
                });
            });
        }
    });

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
}

function getLocationPageContent(location) {
    return new Promise((resolve, reject) => {
        const query = { action: 'query', titles: `${apiTitlePrefix}${location}`, prop: 'revisions', rvslots: '*', rvprop: 'content', formatversion: 2, format: 'json' };
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
            title: `${apiTitlePrefix}${entry.location}`,
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

    let locationBoxSection = sliceHtml(content, locationBoxSectionStartIndex, locationBoxSectionEndIndex);

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

    return `${sliceHtml(content, 0, locationBoxSectionStartIndex)}${locationBoxSection}${sliceHtml(content, locationBoxSectionEndIndex)}`;
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

function sanitizeWorldName(worldName) {
    return worldName.replace(/%26/g, "&").replace(/%27/g, "'").replace(/\_/g, " ").replace(/#.*/, "");
}

function updateWorldDataForChance(worldData) {
    const matchWorld = worldData.find(w => enc(w.title) === '00070001140010100110000990010400032000830011600114001010010100116');
    if (matchWorld)
        matchWorld.title = dec('65314652936531465313653246532400032653166532165325653176532665331653216532765326');
}

// Slice large HTML strings without keeping the original in scope
function sliceHtml(html, start, end) {
    return (' ' + html.slice(start, end)).substr(1);
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

function setUpdateTask(task) {
    if (isMainThread) {
        if (updateTaskStartTime)
            console.log(`Task ${updateTask} took ${Math.floor(performance.now() - updateTaskStartTime)}ms`);
        updateTask = task;
        if (task) {
            console.log(`Task ${updateTask} started`);
            updateTaskStartTime = performance.now();
        } else
            updateTaskStartTime = null;
    } else
        parentPort.postMessage({ updateTask: task });
}

if (isMainThread) {
    app.get('/getMapLocationNames', function(req, res) {
        const mapId = req.query.mapId;
        const prevMapId = req.query.prevMapId;
        const prevLocationName = req.query.prevLocationName;
        let prevLocationNames = req.query.prevLocationNames;
        if (!prevLocationNames)
            prevLocationNames = [];
        else if (!Array.isArray(prevLocationNames))
            prevLocationNames = [prevLocationNames];
        if (prevLocationName)
            prevLocationNames.push(prevLocationName);
        const mapIdPattern = /^\d{4}$/;
        res.setHeader('Access-Control-Allow-Origin', 'https://ynoproject.net');
        if (mapId && mapIdPattern.test(mapId) && (!prevMapId || mapIdPattern.test(prevMapId))) {
            getConnPool().then(pool => {
                getMapLocationNames(mapId, prevMapId, prevLocationNames, pool)
                    .then(data => res.json(data))
                    .catch(err => {
                        console.error(err);
                        res.json({ error: 'Failed to query map location names', err_code: 'QUERY_FAILED' });
                    })
                    .finally(() => pool.end());
            }).catch(err => {
                console.error(err);
                res.json({ error: 'Failed to connect to database', err_code: 'DB_CONN_FAILED' });
            });
        } else
            res.json({ error: 'Invalid request', err_code: 'INVALID_REQUEST' });
    });
}

function getMapLocationNames(mapId, prevMapId, prevLocationNames, pool) {
    return new Promise((resolve, reject) => {
        let query = `
            SELECT w.id, w.title, w.titleJP
            FROM worlds w
            JOIN world_maps wm
                ON wm.worldId = w.id
            JOIN maps m
                ON m.id = wm.mapId
            WHERE m.mapId = '${mapId}'
        `;
        if (prevMapId) {
            const prevLocationClause = prevLocationNames.length
                ? (prevLocationNames.length === 1
                    ? ` AND w2.title = '${prevLocationNames[0].replace(/'/g, "''")}'`
                    : ` AND w2.title IN ('${prevLocationNames.map(l => l.replace(/'/g, "''")).join("', '")}')`)
                : '';
            query += `
                AND EXISTS (
                    SELECT w2.id FROM worlds w2
                    JOIN conns w2c
                        ON w2c.sourceId = w2.id OR w2c.targetId = w2.id
                    JOIN world_maps wm2
                        ON wm2.worldId = w2.id
                    JOIN maps m2
                        ON m2.id = wm2.mapId
                    WHERE m2.mapId = '${prevMapId}'
                        ${prevLocationClause}AND (w2c.sourceId = w.id OR w2c.targetId = w.id)
                )
            `;
        }
        queryWithRetry(pool, query, (err, rows) => {
            if (err) return reject(err);
            const ret = [];
            for (let row of rows)
                ret.push({ title: row.title, titleJP: row.titleJP });
            if (prevLocationNames.length && !ret.length)
                getMapLocationNames(mapId, prevMapId, [], pool)
                    .then(data => resolve(data))
                    .catch(err => reject(err));
            else
                resolve(ret);
        });
    });
}

if (isMainThread) {
    app.get('/getConnectedLocations', function(req, res) {
        const locationName = req.query.locationName;
        let connLocationNames = req.query.connLocationNames;
        res.setHeader('Access-Control-Allow-Origin', 'https://ynoproject.net');
        if (locationName) {
            if (connLocationNames && !Array.isArray(connLocationNames))
                connLocationNames =  [ connLocationNames ];
            getConnPool().then(pool => {
                getConnectedLocations(locationName, connLocationNames, pool)
                    .then(data => res.json(data))
                    .catch(err => {
                        console.error(err);
                        res.json({ error: 'Failed to query connected locations', err_code: 'QUERY_FAILED' });
                    })
                    .finally(() => pool.end());
            }).catch(err => {
                console.error(err);
                res.json({ error: 'Failed to connect to database', err_code: 'DB_CONN_FAILED' });
            });
        } else
            res.json({ error: 'Invalid request', err_code: 'INVALID_REQUEST' });
    });
}

function getConnectedLocations(locationName, connLocationNames, pool) {
    return new Promise((resolve, reject) => {
        let query = `
            SELECT DISTINCT cw.title
            FROM worlds w
            JOIN conns c
                ON c.sourceId = w.id OR c.targetId = w.id
            JOIN worlds cw
                ON cw.id <> w.id AND (cw.id = c.sourceId OR cw.id = c.targetId)
            WHERE w.title = '${locationName.replace(/'/g, "''")}'`;
        if (connLocationNames) {
            query += `AND cw.title ${connLocationNames.length === 1
                ? `= '${connLocationNames[0].replace(/'/g, "''")}'`
                : `IN ('${connLocationNames.map(l => l.replace(/'/g, "''")).join("', '")}')`}`;
        }
        query += ' ORDER BY cw.depth';
        queryWithRetry(pool, query, (err, rows) => {
            if (err) return reject(err);
            const ret = [];
            for (let row of rows)
                ret.push(row.title);
            resolve(ret);
        });
    });
}

if (isMainThread) {
    app.get('/getLocationMaps', function(req, res) {
        const locationName = req.query.locationName;
        let locationNames = req.query.locationNames;
        if (!locationNames)
            locationNames = [];
        else if (!Array.isArray(locationNames))
            locationNames = [locationNames];
        if (locationName)
            locationNames.push(locationName);
        res.setHeader('Access-Control-Allow-Origin', 'https://ynoproject.net');
        if (locationNames.length) {
            getConnPool().then(pool => {
                getLocationMaps(locationNames, pool)
                    .then(data => res.json(data))
                    .catch(err => {
                        console.error(err);
                        res.json({ error: 'Failed to query location maps', err_code: 'QUERY_FAILED' });
                    })
                    .finally(() => pool.end());
            }).catch(err => {
                console.error(err);
                res.json({ error: 'Failed to connect to database', err_code: 'DB_CONN_FAILED' });
            });
        } else
            res.json({ error: 'Invalid request', err_code: 'INVALID_REQUEST' });
    });
}

function getLocationMaps(locationNames, pool) {
    return new Promise((resolve, reject) => {
        let query = `
            SELECT w.mapUrl, w.mapLabel
            FROM worlds w
            WHERE w.title `;
        query += locationNames.length === 1
            ? `= '${locationNames[0].replace(/'/g, "''")}'`
            : `IN ('${locationNames.map(l => l.replace(/'/g, "''")).join("', '")}')`;
        query += ' ORDER BY w.depth';
        queryWithRetry(pool, query, (err, rows) => {
            if (err) return reject(err);
            const ret = [];
            for (let row of rows) {
                if (row.mapUrl) {
                    const urls = row.mapUrl.split('|');
                    const labels = (row.mapLabel || '').split('|');
                    const mapCount = Math.min(urls.length, labels.length);
                    for (let m = 0; m < mapCount; m++)
                        ret.push({ url: urls[m], label: labels[m] })
                }
            }
            resolve(ret);
        });
    });
}

if (isMainThread) {
    app.get('/getLocationInfo', function(req, res) {
        const locationName = req.query.locationName;
        res.setHeader('Access-Control-Allow-Origin', 'https://ynoproject.net');
        if (locationName) {
            const includeRemoved = req.query.includeRemoved === '1';
            const ignoreSecret = req.query.ignoreSecret === '1';
            getConnPool().then(pool => {
                getLocationInfo(locationName, includeRemoved, ignoreSecret, pool)
                    .then(data => res.json(data))
                    .catch(err => {
                        console.error(err);
                        res.json({ error: 'Failed to query location info', err_code: 'QUERY_FAILED' });
                    })
                    .finally(() => pool.end());
            }).catch(err => {
                console.error(err);
                res.json({ error: 'Failed to connect to database', err_code: 'DB_CONN_FAILED' });
            });
        } else
            res.json({ error: 'Invalid request', err_code: 'INVALID_REQUEST' });
    });
}

function getLocationInfo(locationName, includeRemoved, ignoreSecret, pool) {
    return new Promise((resolve, reject) => {
        let query =  `
            SELECT w.title,
                w.titleJP,
                w.author,
                w.depth,
                w.minDepth,
                w.secret,
                m.mapId
            FROM maps m
            JOIN world_maps wm ON wm.mapId = m.id
            JOIN
                (SELECT w.id,
                        w.title,
                        w.titleJP,
                        w.author,
                        w.depth,
                        w.minDepth,
                        w.secret
                FROM worlds w
                WHERE w.title = '${locationName.replace(/'/g, "''")}'
                    ${includeRemoved ? '' : 'AND w.removed = 0'}
                    ${ignoreSecret ? 'AND w.secret = 0' : ''}
            ) w ON w.id = wm.worldId`;
        queryWithRetry(pool, query, (err, rows) => {
            if (err) return reject(err);
            let ret;
            for (let row of rows) {
                if (!ret) {
                    ret = {
                        title: row.title,
                        titleJP: row.titleJP,
                        author: row.author,
                        depth: row.depth,
                        minDepth: row.minDepth,
                        secret: row.secret,
                        mapIds: []
                    };
                }
                ret.mapIds.push(row.mapId);
            }
            resolve(ret);
        });
    });
}

if (isMainThread) {
    app.get('/getLocationColors', function(req, res) {
        const locationName = req.query.locationName;
        res.setHeader('Access-Control-Allow-Origin', 'https://ynoproject.net');
        if (locationName) {
            getConnPool().then(pool => {
                getLocationColors(locationName, pool)
                    .then(data => res.json(data))
                    .catch(err => {
                        console.error(err);
                        res.json({ error: 'Failed to query location maps', err_code: 'QUERY_FAILED' });
                    })
                    .finally(() => pool.end());
            }).catch(err => {
                console.error(err);
                res.json({ error: 'Failed to connect to database', err_code: 'DB_CONN_FAILED' });
            });
        } else
            res.json({ error: 'Invalid request', err_code: 'INVALID_REQUEST' });
    });
}

function getLocationColors(locationName, pool) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT w.fgColor, w.bgColor
            FROM worlds w
            WHERE w.title = '${locationName.replace(/'/g, "''")}'
        `;
        queryWithRetry(pool, query, (err, rows) => {
            if (err) return reject(err);
            let ret = { fgColor: null, bgColor: null };
            if (rows.length)
                ret = rows[0];
            resolve(ret);
        });
    });
}

if (isMainThread) {
    app.get('/getRandomLocations', function(req, res) {
        let count = req.query.count ? Math.min(parseInt(req.query.count), 10) : 1;
        if (isNaN(count))
            count = 1;
        let minDepth = req.query.minDepth ? parseInt(req.query.minDepth) : 0;
        if (isNaN(minDepth))
            minDepth = 0;
        let maxDepth = req.query.maxDepth ? parseInt(req.query.maxDepth) : 25;
        if (isNaN(maxDepth))
            maxDepth = 25;
        if (count > 0 && minDepth >= 0 && maxDepth >= minDepth) {
            const includeRemoved = req.query.includeRemoved === '1';
            const ignoreSecret = req.query.ignoreSecret === '1';
            getConnPool().then(pool => {
                getRandomLocations(count, minDepth, maxDepth, includeRemoved, ignoreSecret, pool)
                    .then(data => res.json(data))
                    .catch(err => {
                        console.error(err);
                        res.json({ error: 'Failed to query random locations', err_code: 'QUERY_FAILED' });
                    })
                    .finally(() => pool.end());
            }).catch(err => {
                console.error(err);
                res.json({ error: 'Failed to connect to database', err_code: 'DB_CONN_FAILED' });
            });
        } else
            res.json({ error: 'Invalid request', err_code: 'INVALID_REQUEST' });
    });
}

function getRandomLocations(count, minDepth, maxDepth, includeRemoved, ignoreSecret, pool) {
    return new Promise((resolve, reject) => {
        let query =  `
            SELECT w.title,
                w.titleJP,
                w.depth,
                w.minDepth,
                m.mapId
            FROM maps m
            JOIN world_maps wm ON wm.mapId = m.id
            JOIN
                (SELECT w.id,
                        w.title,
                        w.titleJP,
                        w.depth,
                        w.minDepth
                FROM worlds w
                WHERE w.depth >= ${minDepth}
                    AND w.depth <= ${maxDepth}
                    ${includeRemoved ? '' : 'AND w.removed = 0'}
                    ${ignoreSecret ? 'AND w.secret = 0' : ''}
                HAVING
                    (SELECT COUNT(wm.id)
                    FROM world_maps wm
                    WHERE wm.worldId = w.id) > 0
                ORDER BY RAND()
                LIMIT ${count}) w ON w.id = wm.worldId
            ORDER BY w.depth`;
        queryWithRetry(pool, query, (err, rows) => {
            if (err) return reject(err);
            const ret = [];
            for (let row of rows) {
                if (!ret.length || row.title !== ret[ret.length - 1].title) {
                    ret.push({
                        title: row.title,
                        titleJP: row.titleJP,
                        depth: row.depth,
                        minDepth: row.minDepth,
                        mapIds: []
                    });
                }
                ret[ret.length - 1].mapIds.push(row.mapId);
            }
            resolve(ret);
        });
    });
}

if (isMainThread) {
    if (process.platform === 'linux') {
        fs.unlinkSync('./explorer.sock');
        app.listen('./explorer.sock', () => {
            fs.chmod('./explorer.sock', 0o777, () => {});
            console.log('Yume 2kki Explorer app listening on explorer.sock');
        });
    } else
        app.listen(port, () => console.log(`Yume 2kki Explorer app listening on port ${port}`));
} else {
    function updateWorldData(reset) {
        return new Promise((resolve, reject) => {
            getConnPool().then(pool => {
                const callback = function (success) {
                    pool.end();
                    resolve(success);
                };
                const errCallback = function (err) {
                    pool.end();
                    reject(err);
                };

                if (reset === 'true')
                    populateWorldData(pool).then(() => callback(true)).catch(err => errCallback(err));
                else {
                    pool.query('SELECT lastUpdate FROM updates', (err, rows) => {
                        if (err)
                            errCallback(err);
                        else if (rows && rows.length) {
                            setUpdateTask('prepareWorldData');
                            getWorldData(pool, true).then(worldData => {
                                getUpdatedWorldNames(worldData.map(w => w.title), rows[0].lastUpdate)
                                    .then(updatedWorldNames => populateWorldData(pool, worldData, updatedWorldNames).then(() => callback(true)))
                                    .catch(err => errCallback(err));
                                }).catch(err => errCallback(err));
                        } else
                            callback(false);
                    });
                }
            }).catch(err => reject(err));
        });
    }

    function updateMiscData(reset) {
        return new Promise((resolve, reject) => {
            getConnPool().then(pool => {
                const callback = function (success) {
                    pool.end();
                    resolve(success);
                };
                const errCallback = function (err) {
                    pool.end();
                    reject(err);
                };

                if (reset === 'true') {
                    setUpdateTask('prepareWorldData');
                    getWorldData(pool, true).then(worldData => {
                        updateMapData(pool, worldData).then(() => {
                            updateAuthorInfoData(pool).then(() => {
                                updateVersionInfoData(pool).then(() => {
                                    updateEffectData(pool, worldData).then(() => {
                                        updateMenuThemeData(pool, worldData).then(() => {
                                            updateWallpaperData(pool, worldData).then(() => {
                                                updateBgmTrackData(pool, worldData).then(() => {
                                                    pool.query('UPDATE updates SET lastUpdate=NOW(), lastFullUpdate=NOW()', err => {
                                                        if (err)
                                                            return errCallback(err);
                                                        callback(true);
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    }).catch(err => errCallback(err));
                } else {
                    pool.query('SELECT lastUpdate FROM updates', (err, rows) => {
                        if (err)
                            errCallback(err);
                        else if (rows && rows.length) {
                            setUpdateTask('prepareWorldData');
                            getWorldData(pool, true).then(worldData => {
                                checkUpdateMapData(pool, worldData, rows[0].lastUpdate).then(() => {
                                    checkUpdateAuthorInfoData(pool, rows[0].lastUpdate).then(() => {
                                        checkUpdateVersionInfoData(pool, rows[0].lastUpdate).then(() => {
                                            checkUpdateEffectData(pool, worldData, rows[0].lastUpdate).then(() => {
                                                checkUpdateMenuThemeData(pool, worldData, rows[0].lastUpdate).then(() => {
                                                    checkUpdateWallpaperData(pool, worldData, rows[0].lastUpdate).then(() => {
                                                        checkUpdateBgmTrackData(pool, worldData, rows[0].lastUpdate).then(() => {
                                                            pool.query('UPDATE updates SET lastUpdate=NOW()', err => {
                                                                if (err)
                                                                    return errCallback(err);
                                                                callback(true);
                                                            });
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
                            }).catch(err => errCallback(err));
                        } else
                            callback(false);
                    });
                }
            });
        });
    }

    parentPort.on('message', value => {
        updateWorldData(value.reset).then(success => {
            if (success) {
                updateMiscData(value.reset)
                    .then(success => parentPort.postMessage({ success: success }))
                    .catch(err => {
                        console.error(err);
                        parentPort.postMessage({ success: false });
                    });
            } else
                parentPort.postMessage({ success: false });
        }).catch(err => {
            console.error(err);
            parentPort.postMessage({ success: false });
        });
    });
}
