/**
 * `$ref` bookkeeping behind PRD 02 FR-2.4: usage counts, impact reporting and
 * the all-or-nothing rename.
 *
 * Named schemas live at `#/components/schemas/<Name>`, matching the OpenAPI
 * document the project exports, so an imported contract's refs need no rewriting.
 */

const REF_PREFIX = '#/components/schemas/';

export function refFor(schemaName: string): string {
  return `${REF_PREFIX}${schemaName}`;
}

export function schemaNameFromRef(ref: string): string | undefined {
  if (!ref.startsWith(REF_PREFIX)) return undefined;
  const name = ref.slice(REF_PREFIX.length);
  return name.length > 0 ? name : undefined;
}

export interface RefSite {
  /** JSON pointer to the `$ref` keyword itself, so the UI can jump to it. */
  pointer: string;
  schemaName: string;
}

/**
 * Collects every local `$ref` in a JSON Schema document. Walks arrays and
 * objects generically rather than enumerating keywords, so composition
 * (`allOf`, `oneOf`), `patternProperties` and vendor extensions are all covered.
 */
export function collectRefs(document: unknown, basePointer = '#'): RefSite[] {
  const sites: RefSite[] = [];

  const walk = (node: unknown, pointer: string): void => {
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        walk(item, `${pointer}/${index}`);
      }
      return;
    }
    if (typeof node !== 'object' || node === null) return;

    for (const [key, value] of Object.entries(node)) {
      // A JSON pointer token escapes `~` and `/` (RFC 6901 section 3).
      const token = key.replaceAll('~', '~0').replaceAll('/', '~1');
      const childPointer = `${pointer}/${token}`;

      if (key === '$ref' && typeof value === 'string') {
        const schemaName = schemaNameFromRef(value);
        if (schemaName) sites.push({ pointer: childPointer, schemaName });
        continue;
      }

      walk(value, childPointer);
    }
  };

  walk(document, basePointer);
  return sites;
}

export function countRefs(document: unknown, schemaName: string): number {
  return collectRefs(document).filter((site) => site.schemaName === schemaName)
    .length;
}

/**
 * Rewrites every `$ref` to `from` so it points at `to`, returning a new
 * document. FR-2.4 requires the rename to update all references or none, so
 * this never mutates its input: the caller commits the whole set in one
 * transaction or discards it.
 */
export function renameRefs(
  document: unknown,
  from: string,
  to: string,
): unknown {
  const fromRef = refFor(from);
  const toRef = refFor(to);

  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (typeof node !== 'object' || node === null) return node;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      result[key] =
        key === '$ref' && value === fromRef ? toRef : rewrite(value);
    }
    return result;
  };

  return rewrite(document);
}

/**
 * Orders schemas so a definition precedes anything referencing it, which the
 * TypeScript exporter needs to emit compilable output.
 *
 * Contracts legitimately contain reference cycles (a tree node whose children
 * are the same type), so a cycle is not an error: the participating schemas are
 * emitted in a stable order and left for the caller's forward declarations.
 */
export function topologicalSchemaOrder(
  schemas: ReadonlyMap<string, unknown>,
): string[] {
  const ordered: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (name: string): void => {
    const seen = state.get(name);
    if (seen === 'done' || seen === 'visiting') return;
    state.set(name, 'visiting');

    const document = schemas.get(name);
    if (document !== undefined) {
      const dependencies = new Set(
        collectRefs(document)
          .map((site) => site.schemaName)
          .filter(
            (dependency) => dependency !== name && schemas.has(dependency),
          ),
      );
      for (const dependency of [...dependencies].sort()) visit(dependency);
    }

    state.set(name, 'done');
    ordered.push(name);
  };

  for (const name of [...schemas.keys()].sort()) visit(name);
  return ordered;
}
