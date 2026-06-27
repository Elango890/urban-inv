from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone


def _company_profile() -> dict:
    from masters.models import OrganizationAddress

    company = {
        "app_name": "InvenTrack",
        "name": "Urban Health Food Supplements Trading LLC",
        "address_lines": [],
        "city_state_zip": "",
        "country": "United Arab Emirates",
        "phone": "",
        "trn": getattr(settings, "SALES_INVOICE_TRN", "") or "",
        "support_email": getattr(settings, "DEFAULT_FROM_EMAIL", ""),
    }
    company.update(getattr(settings, "SALES_INVOICE_COMPANY", {}) or {})

    org = (
        OrganizationAddress.objects.filter(is_active=True, is_default=True).first()
        or OrganizationAddress.objects.filter(is_active=True).first()
    )
    if org:
        company["name"] = org.name or company["name"]
        company["address_lines"] = [
            line
            for line in [org.address_line1.strip(), org.address_line2.strip()]
            if line
        ]
        company["city_state_zip"] = ", ".join(
            part for part in [org.city.strip(), org.state.strip(), org.zip.strip()] if part
        )
        company["country"] = org.country or company["country"]
        company["phone"] = org.phone or company["phone"]

    return company


def money(value, currency: str = "AED") -> str:
    try:
        amount = Decimal(str(value or 0))
    except (InvalidOperation, TypeError, ValueError):
        amount = Decimal("0.00")
    return f"{currency} {amount:,.2f}"


def send_templated_email(*, subject: str, to: list[str], template_name: str, context: dict, reply_to: list[str] | None = None) -> None:
    base_context = {
        "company": _company_profile(),
        "support_email": getattr(settings, "DEFAULT_FROM_EMAIL", ""),
        "current_year": timezone.now().year,
    }
    full_context = {**base_context, **context}
    text_body = render_to_string(f"emails/{template_name}.txt", full_context)
    html_body = render_to_string(f"emails/{template_name}.html", full_context)

    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=to,
        reply_to=reply_to or None,
    )
    message.attach_alternative(html_body, "text/html")
    message.send(fail_silently=False)
