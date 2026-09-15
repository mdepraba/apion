import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JobsService } from '../../infra/jobs.service.js';
import { LintService } from './lint.service.js';

/**
 * PRD 03: the `check all` sweep runs "in chunks of 25, yielding between chunks
 * and streaming progress".
 *
 * One chunk per slice. The job returns `done: false` while a cursor remains, so
 * the runner requeues it and the next poll picks it up: that gap is the yield,
 * and it is what keeps a 1,500-endpoint sweep from monopolising the vCPU.
 */
@Injectable()
export class LintSweepRegistrar implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly lint: LintService,
  ) {}

  onApplicationBootstrap(): void {
    this.jobs.register('lint_sweep', async (context) => {
      const projectId =
        context.projectId ?? String(context.payload['projectId']);
      const cursor = (context.progress['cursor'] as string | null) ?? null;
      const alreadyChecked = Number(context.progress['checked'] ?? 0);

      const { checked, nextCursor } = await this.lint.sweepChunk(
        projectId,
        cursor,
      );

      return {
        progress: { cursor: nextCursor, checked: alreadyChecked + checked },
        done: nextCursor === null,
      };
    });
  }
}
