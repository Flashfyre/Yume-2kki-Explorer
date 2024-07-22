#!/usr/bin/env node
import { build } from 'esbuild';
import pkg from './package.json' assert { type: "json" };

build({
  entryPoints: ['src/index.js'],
  format: 'iife',
  outfile: `public/js/${pkg.name}.js`,
  sourcemap: true,
  bundle: true,
  minify: true,
})
