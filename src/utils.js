export function checkIsMobile(userAgent) {
    return /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|ipad|iris|kindle|Android|Silk|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i
        .test(userAgent)
        || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i
        .test(userAgent.substr(0,4));
}

export function formatDate (date, lang, showTime) {
    const formatFunc = showTime ? date.toLocaleString : date.toLocaleDateString;
    const isEn = lang === 'en';
    return formatFunc.apply(date, [ isEn ? 'en-US' : 'ja-JP', showTime ? { timeZoneName: 'short' } : {} ]);
}

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