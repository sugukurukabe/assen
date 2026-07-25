/**
 * 2段階インテークの単体〜統合テスト（DB使用）
 * Unit/integration tests for two-stage intake (uses DB)
 * Unit/integration test intake 2 tahap (pakai DB)
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedPrincipal } from "../src/lib/auth.js";
import { acquireTenantScopedDb } from "../src/db/client.js";
import {
  closeStaleInquiries,
  promoteInquiry,
  recordInquiry,
  updateInquiry,
} from "../src/services/inquiries/inquiry-lifecycle.js";
import { inquiries } from "../src/db/schema/inquiries.js";
import { eq } from "drizzle-orm";

const tenantId = randomUUID();
const principal: AuthenticatedPrincipal = {
  principalId: "test-oshin",
  role: "admin",
  authMethod: "local_fixed_token",
  tenantId,
};

describe("inquiry two-stage intake", () => {
  let scoped: Awaited<ReturnType<typeof acquireTenantScopedDb>>;

  beforeAll(async () => {
    scoped = await acquireTenantScopedDb(tenantId);
  });

  afterAll(() => {
    scoped.release();
  });

  it("records inquiry and requires DM answers before set_sent", async () => {
    const recorded = await recordInquiry(scoped.db, {
      tenantId,
      displayName: "TEST CANDIDATE",
      channel: "sns_application",
      dmAnswers: { visaStatus: "技人国" },
    });
    expect(recorded.dmComplete).toBe(false);

    await expect(
      updateInquiry(scoped.db, { inquiryId: recorded.inquiryId, setSent: true }),
    ).rejects.toThrow(/DM5問/);
  });

  it("promotes only when the formal application set is complete", async () => {
    const recorded = await recordInquiry(scoped.db, {
      tenantId,
      displayName: "COMPLETE CANDIDATE",
      channel: "sns_application",
      dmAnswers: {
        visaStatus: "技人国",
        visaExpiry: "2028-01-01",
        residence: "Kagoshima",
        workHistory: "construction management",
        japaneseLevel: "N3",
        careerGoal: "direct employment",
      },
    });
    expect(recorded.dmComplete).toBe(true);

    await updateInquiry(scoped.db, { inquiryId: recorded.inquiryId, setSent: true });
    await expect(
      promoteInquiry(scoped.db, {
        tenantId,
        principal,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        reason: "test promote incomplete",
        inquiryId: recorded.inquiryId,
        seeker: {
          name: "COMPLETE CANDIDATE",
          address: "Kagoshima",
          birthDate: "1995-01-01",
        },
        piiConsent: { consentDate: "2026-07-25", scope: "placement", recipients: "employer" },
        fields: {
          desiredOccupation: "施工管理",
          acceptedAt: "2026-07-25",
          validUntil: "2027-07-25",
        },
      }),
    ).rejects.toThrow(/正式申込セット/);

    await updateInquiry(scoped.db, {
      inquiryId: recorded.inquiryId,
      hasApplicationForm: true,
      hasResume: true,
      hasResidenceCard: true,
      hasQualificationDocs: true,
      setReceivedAt: "2026-07-25",
    });

    const promoted = await promoteInquiry(scoped.db, {
      tenantId,
      principal,
      requestId: randomUUID(),
      idempotencyKey: `promote-${recorded.inquiryId}`,
      reason: "test promote complete",
      inquiryId: recorded.inquiryId,
      seeker: {
        name: "COMPLETE CANDIDATE",
        address: "Kagoshima",
        birthDate: "1995-01-01",
      },
      piiConsent: { consentDate: "2026-07-25", scope: "placement", recipients: "employer" },
      fields: {
        desiredOccupation: "施工管理",
        acceptedAt: "2026-07-25",
        validUntil: "2027-07-25",
      },
    });

    expect(promoted.jobSeekerId).toBeTruthy();
    expect(promoted.applicationChannel).toBe("sns_application");
    expect(promoted.acceptedAt).toBe("2026-07-25");

    const [row] = await scoped.db.select().from(inquiries).where(eq(inquiries.id, recorded.inquiryId));
    expect(row?.status).toBe("promoted");
  });

  it("closeStaleInquiries closes set_sent without complete set after 3 days", async () => {
    const recorded = await recordInquiry(scoped.db, {
      tenantId,
      displayName: "STALE",
      channel: "direct_referral",
      dmAnswers: {
        visaStatus: "永住",
        visaExpiry: "2099-01-01",
        residence: "Fukuoka",
        workHistory: "office",
        japaneseLevel: "N2",
        careerGoal: "direct",
      },
    });
    await updateInquiry(scoped.db, { inquiryId: recorded.inquiryId, setSent: true });
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    await scoped.db.update(inquiries).set({ setSentAt: fourDaysAgo }).where(eq(inquiries.id, recorded.inquiryId));

    const result = await closeStaleInquiries(scoped.db, tenantId);
    expect(result.closedCount).toBeGreaterThanOrEqual(1);
    const [row] = await scoped.db.select().from(inquiries).where(eq(inquiries.id, recorded.inquiryId));
    expect(row?.status).toBe("closed");
  });
});
