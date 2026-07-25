/**
 * WF-25H成約4点同時起票の台本
 * Script for WF-25H placement 4-point fire
 * Naskah untuk 4 titik simultan WF-25H
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";

export function registerWf25hPlacementPrompt(server: McpServer, _context: ServiceContext): void {
  server.registerPrompt(
    "wf-25h-placement",
    {
      title: "WF-25H成約を処理する",
      description:
        "通常紹介の入社・紹介予定派遣の成立・WIN移行をplacement_confirmへ流し、#20/#40/#15/#10の4点同時処理を確認する台本 / Script for handling WF-25H placement outcomes through placement_confirm / Naskah memproses hasil WF-25H melalui placement_confirm",
      argsSchema: {
        placementNotes: z.string().describe("成約メモ（転換種別・入社日・手数料状態） / Placement notes / Catatan penempatan"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "WF-25H（直接雇用転換）を処理してください。",
              "1. 転換種別を選ぶ: standard_placement_hire / t2p_conversion / win_transition",
              "2. P5/WIN移行で手数料未確定ならfeeStatus=pending_negotiationにして、feeは省略",
              "3. placement_confirm(outcome=hired)を実行し、帳簿③または請求保留ドラフトを作る",
              "4. #20へ3-1-2/3-1-1/所属機関変更の案内、#15へ成約記録、#40へ請求ドラフト、#10の求人クローズを確認",
              "5. WIN移行ではDrive人材フォルダの🌠→🌞移動と支援記録引き継ぎを必ず残す",
              "",
              "成約メモ:",
              args.placementNotes,
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
