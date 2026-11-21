const superagent = require('superagent');

const queues = new Map();
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function getWiki(url, query, headers) {
    const host = new URL(url).host;
    if (!queues.has(host))
        queues.set(host, { slots: [Promise.resolve(), Promise.resolve()], index: 0, turn: Promise.resolve(), nextStart: 0, retryAt: 0 });
    const queue = queues.get(host);
    const timeout = ['wikiwiki.jp', 'web.archive.org'].includes(host)
        ? { response: 20000, deadline: 20000 } : { response: 60000, deadline: 120000 };
    const slot = queue.index++ % queue.slots.length;
    const pending = queue.slots[slot].then(async () => {
        for (let attempt = 0; ; attempt++) {
            const turn = queue.turn.then(async () => {
                while (Math.max(queue.nextStart, queue.retryAt) > Date.now())
                    await wait(Math.max(queue.nextStart, queue.retryAt) - Date.now());
                queue.nextStart = Date.now() + 100;
            });
            queue.turn = turn.catch(() => {});
            await turn;
            try {
                const response = await superagent.get(url).set(headers || {}).query(query || {}).timeout(timeout);
                if (response.body?.error)
                    throw new Error(`Wiki API error at ${url}: ${response.body.error.info || response.body.error.code}`);
                return response;
            } catch (err) {
                const status = err.status || err.response?.status;
                if (attempt >= 3 || ![429, 502, 503, 504].includes(status)) {
                    err.message = `${url}: ${err.message}`;
                    throw err;
                }
                const retryAfter = err.response?.headers?.['retry-after'];
                const retryDelay = retryAfter == null ? 0 : /^\d+$/.test(retryAfter)
                    ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
                const delay = Math.max(2000 * 2 ** attempt, retryDelay || 0);
                console.warn(`Wiki request returned ${status}; retrying ${url} in ${Math.ceil(delay / 1000)}s (${attempt + 1}/3)`);
                queue.retryAt = Math.max(queue.retryAt, Date.now() + delay);
            }
        }
    });
    queue.slots[slot] = pending.catch(() => {});
    return pending;
}

async function getFileInfo(titles, queryApi) {
    const files = new Map();
    const aliases = new Map();
    const uniqueTitles = [...new Set(titles.map(title => title.replace(/_/g, ' ')))];
    const fetchBatch = async titles => {
        const data = await queryApi({ titles: titles.join('|'), prop: 'imageinfo', iiprop: 'size|url', iiurlwidth: 320, iiurlheight: 240, redirects: 1 });
        for (const alias of [...(data.query.normalized || []), ...(data.query.redirects || [])])
            aliases.set(alias.from, alias.to);
        for (const page of Object.values(data.query.pages || {}))
            files.set(page.title, { id: page.pageid, ...page.imageinfo?.[0] });
    };
    for (let i = 0; i < uniqueTitles.length; i += 100)
        await Promise.all([uniqueTitles.slice(i, i + 50), uniqueTitles.slice(i + 50, i + 100)]
            .filter(batch => batch.length)
            .map(fetchBatch));
    for (const title of uniqueTitles) {
        let canonical = title;
        const visited = new Set();
        while (aliases.has(canonical) && !visited.has(canonical)) {
            visited.add(canonical);
            canonical = aliases.get(canonical);
        }
        if (files.has(canonical))
            files.set(title, files.get(canonical));
    }
    return files;
}

async function getAudioUrls(urls, queryApi) {
    const titles = urls.map(url => decodeURIComponent(/\/(?:2kki\/)?(File:[^?#]+)/i.exec(url)[1]).replace(/_/g, ' '));
    const files = await getFileInfo(titles, queryApi);
    return new Map(urls.map((url, index) => {
        const file = files.get(titles[index]);
        if (!file?.url)
            throw new Error(`No audio URL returned for ${titles[index]}; keeping existing soundtrack data`);
        return [url, file.url.replace(/\/revision\/latest.*$/, '')];
    }));
}

async function getWorldImages(worlds, queryApi) {
    if (!worlds.length)
        return [];
    const imagesByTitle = new Map();
    const requested = new Set(worlds.map(world => world.title));
    const pageTitles = new Map();
    let categoryContinue;
    do {
        const data = await queryApi({ list: 'categorymembers', cmtitle: 'Category:Yume 2kki Locations', cmlimit: 'max', ...categoryContinue });
        for (const page of data.query.categorymembers) {
            // The wrapper uses the part between the first and second colons as the world name.
            const title = page.title.split(':')[1];
            if (requested.has(title))
                pageTitles.set(title, page.title);
        }
        categoryContinue = data.continue;
    } while (categoryContinue);
    if (!pageTitles.size)
        throw new Error('No world image pages found in the wiki category; keeping existing image data');
    const titles = [...pageTitles.values()];
    for (let i = 0; i < titles.length; i += 50) {
        let continuation;
        do {
            const data = await queryApi({ titles: titles.slice(i, i + 50).join('|'), prop: 'images', imlimit: 'max', ...continuation });
            for (const page of Object.values(data.query.pages || {})) {
                if (!imagesByTitle.has(page.title))
                    imagesByTitle.set(page.title, new Set());
                for (const image of page.images || [])
                    imagesByTitle.get(page.title).add(image.title);
            }
            continuation = data.continue;
        } while (continuation);
    }
    const files = await getFileInfo([...imagesByTitle.values()].flatMap(images => [...images]), queryApi);
    return worlds.map(world => ({
        title: world.title,
        images: [...(imagesByTitle.get(pageTitles.get(world.title)) || [])]
            .map(title => files.get(title))
            .filter(image => image?.url)
            .sort((a, b) => a.id - b.id)
            .map(image => ({ url: image.thumburl || image.url, width: image.thumbwidth || image.width, height: image.thumbheight || image.height }))
    }));
}

module.exports = { getWiki, getAudioUrls, getWorldImages };
