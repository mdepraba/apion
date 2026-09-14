import type { MockLocale } from '@apion/contracts';
import type { SeededRandom } from './random.js';

/**
 * Schema-driven value generation (PRD 05). It "honours JSON Schema constraints,
 * common formats and `x-mock-faker`, supports project locale (`en`, `id_ID`),
 * echoes matching path/query values into payloads".
 *
 * Examples always win over generation; this runs only when a response declares
 * a schema and no example, which is the case PRD 05 exists to cover: a client
 * integrating against an endpoint nobody has written examples for yet.
 */

export interface GenerateOptions {
  random: SeededRandom;
  locale: MockLocale;
  /** Captured path and query values, echoed into fields of the same name. */
  context?: Readonly<Record<string, string>>;
  /** Resolves a `$ref` against the version's named schemas. */
  resolveRef?: (ref: string) => unknown;
  /** The standard's pagination ceiling, so a generated list cannot exceed it. */
  maxItems?: number;
}

/** Generated payloads are capped at 1 MB; depth is the cheap half of that. */
const MAX_DEPTH = 10;

export function generateFromSchema(
  schema: unknown,
  options: GenerateOptions,
): unknown {
  return build(schema, options, 0, '');
}

function build(
  schema: unknown,
  options: GenerateOptions,
  depth: number,
  fieldName: string,
): unknown {
  if (depth > MAX_DEPTH) return null;
  if (schema === true) return {};
  if (schema === false || schema === null || schema === undefined) return null;
  if (typeof schema !== 'object') return null;

  const node = schema as Record<string, unknown>;

  const ref = node['$ref'];
  if (typeof ref === 'string') {
    const resolved = options.resolveRef?.(ref);
    // An unresolvable ref yields null rather than throwing: a mock that answers
    // is more useful than one that 500s because a schema was renamed.
    return resolved === undefined
      ? null
      : build(resolved, options, depth + 1, fieldName);
  }

  // A caller-supplied value beats anything generated, so `/orders/{orderId}`
  // answers with the id that was actually asked for.
  const echoed = options.context?.[fieldName];
  if (echoed !== undefined && isScalarSchema(node)) {
    return coerce(echoed, node);
  }

  if (node['const'] !== undefined) return node['const'];

  const enumeration = node['enum'];
  if (Array.isArray(enumeration) && enumeration.length > 0) {
    return options.random.pick(enumeration);
  }

  if (node['example'] !== undefined) return node['example'];
  if (Array.isArray(node['examples']) && node['examples'].length > 0) {
    return options.random.pick(node['examples'] as unknown[]);
  }

  const faker = node['x-mock-faker'];
  if (typeof faker === 'string') {
    const value = fake(faker, options);
    if (value !== undefined) return value;
  }

  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    const branches = node[keyword];
    if (!Array.isArray(branches) || branches.length === 0) continue;

    if (keyword === 'allOf') {
      // Every branch contributes, so the result satisfies all of them.
      const merged: Record<string, unknown> = {};
      for (const branch of branches) {
        const part = build(branch, options, depth + 1, fieldName);
        if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
          Object.assign(merged, part);
        }
      }
      return merged;
    }

    return build(branches[0], options, depth + 1, fieldName);
  }

  const type = resolveType(node, options.random);

  switch (type) {
    case 'object':
      return buildObject(node, options, depth, fieldName);
    case 'array':
      return buildArray(node, options, depth, fieldName);
    case 'string':
      return buildString(node, options, fieldName);
    case 'integer':
    case 'number':
      return buildNumber(node, options, type === 'integer');
    case 'boolean':
      return options.random.bool();
    case 'null':
      return null;
    default:
      return null;
  }
}

function buildObject(
  node: Record<string, unknown>,
  options: GenerateOptions,
  depth: number,
  fieldName: string,
): Record<string, unknown> {
  const properties = node['properties'];
  if (typeof properties !== 'object' || properties === null) {
    return fieldName ? {} : {};
  }

  const required = new Set(
    Array.isArray(node['required']) ? (node['required'] as string[]) : [],
  );

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    // An optional field is present most of the time: a client integrating
    // against the mock should see the full shape, not a minimal one.
    if (!required.has(key) && options.random.next() < 0.15) continue;
    result[key] = build(value, options, depth + 1, key);
  }

  return result;
}

function buildArray(
  node: Record<string, unknown>,
  options: GenerateOptions,
  depth: number,
  fieldName: string,
): unknown[] {
  const items = node['items'];
  if (items === undefined) return [];

  const min = numberOf(node['minItems']) ?? 1;
  const ceiling = Math.min(
    numberOf(node['maxItems']) ?? 3,
    options.maxItems ?? 100,
  );
  const count = options.random.int(min, Math.max(min, ceiling));

  return Array.from({ length: count }, () =>
    build(items, options, depth + 1, singular(fieldName)),
  );
}

function buildString(
  node: Record<string, unknown>,
  options: GenerateOptions,
  fieldName: string,
): string {
  const format = node['format'];
  if (typeof format === 'string') {
    const value = byFormat(format, options);
    if (value !== undefined) return value;
  }

  const pattern = node['pattern'];
  if (typeof pattern === 'string') {
    // A regex is not inverted here; a readable placeholder that names the
    // pattern beats a wrong value that looks real.
    return `pattern:${pattern}`;
  }

  const byName = byFieldName(fieldName, options);
  if (byName !== undefined) return clamp(byName, node);

  return clamp(options.random.pick(WORDS[options.locale]), node);
}

function buildNumber(
  node: Record<string, unknown>,
  options: GenerateOptions,
  integer: boolean,
): number {
  const min =
    numberOf(node['minimum']) ?? numberOf(node['exclusiveMinimum']) ?? 1;
  const max =
    numberOf(node['maximum']) ??
    numberOf(node['exclusiveMaximum']) ??
    min + 999;

  if (integer) return options.random.int(Math.ceil(min), Math.floor(max));

  const value = min + options.random.next() * (max - min);
  return Math.round(value * 100) / 100;
}

function byFormat(
  format: string,
  options: GenerateOptions,
): string | undefined {
  const { random, locale } = options;

  switch (format) {
    case 'uuid':
      return `${random.hex(8)}-${random.hex(4)}-4${random.hex(3)}-a${random.hex(3)}-${random.hex(12)}`;
    case 'date-time':
      return isoAt(random, true);
    case 'date':
      return isoAt(random, false).slice(0, 10);
    case 'time':
      return isoAt(random, true).slice(11, 19);
    case 'email':
      return `${random.pick(NAMES[locale]).toLowerCase()}@example.test`;
    case 'uri':
    case 'url':
      return `https://example.test/${random.hex(6)}`;
    case 'hostname':
      return 'service.example.test';
    case 'ipv4':
      return `192.0.2.${random.int(1, 254)}`;
    case 'ipv6':
      return `2001:db8::${random.hex(4)}`;
    case 'duration':
      return `PT${random.int(1, 59)}M`;
    default:
      return undefined;
  }
}

/** `x-mock-faker` names, kept to what a contract author would reach for. */
function fake(kind: string, options: GenerateOptions): unknown {
  const { random, locale } = options;

  switch (kind) {
    case 'name':
    case 'person.name':
      return random.pick(NAMES[locale]);
    case 'email':
      return `${random.pick(NAMES[locale]).toLowerCase()}@example.test`;
    case 'city':
      return random.pick(CITIES[locale]);
    case 'country':
      return locale === 'id_ID' ? 'Indonesia' : 'United Kingdom';
    case 'phone':
      return locale === 'id_ID'
        ? `+62 21 ${random.int(1000, 9999)} ${random.int(1000, 9999)}`
        : `+44 20 ${random.int(1000, 9999)} ${random.int(1000, 9999)}`;
    case 'company':
      return random.pick(COMPANIES[locale]);
    case 'currency':
      return locale === 'id_ID' ? 'IDR' : 'GBP';
    case 'price':
      return random.int(100, 99999) / 100;
    case 'sentence':
      return `${random.pick(WORDS[locale])} ${random.pick(WORDS[locale])}.`;
    case 'uuid':
      return byFormat('uuid', options);
    default:
      return undefined;
  }
}

/** A last resort before random words: the field name often says enough. */
function byFieldName(
  fieldName: string,
  options: GenerateOptions,
): string | undefined {
  const name = fieldName.toLowerCase();
  if (name.endsWith('id'))
    return `${prefixOf(fieldName)}_${options.random.hex(8)}`;
  if (name.includes('email')) return fake('email', options) as string;
  if (name.includes('name')) return fake('name', options) as string;
  if (name.includes('city')) return fake('city', options) as string;
  if (name.includes('url') || name.includes('link')) {
    return byFormat('uri', options);
  }
  if (name.includes('status') || name.includes('state')) return 'active';
  if (name.includes('currency')) return fake('currency', options) as string;
  return undefined;
}

/** `orderId` yields `ord`, so a generated id reads as belonging to something. */
function prefixOf(fieldName: string): string {
  const base = fieldName.replace(/[_-]?id$/i, '').replace(/Id$/, '');
  return (base || 'obj').toLowerCase().slice(0, 4);
}

function isoAt(random: SeededRandom, withTime: boolean): string {
  // A fixed epoch keeps generation deterministic; a clock read would not be.
  const base = Date.UTC(2026, 0, 1);
  const offset = random.int(0, 300) * 86_400_000 + random.int(0, 86_399) * 1000;
  const iso = new Date(base + offset).toISOString();
  return withTime ? iso.replace(/\.\d{3}Z$/, 'Z') : iso;
}

function resolveType(
  node: Record<string, unknown>,
  random: SeededRandom,
): string {
  const type = node['type'];
  if (typeof type === 'string') return type;
  if (Array.isArray(type) && type.length > 0) {
    const usable = type.filter((member) => member !== 'null');
    return String(usable.length > 0 ? random.pick(usable) : 'null');
  }
  // No type but properties: an object, which is how most schemas are written.
  if (node['properties'] !== undefined) return 'object';
  if (node['items'] !== undefined) return 'array';
  return 'string';
}

function isScalarSchema(node: Record<string, unknown>): boolean {
  const type = node['type'];
  return (
    type === 'string' ||
    type === 'integer' ||
    type === 'number' ||
    type === 'boolean' ||
    type === undefined
  );
}

/** An echoed path value arrives as a string; the schema says what it is. */
function coerce(value: string, node: Record<string, unknown>): unknown {
  const type = node['type'];
  if (type === 'integer') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (type === 'number') {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (type === 'boolean') return value === 'true';
  return value;
}

function clamp(value: string, node: Record<string, unknown>): string {
  const max = numberOf(node['maxLength']);
  const min = numberOf(node['minLength']);
  let out = max !== undefined ? value.slice(0, max) : value;
  if (min !== undefined && out.length < min) out = out.padEnd(min, 'x');
  return out;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function singular(name: string): string {
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

/**
 * Locale data, per PRD 07's "externalised copy (English then Bahasa
 * Indonesia)". Everything here is fictional and sits on example.test, so a
 * generated payload can never be mistaken for a real person or company.
 */
const NAMES: Record<MockLocale, readonly string[]> = {
  en: ['Avery', 'Jordan', 'Rowan', 'Quinn', 'Sasha', 'Morgan'],
  id_ID: ['Andi', 'Sari', 'Budi', 'Dewi', 'Rizki', 'Putri'],
};

const CITIES: Record<MockLocale, readonly string[]> = {
  en: ['Manchester', 'Bristol', 'Leeds', 'Glasgow'],
  id_ID: ['Bandung', 'Surabaya', 'Yogyakarta', 'Makassar'],
};

const COMPANIES: Record<MockLocale, readonly string[]> = {
  en: ['Northwind Supply', 'Harbour Logistics', 'Bellrock Retail'],
  id_ID: ['Nusantara Logistik', 'Cahaya Retail', 'Bahari Supply'],
};

const WORDS: Record<MockLocale, readonly string[]> = {
  en: ['sample', 'placeholder', 'example', 'draft'],
  id_ID: ['contoh', 'sampel', 'rancangan', 'acuan'],
};
