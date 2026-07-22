#!/usr/bin/env bash
set -euo pipefail

BASE="http://localhost:8080/mcp"
AUTH="Authorization: Bearer local-dev-secret-token-do-not-use-in-prod"

call() {
  local id="$1" method="$2" params_json="$3"
  local body
  body=$(jq -n --argjson id "$id" --arg method "$method" --argjson params "$params_json" \
    '{jsonrpc:"2.0", id:$id, method:$method, params:$params}')
  curl -s -X POST "$BASE" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "$AUTH" \
    -d "$body" \
    | sed -n 's/^data: //p'
}

tool_json() {
  jq -r '.result.content[0].text'
}

echo "== 1. job_order.analyze =="
ANALYZE_PARAMS=$(jq -n \
  --arg sourceText $'件名: 求人のご依頼\n事業所名: 株式会社サンプル農園\n所在地: 鹿児島県霧島市国分1-1-1\n代表者: 山田太郎\n担当者: 佐藤花子\n受付年月日: 2026-07-01\n有効期間: 2026-12-31\n求人数: 3\n職種: 農作業員\n就業場所: 鹿児島県霧島市\n雇用形態: 期間の定めあり\n賃金: 時給1200円\n' \
  --arg sourceUri "slack://C123/p999" \
  '{name:"job_order.analyze", arguments:{sourceText:$sourceText, sourceUri:$sourceUri}}')
ANALYZE_RESULT=$(call 10 "tools/call" "$ANALYZE_PARAMS")
echo "$ANALYZE_RESULT" | jq .
SOURCE_ARTIFACT_ID=$(echo "$ANALYZE_RESULT" | tool_json | jq -r '.sourceArtifactId')
echo "sourceArtifactId=$SOURCE_ARTIFACT_ID"

echo "== 2. job_order.confirm =="
CONFIRM_PARAMS=$(jq -n --arg sourceArtifactId "$SOURCE_ARTIFACT_ID" '{
  name: "job_order.confirm",
  arguments: {
    idempotencyKey: "smoke-test-1",
    reason: "スモークテスト",
    sourceArtifactId: $sourceArtifactId,
    employer: {
      companyId: "00000000-0000-0000-0000-000000000002",
      name: "株式会社サンプル農園",
      address: "鹿児島県霧島市国分1-1-1",
      representative: "山田太郎",
      contactPerson: "佐藤花子"
    },
    fields: {
      acceptedAt: "2026-07-01",
      validUntil: "2026-12-31",
      headcount: 3,
      occupation: "農作業員",
      workLocation: "鹿児島県霧島市",
      employmentPeriodType: "fixed",
      wageUnit: "hour",
      t2pFlag: false,
      refundSystem: false,
      source: "direct"
    }
  }
}')
CONFIRM_RESULT=$(call 11 "tools/call" "$CONFIRM_PARAMS")
echo "$CONFIRM_RESULT" | jq .
JOB_ORDER_ID=$(echo "$CONFIRM_RESULT" | tool_json | jq -r '.subjectId')
echo "jobOrderId=$JOB_ORDER_ID"

echo "== 3. compliance.evaluate =="
EVAL_PARAMS=$(jq -n --arg subjectId "$JOB_ORDER_ID" '{name:"compliance.evaluate", arguments:{subjectType:"job_order", subjectId:$subjectId}}')
call 12 "tools/call" "$EVAL_PARAMS" | jq .

echo "== 4. resources/read assen://audit/job_order/{id} =="
AUDIT_PARAMS=$(jq -n --arg uri "assen://audit/job_order/$JOB_ORDER_ID" '{uri:$uri}')
call 13 "resources/read" "$AUDIT_PARAMS" | jq .

echo "== 5. resources/read assen://documents/{logicalDocumentId}/{version} (not found probe) =="
call 14 "resources/list" '{}' | jq .

echo "== 6. prompts/get intake-job-order =="
PROMPT_PARAMS='{"name":"intake-job-order","arguments":{"sourceText":"test","sourceUri":"slack://x"}}'
call 15 "prompts/get" "$PROMPT_PARAMS" | jq -c '.result.messages[0].content.text' | head -c 300
echo

echo "DONE jobOrderId=$JOB_ORDER_ID sourceArtifactId=$SOURCE_ARTIFACT_ID"
