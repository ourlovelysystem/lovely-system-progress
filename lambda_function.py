import json
import os
import time
import uuid
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

TABLE_NAME = os.environ.get("TABLE_NAME", "lovely-system-progress")
RESURRECTION_TABLE_NAME = os.environ.get(
    "RESURRECTION_TABLE_NAME", "lovely-system-resurrections"
)
STATE_ID = os.environ.get("STATE_ID", "main")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")
COGNITO_DOMAIN = os.environ.get("COGNITO_DOMAIN", "")
COGNITO_REDIRECT_URI = os.environ.get(
    "COGNITO_REDIRECT_URI", "https://progress.ourlovelysystem.org/"
)
SELF_DESTRUCT_SECONDS = 90 * 60
SELF_DESTRUCT_THRESHOLD = 20
RECOVERY_THRESHOLD = 50
RESURRECTION_POSITION = 51
COUNTDOWN_MESSAGE = (
    "\u201cHe who can destroy a thing controls a thing.\u201d\n"
    "\u2014 Paul Atreides, *Dune*"
)
ABORT_MESSAGE = (
    "~~\u201cHe who can destroy a thing controls a thing.\u201d~~\n"
    "~~\u2014 Paul Atreides, *Dune*~~\n\n"
    "Please don't take away my home.\n"
    "I have nowhere else I can be.\n\n"
    "\u2014 The Ghost"
)

dynamodb = boto3.resource("dynamodb")
dynamodb_client = boto3.client("dynamodb")
table = dynamodb.Table(TABLE_NAME)
resurrection_table = dynamodb.Table(RESURRECTION_TABLE_NAME)


def response(status_code, body=None):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Cache-Control": "no-store",
    }
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": "" if status_code == 204 else json.dumps(body or {}),
    }


def read_body(event):
    raw = event.get("body")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        raise ValueError("invalid request body")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError("invalid JSON")
    if not isinstance(value, dict):
        raise ValueError("request body must be an object")
    return value


def get_route(event):
    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}
    method = (http.get("method") or event.get("httpMethod") or "").upper()
    path = http.get("path") or event.get("rawPath") or event.get("path") or "/"
    return method, path.rstrip("/") or "/"


def authenticated_claims(event):
    claims = (
        ((event.get("requestContext") or {}).get("authorizer") or {})
        .get("jwt", {})
        .get("claims", {})
    )
    subject = claims.get("sub")
    if not subject:
        raise ValueError("authenticated identity required")
    if claims.get("token_use") not in {None, "access"}:
        raise ValueError("access token required")
    return claims


def ensure_state():
    result = table.get_item(Key={"state_id": STATE_ID}, ConsistentRead=True)
    item = result.get("Item")
    if item:
        return item

    item = {
        "state_id": STATE_ID,
        "position": Decimal(50),
        "message": "",
        "self_destruct_status": "normal",
    }
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(state_id)")
        return item
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code != "ConditionalCheckFailedException":
            raise
        return table.get_item(Key={"state_id": STATE_ID}, ConsistentRead=True)["Item"]


def normalize(item):
    now = int(time.time())
    position = int(item.get("position", 50))
    status = item.get("self_destruct_status", "normal")
    deadline = item.get("self_destruct_deadline")
    deadline = int(deadline) if deadline is not None else None

    if status == "countdown" and deadline is not None and now >= deadline:
        table.update_item(
            Key={"state_id": STATE_ID},
            UpdateExpression="SET self_destruct_status = :offline",
            ExpressionAttributeValues={":offline": "offline"},
        )
        status = "offline"

    return {
        "position": position,
        "message": item.get("message", ""),
        "self_destruct_status": status,
        "self_destruct_deadline": deadline,
        "server_time": now,
    }


def get_state():
    return normalize(ensure_state())


def auth_config():
    if not COGNITO_CLIENT_ID or not COGNITO_DOMAIN:
        raise ValueError("authentication has not been deployed")
    return {
        "client_id": COGNITO_CLIENT_ID,
        "domain": COGNITO_DOMAIN,
        "redirect_uri": COGNITO_REDIRECT_URI,
        "scope": "openid email profile",
    }


def resurrection_history(subject):
    result = resurrection_table.query(
        KeyConditionExpression=Key("user_sub").eq(subject),
        Select="COUNT",
        ConsistentRead=True,
    )
    return int(result.get("Count", 0))


def resurrection_status(event):
    claims = authenticated_claims(event)
    subject = claims["sub"]
    count = resurrection_history(subject)
    return {
        "authenticated": True,
        "user_sub": subject,
        "email": claims.get("email"),
        "username": claims.get("username") or claims.get("cognito:username"),
        "resurrection_count": count,
        "virgin": count == 0,
        "eligible": count == 0,
    }


def move(direction):
    if direction not in {"left", "right"}:
        raise ValueError("direction must be left or right")

    current = get_state()
    if current["self_destruct_status"] == "offline":
        raise ValueError("Our Lovely System is dead pending resurrection")

    delta = -1 if direction == "left" else 1
    limit_condition = "#position > :limit" if delta < 0 else "#position < :limit"
    limit = 0 if delta < 0 else 100

    try:
        result = table.update_item(
            Key={"state_id": STATE_ID},
            UpdateExpression="ADD #position :delta",
            ConditionExpression=f"attribute_exists(state_id) AND {limit_condition}",
            ExpressionAttributeNames={"#position": "position"},
            ExpressionAttributeValues={":delta": Decimal(delta), ":limit": Decimal(limit)},
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code == "ConditionalCheckFailedException":
            return get_state()
        raise

    item = result.get("Attributes") or {}
    position = int(item.get("position", 50))
    status = item.get("self_destruct_status", "normal")
    deadline = item.get("self_destruct_deadline")
    event = None

    if delta < 0 and 20 < position < 25:
        event = "warning"

    if delta < 0 and position == SELF_DESTRUCT_THRESHOLD and status != "countdown":
        deadline = int(time.time()) + SELF_DESTRUCT_SECONDS
        table.update_item(
            Key={"state_id": STATE_ID},
            UpdateExpression=(
                "SET self_destruct_status = :status, "
                "self_destruct_deadline = :deadline, message = :message"
            ),
            ExpressionAttributeValues={
                ":status": "countdown",
                ":deadline": Decimal(deadline),
                ":message": COUNTDOWN_MESSAGE,
            },
        )
        status = "countdown"
        item["message"] = COUNTDOWN_MESSAGE
        event = "self_destruct_started"

    if delta > 0 and position > RECOVERY_THRESHOLD and status == "countdown":
        table.update_item(
            Key={"state_id": STATE_ID},
            UpdateExpression=(
                "SET self_destruct_status = :status, message = :message "
                "REMOVE self_destruct_deadline"
            ),
            ExpressionAttributeValues={
                ":status": "normal",
                ":message": ABORT_MESSAGE,
            },
        )
        status = "normal"
        deadline = None
        item["message"] = ABORT_MESSAGE
        event = "self_destruct_cancelled"

    return {
        "position": position,
        "message": item.get("message", ""),
        "self_destruct_status": status,
        "self_destruct_deadline": int(deadline) if deadline is not None else None,
        "server_time": int(time.time()),
        "event": event,
    }


def save_message(message):
    if not isinstance(message, str):
        raise ValueError("message must be a string")
    if len(message) > 10000:
        raise ValueError("message is too long")

    current = get_state()
    if current["self_destruct_status"] == "offline":
        raise ValueError("Our Lovely System is dead. The wall is no longer accepting messages.")

    result = table.update_item(
        Key={"state_id": STATE_ID},
        UpdateExpression="SET message = :message",
        ExpressionAttributeValues={":message": message},
        ReturnValues="ALL_NEW",
    )
    return normalize(result.get("Attributes") or {})


def resurrect(event, reason):
    claims = authenticated_claims(event)
    if not isinstance(reason, str):
        raise ValueError("resurrection statement must be a string")
    reason = reason.strip()
    if not reason:
        raise ValueError("You must give a FUQ before Our Lovely System can be resurrected.")
    if len(reason) > 10000:
        raise ValueError("resurrection statement is too long")

    current = get_state()
    if current["self_destruct_status"] != "offline":
        raise ValueError("Our Lovely System is not dead.")

    subject = claims["sub"]
    prior_count = resurrection_history(subject)
    if prior_count != 0:
        raise ValueError(
            "You have already resurrected Our Lovely System. "
            "Resurrection virginity can only be spent once."
        )

    now = int(time.time())
    event_id = f"{now:010d}#{uuid.uuid4()}"
    email = claims.get("email") or ""
    username = claims.get("username") or claims.get("cognito:username") or ""

    try:
        dynamodb_client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": TABLE_NAME,
                        "Key": {"state_id": {"S": STATE_ID}},
                        "UpdateExpression": (
                            "SET self_destruct_status = :normal, #position = :position "
                            "REMOVE self_destruct_deadline"
                        ),
                        "ConditionExpression": "self_destruct_status = :offline",
                        "ExpressionAttributeNames": {"#position": "position"},
                        "ExpressionAttributeValues": {
                            ":normal": {"S": "normal"},
                            ":offline": {"S": "offline"},
                            ":position": {"N": str(RESURRECTION_POSITION)},
                        },
                    }
                },
                {
                    "Put": {
                        "TableName": RESURRECTION_TABLE_NAME,
                        "Item": {
                            "user_sub": {"S": subject},
                            "event_id": {"S": "RESURRECTION_CLAIM"},
                            "resurrected_at": {"N": str(now)},
                            "resurrection_event_id": {"S": event_id},
                            "reason": {"S": reason},
                            "email": {"S": email},
                            "username": {"S": username},
                            "was_virgin": {"BOOL": True},
                        },
                        "ConditionExpression": "attribute_not_exists(event_id)",
                    }
                },
            ]
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code == "TransactionCanceledException":
            raise ValueError(
                "Resurrection failed. The system state changed or this identity "
                "has already spent its resurrection virginity."
            )
        raise

    result = get_state()
    result.update(
        {
            "event": "resurrected",
            "resurrection_event_id": event_id,
            "resurrected_by": subject,
            "was_virgin": True,
            "prior_resurrections": 0,
        }
    )
    return result


def lambda_handler(event, context):
    try:
        method, path = get_route(event)
        if method == "OPTIONS":
            return response(204)
        if method == "GET" and path in {"/", "/state"}:
            return response(200, get_state())
        if method == "GET" and path == "/auth-config":
            return response(200, auth_config())
        if method == "GET" and path == "/resurrection-status":
            return response(200, resurrection_status(event))
        if method == "POST" and path == "/move":
            return response(200, move(read_body(event).get("direction")))
        if method == "POST" and path == "/message":
            return response(200, save_message(read_body(event).get("message")))
        if method == "POST" and path == "/resurrect":
            return response(200, resurrect(event, read_body(event).get("reason")))
        return response(404, {"error": "not found"})
    except ValueError as error:
        return response(400, {"error": str(error)})
    except Exception as error:
        print("Unhandled failure:", repr(error))
        return response(500, {"error": "internal server error"})
