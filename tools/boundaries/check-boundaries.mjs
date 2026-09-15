/**
 * Enforces the dependency rules in docs/prd/07-platform-architecture-and-operations.md:
 *
 *   - applications may import libraries; no library imports an application
 *   - `domain` is framework-free
 *   - `contracts` imports no other library
 *
 * The workspace lints with Biome, which has no module-boundary rule, so this
 * reads the Nx project graph directly instead of going through
 * @nx/enforce-module-boundaries and its ESLint dependency.
 */
import { createProjectGraphAsync } from '@nx/devkit';

/** Packages `domain` must not reach, so it stays runnable without a framework. */
const FRAMEWORK_PACKAGES = [
  '@nestjs/',
  'fastify',
  '@fastify/',
  'react',
  'react-dom',
  '@tanstack/',
  'drizzle-orm',
  'postgres',
  'pg-boss',
];

function tagsOf(graph, name) {
  return graph.nodes[name]?.data?.tags ?? [];
}

function isWorkspaceProject(graph, name) {
  return Boolean(graph.nodes[name]);
}

async function main() {
  const graph = await createProjectGraphAsync({ exitOnError: false });
  const violations = [];

  for (const [source, deps] of Object.entries(graph.dependencies)) {
    const sourceTags = tagsOf(graph, source);
    if (sourceTags.length === 0) continue;

    const sourceIsLib = sourceTags.includes('type:lib');

    for (const dep of deps) {
      const target = dep.target;

      if (sourceIsLib && isWorkspaceProject(graph, target)) {
        if (tagsOf(graph, target).includes('type:app')) {
          violations.push(
            `${source} imports the application ${target}. Libraries must not depend on applications.`,
          );
        }
      }

      if (sourceTags.includes('scope:contracts') && isWorkspaceProject(graph, target)) {
        violations.push(
          `${source} imports ${target}. The contracts library must not import any other library.`,
        );
      }

      if (
        sourceTags.includes('scope:domain') &&
        FRAMEWORK_PACKAGES.some((pkg) => target.startsWith(`npm:${pkg}`))
      ) {
        violations.push(
          `${source} imports ${target.replace(/^npm:/, '')}. The domain library must stay framework-free.`,
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error('Module boundary violations:\n');
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error(
      '\nSee docs/prd/07-platform-architecture-and-operations.md, "Code boundaries".',
    );
    process.exit(1);
  }

  console.log('Module boundaries OK.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
