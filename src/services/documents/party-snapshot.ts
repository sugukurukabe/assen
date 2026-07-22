/**
 * party_snapshots（§4.3）の作成。求人受理時・契約承認時・就職成立時に凍結コピーを保存する
 * Creates party_snapshots (§4.3). Freezes a copy at job-order acceptance / contract approval / placement confirmation
 * Membuat party_snapshots (§4.3). Membekukan kopi saat penerimaan lowongan / persetujuan kontrak / konfirmasi penempatan
 */
import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { partySnapshots, type partyTypeEnum, type takenReasonEnum } from "../../db/schema/party-snapshots.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";

type Db = NodePgDatabase<typeof schema>;
type PartyType = (typeof partyTypeEnum.enumValues)[number];
type TakenReason = (typeof takenReasonEnum.enumValues)[number];

export interface CreatePartySnapshotInput {
  tenantId: string;
  partyType: PartyType;
  partyRefId: string;
  snapshot: Record<string, unknown>;
  takenReason: TakenReason;
}

export async function createPartySnapshot(db: Db, input: CreatePartySnapshotInput): Promise<{ id: string }> {
  const id = randomUUID();
  const sha256 = sha256Hex(canonicalJsonString(input.snapshot));

  await db.insert(partySnapshots).values({
    id,
    tenantId: input.tenantId,
    partyType: input.partyType,
    partyRefId: input.partyRefId,
    schemaVersion: "v1",
    snapshot: input.snapshot,
    sha256,
    takenReason: input.takenReason,
  });

  return { id };
}
