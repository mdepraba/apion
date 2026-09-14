---
name: skill-orchestrator
description: Select and sequence the smallest relevant set of workspace skills for a non-trivial user request. Use for multi-domain work, ambiguous skill overlap, or when planning how to apply the installed skills; do not use when one specialist skill is an obvious complete match.
---

# Workspace Skill Orchestrator

## Outcome

Turn a user request into a small, ordered skill plan. Preserve the user’s requested scope and let the selected specialist skills own their work. This skill routes work; it does not replace implementation, review, documentation, or Nx skills.

## Routing procedure

1. Identify the requested outcome and action: explain, inspect, create, change, run, audit, monitor, or deploy.
2. Honour every user-named skill. Add only the skills needed to cover unaddressed parts of the request.
3. Select one **primary** skill that owns the main outcome, then zero to two supporting skills. Use more only when the request has independently substantial deliverables.
4. Order skills by dependency: workspace/scaffolding discovery → architecture or design → implementation → verification/review. A skill’s explicit trigger or mandatory ordering always wins.
5. Announce the selected skills and why before acting. Read each selected `SKILL.md` fully before using it.

Do not use this router for a narrowly scoped task with an obvious single owner. Never load all skills as a checklist. Do not use a specialist audit skill when the user asked to implement a feature, or implementation skills when the user requested a read-only audit.

## Mandatory precedence

| Situation | Required route |
| --- | --- |
| User explicitly names a skill | Include it; its instructions take precedence for its scope |
| New app, library, project structure, scaffolding or setup | `nx-generate` first, before workspace exploration |
| Workspace/project/target/dependency question or an Nx failure | `nx-workspace` first |
| Build, test, lint, serve, or another configured target | `nx-run-tasks` |
| CI tracking or self-healing CI | `monitor-ci` |
| Repository import/merge into Nx | `nx-import` |
| Add/discover Nx framework support | `nx-plugins` |
| Any `github.com` URL | `octocat` |
| User seeks a capability that may be installable | `find-skills` |
| Task needs an unavailable external service/account | `plugin-management` |

## Domain routes

### Documentation and product work

| Request | Primary | Add only when needed |
| --- | --- | --- |
| Create, reorganise or improve documentation | `documentation` | `writing-guidelines` only for a requested prose/voice review |
| Review docs voice, tone or handbook compliance | `writing-guidelines` | `documentation` if restructuring is also requested |
| Generate or edit bitmap imagery | `imagegen` | — |

### Backend and API work

| Request | Primary | Supporting route |
| --- | --- | --- |
| Design NestJS module boundaries or assess modular architecture | `nestjs-architecture-principles` | `clean-code` for a code-quality review/refactor |
| Implement or fix a NestJS feature | `nestjs-professional-software-engineering` | `nestjs-oop-design-patterns` only when an object/design-pattern decision is central |
| Fastify routes/plugins/request lifecycle | `fastify-best-practices` | `zod-schema-validation`, `oauth`, or `nestjs-features-performance` only for the matching concern |
| OAuth/authentication/token flow | `oauth` | `fastify-best-practices` when changing Fastify integration |
| Zod validation/schema inference | `zod-schema-validation` | `typescript-magician` only for a material type-system issue |
| Drizzle schema/query/migration work | `drizzle-orm` | `nestjs-professional-software-engineering` if it is part of a Nest feature |
| Production reliability, security, metrics, jobs, deployment or scale in NestJS | `nestjs-features-performance` | `fastify-best-practices` for request-level Fastify work |
| Whole NestJS codebase quality audit | `nestjs-code-audit` | no implementation skills |
| Audit one documented NestJS feature against a roadmap | `nestjs-feature-audit` | no implementation skills |

### Frontend work

| Request | Primary | Supporting route |
| --- | --- | --- |
| User journeys, interaction design or information architecture | `ux-design` | `ui-design` for visual/component decisions |
| Accessible, responsive interface implementation/design | `ui-design` | `tailwindcss` when Tailwind is being authored |
| Tailwind classes, tokens or responsive styling | `tailwindcss` | `ui-design` for an independently requested UX/accessibility design pass |
| TanStack Query fetching/caching/mutations | `tanstack-query` | — |
| TanStack Router routes/loaders/guards | `tanstack-router` | `tanstack-query` if loader data integration is central |
| TanStack Start server functions, SSR, deployment or app configuration | `tanstack-start` | router/query only when the request uses them directly |
| React component API/composition refactor | `vercel-composition-patterns` | `vercel-react-best-practices` for an explicitly performance-sensitive implementation |
| React/Next performance review or refactor | `vercel-react-best-practices` | — |
| UI accessibility/design audit | `web-design-guidelines` | no implementation skills unless a fix is requested |
| Vercel cost/performance investigation | `vercel-optimize` | — |

### General implementation

- Use `clean-code` for a substantive code write, refactor, or quality review when no more specific skill already supplies equivalent scope.
- Use `typescript-magician` only for non-trivial TypeScript type design or compiler-type errors; ordinary TypeScript belongs to the primary framework/domain skill.
- Use `link-workspace-packages` when creating workspace packages or resolving a real workspace-package import/linking problem. Do not emulate it with path aliases or manual dependency edits.

## Combination rules

- **Feature slice:** choose a framework/domain owner first. Add one data/API/UI skill only if the request substantively crosses that boundary. Example: a NestJS feature with a Drizzle migration uses `nestjs-professional-software-engineering` then `drizzle-orm`.
- **Frontend page:** use `ui-design` or `ux-design` for product/interface decisions, then Tailwind, Router, Query, or Start only for the technologies actually changed.
- **Review versus fix:** audit skills are read-only. If the user wants fixes after an audit, finish the audit, report findings, then use the relevant implementation skill in a subsequent authorised change step.
- **Nx work:** keep Nx lifecycle skills first. A specialised implementation skill may follow once the project/target context is established.
- **External integrations:** a plugin is not a default enhancement. Use `plugin-management` only if a required capability cannot be met by available local tools and needs an external account or service.

## Verification hand-off

The primary implementation skill determines verification. For workspace targets, use `nx-run-tasks`; do not bypass configured Nx targets with underlying tools. Documentation changes need link/format checks proportional to their risk. State what was verified and what was not.
