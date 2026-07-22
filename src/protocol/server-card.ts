/**
 * Server Card（`/.well-known/mcp.json`）：MCPレジストリ/クローラーが起動不要でAssenを発見できるようにする静的マニフェスト。
 * mcp-factory.tsのASSEN_SERVER_INFO/assenServerCapabilitiesを単一の正として参照し、ここで再定義しない。
 * SEP-2127 Draftに準拠した最小構成。外販β提出（M2/M3ゲート通過後）まではrepository/contactはプレースホルダのまま
 *
 * Server Card (`/.well-known/mcp.json`): a static manifest so MCP registries/crawlers can discover Assen
 * without connecting first. References ASSEN_SERVER_INFO/assenServerCapabilities from mcp-factory.ts as the
 * single source of truth rather than redefining them here. Minimal shape aligned with SEP-2127 Draft.
 * repository/contact stay as placeholders until external submission (post M2/M3 gate)
 *
 * Server Card (`/.well-known/mcp.json`): manifest statis agar registry/crawler MCP dapat menemukan Assen tanpa
 * perlu terhubung dahulu. Mengacu pada ASSEN_SERVER_INFO/assenServerCapabilities di mcp-factory.ts sebagai satu
 * sumber kebenaran, tidak didefinisikan ulang di sini. Bentuk minimal selaras dengan SEP-2127 Draft.
 * repository/contact tetap placeholder sampai pengajuan eksternal (setelah gate M2/M3)
 */
import { ASSEN_SERVER_INFO } from "./mcp-factory.js";
import { assenServerCapabilities } from "./capabilities.js";
import { loadEnv } from "../lib/env.js";

export interface ServerCard {
  schemaVersion: string;
  name: string;
  version: string;
  description: string;
  mcpEndpoint: string;
  transport: "streamable-http";
  capabilities: Record<string, unknown>;
  auth: {
    modes: string[];
    note: string;
  };
  legalDomain: {
    licenses: string[];
    tenantIsolation: string;
  };
  status: {
    milestone: string;
    publicListing: string;
  };
  license: string;
  repository: string | null;
  contact: string | null;
  documentation: string | null;
}

export function buildServerCard(baseUrl: string): ServerCard {
  const env = loadEnv();
  const repository = env.SERVER_CARD_REPOSITORY_URL || null;
  return {
    schemaVersion: "sep-2127-draft",
    name: ASSEN_SERVER_INFO.name,
    version: ASSEN_SERVER_INFO.version,
    description:
      "職安法・派遣法・労基法の法定帳簿・書類生成を継続的コンプライアンスOSとして提供するMCPサーバー。 / MCP server providing a continuous compliance OS for Japanese employment-placement and dispatch-law statutory ledgers and documents. / Server MCP yang menyediakan OS kepatuhan berkelanjutan untuk buku besar dan dokumen wajib hukum ketenagakerjaan dan dispatch Jepang.",
    mcpEndpoint: `${baseUrl}/mcp`,
    transport: "streamable-http",
    capabilities: assenServerCapabilities.capabilities ?? {},
    auth: {
      modes: ["local_fixed_token", "oauth2_bearer"],
      note:
        "local_fixed_tokenは開発専用。本番はOAuth2 bearerのみ許可する / local_fixed_token is dev-only; production allows OAuth2 bearer only / local_fixed_token hanya untuk dev; produksi hanya mengizinkan OAuth2 bearer",
    },
    legalDomain: {
      licenses: ["有料職業紹介 46-ユ-000000", "労働者派遣 派46-000000"],
      tenantIsolation: "postgres-rls",
    },
    status: {
      milestone: "M1",
      publicListing:
        "外販β・レジストリ公開申請はM2/M3の客観ゲート通過後に行う（設計書§11） / Public-registry submission happens only after passing the M2/M3 objective gates (design doc §11) / Pengajuan registry publik dilakukan setelah lolos gate objektif M2/M3 (dokumen desain §11)",
    },
    // LICENSEファイルに準拠。ライセンス方針が決まるまでの安全側デフォルト（全著作権留保） / Mirrors the LICENSE file; a conservative default until a licensing decision is made (all rights reserved) / Sesuai file LICENSE; default konservatif sampai keputusan lisensi dibuat (semua hak dilindungi)
    license: "UNLICENSED",
    repository,
    contact: env.SERVER_CARD_CONTACT_URL || null,
    documentation: repository ? `${repository}/blob/main/docs/team-guide.md` : null,
  };
}
