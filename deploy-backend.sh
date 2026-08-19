#!/usr/bin/env bash
set -euo pipefail

TABLE_NAME="lovely-system-progress"
RESURRECTION_TABLE_NAME="lovely-system-resurrections"
FUNCTION_NAME="lovely-system-progress"
ROLE_NAME="lovely-system-progress-lambda"
API_NAME="lovely-system-progress"
USER_POOL_NAME="lovely-system-users"
APP_CLIENT_NAME="lovely-system-web"
AUTHORIZER_NAME="lovely-system-cognito"
COGNITO_REDIRECT_URI="https://progress.ourlovelysystem.org/"

REGION="$(aws configure get region 2>/dev/null || true)"
if [[ -z "${REGION}" ]]; then
  REGION="us-east-1"
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
COGNITO_DOMAIN_PREFIX="ourlovelysystem-${ACCOUNT_ID}"
COGNITO_DOMAIN="https://${COGNITO_DOMAIN_PREFIX}.auth.${REGION}.amazoncognito.com"

echo "Account: ${ACCOUNT_ID}"
echo "Region:  ${REGION}"

if ! aws dynamodb describe-table \
  --table-name "${RESURRECTION_TABLE_NAME}" \
  --region "${REGION}" >/dev/null 2>&1
then
  echo "Creating resurrection ledger..."
  aws dynamodb create-table \
    --region "${REGION}" \
    --table-name "${RESURRECTION_TABLE_NAME}" \
    --attribute-definitions \
      AttributeName=user_sub,AttributeType=S \
      AttributeName=event_id,AttributeType=S \
    --key-schema \
      AttributeName=user_sub,KeyType=HASH \
      AttributeName=event_id,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists \
    --region "${REGION}" \
    --table-name "${RESURRECTION_TABLE_NAME}"
fi

TABLE_ARN="$(aws dynamodb describe-table \
  --table-name "${TABLE_NAME}" \
  --region "${REGION}" \
  --query 'Table.TableArn' --output text)"
RESURRECTION_TABLE_ARN="$(aws dynamodb describe-table \
  --table-name "${RESURRECTION_TABLE_NAME}" \
  --region "${REGION}" \
  --query 'Table.TableArn' --output text)"

USER_POOL_ID="$(aws cognito-idp list-user-pools \
  --region "${REGION}" \
  --max-results 60 \
  --query "UserPools[?Name=='${USER_POOL_NAME}'].Id | [0]" \
  --output text)"

if [[ -z "${USER_POOL_ID}" || "${USER_POOL_ID}" == "None" ]]; then
  echo "Creating Cognito user pool..."
  USER_POOL_ID="$(aws cognito-idp create-user-pool \
    --region "${REGION}" \
    --pool-name "${USER_POOL_NAME}" \
    --username-attributes email \
    --auto-verified-attributes email \
    --query 'UserPool.Id' --output text)"
fi

APP_CLIENT_ID="$(aws cognito-idp list-user-pool-clients \
  --region "${REGION}" \
  --user-pool-id "${USER_POOL_ID}" \
  --max-results 60 \
  --query "UserPoolClients[?ClientName=='${APP_CLIENT_NAME}'].ClientId | [0]" \
  --output text)"

if [[ -z "${APP_CLIENT_ID}" || "${APP_CLIENT_ID}" == "None" ]]; then
  echo "Creating Cognito public web client..."
  APP_CLIENT_ID="$(aws cognito-idp create-user-pool-client \
    --region "${REGION}" \
    --user-pool-id "${USER_POOL_ID}" \
    --client-name "${APP_CLIENT_NAME}" \
    --no-generate-secret \
    --supported-identity-providers COGNITO \
    --callback-urls "${COGNITO_REDIRECT_URI}" \
    --logout-urls "${COGNITO_REDIRECT_URI}" \
    --allowed-o-auth-flows code \
    --allowed-o-auth-scopes openid email profile \
    --allowed-o-auth-flows-user-pool-client \
    --prevent-user-existence-errors ENABLED \
    --query 'UserPoolClient.ClientId' --output text)"
else
  aws cognito-idp update-user-pool-client \
    --region "${REGION}" \
    --user-pool-id "${USER_POOL_ID}" \
    --client-id "${APP_CLIENT_ID}" \
    --client-name "${APP_CLIENT_NAME}" \
    --supported-identity-providers COGNITO \
    --callback-urls "${COGNITO_REDIRECT_URI}" \
    --logout-urls "${COGNITO_REDIRECT_URI}" \
    --allowed-o-auth-flows code \
    --allowed-o-auth-scopes openid email profile \
    --allowed-o-auth-flows-user-pool-client \
    --prevent-user-existence-errors ENABLED >/dev/null
fi

DOMAIN_POOL_ID="$(aws cognito-idp describe-user-pool-domain \
  --region "${REGION}" \
  --domain "${COGNITO_DOMAIN_PREFIX}" \
  --query 'DomainDescription.UserPoolId' --output text 2>/dev/null || true)"

if [[ -z "${DOMAIN_POOL_ID}" || "${DOMAIN_POOL_ID}" == "None" ]]; then
  echo "Creating Cognito hosted-login domain..."
  aws cognito-idp create-user-pool-domain \
    --region "${REGION}" \
    --user-pool-id "${USER_POOL_ID}" \
    --domain "${COGNITO_DOMAIN_PREFIX}" \
    --managed-login-version 1 >/dev/null
elif [[ "${DOMAIN_POOL_ID}" != "${USER_POOL_ID}" ]]; then
  echo "Cognito domain ${COGNITO_DOMAIN_PREFIX} belongs to another user pool." >&2
  exit 1
fi

cat > /tmp/lovely-progress-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF

if ! aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document file:///tmp/lovely-progress-trust.json >/dev/null
fi

aws iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

cat > /tmp/lovely-progress-dynamodb.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:TransactWriteItems"
    ],
    "Resource": [
      "${TABLE_ARN}",
      "${RESURRECTION_TABLE_ARN}"
    ]
  }]
}
EOF

aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name lovely-system-progress-dynamodb \
  --policy-document file:///tmp/lovely-progress-dynamodb.json

ROLE_ARN="$(aws iam get-role \
  --role-name "${ROLE_NAME}" \
  --query 'Role.Arn' --output text)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -f "${SCRIPT_DIR}/function.zip"
(
  cd "${SCRIPT_DIR}"
  zip -q function.zip lambda_function.py
)

cat > /tmp/lovely-progress-env.json <<EOF
{
  "Variables": {
    "TABLE_NAME": "${TABLE_NAME}",
    "RESURRECTION_TABLE_NAME": "${RESURRECTION_TABLE_NAME}",
    "STATE_ID": "main",
    "COGNITO_CLIENT_ID": "${APP_CLIENT_ID}",
    "COGNITO_DOMAIN": "${COGNITO_DOMAIN}",
    "COGNITO_REDIRECT_URI": "${COGNITO_REDIRECT_URI}"
  }
}
EOF

if aws lambda get-function \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" >/dev/null 2>&1
then
  aws lambda update-function-code \
    --function-name "${FUNCTION_NAME}" \
    --region "${REGION}" \
    --zip-file "fileb://${SCRIPT_DIR}/function.zip" >/dev/null

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
    --environment file:///tmp/lovely-progress-env.json >/dev/null
else
  echo "Creating Lambda function..."
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
      --environment file:///tmp/lovely-progress-env.json >/dev/null 2>&1
    then
      break
    fi
    if [[ "${attempt}" -eq 12 ]]; then
      echo "Unable to create Lambda function." >&2
      exit 1
    fi
    sleep 5
  done
fi

aws lambda wait function-active-v2 \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}"

FUNCTION_ARN="$(aws lambda get-function \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --query 'Configuration.FunctionArn' --output text)"

API_ID="$(aws apigatewayv2 get-apis \
  --region "${REGION}" \
  --query "Items[?Name=='${API_NAME}'].ApiId | [0]" --output text)"

if [[ -z "${API_ID}" || "${API_ID}" == "None" ]]; then
  echo "Creating HTTP API..."
  API_JSON="$(aws apigatewayv2 create-api \
    --region "${REGION}" \
    --name "${API_NAME}" \
    --protocol-type HTTP \
    --target "${FUNCTION_ARN}" \
    --cors-configuration \
      'AllowOrigins=["*"],AllowMethods=["GET","POST","OPTIONS"],AllowHeaders=["Content-Type","Authorization"],MaxAge=86400')"
  API_ID="$(printf '%s' "${API_JSON}" | python3 -c \
    'import json,sys; print(json.load(sys.stdin)["ApiId"])')"
else
  aws apigatewayv2 update-api \
    --region "${REGION}" \
    --api-id "${API_ID}" \
    --cors-configuration \
      'AllowOrigins=["*"],AllowMethods=["GET","POST","OPTIONS"],AllowHeaders=["Content-Type","Authorization"],MaxAge=86400' >/dev/null
fi

API_ENDPOINT="$(aws apigatewayv2 get-api \
  --region "${REGION}" \
  --api-id "${API_ID}" \
  --query 'ApiEndpoint' --output text)"

STATEMENT_ID="allow-apigateway-${API_ID}"
if ! aws lambda get-policy \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" 2>/dev/null | grep -q "${STATEMENT_ID}"
then
  aws lambda add-permission \
    --function-name "${FUNCTION_NAME}" \
    --region "${REGION}" \
    --statement-id "${STATEMENT_ID}" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" >/dev/null
fi

INTEGRATION_ID="$(aws apigatewayv2 get-integrations \
  --region "${REGION}" \
  --api-id "${API_ID}" \
  --query 'Items[0].IntegrationId' --output text)"

AUTHORIZER_ID="$(aws apigatewayv2 get-authorizers \
  --region "${REGION}" \
  --api-id "${API_ID}" \
  --query "Items[?Name=='${AUTHORIZER_NAME}'].AuthorizerId | [0]" --output text)"

ISSUER="https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}"
if [[ -z "${AUTHORIZER_ID}" || "${AUTHORIZER_ID}" == "None" ]]; then
  AUTHORIZER_ID="$(aws apigatewayv2 create-authorizer \
    --region "${REGION}" \
    --api-id "${API_ID}" \
    --name "${AUTHORIZER_NAME}" \
    --authorizer-type JWT \
    --identity-source '$request.header.Authorization' \
    --jwt-configuration "Audience=${APP_CLIENT_ID},Issuer=${ISSUER}" \
    --query 'AuthorizerId' --output text)"
else
  aws apigatewayv2 update-authorizer \
    --region "${REGION}" \
    --api-id "${API_ID}" \
    --authorizer-id "${AUTHORIZER_ID}" \
    --name "${AUTHORIZER_NAME}" \
    --identity-source '$request.header.Authorization' \
    --jwt-configuration "Audience=${APP_CLIENT_ID},Issuer=${ISSUER}" >/dev/null
fi

ensure_protected_route() {
  local route_key="$1"
  local route_id
  route_id="$(aws apigatewayv2 get-routes \
    --region "${REGION}" \
    --api-id "${API_ID}" \
    --query "Items[?RouteKey=='${route_key}'].RouteId | [0]" --output text)"

  if [[ -z "${route_id}" || "${route_id}" == "None" ]]; then
    aws apigatewayv2 create-route \
      --region "${REGION}" \
      --api-id "${API_ID}" \
      --route-key "${route_key}" \
      --target "integrations/${INTEGRATION_ID}" \
      --authorization-type JWT \
      --authorizer-id "${AUTHORIZER_ID}" >/dev/null
  else
    aws apigatewayv2 update-route \
      --region "${REGION}" \
      --api-id "${API_ID}" \
      --route-id "${route_id}" \
      --target "integrations/${INTEGRATION_ID}" \
      --authorization-type JWT \
      --authorizer-id "${AUTHORIZER_ID}" >/dev/null
  fi
}

ensure_protected_route "GET /resurrection-status"
ensure_protected_route "POST /resurrect"

cat > "${SCRIPT_DIR}/backend.json" <<EOF
{
  "account": "${ACCOUNT_ID}",
  "region": "${REGION}",
  "table": "${TABLE_NAME}",
  "resurrection_table": "${RESURRECTION_TABLE_NAME}",
  "function": "${FUNCTION_NAME}",
  "api_id": "${API_ID}",
  "api_endpoint": "${API_ENDPOINT}",
  "cognito_user_pool_id": "${USER_POOL_ID}",
  "cognito_client_id": "${APP_CLIENT_ID}",
  "cognito_domain": "${COGNITO_DOMAIN}",
  "cognito_redirect_uri": "${COGNITO_REDIRECT_URI}"
}
EOF

echo
echo "Backend deployed."
echo "API endpoint:     ${API_ENDPOINT}"
echo "Cognito domain:  ${COGNITO_DOMAIN}"
echo "Cognito client:  ${APP_CLIENT_ID}"
echo "Resurrection:    authenticated JWT required"
echo
echo "Testing GET /state..."
curl -fsS "${API_ENDPOINT}/state"
echo
