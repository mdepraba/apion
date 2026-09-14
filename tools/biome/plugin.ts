import { dirname } from 'node:path';
import type {
  CreateNodes,
  CreateNodesResultArray,
} from 'nx/src/project-graph/plugins/public-api';

export interface BiomePluginOptions {
  lintTargetName?: string;
  lintFixTargetName?: string;
  lintFixUnsafeTargetName?: string;
  formatTargetName?: string;
  checkTargetName?: string;
}

const projectFilePattern = '**/{project.json,package.json}';

function targets(projectRoot: string, options: BiomePluginOptions) {
  const {
    lintTargetName = 'lint',
    lintFixTargetName = 'lint:fix',
    lintFixUnsafeTargetName = 'lint:fix-unsafe',
    formatTargetName = 'format',
    checkTargetName = 'check',
  } = options;

  // Biome resolves its own config by walking up to the root biome.json, so each
  // target only needs to scope itself to the project directory.
  const run = (args: string) => ({
    command: `biome ${args} .`,
    options: { cwd: projectRoot },
  });

  return {
    [lintTargetName]: {
      ...run('lint'),
      cache: true,
      inputs: ['default', '{workspaceRoot}/biome.json'],
      metadata: { technologies: ['biome'] },
    },
    [lintFixTargetName]: {
      ...run('check --write'),
      metadata: { technologies: ['biome'] },
    },
    // Biome withholds fixes that can change behaviour (`x == y` to `x === y`)
    // unless --unsafe is passed, so they get an opt-in target of their own.
    [lintFixUnsafeTargetName]: {
      ...run('check --write --unsafe'),
      metadata: { technologies: ['biome'] },
    },
    [formatTargetName]: {
      ...run('format --write'),
      metadata: { technologies: ['biome'] },
    },
    // `check` runs the linter and formatter together and is what CI should call.
    [checkTargetName]: {
      ...run('check'),
      cache: true,
      inputs: ['default', '{workspaceRoot}/biome.json'],
      metadata: { technologies: ['biome'] },
    },
  };
}

export const createNodes: CreateNodes<BiomePluginOptions> = [
  projectFilePattern,
  (configFiles, options): CreateNodesResultArray => {
    const seen = new Set<string>();

    return configFiles.flatMap((configFile) => {
      const projectRoot = dirname(configFile);

      // A project with both a project.json and a package.json matches the
      // pattern twice, and the second match would overwrite the first.
      if (projectRoot === '.' || seen.has(projectRoot)) {
        return [];
      }
      seen.add(projectRoot);

      return [
        [
          configFile,
          {
            projects: {
              [projectRoot]: {
                targets: targets(projectRoot, options ?? {}),
              },
            },
          },
        ] as const,
      ];
    });
  },
];
