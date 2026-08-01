/**
 * list optionツールのsystem role許可を固定する
 * Locks in system-role permission for the list-option tools
 * Mengunci izin role system untuk tool list-option
 */
import { describe, expect, it } from "vitest";
import { assertScope, type AuthenticatedPrincipal } from "../src/lib/auth.js";
import { LIST_OPTION_ALLOWED_ROLES } from "../src/services/list-options/allowed-roles.js";

function principal(role: AuthenticatedPrincipal["role"]): AuthenticatedPrincipal {
  return {
    principalId: "test-principal",
    role,
    authMethod: "oauth",
    tenantId: "92ee7556-1417-44e6-8f92-44d7e99d315c",
  };
}

describe("LIST_OPTION_ALLOWED_ROLES", () => {
  it("allows the Bolt service-account system role for staff/partner/job_seeker list tools", () => {
    expect(LIST_OPTION_ALLOWED_ROLES).toContain("system");
    expect(() => assertScope(principal("system"), [...LIST_OPTION_ALLOWED_ROLES])).not.toThrow();
  });

  it("does not treat system as a general write role (requester/admin only tools still reject it)", () => {
    expect(() => assertScope(principal("system"), ["requester", "admin"])).toThrow(/権限不足|Insufficient permission/);
  });
});
