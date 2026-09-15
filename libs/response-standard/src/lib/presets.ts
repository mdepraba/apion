import {
  DATA_SLOT,
  type ResponseStandard,
  simpleStandard,
} from './standard.js';

/**
 * FR-4.7 bootstrap presets. "A preset is never a locked mode": each one returns
 * an ordinary standard the project then edits freely, so nothing downstream can
 * branch on which preset a project started from.
 *
 * Each preset is just a different set of envelope slots.
 */
export const PRESET_IDS = [
  'simple',
  'jsonapi',
  'problem-details',
  'google',
  'none',
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface PresetDescription {
  id: PresetId;
  name: string;
  /** Shown next to the name when a project picks its starting point. */
  summary: string;
}

export const PRESETS: readonly PresetDescription[] = [
  {
    id: 'simple',
    name: 'Simple',
    summary: 'A status code, a message and the data every response carries.',
  },
  {
    id: 'jsonapi',
    name: 'JSON:API',
    summary: 'The JSON:API document: data, errors and meta.',
  },
  {
    id: 'problem-details',
    name: 'RFC 9457 Problem Details',
    summary: 'Type, title, status and detail alongside the data.',
  },
  {
    id: 'google',
    name: 'Google API Design Guide',
    summary: 'Data beside an error object, with snake_case fields.',
  },
  {
    id: 'none',
    name: 'None',
    summary:
      'The payload alone, with every rule off. Start here to describe an API that already exists.',
  },
];

export function presetStandard(id: PresetId): ResponseStandard {
  switch (id) {
    case 'simple':
      return simpleStandard();
    case 'jsonapi':
      return jsonApiStandard();
    case 'problem-details':
      return problemDetailsStandard();
    case 'google':
      return googleStandard();
    case 'none':
      return noneStandard();
  }
}

function jsonApiStandard(): ResponseStandard {
  return {
    ...simpleStandard(),
    envelope: {
      data: DATA_SLOT,
      errors: '$errors',
      meta: '$meta',
    },
    propertyNaming: 'kebab-case',
    pagination: { style: 'cursor', maxLimit: 100 },
    requiredResponseHeaders: ['content-type'],
  };
}

function problemDetailsStandard(): ResponseStandard {
  return {
    ...simpleStandard(),
    envelope: {
      type: '$type',
      title: '$title',
      status: '$status_code',
      detail: '$detail',
      data: DATA_SLOT,
    },
    propertyNaming: 'camelCase',
    requiredResponseHeaders: ['content-type'],
  };
}

function googleStandard(): ResponseStandard {
  return {
    ...simpleStandard(),
    envelope: {
      data: DATA_SLOT,
      error: { code: '$code', message: '$message', status: '$status' },
    },
    propertyNaming: 'snake_case',
    pathNaming: 'kebab-case',
    // The guide's list convention: a page token rather than an opaque cursor.
    pagination: { style: 'page', maxLimit: 1000 },
  };
}

/**
 * The escape hatch for an API that already exists and does not answer to any
 * house style. One slot and the rules switched off, so importing such a
 * contract does not bury its author in violations they did not ask for.
 *
 * The switch rather than ten `off` severities: a project that later decides it
 * does want checking turns one thing on and gets a usable set back, instead of
 * having to reconstruct a severity for every rule.
 */
function noneStandard(): ResponseStandard {
  return {
    ...simpleStandard(),
    envelope: DATA_SLOT,
    errorCodes: [],
    requiredResponseHeaders: [],
    pagination: { style: 'none', maxLimit: 100 },
    rulesEnabled: false,
  };
}
