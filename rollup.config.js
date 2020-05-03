import resolve from '@rollup/plugin-node-resolve';
import commonJs from '@rollup/plugin-commonjs';
import { terser } from "rollup-plugin-terser";
import inject from '@rollup/plugin-inject';
import visualizer from 'rollup-plugin-visualizer';
import { name, homepage, version } from './package.json';

const umdConf = {
  format: 'umd',
  name: 'Y2E',
  banner: `// Version ${version} ${name} - ${homepage}`
};

export default [
  { // UMD
    input: 'src/index.js',
    output: [
      /*{
        ...umdConf,
        file: `dist/${name}.js`,
        sourcemap: true
      },
      {
        ...umdConf,
        file: `dist/${name}.min.js`,
        plugins: [terser({
          output: { comments: '/Version/' }
        })]
      },*/
      {
        ...umdConf,
        file: `public/js/${name}.js`,
        sourcemap: true
      }
    ],
    plugins: [
      resolve(),
      commonJs(),
      inject({
        jQuery: 'jquery'
      }),
      visualizer()
    ]
  }
];