ALTER TYPE "public"."audit_action" ADD VALUE 'standard.published';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'exemption.granted';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'exemption.revoked';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'mock.config_updated';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'mock.token_rotated';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'mock.scenario_saved';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'mock.scenario_deleted';