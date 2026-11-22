const connectionProperties = [
    'Origin', 'Location', 'Attribute', 'Unlock conditions', 'Effects needed',
    'Season available', 'Chance percentage', 'Chance description', 'Is removed'
];

async function getWorldConnections(queryWiki) {
    const connections = new Map();
    for (const order of ['asc', 'desc']) {
        const precedingIds = new Set(connections.keys());
        const seenOffsets = new Set();
        let offset = 0;
        while (true) {
            const data = await queryWiki({
                action: 'askargs',
                api_version: '3',
                conditions: 'Yume 2kki:+|Is subobject type::connection',
                printouts: connectionProperties.map(property => `Connection/${property}`).join('|'),
                parameters: `limit=500|offset=${offset}|order=${order}`
            });
            if (data.error || !data.query?.results || data.query.meta?.offset == null)
                throw new Error('Invalid wiki connection response');

            // Semantic MediaWiki silently resets offsets beyond its query limit to zero.
            if (Number(data.query.meta.offset) !== offset || seenOffsets.has(offset)) {
                if (order === 'desc' || !connections.size)
                    throw new Error('Wiki connection pagination restarted before all connections were fetched');
                break;
            }
            seenOffsets.add(offset);

            let overlaps = false;
            for (const result of Object.values(data.query.results)) {
                for (const [id, connection] of Object.entries(result)) {
                    if (connections.has(id)) {
                        overlaps ||= precedingIds.has(id);
                        continue;
                    }
                    connections.set(id, parseWikiConnection(connection.printouts));
                }
            }

            if (order === 'desc' && overlaps)
                return Array.from(connections.values());

            const nextOffset = Number(data['query-continue-offset']);
            if (!nextOffset) {
                if (order === 'desc')
                    throw new Error('Wiki connection pages did not overlap; retry the data update');
                return Array.from(connections.values());
            }
            if (nextOffset <= offset) {
                if (order === 'desc' || !connections.size)
                    throw new Error('Wiki connection pagination did not advance');
                break;
            }
            offset = nextOffset;
        }
    }
}

function parseWikiConnection(printouts) {
    const values = property => printouts[`Connection/${property}`] || [];
    const title = property => (values(property)[0]?.fulltext || '').replace(/^Yume 2kki:/, '');
    return {
        origin: title('Origin'),
        destination: title('Location'),
        attributes: values('Attribute'),
        unlockCondition: values('Unlock conditions')[0],
        effectsNeeded: values('Effects needed'),
        seasonAvailable: values('Season available')[0],
        chancePercentage: values('Chance percentage')[0],
        chanceDescription: values('Chance description')[0],
        isRemoved: values('Is removed')[0] === 't'
    };
}

module.exports = { getWorldConnections };
