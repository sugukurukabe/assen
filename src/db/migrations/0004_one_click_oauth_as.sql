-- Claude Connector向けワンクリックOAuth AS（DCR/PKCE/refresh）を追加
-- Adds one-click OAuth AS for Claude Connectors (DCR/PKCE/refresh)
-- Menambahkan OAuth AS sekali klik untuk Claude Connectors (DCR/PKCE/refresh)

CREATE TABLE "oauth_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" text NOT NULL,
  "client_name" text,
  "redirect_uris" jsonb NOT NULL,
  "grant_types" jsonb NOT NULL,
  "response_types" jsonb NOT NULL,
  "token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
  "client_metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);--> statement-breakpoint

CREATE TABLE "oauth_auth_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "requested_state" text,
  "google_state" text NOT NULL,
  "code_hash" text,
  "code_challenge" text NOT NULL,
  "code_challenge_method" text NOT NULL,
  "scope" text DEFAULT 'assen' NOT NULL,
  "principal_email" text,
  "principal_role" text,
  "tenant_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_auth_codes_google_state_unique" UNIQUE("google_state"),
  CONSTRAINT "oauth_auth_codes_code_hash_unique" UNIQUE("code_hash")
);--> statement-breakpoint

CREATE TABLE "oauth_refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "client_id" text NOT NULL,
  "principal_email" text NOT NULL,
  "principal_role" text NOT NULL,
  "tenant_id" text NOT NULL,
  "scope" text DEFAULT 'assen' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "rotation_counter" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);--> statement-breakpoint

CREATE TABLE "oauth_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" text NOT NULL,
  "client_id" text,
  "principal_email" text,
  "success" boolean NOT NULL,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "oauth_auth_codes_code_hash_idx" ON "oauth_auth_codes" ("code_hash");--> statement-breakpoint
CREATE INDEX "oauth_auth_codes_google_state_idx" ON "oauth_auth_codes" ("google_state");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_token_hash_idx" ON "oauth_refresh_tokens" ("token_hash");
