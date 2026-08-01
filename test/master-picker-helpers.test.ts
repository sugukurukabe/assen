import { describe, expect, it } from "vitest";
import { buildSelectionSummary, extractSlackId } from "../src/services/slack-bolt/master-picker.js";

describe("master-picker helpers", () => {
  it("extractSlackId accepts string and object ids", () => {
    expect(extractSlackId("U123")).toBe("U123");
    expect(extractSlackId({ id: "C456" })).toBe("C456");
    expect(extractSlackId({ channel_id: "C789" })).toBe("C789");
    expect(extractSlackId(null)).toBe("");
  });

  it("buildSelectionSummary includes only requested fields", () => {
    const summary = buildSelectionSummary(
      "Assen E2E",
      {
        staff_value: "I-1",
        staff_label: "山田",
        partner_value: "120",
        partner_label: "株式会社小林グリーンファーム",
        job_seeker_value: "",
        job_seeker_label: "",
      },
      { askStaff: false, askPartner: true, askJobSeeker: false },
    );
    expect(summary).toContain("Assen E2E — 選択完了");
    expect(summary).toContain("取引先: 株式会社小林グリーンファーム");
    expect(summary).not.toContain("スタッフ:");
    expect(summary).not.toContain("求職者:");
  });
});
