import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JobsService } from '../../infra/jobs.service.js';
import { MockLogService } from './mock-log.service.js';

/**
 * PRD 05's retention: detailed mock logs for 48 hours, daily aggregates for 90
 * days. The job also reaps finished job rows, which is the only other table
 * that grows purely with activity.
 *
 * It reschedules itself hourly, so retention holds without a cron on the host.
 */
@Injectable()
export class LogPruneRegistrar implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly logs: MockLogService,
  ) {}

  onApplicationBootstrap(): void {
    this.jobs.register('log_prune', async () => {
      const pruned = await this.logs.prune();
      const jobRows = await this.jobs.pruneFinished(
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      );

      await this.jobs.enqueueAfter('log_prune', null, {}, 60 * 60 * 1000);

      return {
        progress: {
          logs: pruned.logs,
          stats: pruned.stats,
          jobs: jobRows,
        },
        done: true,
      };
    });

    void this.jobs.enqueueUnique('log_prune', null);
  }
}
