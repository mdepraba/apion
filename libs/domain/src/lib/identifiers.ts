/**
 * PRD 07 specifies UUIDv7 for every primary key. Version 7 puts a millisecond
 * timestamp in the high bits, so keys sort by creation time and B-tree inserts
 * stay at the right-hand edge of the index instead of scattering: which is
 * what makes them worth the trouble on a 1 vCPU host.
 *
 * Neither runtime ships a version 7 generator, so the layout is assembled here
 * (RFC 9562 section 5.7). Randomness comes from Web Crypto rather than
 * `node:crypto`, because this library is framework-free and also runs in the
 * SPA; importing the Node module would break the browser build.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);

  // 48-bit big-endian milliseconds since the Unix epoch.
  const timestamp = BigInt(now);
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Number((timestamp >> BigInt(8 * (5 - index))) & 0xffn);
  }

  // The remaining 74 bits are random. `crypto` is a global in Node 19+ and in
  // every browser the product supports.
  crypto.getRandomValues(bytes.subarray(6));

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant

  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/** Reads back the embedded timestamp; useful for ordering assertions in tests. */
export function uuidv7Timestamp(uuid: string): number {
  return Number.parseInt(uuid.replaceAll('-', '').slice(0, 12), 16);
}

/**
 * Turns free text into a URL-safe slug. Used to suggest a project slug from its
 * name; the user can still edit it, and the server enforces uniqueness.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}
