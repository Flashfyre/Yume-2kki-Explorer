function wikiText(html) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return html.replace(/<[^>]+>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
        if (code[0] !== '#')
            return entities[code.toLowerCase()];
        const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    }).trim();
}

function parseEffectHeading(heading) {
    const headline = /<span\b[^>]*class="[^"]*\bmw-headline\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(heading);
    return wikiText(headline ? headline[1] : heading);
}

function parseJapaneseEffectName(section) {
    const match = /[（(]\s*([^,，、)）]+)(?:[,，、][^）)]*)?[）)]/.exec(wikiText(section));
    return match && /[\u3040-\u30ff\u3400-\u9fff]/.test(match[1]) ? match[1].trim() : null;
}

function createEffectNameNormalizer(namesJP) {
    const names = { ...namesJP, Instructions: '説明書' };
    const foldKana = name => name.normalize('NFKC').replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
    const englishByJapanese = new Map(Object.entries(names).map(([en, jp]) => [foldKana(jp), en]));
    return effect => {
        if (names[effect.name])
            return { ...effect, nameJP: effect.nameJP || names[effect.name] };
        // Older imports mistook the bold pronunciation for the English heading.
        const japanese = (effect.nameJP || effect.name || '').replace(/^[（(]\s*/, '').split(/[,，、)）]/, 1)[0].trim();
        const english = englishByJapanese.get(foldKana(japanese));
        return english ? { ...effect, name: english, nameJP: effect.nameJP || japanese } : effect;
    };
}

module.exports = { wikiText, parseEffectHeading, parseJapaneseEffectName, createEffectNameNormalizer };
