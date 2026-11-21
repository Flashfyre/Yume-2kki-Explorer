const { createHash } = require('node:crypto');

// Encode raw spaces and Unicode without encoding existing URL escapes again.
function encodeImageUrl(url) {
    return url == null ? url : encodeURI(url).replace(/%25([0-9a-f]{2})/gi, '%$1');
}

function repairWorldImageFilename(filename) {
    if (!filename)
        return filename;

    // Older imports encoded the wiki URL twice. Local filenames before the
    // separator were never URL-encoded and must be left alone.
    const urlStart = filename.lastIndexOf('|') + 1;
    const url = filename.slice(urlStart);
    const match = /^https:\/\/yume\.wiki\/images\/([0-9a-f])\/([0-9a-f]{2})\/([^?#]+)$/i.exec(url);
    if (!match || !/%25[0-9a-f]{2}/i.test(match[3]))
        return filename;

    const repaired = match[3].replace(/%25([0-9a-f]{2})/gi, '%$1');
    try {
        // Wiki image directories contain the first two MD5 digits of the
        // decoded filename. Only repair when that confirms the original name;
        // a legitimate filename containing literal "%27" must keep its escapes.
        const matchesHash = name => {
            const hash = createHash('md5').update(decodeURIComponent(name)).digest('hex');
            return hash[0] === match[1] && hash.slice(0, 2) === match[2];
        };
        if (!matchesHash(match[3]) && matchesHash(repaired))
            return filename.slice(0, urlStart) + url.slice(0, url.length - match[3].length) + repaired;
    } catch (err) {
        // An invalid escape is not evidence of double encoding.
    }
    return filename;
}

module.exports = { encodeImageUrl, repairWorldImageFilename };

