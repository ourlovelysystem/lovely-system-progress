#!/usr/bin/env bash
set -euo pipefail

TABLE_NAME="lovely-system-progress"
FUNCTION_NAME="lovely-system-progress"
ROLE_NAME="lovely-system-progress-lambda"
API_NAME="lovely-system-progress"

REGION="$(
  aws configure get region 2>/dev/null || true
)"

if [[ -z "${REGION}" ]]; then
  REGION="us-east-1"
fi

ACCOUNT_ID="$(
  aws sts get-caller-identity \
    --query Account \
    --output text
)"

echo "Account: ${ACCOUNT_ID}"
echo "Region:  ${REGION}"

TABLE_ARN="$(
  aws dynamodb describe-table \
    --table-name "${TABLE_NAME}" \
    --region "${REGION}" \
    --query 'Table.TableArn' \
    --output text
)"

cat > /tmp/lovely-progress-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

if ! aws iam get-role \
  --role-name "${ROLE_NAME}" \
  >/dev/null 2>&1
then
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document \
      file:///tmp/lovely-progress-trust.json \
    >/dev/null
fi

aws iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn \
    arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

cat > /tmp/lovely-progress-dynamodb.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": "${TABLE_ARN}"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name lovely-system-progress-dynamodb \
  --policy-document \
    file:///tmp/lovely-progress-dynamodb.json

ROLE_ARN="$(
  aws iam get-role \
    --role-name "${ROLE_NAME}" \
    --query 'Role.Arn' \
    --output text
)"

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" \
  && pwd
)"

rm -f "${SCRIPT_DIR}/function.zip"

(
  cd "${SCRIPT_DIR}"
  zip -q function.zip lambda_function.py
)

if aws lambda get-function \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  >/dev/null 2>&1
then
  aws lambda update-function-code \
    --function-name "${FUNCTION_NAME}" \
    --region "${REGION}" \
    --zip-file "fileb://${SCRIPT_DIR}/function.zip" \
    >/dev/null

  aws lambda wait function-updated-v2 \
    --function-name "${FUNCTION_NAME}" \
    --region "${REGION}"

  aws lambda update-function-configuration \
    --function-name "${FUNCTION_NAME}" \
    --region "${REGION}" \
    --runtime python3.13 \
    --handler lambda_function.lambda_handler \
    --timeout 10 \
    --memory-size 128 \
    --environment \
      "Variables={TABLE_NAME=${TABLE_NAME},STATE_ID=main}" \
    >/dev/null
else
  echo "Creating Lambda function..."

  # IAM role creation is eventually consistent.
  for attempt in {1..12}; do
    if aws lambda create-function \
      --function-name "${FUNCTION_NAME}" \
      --region "${REGION}" \
      --runtime python3.13 \
      --role "${ROLE_ARN}" \
      --handler lambda_function.lambda_handler \
      --zip-file "fileb://${SCRIPT_DIR}/function.zip" \
      --timeout 10 \
      --memory-size 128 \
      --environment \
        "Variables={TABLE_NAME=${TABLE_NAME},STATE_ID=main}" \
      >/dev/null 2>&1
    then
      break
    fi

    if [[ "${attempt}" -eq 12 ]]; then
      echo "Unable to create Lambda function."
      exit 1
    fi

    sleep 5
  done
fi

aws lambda wait function-active-v2 \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}"

FUNCTION_ARN="$(
  aws lambda get-function \
    --function-name "${FUNCTION_NAME}" \
    --region "${REGION}" \
    --query 'Configuration.FunctionArn' \
    --output text
)"

API_ID="$(
  aws apigatewayv2 get-apis \
    --region "${REGION}" \
    --query \
      "Items[?Name=='${API_NAME}'].ApiId | [0]" \
    --output text
)"

if [[ \
  -z "${API_ID}" \
  || "${API_ID}" == "None" \
]]
then
  echo "Creating HTTP API..."

  API_JSON="$(
    aws apigatewayv2 create-api \
      --region "${REGION}" \
      --name "${API_NAME}" \
      --protocol-type HTTP \
      --target "${FUNCTION_ARN}" \
      --cors-configuration \
        'AllowOrigins=["*"],AllowMethods=["GET","POST","OPTIONS"],AllowHeaders=["Content-Type"],MaxAge=86400'
  )"

  API_ID="$(
    printf '%s' "${API_JSON}" \
    | python3 -c \
      'import json,sys; print(json.load(sys.stdin)["ApiId"])'
  )"
fi

API_ENDPOINT="$(
  aws apigatewayv2 get-api \
    --region "${REGION}" \
    --api-id "${API_ID}" \
    --query 'ApiEndpoint' \
    --output text
)"

STATEMENT_ID="allow-apigateway-${API_ID}"

if ! aws lambda get-policy \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  2>/dev/null \
  | grep -q "${STATEMENT_ID}"
then
  aws lambda add-permission \
    --function-name "${FUNCTION_NAME}" \
    --region "${REGION}" \
    --statement-id "${STATEMENT_ID}" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn \
      "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" \
    >/dev/null
fi

cat > "${SCRIPT_DIR}/backend.json" <<EOF
{
  "account": "${ACCOUNT_ID}",
  "region": "${REGION}",
  "table": "${TABLE_NAME}",
  "function": "${FUNCTION_NAME}",
  "api_id": "${API_ID}",
  "api_endpoint": "${API_ENDPOINT}"
}
EOF

echo
echo "Backend deployed."
echo "API endpoint: ${API_ENDPOINT}"
echo
echo "Testing GET /state..."

curl -fsS "${API_ENDPOINT}/state"
echo
