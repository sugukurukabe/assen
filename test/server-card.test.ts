/**
 * Server Card（/.well-known/mcp.json）の単体テスト：必須フィールドの存在と、
 * repository未設定時にURLを捏造せずnullを返すことを確認する
 * Unit test for the Server Card (/.well-known/mcp.json): confirms required fields are present, and that no URL is
 * fabricated when the repository is unconfigured (returns null instead)
 * Unit test untuk Server Card (/.well-known/mcp.json): memastikan field wajib ada, dan tidak ada URL yang dibuat-buat
 * saat repository belum dikonfigurasi (mengembalikan null)
 */
import { describe, expect, it } from "vitest";
import { buildServerCard } from "../src/protocol/server-card.js";

describe("buildServerCard", () => {
  it("repository/contact未設定時はURLを捏造せずnullを返す / returns null instead of fabricating repository/contact URLs when unset", () => {
    const card = buildServerCard("https://assen.example.com");
    expect(card.repository).toBeNull();
    expect(card.contact).toBeNull();
    expect(card.documentation).toBeNull();
  });

  it("ライセンス方針が決まるまでUNLICENSEDを既定にする / defaults to UNLICENSED until a licensing decision is made", () => {
    const card = buildServerCard("https://assen.example.com");
    expect(card.license).toBe("UNLICENSED");
  });

  it("mcpEndpointはbaseUrlに/mcpを付与する / mcpEndpoint appends /mcp to the base URL", () => {
    const card = buildServerCard("https://assen.example.com");
    expect(card.mcpEndpoint).toBe("https://assen.example.com/mcp");
  });
});
