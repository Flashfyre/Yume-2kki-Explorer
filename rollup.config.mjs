import resolve from '@rollup/plugin-node-resolve';
import commonJs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import inject from '@rollup/plugin-inject';
import json from '@rollup/plugin-json';
import pkg from './package.json' with { type: "json" };
import fs from 'node:fs';

const umdConf = {
  format: 'umd',
  name: 'Y2E',
  banner: `// Version ${pkg.version} ${pkg.name} - ${pkg.homepage}`
};

export default [
  { // UMD
    input: 'src/index.js',
    output: [
      {
        ...umdConf,
        file: `dist/${pkg.name}.js`,
        sourcemap: true
      },
      {
        ...umdConf,
        file: `dist/${pkg.name}.min.js`,
        plugins: [terser({
          output: { comments: '/Version/' }
        })]
      },
      {
        ...umdConf,
        file: `public/js/${pkg.name}.js`,
        sourcemap: true
      }
    ],
    plugins: [
      {
        name: 'version-assets',
        writeBundle() {
          for (const filename of ['index.html', 'location.html']) {
            const html = fs.readFileSync(filename, 'utf8');
            const versioned = html
              .replace(/(href="\/css\/(?:index|mobile|vendor\/green-audio-player)\.css)(?:\?[^\"]*)?"/g, `$1?v=${pkg.version}"`)
              .replace(/(src="\/js\/yume-2kki-explorer\.js)(?:\?([^\"]*))?"/g, (_, src, query) => {
                const params = new URLSearchParams(query);
                params.set('v', pkg.version);
                return `${src}?${params}"`;
              });
            if (versioned !== html)
              fs.writeFileSync(filename, versioned);
          }
        }
      },
      resolve(),
      json(),
      commonJs(),
      inject({
        jQuery: 'jquery'
      })
    ]
  }
];
