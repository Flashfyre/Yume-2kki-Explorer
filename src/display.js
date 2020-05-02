export function hueToRGBA(h, a) {
    let s = 1, v = 1, r, g, b, i, f, p, q, t;
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

export let uiThemeBgColors = {};

export let uiThemeFontColors = {};

export function getFontColor(uiTheme, fontStyle, callback) {
    if (!uiThemeFontColors[uiTheme])
        uiThemeFontColors[uiTheme] = {};
    let pixel = uiThemeFontColors[uiTheme][fontStyle];
    if (pixel)
        return callback(`rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, 1)`);
    const img = new Image();
    img.onload = function () {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        pixel = context.getImageData(0, 8, 1, 1).data;
        uiThemeFontColors[uiTheme][fontStyle] = [ pixel[0], pixel[1], pixel[2] ];
        callback(`rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, 1)`);
        canvas.remove();
    };
    img.src = `./images/ui/${uiTheme}/font${(fontStyle + 1)}.png`;
}

export function getBaseBgColor(uiTheme, callback) {
    const img = new Image();
    let pixel = uiThemeBgColors[uiTheme];
    if (pixel)
        return callback(`rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, 1)`);
    img.onload = function () {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        pixel = context.getImageData(0, 0, 1, 1).data;
        const pixel2 = context.getImageData(4, 4, 1, 1).data;
        const pixel3 = context.getImageData(8, 8, 1, 1).data;
        const r = Math.round((pixel[0] + pixel2[0] + pixel3[0]) / 3);
        const g = Math.round((pixel[1] + pixel2[1] + pixel3[1]) / 3);
        const b = Math.round((pixel[2] + pixel2[2] + pixel3[2]) / 3);
        uiThemeBgColors[uiTheme] = [ r, g, b ];
        callback(`rgba(${r}, ${g}, ${b}, 1)`);
        canvas.remove();
    };
    img.src = `./images/ui/${uiTheme}/containerbg.png`;
}
