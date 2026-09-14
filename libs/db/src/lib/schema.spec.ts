import {
  auditActions,
  httpMethods,
  implementationStatuses,
  projectRoles,
} from '@apion/contracts';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  auditActionEnum,
  endpointStatusEvents,
  endpointStatuses,
  endpoints,
  httpMethodEnum,
  implementationStatusEnum,
  projectRoleEnum,
  projects,
} from './schema/index.js';

/**
 * These assert the parts of the schema that other code silently depends on.
 * They need no database: Drizzle's table objects carry the shape, so a
 * mismatch is caught here rather than at the first migration on a real host.
 */

describe('postgres enums track the contract enums', () => {
  it.each([
    ['project_role', projectRoleEnum, projectRoles],
    ['implementation_status', implementationStatusEnum, implementationStatuses],
    ['http_method', httpMethodEnum, httpMethods],
    ['audit_action', auditActionEnum, auditActions],
  ])('%s', (_name, pgEnum, contractValues) => {
    // A value added to one and not the other is a runtime insert failure that
    // no type check would catch, because the enum arrays are the same source.
    expect([...pgEnum.enumValues]).toEqual([...contractValues]);
  });
});

describe('optimistic concurrency columns', () => {
  it('gives every independently-editable entity an entityVersion', () => {
    // PRD 01 checks a version on every server-authoritative write, so a table
    // without this column cannot participate in that protocol.
    expect(getTableColumns(projects).entityVersion).toBeDefined();
    expect(getTableColumns(endpoints).entityVersion).toBeDefined();
  });

  it('defaults entityVersion to 1 so a fresh row has a version to match', () => {
    expect(getTableColumns(projects).entityVersion.default).toBe(1);
    expect(getTableColumns(endpoints).entityVersion.default).toBe(1);
  });
});

describe('status tables', () => {
  it('keys current status by endpoint and environment, not endpoint alone', () => {
    // FR-3.2: a status in dev says nothing about production.
    const columns = getTableColumns(endpointStatuses);
    expect(columns.endpointId.primary || columns.environmentId.primary).toBe(
      false,
    );
    expect(getTableName(endpointStatuses)).toBe('endpoint_statuses');
    expect(columns.environmentId).toBeDefined();
  });

  it('keeps an append-only history table beside the current status', () => {
    // FR-3.4: competing writes leave two events even though one wins the state.
    const history = getTableColumns(endpointStatusEvents);
    expect(history.id).toBeDefined();
    expect(history.changedVia).toBeDefined();
    expect(history.changedAt).toBeDefined();
  });
});

describe('endpoint table', () => {
  it('carries the lint cache column the lazy relint depends on', () => {
    // PRD 03 makes publishing a standard constant-time by leaving these behind.
    expect(getTableColumns(endpoints).lintCheckedStandardVersion).toBeDefined();
  });

  it('stores parameters, request body and responses as JSONB on the row', () => {
    const columns = getTableColumns(endpoints);
    expect(columns.parameters.dataType).toBe('json');
    expect(columns.responses.dataType).toBe('json');
    expect(columns.requestBody.dataType).toBe('json');
  });
});
