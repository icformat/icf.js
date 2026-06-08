import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM build + bundled type declarations
  {
    entry: { icf: 'src/index.ts' },
    format: ['esm'],
    dts: { entry: 'src/index.ts' },
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: 'es2020',
    outExtension: () => ({ js: '.js' }),
  },
  // IIFE global (window.ICF), readable
  {
    entry: { 'icf.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'ICF',
    sourcemap: true,
    target: 'es2020',
    outExtension: () => ({ js: '.js' }),
  },
  // IIFE global (window.ICF), minified
  {
    entry: { 'icf.min': 'src/index.ts' },
    format: ['iife'],
    globalName: 'ICF',
    minify: true,
    sourcemap: true,
    target: 'es2020',
    outExtension: () => ({ js: '.js' }),
  },
]);
