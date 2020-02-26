const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
const superagent = require('superagent');
const fs = require('fs');
const download = require('image-downloader');

app.use(express.static('public'))

app.get('/', (req, res) => res.sendFile('index.html', { root: '.' }))

app.get('/world/:worldName', function(req, res) {
    (async function(){
        const response = await superagent.get('https://yume2kki.fandom.com/wiki/' + req.params.worldName);
        var worldName = req.params.worldName.replace(/\_/g, " ");
        var imageUrl = response.text.split(';"> <a href="https://vignette.wikia.nocookie.net')[1];
        if (imageUrl) {
            imageUrl = "https://vignette.wikia.nocookie.net" + imageUrl.slice(0, imageUrl.indexOf('"'));
            var ext = imageUrl.slice(imageUrl.lastIndexOf("."), imageUrl.indexOf("/", imageUrl.lastIndexOf(".")));
            try {
                if (!fs.existsSync("./images/worlds/" + worldName + ext)) {
                    downloadImage(imageUrl, worldName + ext);
                }
            } catch(err) {
                console.error(err)
            }
        }
        res.json(
            {
                connections: getConnections(response.text),
                filename: worldName + ext
            }
        );
    })();
});

function downloadImage(imageUrl, filename) {
    options = {
        url: imageUrl,
        dest: 'public/images/' + (filename = (filename + ext))
    };
    
    download.image(options)
        .then(({ filename, image }) => {
            console.log('Saved to', filename);
        })
        .catch((err) => console.error(err));
}

function getConnections(html) {
    var ret = [];
    html = html.slice(html.indexOf("<b>Connecting Areas</b>"), html.indexOf("<b>BGM</b>"));
    areas = html.split(/(?:<p>|, +)<a href="/);
    if (areas.length > 1) {
        for (var a = 1; a < areas.length; a++) {
            var connType = 0;
            var areaText = areas[a];
            var urlIndex = areaText.indexOf("/wiki/") + 6;
            if (areaText.indexOf("NoReturn") > -1) {
                connType = 1;
            } else if (areaText.indexOf("NoEntry") > -1) {
                connType = 2;
            }
            ret.push({
                location: areaText.slice(urlIndex, areaText.indexOf('"', urlIndex)).replace(/%26/g, "&").replace(/%27/g, "'").replace(/\_/, " ").replace(/#.*/, ""),
                type: connType
            });
        }
    }
    return ret;
}

app.listen(port, () => console.log(`2kki app listening on port ${port}!`))