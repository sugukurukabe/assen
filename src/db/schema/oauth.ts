/**
 * OAuth Authorization Server用テーブル。Claude ConnectorsのDCR/PKCE/refreshを永続化する
 * Tables for the OAuth Authorization Server. Persists DCR clients, PKCE authorization codes, and refresh tokens
 * Tabel untuk OAuth Authorization Server. Menyimpan klien DCR, kode otorisasi PKCE, dan refresh token
 */
import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, updatedAtColumn } from "./common.js";

export const oauthClients = pgTable("oauth_clients", {
  id: idColumn(),
  clientId: text("client_id").notNull().unique(),
  clientName: text("client_name"),
  redirectUris: jsonb("redirect_uris").notNull(),
  grantTypes: jsonb("grant_types").notNull(),
  responseTypes: jsonb("response_types").notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
  clientMetadata: jsonb("client_metadata"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const oauthAuthCodes = pgTable("oauth_auth_codes", {
  id: idColumn(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  requestedState: text("requested_state"),
  googleState: text("google_state").notNull().unique(),
  codeHash: text("code_hash").unique(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull(),
  scope: text("scope").notNull().default("assen"),
  principalEmail: text("principal_email"),
  principalRole: text("principal_role"),
  tenantId: text("tenant_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const oauthRefreshTokens = pgTable("oauth_refresh_tokens", {
  id: idColumn(),
  tokenHash: text("token_hash").notNull().unique(),
  clientId: text("client_id").notNull(),
  principalEmail: text("principal_email").notNull(),
  principalRole: text("principal_role").notNull(),
  tenantId: text("tenant_id").notNull(),
  scope: text("scope").notNull().default("assen"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  rotationCounter: integer("rotation_counter").notNull().default(0),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const oauthAuditEvents = pgTable("oauth_audit_events", {
  id: idColumn(),
  eventType: text("event_type").notNull(),
  clientId: text("client_id"),
  principalEmail: text("principal_email"),
  success: boolean("success").notNull(),
  details: jsonb("details"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});
