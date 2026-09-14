import type {
  AuditEvent,
  ContractVersion,
  Endpoint,
  EndpointStatus,
  EndpointStatusEvent,
  EndpointSummary,
  EnvelopeSlotsResponse,
  Environment,
  ExemptionRecord,
  LintResult,
  MockConfig,
  MockLogEntry,
  MockScenario,
  NamedSchema,
  Project,
  ProjectMember,
  ProjectRole,
  Resource,
  ResponseStandardRecord,
  StandardHealth,
  StatusRollup,
  User,
} from '@apion/contracts';
import { queryOptions } from '@tanstack/react-query';
import { request } from './client.js';

/**
 * One key factory for the whole app. Keys nest the way the routes do, so
 * invalidating `keys.version(slug, versionId)` clears every list under a
 * version after an import replaces its contract.
 */
export const keys = {
  session: ['session'] as const,
  projects: ['projects'] as const,
  project: (slug: string) => ['projects', slug] as const,
  access: (slug: string) => ['projects', slug, 'access'] as const,
  environments: (slug: string) => ['projects', slug, 'environments'] as const,
  members: (slug: string) => ['projects', slug, 'members'] as const,
  activity: (slug: string) => ['projects', slug, 'activity'] as const,
  versions: (slug: string) => ['projects', slug, 'versions'] as const,
  version: (slug: string, versionId: string) =>
    ['projects', slug, 'versions', versionId] as const,
  resources: (slug: string, versionId: string) =>
    ['projects', slug, 'versions', versionId, 'resources'] as const,
  endpoints: (slug: string, versionId: string, environmentId?: string) =>
    [
      'projects',
      slug,
      'versions',
      versionId,
      'endpoints',
      environmentId ?? 'none',
    ] as const,
  endpoint: (slug: string, versionId: string, endpointId: string) =>
    [
      'projects',
      slug,
      'versions',
      versionId,
      'endpoints',
      endpointId,
      'detail',
    ] as const,
  endpointStatus: (slug: string, endpointId: string) =>
    ['projects', slug, 'endpoints', endpointId, 'status'] as const,
  endpointHistory: (slug: string, endpointId: string) =>
    ['projects', slug, 'endpoints', endpointId, 'history'] as const,
  schemas: (slug: string, versionId: string) =>
    ['projects', slug, 'versions', versionId, 'schemas'] as const,
  health: (slug: string, versionId: string, environment: string) =>
    ['projects', slug, 'versions', versionId, 'health', environment] as const,
  search: (query: string) => ['search', query] as const,
  standard: (slug: string) => ['projects', slug, 'standard'] as const,
  standardDraft: (slug: string) =>
    ['projects', slug, 'standard', 'draft'] as const,
  standardHealth: (slug: string) =>
    ['projects', slug, 'standard', 'health'] as const,
  exemptions: (slug: string) =>
    ['projects', slug, 'standard', 'exemptions'] as const,
  envelopeSlots: (slug: string) =>
    ['projects', slug, 'standard', 'slots'] as const,
  lint: (slug: string, versionId: string, endpointId: string) =>
    [
      'projects',
      slug,
      'versions',
      versionId,
      'endpoints',
      endpointId,
      'lint',
    ] as const,
  mockConfig: (slug: string) => ['projects', slug, 'mock'] as const,
  mockScenarios: (slug: string) =>
    ['projects', slug, 'mock', 'scenarios'] as const,
  mockLog: (slug: string, filters: string) =>
    ['projects', slug, 'mock', 'log', filters] as const,
};

export const standardQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.standard(slug),
    queryFn: () =>
      request<ResponseStandardRecord>(`/projects/${slug}/standard`),
  });

export const standardDraftQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.standardDraft(slug),
    queryFn: () =>
      request<ResponseStandardRecord>(`/projects/${slug}/standard/draft`),
  });

export const standardHealthQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.standardHealth(slug),
    queryFn: () => request<StandardHealth>(`/projects/${slug}/standard/health`),
  });

/**
 * The slots the active envelope declares. The endpoint editor renders a field
 * per slot, so this is fetched wherever an example is authored.
 */
export const envelopeSlotsQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.envelopeSlots(slug),
    queryFn: () =>
      request<EnvelopeSlotsResponse>(`/projects/${slug}/standard/slots`),
    // The envelope only moves when someone publishes a standard.
    staleTime: 60_000,
  });

export const exemptionsQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.exemptions(slug),
    queryFn: () =>
      request<ExemptionRecord[]>(`/projects/${slug}/standard/exemptions`),
  });

/**
 * FR-4.5 asks for inline feedback while an author works, so this follows the
 * open endpoint. The server answers from cache unless the standard has moved,
 * which is what keeps it cheap enough to fetch on every selection.
 */
export const lintQuery = (
  slug: string,
  versionId: string,
  endpointId: string,
) =>
  queryOptions({
    queryKey: keys.lint(slug, versionId, endpointId),
    queryFn: () =>
      request<LintResult>(
        `/projects/${slug}/versions/${versionId}/endpoints/${endpointId}/lint`,
      ),
  });

export const mockConfigQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.mockConfig(slug),
    queryFn: () => request<MockConfig>(`/projects/${slug}/mock`),
  });

export const mockScenariosQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.mockScenarios(slug),
    queryFn: () => request<MockScenario[]>(`/projects/${slug}/mock/scenarios`),
  });

export interface MockLogFilters {
  environmentKey?: string;
  status?: number;
  endpointId?: string;
}

export const mockLogQuery = (slug: string, filters: MockLogFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.environmentKey)
    params.set('environmentKey', filters.environmentKey);
  if (filters.status) params.set('status', String(filters.status));
  if (filters.endpointId) params.set('endpointId', filters.endpointId);
  const query = params.toString();

  return queryOptions({
    queryKey: keys.mockLog(slug, query),
    queryFn: () =>
      request<{ items: MockLogEntry[]; nextCursor: string | null }>(
        `/projects/${slug}/mock/log${query ? `?${query}` : ''}`,
      ),
    // FR-6.7 calls this a live log; five seconds is frequent enough to watch an
    // integration without polling the control plane hard.
    refetchInterval: 5_000,
  });
};

export const sessionQuery = () =>
  queryOptions({
    queryKey: keys.session,
    queryFn: () => request<User>('/auth/me'),
    // A signed-in user's own record changes rarely; refetching it on every
    // window focus is noise on a tool that stays open all day.
    staleTime: 5 * 60_000,
    retry: false,
  });

export const projectsQuery = () =>
  queryOptions({
    queryKey: keys.projects,
    queryFn: () => request<Project[]>('/projects'),
  });

export const projectQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.project(slug),
    queryFn: () => request<Project>(`/projects/${slug}`),
  });

export const accessQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.access(slug),
    queryFn: () => request<{ role: ProjectRole }>(`/projects/${slug}/access`),
    staleTime: 5 * 60_000,
  });

export const environmentsQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.environments(slug),
    queryFn: () => request<Environment[]>(`/projects/${slug}/environments`),
    staleTime: 5 * 60_000,
  });

export const membersQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.members(slug),
    queryFn: () => request<ProjectMember[]>(`/projects/${slug}/members`),
  });

export const versionsQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.versions(slug),
    queryFn: () => request<ContractVersion[]>(`/projects/${slug}/versions`),
  });

export const resourcesQuery = (slug: string, versionId: string) =>
  queryOptions({
    queryKey: keys.resources(slug, versionId),
    queryFn: () =>
      request<Resource[]>(`/projects/${slug}/versions/${versionId}/resources`),
  });

export const endpointsQuery = (
  slug: string,
  versionId: string,
  environmentId?: string,
) =>
  queryOptions({
    queryKey: keys.endpoints(slug, versionId, environmentId),
    queryFn: () => {
      const query = environmentId ? `?environmentId=${environmentId}` : '';
      return request<EndpointSummary[]>(
        `/projects/${slug}/versions/${versionId}/endpoints${query}`,
      );
    },
  });

export const endpointQuery = (
  slug: string,
  versionId: string,
  endpointId: string,
) =>
  queryOptions({
    queryKey: keys.endpoint(slug, versionId, endpointId),
    queryFn: () =>
      request<Endpoint>(
        `/projects/${slug}/versions/${versionId}/endpoints/${endpointId}`,
      ),
  });

export const endpointStatusQuery = (slug: string, endpointId: string) =>
  queryOptions({
    queryKey: keys.endpointStatus(slug, endpointId),
    queryFn: () =>
      request<EndpointStatus[]>(
        `/projects/${slug}/endpoints/${endpointId}/status`,
      ),
  });

export const endpointHistoryQuery = (slug: string, endpointId: string) =>
  queryOptions({
    queryKey: keys.endpointHistory(slug, endpointId),
    queryFn: () =>
      request<EndpointStatusEvent[]>(
        `/projects/${slug}/endpoints/${endpointId}/status/history`,
      ),
  });

export const schemasQuery = (slug: string, versionId: string) =>
  queryOptions({
    queryKey: keys.schemas(slug, versionId),
    queryFn: () =>
      request<NamedSchema[]>(`/projects/${slug}/versions/${versionId}/schemas`),
  });

export const healthQuery = (
  slug: string,
  versionId: string,
  environment: string,
) =>
  queryOptions({
    queryKey: keys.health(slug, versionId, environment),
    queryFn: () =>
      request<StatusRollup[]>(
        `/projects/${slug}/versions/${versionId}/health?environment=${environment}`,
      ),
  });

export const activityQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.activity(slug),
    queryFn: () =>
      request<{ items: AuditEvent[]; nextCursor: string | null }>(
        `/projects/${slug}/activity?limit=50`,
      ),
  });

export interface SearchHit {
  kind: 'endpoint' | 'schema';
  id: string;
  label: string;
  detail: string;
  projectSlug: string;
  projectName: string;
  versionId: string;
  versionLabel: string;
}

export const searchQuery = (query: string) =>
  queryOptions({
    queryKey: keys.search(query),
    queryFn: () =>
      request<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`),
    // Below two characters the server returns nothing, so don't ask.
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });
