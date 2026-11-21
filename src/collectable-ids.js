const BGM_UNNUMBERED_OFFSET = 10000;
const BGM_UNUSED_OFFSET = 20000;
const WALLPAPER_ID_RANGE = 10000;

function getWallpaperNumber(wallpaper) {
    if (!wallpaper.removed)
        return wallpaper.wallpaperId;
    return wallpaper.wallpaperId < WALLPAPER_ID_RANGE
        ? wallpaper.wallpaperId - 1000
        : wallpaper.wallpaperId % WALLPAPER_ID_RANGE;
}

module.exports = { BGM_UNNUMBERED_OFFSET, BGM_UNUSED_OFFSET, WALLPAPER_ID_RANGE, getWallpaperNumber };
