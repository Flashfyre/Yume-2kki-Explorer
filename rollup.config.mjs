import resolve from '@rollup/plugin-node-resolve';
import commonJs from '@rollup/plugin-commonjs';
import { terser } from "rollup-plugin-terser";
import inject from '@rollup/plugin-inject';
import pkg from './package.json' assert { type: "json" };

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
      resolve(),
      commonJs(),
      inject({
        jQuery: 'jquery'
      })
    ]
  }
];