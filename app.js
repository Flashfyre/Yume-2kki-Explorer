const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
const _ = require('lodash');
const superagent = require('superagent');
const fs = require('fs');
const download = require('image-downloader');
const mysql = require("mysql");

var pool;
if (process.env.DATABASE_URL) {
    let dbUrl = process.env.DATABASE_URL.slice(8);
    let user = dbUrl.slice(0, dbUrl.indexOf(":"));
    let password = dbUrl.slice(dbUrl.indexOf(":") + 1, dbUrl.indexOf("@"));
    let host = dbUrl.slice(dbUrl.indexOf("@") + 1, dbUrl.indexOf("/"));
    let database = dbUrl.slice(dbUrl.indexOf("/") + 1, dbUrl.indexOf("?") > -1 ? dbUrl.indexOf("?") : dbUrl.length);
    pool = mysql.createPool({
        host: host,
        user: user,
        password: password,
        database: database
    });
    console.log(dbUrl);
} else {
    const dbConfig = require("./config/db.config.js");

    pool = mysql.createPool({
        host: dbConfig.HOST,
        user: dbConfig.USER,
        password: dbConfig.PASSWORD,
        database: dbConfig.DB
    });
}

module.exports = pool;

pool.query(`CREATE TABLE IF NOT EXISTS worlds (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    depth INT NOT NULL,
    filename VARCHAR(255) NOT NULL
)`);

pool.query(`CREATE TABLE IF NOT EXISTS conns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sourceId INT NOT NULL,
    targetId INT NOT NULL,
    type TINYINT NOT NULL,
    CONSTRAINT fk_sourceId
        FOREIGN KEY (sourceId) 
        REFERENCES world(id),
    CONSTRAINT fk_targetId
        FOREIGN KEY (targetId) 
        REFERENCES world(id)
)`);

app.use(express.static('public'))

app.get('/', (req, res) => res.sendFile('index.html', { root: '.' }))

const startLocation = "Urotsuki's Room";

const batchSize = 20;

app.get('/worlds', function(req, res) {
    let callback = function (worldData) {
        res.json(worldData);
    };
    if (req.query.hasOwnProperty("update") && req.query.update) {
        populateWorldData(function (worldData) {
            console.log(worldData);
            getWorldData(callback);
        });
    } else {
        getWorldData(callback);
    }
});

function populateWorldData(callback) {
    let worldData = [];
    superagent.get('https://yume2kki.fandom.com/api.php')
        .query({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Locations', cmlimit: 500, format: 'json' })
        .end((err, res) => {
        if (err) { return console.log(err); }
        let data = JSON.parse(res.text);
        let worlds = data.query.categorymembers;
        populateWorldDataSub(worldData, worlds, 0, worlds.length <= batchSize, function () {
            updateWorldDepths(worldData, callback);
        });
    });
}

function getWorldData(callback) {
    let worldDataById = {};
    pool.query('SELECT id, title, depth, filename FROM worlds', (err, rows) => {
        if (err) throw err;
        for (var r in rows) {
            let row = rows[r];
            worldDataById[row.id] = {
                title: row.title,
                depth: row.depth,
                filename: row.filename,
                connections: []
            };
        }
        let worldData = Object.values(worldDataById);
        for (var d in worldData)
            worldData[d].id = parseInt(d);
        pool.query('SELECT sourceId, targetId, type FROM conns', (err, rows) => {
            if (err) throw err;
            for (var r in rows) {
                let row = rows[r];
                worldDataById[row.sourceId].connections.push({
                    targetId: worldDataById[row.targetId].id,
                    type: row.type
                });
            }
            callback(worldData);
        });
    });
}

function populateWorldDataSub(worldData, worlds, batchIndex, lastBatch, callback) {
    let worldsKeyed = _.keyBy(worlds.slice(batchIndex * batchSize, Math.min((batchIndex + 1) * batchSize, worlds.length)),
        function(w) {
            return w.pageid;
        }
    );
    getBaseWorldData(worldsKeyed, function (data) {
        let newWorldsByName = _.keyBy(Object.values(data), (w) => w.title);
        let worldNames = Object.keys(newWorldsByName);
        for (var d in data)
            worldData.push(data[d]);
        pool.query('SELECT id, title FROM worlds', (err, rows) => {
            if (err) throw err;
            for (var r in rows) {
                let worldName = rows[r].title;
                if (worldNames.indexOf(worldName) > -1) {
                    let world = newWorldsByName[worldName];
                    world.id = rows[r].id;
                    delete newWorldsByName[worldName];
                }
            }
            let newWorldNames = Object.keys(newWorldsByName);
            if (newWorldNames.length) {
                var i = 0;
                var worldsQuery = "INSERT INTO worlds (title, depth, filename) VALUES "
                for (let w in newWorldsByName) {
                    let newWorld = newWorldsByName[w];
                    if (i++) {
                        worldsQuery += ", ";
                    }
                    worldsQuery += `('${newWorld.title.replace("'", "''")}', 0, '${newWorld.filename.replace("'", "''")}')`;
                }
                pool.query(worldsQuery, (error, res) => {
                    if (error) throw error;
                    let insertedRows = res.affectedRows;
                    let worldRowIdsQuery = `SELECT r.id FROM (SELECT id FROM worlds ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                    pool.query(worldRowIdsQuery, (err, rows) => {
                        if (err) throw err;
                        for (var r in rows) {
                            newWorldsByName[newWorldNames[r]].id = rows[r].id;
                        }
                        if (lastBatch) {
                            let worldDataByName = _.keyBy(worldData, (w) => w.title);
                            updateConns(worldDataByName, callback);
                        } else {
                            populateWorldDataSub(worldData, worlds, ++batchIndex, (batchIndex + 1) * batchSize >= worlds.length, callback);
                        }
                    });
                });
            } else if (lastBatch) {
                let worldDataByName = _.keyBy(worldData, (w) => w.title);
                updateConns(worldDataByName, callback);
            } else {
                populateWorldDataSub(worldData, worlds, ++batchIndex, (batchIndex + 1) * batchSize >= worlds.length, callback);
            }
        });
    });
}

function getBaseWorldData(worlds, callback) {
    let pageIds = Object.keys(worlds);
    superagent.get('https://yume2kki.fandom.com/api.php')
        .query({ action: 'query', pageids: pageIds.join("|"), prop: "categories", cllimit: 50, format: "json" })
        .end((err, res) => {
        if (err) { return console.log(err); }
        let query = JSON.parse(res.text).query;
        if (!query)
            callback(worlds);
        worlds = query.pages;
        var reqCount = 0;
        var reqTotal = pageIds.length;
        for (var p in pageIds) {
            let pageId = pageIds[p];
            let world = worlds[parseInt(pageId)];
            let categories = world.categories;
            var skip = false;
            if (world.title.indexOf("Board Thread") > -1 || world.title === "Dream Worlds")
                skip = true;
            else if (categories) {
                for (var c in categories) {
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
                if (reqCount === --reqTotal) {
                    callback(worlds);
                }
                continue;
            }
            delete world.pageid;
            delete world.categories;
            delete world.ns;
            (function(pageId, world) {
                getWorldInfo(world.title, function (worldInfo) {
                    world = _.extend(world, worldInfo);
                    worlds[pageId] = world;
                    if (++reqCount === reqTotal) {
                        callback(worlds);
                    }
                });
            })(pageId, world);
        }
    });
}

function updateConns(worldDataByName, callback) {
    let newConnsByKey = {};
    let existingConns = [];
    let worldNames = Object.keys(worldDataByName);
    for (var w in worldDataByName) {
        let world = worldDataByName[w];
        for (var c in world.connections) {
            let conn = world.connections[c];
            if (worldNames.indexOf(conn.location) > -1) {
                conn.sourceId = world.id;
                conn.targetId = worldDataByName[conn.location].id;
                let key = `${conn.sourceId}_${conn.targetId}`;
                newConnsByKey[key] = conn;
            }
        }
    }
    pool.query('SELECT id, sourceId, targetId FROM conns', (err, rows) => {
        if (err) throw err;
        for (var r in rows) {
            let key = `${rows[r].sourceId}_${rows[r].targetId}`;
            let conn = newConnsByKey[key];
            conn.id = rows[r].id;
            existingConns.push(conn);
            delete newConnsByKey[key];
        }
        let existingConnsByType = _.groupBy(existingConns, 'type');
        let insertCallback = function () {
            if (Object.keys(existingConnsByType).length)
                updateConnsOfType(existingConnsByType, 0, callback);
            else
                callback();
        }
        let newConnKeys = Object.keys(newConnsByKey);
        if (newConnKeys.length) {
            var i = 0;
            var connsQuery = "INSERT INTO conns (sourceId, targetId, type) VALUES "
            for (var c in newConnsByKey) {
                let conn = newConnsByKey[c];
                if (i++)
                    connsQuery += ", ";
                connsQuery += `(${conn.sourceId}, ${conn.targetId}, ${conn.type})`;
            }
            pool.query(connsQuery, (err, res) => {
                if (err) throw err;
                let insertedRows = res.affectedRows;
                let connRowIdsQuery = `SELECT r.id FROM (SELECT id FROM conns ORDER BY id DESC LIMIT ${insertedRows}) r ORDER BY 1`;
                pool.query(connRowIdsQuery, (err, rows) => {
                    if (err) throw err;
                    for (var r in rows) {
                        newConnsByKey[newConnKeys[r]].id = rows[r].id;
                    }
                    insertCallback();
                });
            });
        } else
            insertCallback();
    });
}

function updateConnsOfType(existingConnsByType, t, callback) {
    let existingConnTypes = Object.keys(existingConnsByType);
    let type = existingConnTypes[t];
    let conns = existingConnsByType[type];
    var i = 0;
    var updateConnsQuery = `UPDATE conns SET type=${type} WHERE id IN (`
    for (var c in conns) {
        if (i++)
            updateConnsQuery += ", ";
        updateConnsQuery += conns[c].id;
    }
    updateConnsQuery += ")";
    pool.query(updateConnsQuery, (err, _) => {
        if (err) throw err;
        if (++t < existingConnTypes.length)
            updateConnsOfType(existingConnsByType, t, callback);
        else
            callback();
    });
}

function updateWorldDepths(worldData, callback) {
    let depthMap = {};

    for (var w in worldData) {
        depthMap[worldData[w].title] = -1;
    }

    calcDepth(worldData, depthMap, null, 0);

    for (var w in worldData) {
        if (worldData[w].depth === undefined)
            worldData[w].depth = 1;
    }

    let worldsByDepth = _.groupBy(worldData, 'depth');

    if (Object.keys(worldsByDepth).length)
        updateWorldsOfDepth(worldsByDepth, 0, function() {
            callback(worldData);
        });
    else
        callback(worldData);
}

function calcDepth(worldData, depthMap, world, depth) {
    let worldDataByName = _.keyBy(worldData, (w) => w.title);
    let worldNames = Object.keys(worldDataByName);
    var currentWorld;
    if (depth > 0) {
        currentWorld = world;
    } else {
        currentWorld = worldDataByName[startLocation];
        currentWorld.depth = depthMap[currentWorld.title] = depth;
    }
    for (var c in currentWorld.connections) {
        let conn = currentWorld.connections[c];
        let w = conn.location;
        if (worldNames.indexOf(w) > -1) {
            if (conn.type >= 2)
                continue;
            let d = depthMap[w];
            if (d === -1 || d > depth + 1) {
                worldDataByName[w].depth = depthMap[w] = depth + 1;
                calcDepth(worldData, depthMap, worldDataByName[w], depth + 1);
            }
        } else {
            let dc = world.title + " -> " + w;
            console.log("DEAD CONNECTION: ", dc);
        }
    }
    return depth;
}

function updateWorldsOfDepth(worldsByDepth, d, callback) {
    let worldDepths = Object.keys(worldsByDepth);
    let depth = worldDepths[d];
    let worlds = worldsByDepth[depth];
    var i = 0;
    var updateDepthsQuery = `UPDATE worlds SET depth=${depth} WHERE id IN (`
    for (var w in worlds) {
        if (i++)
            updateDepthsQuery += ", ";
        updateDepthsQuery += worlds[w].id;
    }
    updateDepthsQuery += ")";
    pool.query(updateDepthsQuery, (err, _) => {
        if (err) throw err;
        if (++d < worldDepths.length)
            updateWorldsOfDepth(worldsByDepth, d, callback);
        else
            callback();
    });
}

function getWorldInfo(worldName, callback) {
    superagent.get('https://yume2kki.fandom.com/wiki/' + worldName, function (err, res) {
        if (err) throw err;
        worldName = worldName.replace(/\_/g, " ");
        var imageUrl = res.text.split(';"> <a href="https://vignette.wikia.nocookie.net')[1];
        imageUrl = "https://vignette.wikia.nocookie.net" + imageUrl.slice(0, imageUrl.indexOf('"'));
        let ext = imageUrl.slice(imageUrl.lastIndexOf("."), imageUrl.indexOf("/", imageUrl.lastIndexOf(".")));
        try {
            if (!fs.existsSync("./public/images/worlds/" + worldName + ext)) {
                downloadImage(imageUrl, worldName + ext);
            }
        } catch (err) {
            console.error(err)
        }
        callback({
            connections: getConnections(res.text),
            filename: worldName + ext
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

function getConnections(html) {
    let ret = [];
    html = html.slice(html.indexOf("<b>Connecting Areas</b>"), html.indexOf("<b>BGM</b>"));
    areas = html.split(/(?:<p>|, +)<a href="/);
    if (areas.length > 1) {
        for (var a = 1; a < areas.length; a++) {
            var connType = 0;
            let areaText = areas[a];
            let urlIndex = areaText.indexOf("/wiki/") + 6;
            if (areaText.indexOf("NoReturn") > -1) {
                connType = 1;
            } else if (areaText.indexOf("NoEntry") > -1) {
                connType = 2;
            }
            ret.push({
                location: areaText.slice(urlIndex, areaText.indexOf('"', urlIndex)).replace(/%26/g, "&").replace(/%27/g, "'").replace(/\_/g, " ").replace(/#.*/, ""),
                type: connType
            });
        }
    }
    return ret;
}

app.listen(port, () => console.log(`2kki app listening on port ${port}!`))