import type { Database } from '@apion/db';
import { Controller, Get, Header, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../modules/auth/auth.guard.js';
import { DATABASE } from './database.module.js';

/**
 * PRD 07: "Expose RSS, p99 event-loop lag and Postgres connection count at
 * `/metrics`." Both routes are excluded from the `/api/v1` prefix so a
 * deployment health gate and a scraper can reach them at fixed paths.
 */
@Controller()
export class HealthController {
  private lagSamples: number[] = [];
  private lastSampleAt = process.hrtime.bigint();

  constructor(@Inject(DATABASE) private readonly db: Database) {
    this.sampleEventLoopLag();
  }

  @Public()
  @Get('health')
  async health(): Promise<{ status: 'ok' | 'degraded'; database: boolean }> {
    const database = await this.db
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false);

    return { status: database ? 'ok' : 'degraded', database };
  }

  @Public()
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    const memory = process.memoryUsage();
    const connections = await this.postgresConnectionCount();

    return [
      '# HELP apion_process_resident_bytes Resident set size of the API process.',
      '# TYPE apion_process_resident_bytes gauge',
      `apion_process_resident_bytes ${memory.rss}`,
      '# HELP apion_process_heap_used_bytes Heap in use.',
      '# TYPE apion_process_heap_used_bytes gauge',
      `apion_process_heap_used_bytes ${memory.heapUsed}`,
      '# HELP apion_event_loop_lag_p99_seconds Event-loop lag, 99th percentile over the sample window.',
      '# TYPE apion_event_loop_lag_p99_seconds gauge',
      `apion_event_loop_lag_p99_seconds ${this.eventLoopLagP99().toFixed(6)}`,
      '# HELP apion_postgres_connections Backends currently connected to this database.',
      '# TYPE apion_postgres_connections gauge',
      `apion_postgres_connections ${connections}`,
      '',
    ].join('\n');
  }

  private async postgresConnectionCount(): Promise<number> {
    const rows = await this.db
      .execute<{ count: number }>(
        sql`select count(*)::int as count from pg_stat_activity where datname = current_database()`,
      )
      .catch(() => null);

    return rows?.[0]?.count ?? 0;
  }

  /**
   * Samples the gap between a scheduled and an actual timer tick. A one-second
   * interval over a 60-sample window costs nothing measurable and is enough to
   * see the control plane starving, which is the risk PRD 08 flags for mocks.
   */
  private sampleEventLoopLag(): void {
    const interval = setInterval(() => {
      const now = process.hrtime.bigint();
      const elapsedSeconds = Number(now - this.lastSampleAt) / 1e9;
      this.lastSampleAt = now;

      this.lagSamples.push(Math.max(0, elapsedSeconds - 1));
      if (this.lagSamples.length > 60) this.lagSamples.shift();
    }, 1000);

    // Never hold the process open for a metrics sample.
    interval.unref();
  }

  private eventLoopLagP99(): number {
    if (this.lagSamples.length === 0) return 0;
    const sorted = [...this.lagSamples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
    return sorted[index];
  }
}
