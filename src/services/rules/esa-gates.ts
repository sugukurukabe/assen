/**
 * 職安法ゲート（G1監督職判定＋G2–G6）の決定論判定
 * Deterministic ESA gates (G1 supervisor assessment + G2–G6)
 * Penilaian deterministik gerbang ESA (penilaian pengawas G1 + G2–G6)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { documents } from "../../db/schema/documents.js";
import { feeRecords, jobOrderReferrals, jobOrders } from "../../db/schema/ledgers.js";
import { findProjectRoot } from "../../lib/project-root.js";
import type { Finding } from "./five-value-result.js";

type Db = NodePgDatabase<typeof schema>;

export type SupervisorGateResult =
  | "allowed_supervisor"
  | "blocked_construction_site"
  | "blocked_port"
  | "needs_review";

interface EsaGatesPack {
  ruleKey: string;
  version: string;
  gates: {
    G1: {
      blockedDutyKeywords: { construction_site: string[]; port: string[] };
      allowedSupervisorKeywords: string[];
      titleOnlyNotEnough: boolean;
    };
    G6: { forbiddenPhrases: string[] };
  };
}

let cachedPack: EsaGatesPack | undefined;

function loadEsaGatesPack(): EsaGatesPack {
  if (cachedPack) {
    return cachedPack;
  }
  const path = join(findProjectRoot(import.meta.url), "legal", "rules", "esa-gates.v1.json");
  cachedPack = JSON.parse(readFileSync(path, "utf8")) as EsaGatesPack;
  return cachedPack;
}

function containsAny(text: string, keywords: string[]): string | undefined {
  const normalized = text.toLowerCase();
  return keywords.find((keyword) => normalized.includes(keyword.toLowerCase()));
}

export interface SupervisorAssessmentInput {
  jobTitle?: string;
  actualDuties: string;
  occupation?: string;
}

export interface SupervisorAssessmentResult {
  result: SupervisorGateResult;
  matchedKeywords: string[];
  rationale: string;
  findings: Finding[];
}

/**
 * G1：実作業ベースで建設現場作業・港湾運送をブロックし、監督職を許可する
 * G1: block construction-site labor / port work by actual duties; allow supervisor roles
 * G1: blokir kerja lapangan konstruksi / pelabuhan berdasarkan tugas aktual; izinkan jabatan pengawas
 */
export function assessSupervisorGate(input: SupervisorAssessmentInput): SupervisorAssessmentResult {
  const pack = loadEsaGatesPack();
  const duties = input.actualDuties.trim();
  if (!duties) {
    return {
      result: "needs_review",
      matchedKeywords: [],
      rationale: "実作業内容が未入力のため二次関所（人の目視）が必要です / Actual duties missing; human secondary review required",
      findings: [
        {
          ruleKey: "esa.G1.actual_duties_required",
          result: "incomplete",
          severity: "blocking",
          message: "実作業内容（actualDuties）が未入力です。肩書だけでは判定できません / actualDuties is required; title alone is not enough",
          missingFields: ["actualDuties"],
        },
      ],
    };
  }

  const portHit = containsAny(duties, pack.gates.G1.blockedDutyKeywords.port);
  if (portHit) {
    return {
      result: "blocked_port",
      matchedKeywords: [portHit],
      rationale: `港湾運送に該当する実作業「${portHit}」を検出。紹介不可（職安法32条の11） / Port-work duty "${portHit}" detected; placement forbidden (ESA Art. 32-11)`,
      findings: [
        {
          ruleKey: "esa.G1.port_work_blocked",
          result: "fail",
          severity: "blocking",
          message: `港湾運送業務は有料職業紹介が禁止されています（検出語: ${portHit}） / Port transport work cannot be placed for a fee (matched: ${portHit})`,
          missingFields: [],
        },
      ],
    };
  }

  const constructionHit = containsAny(duties, pack.gates.G1.blockedDutyKeywords.construction_site);
  const supervisorHit =
    containsAny(duties, pack.gates.G1.allowedSupervisorKeywords) ??
    (input.jobTitle ? containsAny(input.jobTitle, pack.gates.G1.allowedSupervisorKeywords) : undefined) ??
    (input.occupation ? containsAny(input.occupation, pack.gates.G1.allowedSupervisorKeywords) : undefined);

  if (constructionHit && !supervisorHit) {
    return {
      result: "blocked_construction_site",
      matchedKeywords: [constructionHit],
      rationale: `建設現場作業「${constructionHit}」を検出。監督職キーワードなし → 紹介不可 / Construction-site duty "${constructionHit}" without supervisor keywords → blocked`,
      findings: [
        {
          ruleKey: "esa.G1.construction_site_blocked",
          result: "fail",
          severity: "blocking",
          message: `建設現場作業は有料職業紹介が禁止されています（検出語: ${constructionHit}）。監督・管理・設計の実作業であることを確認してください / Construction-site labor cannot be placed (matched: ${constructionHit}). Confirm actual duties are supervisory/management/design`,
          missingFields: [],
        },
      ],
    };
  }

  if (constructionHit && supervisorHit) {
    return {
      result: "needs_review",
      matchedKeywords: [constructionHit, supervisorHit],
      rationale: `現場作業語「${constructionHit}」と監督語「${supervisorHit}」が混在。肩書だけで通さず人の目視が必要 / Mixed site-work "${constructionHit}" and supervisor "${supervisorHit}"; human review required`,
      findings: [
        {
          ruleKey: "esa.G1.mixed_duties_needs_review",
          result: "expert_review_required",
          severity: "blocking",
          message: "実作業に現場作業と監督の両方の語が含まれるため、二次関所（目視）が必要です / Duties mix site-work and supervisor terms; secondary human review required",
          missingFields: [],
        },
      ],
    };
  }

  if (supervisorHit) {
    return {
      result: "allowed_supervisor",
      matchedKeywords: [supervisorHit],
      rationale: `監督・管理系の実作業「${supervisorHit}」を確認。紹介可能領域 / Supervisor/management duty "${supervisorHit}" confirmed; placement allowed`,
      findings: [
        {
          ruleKey: "esa.G1.supervisor_allowed",
          result: "pass",
          severity: "info",
          message: `監督職として受理可能です（検出語: ${supervisorHit}） / Acceptable as supervisor role (matched: ${supervisorHit})`,
          missingFields: [],
        },
      ],
    };
  }

  // 建設・港湾キーワードも監督キーワードもない一般職 → 建設ブロック対象外としてpass
  // General occupation with neither construction/port nor supervisor keywords → pass (not in G1 block set)
  return {
    result: "allowed_supervisor",
    matchedKeywords: [],
    rationale: "建設現場作業・港湾運送の禁止キーワードに該当しない / No blocked construction-site or port keywords",
    findings: [
      {
        ruleKey: "esa.G1.not_blocked_occupation",
        result: "pass",
        severity: "info",
        message: "建設現場作業・港湾運送の禁止業務には該当しません / Not a blocked construction-site or port occupation",
        missingFields: [],
      },
    ],
  };
}

/**
 * G6：お祝い金等の禁止表現を検出する
 * G6: detect forbidden celebration-bonus / incentive phrases
 * G6: deteksi frasa uang selamat / insentif yang dilarang
 */
export function checkAccurateRepresentation(adCopy: string): Finding[] {
  const pack = loadEsaGatesPack();
  const hits = pack.gates.G6.forbiddenPhrases.filter((phrase) => adCopy.includes(phrase));
  if (hits.length === 0) {
    return [
      {
        ruleKey: "esa.G6.accurate_representation",
        result: "pass",
        severity: "info",
        message: "的確表示の禁止表現は検出されませんでした / No forbidden accurate-representation phrases detected",
        missingFields: [],
      },
    ];
  }
  return [
    {
      ruleKey: "esa.G6.forbidden_incentive_phrase",
      result: "fail",
      severity: "blocking",
      message: `就職お祝い金等の禁止表現を検出: ${hits.join(", ")} / Forbidden incentive phrases detected: ${hits.join(", ")}`,
      missingFields: [],
    },
  ];
}

export interface EsaGateContextFindingsInput {
  jobOrderId?: string;
  jobOrderReferralId?: string;
  adCopy?: string;
}

/**
 * G2–G6をDB状態から追加判定する（G1はassessSupervisorGateを別途呼ぶ）
 * Extra G2–G6 findings from DB state (call assessSupervisorGate separately for G1)
 * Finding tambahan G2–G6 dari status DB (panggil assessSupervisorGate terpisah untuk G1)
 */
export async function evaluateEsaGateContext(db: Db, input: EsaGateContextFindingsInput): Promise<Finding[]> {
  const findings: Finding[] = [];

  if (input.jobOrderId) {
    const [jobOrder] = await db.select().from(jobOrders).where(eq(jobOrders.id, input.jobOrderId)).limit(1);
    if (jobOrder) {
      if (jobOrder.status === "filled" || jobOrder.status === "closed") {
        findings.push({
          ruleKey: "esa.G6.stale_job_still_advertised",
          result: jobOrder.status === "filled" ? "fail" : "pass",
          severity: jobOrder.status === "filled" ? "blocking" : "info",
          message:
            jobOrder.status === "filled"
              ? "充足済み求人です。広告・投稿は速やかに削除してください / Job is filled; remove ads/posts promptly"
              : "求人はクローズ済みです / Job order is closed",
          missingFields: [],
        });
      }
      if (jobOrder.actualDuties) {
        findings.push(...assessSupervisorGate({
          jobTitle: jobOrder.jobTitle ?? undefined,
          actualDuties: jobOrder.actualDuties,
          occupation: jobOrder.occupation,
        }).findings);
      } else {
        findings.push({
          ruleKey: "esa.G1.actual_duties_required",
          result: "incomplete",
          severity: "blocking",
          message: "実作業内容が未入力のためG1関所を通過できません / Cannot pass G1 without actualDuties",
          missingFields: ["actualDuties"],
        });
      }
    }
  }

  if (input.jobOrderReferralId) {
    const [referral] = await db
      .select()
      .from(jobOrderReferrals)
      .where(eq(jobOrderReferrals.id, input.jobOrderReferralId))
      .limit(1);
    if (referral) {
      const relatedDocs = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.subjectId, input.jobOrderReferralId),
            inArray(documents.docType, ["t2p_job_order_notice", "t2p_consent_form"]),
          ),
        );

      const notice4 = relatedDocs.find((doc) => doc.docType === "t2p_job_order_notice");
      const consent5 = relatedDocs.find((doc) => doc.docType === "t2p_consent_form");

      // G2: 推薦前に④交付（delivered/sent）済みか
      if (!notice4 || (notice4.deliveryStatus !== "sent" && notice4.deliveryStatus !== "delivered")) {
        findings.push({
          ruleKey: "esa.G2.conditions_notice_before_referral",
          result: "fail",
          severity: "blocking",
          message: "推薦前に④求人条件明示書の交付（deliveryStatus=sent/delivered）が必要です / Document ④ must be delivered before referral",
          missingFields: ["t2p_job_order_notice.deliveryStatus"],
        });
      } else {
        findings.push({
          ruleKey: "esa.G2.conditions_notice_before_referral",
          result: "pass",
          severity: "info",
          message: "④求人条件明示書は交付済みです / Document ④ has been delivered",
          missingFields: [],
        });
      }

      // G3: レジュメ提供前に⑤同意
      if (!consent5 || (consent5.executionStatus !== "executed" && consent5.contentStatus !== "approved")) {
        findings.push({
          ruleKey: "esa.G3.consent_before_pii_share",
          result: "fail",
          severity: "blocking",
          message: "第三者提供前に⑤本人同意書の取得（approved/executed）が必要です / Document ⑤ must be approved/executed before sharing PII",
          missingFields: ["t2p_consent_form"],
        });
      } else {
        findings.push({
          ruleKey: "esa.G3.consent_before_pii_share",
          result: "pass",
          severity: "info",
          message: "⑤本人同意書は取得済みです / Document ⑤ consent has been obtained",
          missingFields: [],
        });
      }

      // G5: 成立前のfee禁止・転職勧奨禁止期間
      const fees = await db.select().from(feeRecords).where(eq(feeRecords.referralId, referral.id));
      if (referral.outcome !== "hired" && fees.length > 0) {
        findings.push({
          ruleKey: "esa.G5.fee_only_after_hire",
          result: "fail",
          severity: "blocking",
          message: "就職成立前に手数料が記帳されています / Fee recorded before hire is finalized",
          missingFields: [],
        });
      }
      if (referral.outcome === "hired" && referral.noPoachingUntil) {
        const today = new Date().toISOString().slice(0, 10);
        if (today <= referral.noPoachingUntil) {
          findings.push({
            ruleKey: "esa.G5.no_poaching_active",
            result: "pass",
            severity: "info",
            message: `転職勧奨禁止期間中です（〜${referral.noPoachingUntil}）。本人への再勧奨は禁止 / No-poaching period active until ${referral.noPoachingUntil}`,
            missingFields: [],
          });
        }
      }
    }
  }

  if (input.adCopy) {
    findings.push(...checkAccurateRepresentation(input.adCopy));
  }

  return findings;
}
