import json
import os
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError


TABLE_NAME = os.environ.get(
    "TABLE_NAME",
    "lovely-system-progress",
)

STATE_ID = os.environ.get(
    "STATE_ID",
    "main",
)

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def response(status_code, body=None):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Cache-Control": "no-store",
    }

    if status_code == 204:
        return {
            "statusCode": status_code,
            "headers": headers,
            "body": "",
        }

    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps(body or {}),
    }


def read_body(event):
    raw = event.get("body")

    if not raw:
        return {}

    if not isinstance(raw, str):
        if isinstance(raw, dict):
            return raw

        raise ValueError("invalid request body")

    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError("invalid JSON")

    if not isinstance(value, dict):
        raise ValueError(
            "request body must be an object"
        )

    return value


def get_route(event):
    request_context = (
        event.get("requestContext")
        or {}
    )

    http = (
        request_context.get("http")
        or {}
    )

    method = (
        http.get("method")
        or event.get("httpMethod")
        or ""
    ).upper()

    path = (
        http.get("path")
        or event.get("rawPath")
        or event.get("path")
        or "/"
    )

    return method, path.rstrip("/") or "/"


def get_state():
    result = table.get_item(
        Key={
            "state_id": STATE_ID
        },
        ConsistentRead=True,
    )

    item = result.get("Item")

    if not item:
        item = {
            "state_id": STATE_ID,
            "position": Decimal(50),
            "message": "",
        }

        try:
            table.put_item(
                Item=item,
                ConditionExpression=(
                    "attribute_not_exists(state_id)"
                ),
            )

        except ClientError as error:
            code = (
                error.response
                .get("Error", {})
                .get("Code")
            )

            if code != (
                "ConditionalCheckFailedException"
            ):
                raise

            result = table.get_item(
                Key={
                    "state_id": STATE_ID
                },
                ConsistentRead=True,
            )

            item = result["Item"]

    return {
        "position": int(
            item.get("position", 50)
        ),
        "message": item.get(
            "message",
            "",
        ),
    }


def move(direction):
    if direction not in {
        "left",
        "right",
    }:
        raise ValueError(
            "direction must be left or right"
        )

    if direction == "left":
        delta = Decimal(-1)

        condition = (
            "attribute_exists(state_id) "
            "AND #position > :limit"
        )

        values = {
            ":delta": delta,
            ":limit": Decimal(0),
        }

    else:
        delta = Decimal(1)

        condition = (
            "attribute_exists(state_id) "
            "AND #position < :limit"
        )

        values = {
            ":delta": delta,
            ":limit": Decimal(100),
        }

    try:
        result = table.update_item(
            Key={
                "state_id": STATE_ID
            },

            UpdateExpression=(
                "ADD #position :delta"
            ),

            ConditionExpression=condition,

            ExpressionAttributeNames={
                "#position": "position",
            },

            ExpressionAttributeValues=values,

            ReturnValues="ALL_NEW",
        )

    except ClientError as error:
        code = (
            error.response
            .get("Error", {})
            .get("Code")
        )

        if code == (
            "ConditionalCheckFailedException"
        ):
            return get_state()

        raise

    attributes = (
        result.get("Attributes")
        or {}
    )

    return {
        "position": int(
            attributes.get(
                "position",
                50,
            )
        ),

        "message": attributes.get(
            "message",
            "",
        ),
    }


def save_message(message):
    if not isinstance(message, str):
        raise ValueError(
            "message must be a string"
        )

    if len(message) > 10000:
        raise ValueError(
            "message is too long"
        )

    result = table.update_item(
        Key={
            "state_id": STATE_ID
        },

        UpdateExpression=(
            "SET message = :message"
        ),

        ExpressionAttributeValues={
            ":message": message,
        },

        ReturnValues="ALL_NEW",
    )

    attributes = (
        result.get("Attributes")
        or {}
    )

    return {
        "position": int(
            attributes.get(
                "position",
                50,
            )
        ),

        "message": attributes.get(
            "message",
            "",
        ),
    }


def lambda_handler(event, context):
    try:
        method, path = get_route(event)

        if method == "OPTIONS":
            return response(204)

        if (
            method == "GET"
            and path in {
                "/",
                "/state",
            }
        ):
            return response(
                200,
                get_state(),
            )

        if (
            method == "POST"
            and path == "/move"
        ):
            body = read_body(event)

            return response(
                200,
                move(
                    body.get(
                        "direction"
                    )
                ),
            )

        if (
            method == "POST"
            and path == "/message"
        ):
            body = read_body(event)

            return response(
                200,
                save_message(
                    body.get(
                        "message"
                    )
                ),
            )

        return response(
            404,
            {
                "error": "not found"
            },
        )

    except ValueError as error:
        return response(
            400,
            {
                "error": str(error)
            },
        )

    except Exception as error:
        print(
            "Unhandled failure:",
            repr(error),
        )

        return response(
            500,
            {
                "error":
                    "internal server error"
            },
        )
