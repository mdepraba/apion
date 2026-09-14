import { createFileRoute, redirect } from '@tanstack/react-router';
import { versionsQuery } from '../../../../api/queries.js';

/**
 * A project on its own has nothing to show: the work happens inside a version.
 * This resolves the one a person means (the earliest draft, or the newest
 * published version if the project has no draft) and hands off.
 */
export const Route = createFileRoute('/_app/projects/$slug/')({
  loader: async ({ context, params }) => {
    const versions = await context.queryClient.ensureQueryData(
      versionsQuery(params.slug),
    );

    const target =
      versions.find((version) => version.state === 'draft') ??
      versions.filter((version) => version.state === 'published').at(-1) ??
      versions[0];

    if (!target) {
      throw new Error(
        'This project has no contract version. That should not happen; report it.',
      );
    }

    throw redirect({
      to: '/projects/$slug/versions/$versionId',
      params: { slug: params.slug, versionId: target.id },
    });
  },
});
