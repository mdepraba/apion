const { readFile } = require('node:fs/promises');
const { transform } = require('@swc/core');

/**
 * esbuild does not implement `emitDecoratorMetadata`, and NestJS resolves
 * constructor dependencies from exactly that metadata. Without it every
 * provider injected by type alone arrives as `undefined` at runtime, which
 * looks like a DI bug rather than a build setting.
 *
 * This routes .ts through SWC, which does emit it, and lets esbuild handle
 * bundling. It is scoped to .ts only: .tsx and .js need none of this.
 */
module.exports = function swcDecoratorMetadata() {
  return {
    name: 'swc-decorator-metadata',
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        // node_modules ships compiled output; re-running SWC over it is waste.
        if (args.path.includes('node_modules')) return undefined;

        const source = await readFile(args.path, 'utf8');

        const { code } = await transform(source, {
          filename: args.path,
          sourceMaps: 'inline',
          jsc: {
            parser: { syntax: 'typescript', decorators: true },
            transform: {
              legacyDecorator: true,
              decoratorMetadata: true,
            },
            target: 'es2022',
            // Nest reads metadata off the class at decoration time, so the
            // fields have to exist as assignments, not as bare declarations.
            keepClassNames: true,
          },
          module: { type: 'es6' },
        });

        return { contents: code, loader: 'js' };
      });
    },
  };
};
