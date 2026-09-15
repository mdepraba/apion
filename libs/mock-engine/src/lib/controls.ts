/**
 * PRD 05's resilience controls. "Headers can request a capped fixed/range
 * delay, failure rate, forced timeout or deliberately malformed JSON. No more
 * than 20 delayed requests are held; later requests proceed with a warning
 * header."
 *
 * Every cap here is a product requirement rather than a tuning choice: a mock
 * that can be told to hold 500 connections for five seconds is a way to take
 * the control plane down from a client test.
 */

/** PRD 07: "a 20-connection/5-second delay cap". */
export const MAX_DELAY_MS = 5_000;
export const MAX_HELD_REQUESTS = 20;
/** PRD 05: "Generated payloads are capped at 1 MB". */
export const MAX_PAYLOAD_BYTES = 1024 * 1024;

export interface FaultControls {
  delayMs: number;
  /** 0 to 1. A seeded draw decides, so a deterministic request stays so. */
  failureRate: number;
  /** Hold the connection without answering, to exercise a client timeout. */
  forceTimeout: boolean;
  /** Answer with a body that is not valid JSON, on purpose. */
  malformed: boolean;
  /** Set when a requested value was clamped, so the caller can say so. */
  clamped: string[];
}

export const NO_FAULTS: FaultControls = {
  delayMs: 0,
  failureRate: 0,
  forceTimeout: false,
  malformed: false,
  clamped: [],
};

export interface FaultHeaders {
  delay?: string;
  failureRate?: string;
  timeout?: string;
  malformed?: string;
}

/**
 * `X-Mock-Delay: 250` or `X-Mock-Delay: 100-400` for a range. A value over the
 * cap is clamped rather than refused: the client asked for slowness and gets as
 * much as the host can safely give.
 */
export function parseFaults(
  headers: FaultHeaders,
  random: { int: (min: number, max: number) => number; next: () => number },
): FaultControls {
  const clamped: string[] = [];
  let delayMs = 0;

  if (headers.delay) {
    const range = headers.delay.split('-').map((part) => Number(part.trim()));
    const requested =
      range.length === 2 && range.every((value) => Number.isFinite(value))
        ? random.int(range[0], range[1])
        : Number(headers.delay);

    if (Number.isFinite(requested) && requested > 0) {
      delayMs = Math.min(requested, MAX_DELAY_MS);
      if (requested > MAX_DELAY_MS) clamped.push('delay');
    }
  }

  let failureRate = 0;
  if (headers.failureRate) {
    const requested = Number(headers.failureRate);
    if (Number.isFinite(requested) && requested > 0) {
      failureRate = Math.min(Math.max(requested, 0), 1);
    }
  }

  return {
    delayMs,
    failureRate,
    forceTimeout: headers.timeout === 'true' || headers.timeout === '1',
    malformed: headers.malformed === 'true' || headers.malformed === '1',
    clamped,
  };
}

/**
 * Counts the requests currently being held. Past the cap a request proceeds
 * immediately with a warning header rather than queueing, which is what stops
 * the mock from consuming every connection the process has.
 */
export class DelayGate {
  private held = 0;

  get inFlight(): number {
    return this.held;
  }

  /** Returns whether the delay was honoured. */
  async hold(delayMs: number): Promise<boolean> {
    if (delayMs <= 0) return true;
    if (this.held >= MAX_HELD_REQUESTS) return false;

    this.held += 1;
    try {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(delayMs, MAX_DELAY_MS)),
      );
      return true;
    } finally {
      this.held -= 1;
    }
  }
}

/**
 * PRD 05: "Cache deterministic responses in a roughly 32 MB LRU keyed by
 * endpoint/version/selection/seed; invalidate on contract save and bypass
 * random, stateful and fault-injected calls."
 *
 * Size is tracked in bytes rather than entries, because one 1 MB payload and a
 * thousand 200-byte ones are very different things to a 1 GB host.
 */
export class ResponseCache {
  private readonly entries = new Map<string, { body: string; bytes: number }>();
  private bytes = 0;

  constructor(private readonly maxBytes = 32 * 1024 * 1024) {}

  get size(): number {
    return this.bytes;
  }

  get count(): number {
    return this.entries.size;
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    // Re-insertion is what makes the Map an LRU: iteration order is insertion
    // order, so the oldest key is always the first one out.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.body;
  }

  set(key: string, body: string): void {
    const bytes = Buffer.byteLength(body, 'utf8');
    // Nothing larger than the cache itself is worth evicting everything for.
    if (bytes > this.maxBytes) return;

    const existing = this.entries.get(key);
    if (existing) {
      this.bytes -= existing.bytes;
      this.entries.delete(key);
    }

    this.entries.set(key, { body, bytes });
    this.bytes += bytes;

    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const evicted = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      this.bytes -= evicted?.bytes ?? 0;
    }
  }

  /** Called on contract save: everything for one project stops being valid. */
  invalidateProject(projectId: string): void {
    for (const key of [...this.entries.keys()]) {
      if (!key.startsWith(`${projectId}:`)) continue;
      this.bytes -= this.entries.get(key)?.bytes ?? 0;
      this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

/** The cache key from FR-6.4: endpoint, version, selection and seed. */
export function cacheKey(parts: {
  projectId: string;
  versionId: string;
  endpointId: string;
  selection: string;
  seed: string;
}): string {
  return [
    parts.projectId,
    parts.versionId,
    parts.endpointId,
    parts.selection,
    parts.seed,
  ].join(':');
}

/** A caller IP, truncated so the log groups callers without identifying one. */
export function truncateIp(ip: string | undefined): string | null {
  if (!ip) return null;

  if (ip.includes(':')) {
    // IPv6 to its /48, which is the site rather than the machine.
    return `${ip.split(':').slice(0, 3).join(':')}::`;
  }

  const octets = ip.split('.');
  return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.0` : null;
}
