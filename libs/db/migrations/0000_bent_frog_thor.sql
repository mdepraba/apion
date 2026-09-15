CREATE TYPE "public"."audit_action" AS ENUM('project.created', 'project.updated', 'project.archived', 'project.restored', 'project.deleted', 'member.added', 'member.role_changed', 'member.removed', 'version.created', 'version.published', 'resource.created', 'resource.updated', 'resource.deleted', 'endpoint.created', 'endpoint.updated', 'endpoint.deleted', 'endpoint.status_changed', 'schema.created', 'schema.updated', 'schema.renamed', 'schema.deleted', 'contract.imported', 'contract.exported', 'lock.force_released');--> statement-breakpoint
CREATE TYPE "public"."change_kind" AS ENUM('breaking', 'non_breaking', 'additive');--> statement-breakpoint
CREATE TYPE "public"."http_method" AS ENUM('get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace');--> statement-breakpoint
CREATE TYPE "public"."implementation_status" AS ENUM('draft', 'in_review', 'approved', 'in_progress', 'implemented', 'deprecated', 'retired');--> statement-breakpoint
CREATE TYPE "public"."parameter_location" AS ENUM('path', 'query', 'header', 'cookie');--> statement-breakpoint
CREATE TYPE "public"."project_lifecycle_state" AS ENUM('active', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('viewer', 'commenter', 'editor', 'maintainer', 'owner');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('private', 'organisation');--> statement-breakpoint
CREATE TYPE "public"."status_channel" AS ENUM('ui', 'ci');--> statement-breakpoint
CREATE TYPE "public"."version_state" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('lint_sweep', 'export_build', 'log_prune', 'notification_send', 'collab_compaction');--> statement-breakpoint
CREATE TYPE "public"."job_state" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"method" "http_method" NOT NULL,
	"path" varchar(500) NOT NULL,
	"summary" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"operation_id" varchar(120),
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request_body" jsonb,
	"responses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auth_required" boolean DEFAULT true NOT NULL,
	"deprecated" boolean DEFAULT false NOT NULL,
	"owner_id" uuid,
	"ticket_url" varchar(500),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"lint_checked_standard_version" integer,
	"entity_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "named_schemas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"schema" jsonb NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"entity_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"source_endpoint_id" uuid,
	"source_schema_id" uuid,
	"pointer" varchar(1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "project_role" NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"format" varchar(40) NOT NULL,
	"file_path" text NOT NULL,
	"byte_size" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "job_kind" NOT NULL,
	"state" "job_state" DEFAULT 'queued' NOT NULL,
	"project_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"label" varchar(60) NOT NULL,
	"state" "version_state" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"entity_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(60) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" "project_visibility" DEFAULT 'organisation' NOT NULL,
	"lifecycle_state" "project_lifecycle_state" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"stale_status_threshold_days" integer DEFAULT 14 NOT NULL,
	"entity_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"entity_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"actor_id" uuid,
	"actor_name" varchar(120),
	"action" "audit_action" NOT NULL,
	"target_type" varchar(60) NOT NULL,
	"target_id" uuid,
	"target_label" varchar(300),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoint_status_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"status" "implementation_status" NOT NULL,
	"note" text,
	"changed_by" uuid,
	"changed_via" "status_channel" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoint_statuses" (
	"endpoint_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"status" "implementation_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"changed_by" uuid,
	"changed_via" "status_channel" DEFAULT 'ui' NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "endpoint_statuses_endpoint_id_environment_id_pk" PRIMARY KEY("endpoint_id","environment_id")
);
--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_version_id_contract_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."contract_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "named_schemas" ADD CONSTRAINT "named_schemas_version_id_contract_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."contract_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_references" ADD CONSTRAINT "schema_references_version_id_contract_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."contract_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_references" ADD CONSTRAINT "schema_references_schema_id_named_schemas_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."named_schemas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_references" ADD CONSTRAINT "schema_references_source_endpoint_id_endpoints_id_fk" FOREIGN KEY ("source_endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_references" ADD CONSTRAINT "schema_references_source_schema_id_named_schemas_id_fk" FOREIGN KEY ("source_schema_id") REFERENCES "public"."named_schemas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_artifacts" ADD CONSTRAINT "export_artifacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_version_id_contract_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."contract_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_status_events" ADD CONSTRAINT "endpoint_status_events_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_status_events" ADD CONSTRAINT "endpoint_status_events_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_status_events" ADD CONSTRAINT "endpoint_status_events_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_statuses" ADD CONSTRAINT "endpoint_statuses_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_statuses" ADD CONSTRAINT "endpoint_statuses_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_statuses" ADD CONSTRAINT "endpoint_statuses_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "endpoints_version_method_path_idx" ON "endpoints" USING btree ("version_id","method","path");--> statement-breakpoint
CREATE INDEX "endpoints_resource_position_idx" ON "endpoints" USING btree ("resource_id","position");--> statement-breakpoint
CREATE INDEX "endpoints_owner_idx" ON "endpoints" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "endpoints_search_idx" ON "endpoints" USING gin (to_tsvector('simple', "summary" || ' ' || "path"));--> statement-breakpoint
CREATE UNIQUE INDEX "named_schemas_version_name_idx" ON "named_schemas" USING btree ("version_id","name");--> statement-breakpoint
CREATE INDEX "named_schemas_body_idx" ON "named_schemas" USING gin ("schema");--> statement-breakpoint
CREATE INDEX "schema_references_schema_idx" ON "schema_references" USING btree ("schema_id");--> statement-breakpoint
CREATE INDEX "schema_references_endpoint_idx" ON "schema_references" USING btree ("source_endpoint_id");--> statement-breakpoint
CREATE INDEX "schema_references_version_idx" ON "schema_references" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_email_idx" ON "users" USING btree ("organisation_id","email");--> statement-breakpoint
CREATE INDEX "export_artifacts_expiry_idx" ON "export_artifacts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("state","run_after");--> statement-breakpoint
CREATE INDEX "jobs_project_idx" ON "jobs" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_versions_project_label_idx" ON "contract_versions" USING btree ("project_id","label");--> statement-breakpoint
CREATE INDEX "contract_versions_project_state_idx" ON "contract_versions" USING btree ("project_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_key_idx" ON "environments" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_idx" ON "projects" USING btree ("organisation_id","slug");--> statement-breakpoint
CREATE INDEX "projects_lifecycle_idx" ON "projects" USING btree ("organisation_id","lifecycle_state");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_version_name_idx" ON "resources" USING btree ("version_id","name");--> statement-breakpoint
CREATE INDEX "resources_version_position_idx" ON "resources" USING btree ("version_id","position");--> statement-breakpoint
CREATE INDEX "audit_events_project_time_idx" ON "audit_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "endpoint_status_events_endpoint_idx" ON "endpoint_status_events" USING btree ("endpoint_id","environment_id","changed_at");--> statement-breakpoint
CREATE INDEX "endpoint_statuses_env_status_idx" ON "endpoint_statuses" USING btree ("environment_id","status");--> statement-breakpoint
CREATE INDEX "endpoint_statuses_changed_at_idx" ON "endpoint_statuses" USING btree ("changed_at");