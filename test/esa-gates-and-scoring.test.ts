/**
 * 職安法G1ゲートと決めやすさスコアの単体テスト（DB不要）
 * Unit tests for ESA G1 gate and ease-of-close scoring (no DB)
 * Unit test gerbang ESA G1 dan skor kemudahan penutupan (tanpa DB)
 */
import { describe, expect, it } from "vitest";
import { assessSupervisorGate, checkAccurateRepresentation } from "../src/services/rules/esa-gates.js";
import { computeJobOrderScore } from "../src/services/job-orders/score-job-order.js";

describe("assessSupervisorGate (G1)", () => {
  it("blocks construction-site labor even with a supervisor-looking title", () => {
    const result = assessSupervisorGate({
      jobTitle: "現場監督",
      actualDuties: "型枠・鉄筋の組み立て作業が主。安全管理は補助程度",
    });
    expect(result.result).toBe("needs_review");
    expect(result.findings.some((f) => f.result === "expert_review_required" || f.result === "fail")).toBe(true);
  });

  it("allows clear supervisor / construction-management duties", () => {
    const result = assessSupervisorGate({
      jobTitle: "施工管理アシスタント",
      actualDuties: "施工管理・工程管理・品質管理・安全管理のデスクワークおよび巡回確認",
    });
    expect(result.result).toBe("allowed_supervisor");
    expect(result.findings[0]?.result).toBe("pass");
  });

  it("blocks port work", () => {
    const result = assessSupervisorGate({
      actualDuties: "港湾荷役作業",
    });
    expect(result.result).toBe("blocked_port");
    expect(result.findings[0]?.result).toBe("fail");
  });

  it("requires actualDuties", () => {
    const result = assessSupervisorGate({ actualDuties: "  " });
    expect(result.result).toBe("needs_review");
    expect(result.findings[0]?.result).toBe("incomplete");
  });
});

describe("checkAccurateRepresentation (G6)", () => {
  it("fails on celebration-bonus phrases", () => {
    const findings = checkAccurateRepresentation("入社で就職お祝い金10万円プレゼント");
    expect(findings[0]?.result).toBe("fail");
  });

  it("passes clean ad copy", () => {
    const findings = checkAccurateRepresentation("施工管理アシスタント募集。月給30万円〜。寮あり。");
    expect(findings[0]?.result).toBe("pass");
  });
});

describe("computeJobOrderScore (§04)", () => {
  it("scores an S-grade easy-to-close job", () => {
    const result = computeJobOrderScore({
      offerRatePercent: 7,
      documentPassRatePercent: 60,
      recentApplicantCount: 8,
      foreignNationalsOk: true,
      inexperiencedOk: true,
      hasDormitory: true,
      kyushuLocation: true,
      laneFit: "mobile_shop",
      wantsExperiencedWorker: true,
    });
    expect(result.total).toBeGreaterThanOrEqual(9);
    expect(result.grade).toBe("S");
    expect(result.routeToP2Lane).toBe(false);
  });

  it("routes construction-supervisor B/C to P2 lane", () => {
    const result = computeJobOrderScore({
      offerRatePercent: 2,
      documentPassRatePercent: 20,
      recentApplicantCount: 20,
      requiresNativeJapanese: true,
      isConstructionSupervisorLane: true,
    });
    expect(["B", "C"]).toContain(result.grade);
    expect(result.routeToP2Lane).toBe(true);
  });

  it("penalizes native-Japanese requirement", () => {
    const withNative = computeJobOrderScore({
      offerRatePercent: 6,
      documentPassRatePercent: 55,
      foreignNationalsOk: true,
      requiresNativeJapanese: true,
    });
    const withoutNative = computeJobOrderScore({
      offerRatePercent: 6,
      documentPassRatePercent: 55,
      foreignNationalsOk: true,
      requiresNativeJapanese: false,
    });
    expect(withNative.total).toBe(withoutNative.total - 2);
  });
});
