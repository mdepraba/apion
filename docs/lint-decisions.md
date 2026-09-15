# Disabled lint rules and why

Every rule turned off in `biome.json` is recorded here with its reason, so a
future reader can tell a considered exception from an inherited one. A rule
without an entry here should be switched back on.

## `complexity/useLiteralKeys` (off, workspace-wide)

`tsconfig.base.json` sets `noPropertyAccessFromIndexSignature`, so TypeScript
*requires* `body['message']` when reading an unknown-shaped object. Biome wants
`body.message`. The two cannot both be satisfied, and the TypeScript setting is
the one carrying real safety: it forces every read of untrusted JSON to be
explicit about the fact that the key may not exist.

## `style/noDescendingSpecificity` (off, workspace-wide)

Flags a lower-specificity selector appearing after a higher-specificity one,
which in plain CSS can mean an accidental override. In CSS Modules the classes
are locally scoped and the pattern it flags is deliberate: a base rule for
`.input`, then a state rule such as `.fieldset:disabled .input` above it. The
warning fires on correct code often enough that acting on it would mean
reordering rules away from how they read.

## `correctness/noUnusedFunctionParameters` (off, `apps/api/**` only)

NestJS injects constructor dependencies by type. A parameter such as
`constructor(@Inject(DATABASE) private readonly db: Database)` is used through
`this.db`, but Biome sees the parameter itself as unread. Off only for the API,
where the pattern is unavoidable; the SPA and the libraries keep the rule.

## `complexity/noImportantStyles` (off, `apps/web/src/styles.css` only)

The single `!important` block is the `prefers-reduced-motion` override, which
has to beat any animation declared further down the cascade or in a component
module. That is the documented pattern for the media query, and it applies to
exactly one rule in one file.

## `style/useImportType` and import organising (off, `apps/api/**` only)

Biome rewrites `import { JwtService }` to `import type { JwtService }` whenever
a class is only referenced in a type position. For NestJS that is wrong in a way
that compiles cleanly and fails at runtime: the constructor parameter type *is*
the dependency-injection token, emitted into `design:paramtypes`. A type-only
import has no runtime binding, so the emitted metadata degrades to `Object` and
Nest reports `can't resolve dependencies ... argument at index [n]`.

This bit once already, taking the whole API down after a formatting pass. Both
the rule and the import-organiser assist are off for the API; everywhere else
they stay on.

## `css.parser.tailwindDirectives` (on, whole workspace)

The SPA styles with Tailwind 4, whose configuration is written in CSS rather
than in a JavaScript config file: `@theme`, `@utility` and `@import
"tailwindcss"` all appear in `apps/web/src/styles.css`. Biome's CSS parser
rejects those as unknown at-rules unless this is set, so without it the one
file holding the design system cannot be linted or formatted at all.

This widens what the CSS parser accepts; it turns no lint rule off. Plain CSS
elsewhere in the workspace is parsed exactly as before.
