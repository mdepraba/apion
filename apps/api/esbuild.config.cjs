const swcDecoratorMetadata = require('../../tools/esbuild/swc-decorator-metadata.cjs');

/**
 * esbuild options for the API bundle. This file exists rather than an inline
 * `esbuildOptions` because the build needs a plugin, and the Nx executor
 * accepts either the inline options or this file, not both.
 *
 * The plugin is not optional: NestJS resolves constructor dependencies from
 * `emitDecoratorMetadata`, which esbuild does not implement. See
 * tools/esbuild/swc-decorator-metadata.cjs.
 */
module.exports = {
  plugins: [swcDecoratorMetadata()],
  sourcemap: true,
  // Nest and Fastify both reach for CommonJS globals from inside ESM output.
  banner: {
    js: "import { createRequire as __apionCreateRequire } from 'module'; const require = __apionCreateRequire(import.meta.url);",
  },
};
