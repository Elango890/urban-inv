from typing import Dict, Iterable, Optional

from rest_framework.response import Response


def _humanize_field_name(field: str) -> str:
    label = (
        field.replace("_", " ")
        .replace("-", " ")
    )
    humanized = []
    for char in label:
        if humanized and char.isupper() and humanized[-1].isalnum():
            humanized.append(" ")
        humanized.append(char)
    return "".join(humanized).strip().capitalize()


def error_response(
    message: str,
    code: int = 400,
    errors: Optional[Dict[str, Iterable[str]]] = None,
) -> Response:
    payload = {"error": message}
    if errors:
        payload["errors"] = errors
    return Response(payload, status=code)


def required_errors(data, fields: Iterable[str]) -> Dict[str, list]:
    errors: Dict[str, list] = {}
    for f in fields:
        if not data.get(f):
            errors[f] = [f"{_humanize_field_name(f)} is required."]
    return errors


def field_errors(field: str, message: str) -> Dict[str, list]:
    return {field: [message]}
