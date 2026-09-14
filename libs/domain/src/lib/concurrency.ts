/**
 * Optimistic concurrency, shared by every server-authoritative operation listed
 * in PRD 01 ("Contract version governance") and PRD 06 FR-5.7.
 *
 * A caller sends the entity version it last saw. If the row has moved on, the
 * write is refused with the current state attached so the client can show a
 * resolution UI instead of silently overwriting someone.
 */

export class StaleWriteError<T> extends Error {
  readonly code = 'VERSION_CONFLICT' as const;

  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
    readonly current: T,
  ) {
    super(
      `This changed since you loaded it (you had version ${expectedVersion}, it is now ${actualVersion}).`,
    );
    this.name = 'StaleWriteError';
  }
}

export class MissingPreconditionError extends Error {
  readonly code = 'PRECONDITION_REQUIRED' as const;

  constructor(entity: string) {
    super(
      `Send an If-Match header with the ${entity} version you are changing.`,
    );
    this.name = 'MissingPreconditionError';
  }
}

export function assertFresh<T extends { entityVersion: number }>(
  current: T,
  expectedVersion: number,
): void {
  if (current.entityVersion !== expectedVersion) {
    throw new StaleWriteError(expectedVersion, current.entityVersion, current);
  }
}

/**
 * `If-Match` is quoted per RFC 9110. Weak validators (`W/"3"`) are rejected:
 * an entity version is an exact counter, so a weak match would be a lie.
 */
export function parseIfMatch(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (trimmed === '*') return undefined;
  const match = /^"(\d+)"$/.exec(trimmed);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function formatETag(entityVersion: number): string {
  return `"${entityVersion}"`;
}
