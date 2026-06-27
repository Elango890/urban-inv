import io
import os
from decimal import Decimal
from typing import Dict, List, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


def _number_to_words(n: int) -> str:
    ones = [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"
    ]
    tens = [
        "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
    ]
    teens = [
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
        "Sixteen", "Seventeen", "Eighteen", "Nineteen"
    ]

    def lt1000(num: int) -> str:
        if num == 0:
            return ""
        if num < 10:
            return ones[num]
        if num < 20:
            return teens[num - 10]
        if num < 100:
            return tens[num // 10] + (" " + ones[num % 10] if num % 10 else "")
        return ones[num // 100] + " Hundred" + (" " + lt1000(num % 100) if num % 100 else "")

    if n == 0:
        return "Zero"

    parts = []
    for divisor, label in [(10_000_000, "Crore"), (100_000, "Lakh"), (1_000, "Thousand")]:
        if n >= divisor:
            parts.append(f"{lt1000(n // divisor)} {label}")
            n %= divisor
    if n:
        parts.append(lt1000(n))
    return " ".join(parts)


class SalesInvoicePDFGenerator:
    DEFAULT_COMPANY = {
        "name": "Urban Health Food Supplements Trading LLC",
        "trn": "",
        "address_lines": [],
        "city_state_zip": "",
        "country": "United Arab Emirates",
        "phone": "",
        "account_name": "URBAN HEALTH FOOD SUPPLEMENTS TRADING LLC",
        "bank_name": "RAKBANK",
        "bank_account": "0882968172001",
        "iban": "AE610400000882968172001",
        "swift": "NRAKAEAK",
        "invoice_title": "TAX INVOICE",
    }

    def __init__(self, invoice):
        self.invoice = invoice
        self.buffer = io.BytesIO()
        self.page_size = A4
        self.page_width, self.page_height = self.page_size
        self.margin_x = 34
        self.margin_top = 34
        self.margin_bottom = 34
        self.table_header_fill = colors.HexColor("#f2f4f7")
        self.border_color = colors.HexColor("#6b7280")
        self.light_border = colors.HexColor("#d0d7e2")
        self.muted_text = colors.HexColor("#566273")
        self.heading_text = colors.HexColor("#0f172a")
        self.company = self._load_company()
        self.items = list(self.invoice.items.select_related("item").all())

    def _load_company(self) -> Dict[str, str]:
        from django.conf import settings
        from masters.models import OrganizationAddress

        company = dict(self.DEFAULT_COMPANY)
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

        company["trn"] = company.get("trn") or getattr(settings, "SALES_INVOICE_TRN", "") or ""
        return company

    def _customer_trn(self) -> str:
        return (
            getattr(self.invoice, "customer_trn", "")
            or getattr(self.invoice, "customer_gst", "")
            or ""
        )

    def _logo_path(self):
        from django.conf import settings

        configured = getattr(settings, "SALES_INVOICE_LOGO_PATH", "")
        candidates = [
            configured,
            os.path.join(settings.BASE_DIR, "inventory_backend", "static", "images", "logo.jpeg"),
            os.path.join(settings.BASE_DIR, "inventory_backend", "static", "images", "logo.png"),
        ]
        for path in candidates:
            if path and os.path.exists(path):
                return path
        return None

    @staticmethod
    def _money(value: float) -> str:
        return f"AED {value:,.2f}"

    @staticmethod
    def _money_plain(value: float) -> str:
        return f"{value:,.2f}"

    def _format_date(self, value) -> str:
        if not value:
            return "—"
        return value.strftime("%d %b %Y")

    def _format_table_date(self, value) -> str:
        if not value:
            return "—"
        return value.strftime("%d %b %Y")

    def _wrap_lines(
        self,
        text: str,
        width: float,
        font_name: str = "Helvetica",
        font_size: int = 9,
        max_lines: int | None = None,
    ) -> List[str]:
        text = (text or "").replace("\r\n", "\n")
        chunks = []
        for para in text.split("\n"):
            words = para.split()
            if not words:
                chunks.append("")
                continue
            line = words[0]
            for word in words[1:]:
                candidate = f"{line} {word}"
                if stringWidth(candidate, font_name, font_size) <= width:
                    line = candidate
                else:
                    chunks.append(line)
                    line = word
            chunks.append(line)
        if max_lines and len(chunks) > max_lines:
            trimmed = chunks[:max_lines]
            if trimmed:
                last = trimmed[-1]
                if len(last) > 3:
                    trimmed[-1] = last[:-3].rstrip() + "..."
            return trimmed
        return chunks

    def _customer_block_lines(self, shipping: bool = False) -> List[str]:
        customer = getattr(self.invoice, "customer", None)
        customer_trn = self._customer_trn()
        if shipping:
            lines = [
                self.invoice.customer_name or "",
                getattr(customer, "shipping_attention", "") if customer else "",
                getattr(customer, "shipping_address_line1", "") if customer else "",
                getattr(customer, "shipping_address_line2", "") if customer else "",
                ", ".join(
                    part
                    for part in [
                        getattr(customer, "shipping_city", "") if customer else "",
                        getattr(customer, "shipping_state", "") if customer else "",
                    ]
                    if part
                ),
                getattr(customer, "shipping_country", "") if customer else "",
                getattr(customer, "shipping_zip", "") if customer else "",
                f"TRN {customer_trn}" if customer_trn else "",
            ]
            if not any(lines[1:4]):
                lines = [
                    self.invoice.customer_name or "",
                    self.invoice.customer_shipping_address or self.invoice.customer_address or "",
                    getattr(customer, "shipping_country", "") if customer else "",
                    f"TRN {customer_trn}" if customer_trn else "",
                ]
        else:
            lines = [
                self.invoice.customer_name or "",
                getattr(customer, "billing_attention", "") if customer else "",
                self.invoice.customer_address or "",
                ", ".join(
                    part
                    for part in [
                        getattr(customer, "billing_city", "") if customer else "",
                        getattr(customer, "billing_state", "") if customer else "",
                    ]
                    if part
                ),
                getattr(customer, "billing_country", "") if customer else "",
                getattr(customer, "billing_zip", "") if customer else "",
                f"TRN {customer_trn}" if customer_trn else "",
            ]
        return [line.strip() for line in lines if line and str(line).strip()]

    def _terms_display(self) -> str:
        customer = getattr(self.invoice, "customer", None)
        if customer and getattr(customer, "payment_terms", ""):
            return customer.get_payment_terms_display()
        return "—"

    def _amount_in_words(self, amount: float) -> str:
        dirhams = int(amount)
        fils = int(round((amount - dirhams) * 100))
        text = f"{_number_to_words(dirhams)} Dirhams"
        if fils:
            text += f" And {_number_to_words(fils)} Fils"
        return f"{text} Only"

    def _row_dict(self, item) -> Dict[str, object]:
        quantity = float(item.quantity or 0)
        rsp_incl = float(getattr(item, "rsp_incl_vat", 0) or 0)
        rsp_without = float(getattr(item, "rsp_without_vat", item.unit_price) or 0)
        discount = float(item.discount or 0)
        discount_label = (
            f"{discount:.2f}%"
            if getattr(item, "discount_type", "amount") == "percent"
            else self._money_plain(discount)
        )
        amount_per_unit = float(getattr(item, "amount_per_unit", 0) or 0)
        net_amount = round(amount_per_unit * quantity, 2)
        return {
            "name_lines": self._wrap_lines(item.item_name or "", 120, "Helvetica-Bold", 8, max_lines=3),
            "desc_lines": self._wrap_lines(item.item_description or "", 120, "Helvetica", 7, max_lines=2),
            "batch": item.batch_number or "—",
            "expiry": self._format_table_date(item.expiry_date) if item.expiry_date else "—",
            "qty": f"{quantity:.2f}".rstrip("0").rstrip(".") if quantity % 1 else f"{int(quantity)}",
            "vat_rate": f"{float(item.tax_rate or 0):.2f}%",
            "rsp_incl": self._money_plain(rsp_incl),
            "rsp_without": self._money_plain(rsp_without),
            "discount": discount_label,
            "amount_per_unit": self._money_plain(amount_per_unit),
            "line_amount": self._money_plain(net_amount),
        }

    def _row_height(self, row: Dict[str, object]) -> float:
        line_count = len(row["name_lines"]) + max(0, len(row["desc_lines"]))
        return max(34, 16 + (line_count * 9))

    def _summary_values(self) -> Dict[str, float]:
        subtotal = round(sum(float(getattr(i, "amount_per_unit", 0) or 0) * float(i.quantity or 0) for i in self.items), 2)
        vat = round(sum(float(i.tax_amount or 0) for i in self.items), 2)
        total = round(subtotal + vat, 2)
        paid = round(
            sum(float(getattr(payment, "amount", 0) or 0) for payment in self.invoice.payments.all()),
            2,
        )
        balance_due = round(max(total - paid, 0), 2)
        vat_rates = sorted(
            {
                round(float(getattr(i, "tax_rate", 0) or 0), 2)
                for i in self.items
                if float(getattr(i, "tax_rate", 0) or 0) > 0
            }
        )
        if not vat_rates:
            vat_label = "VAT"
        elif len(vat_rates) == 1:
            rate = vat_rates[0]
            vat_label = f"VAT ({rate:.0f}%)" if rate.is_integer() else f"VAT ({rate:.2f}%)"
        else:
            rate_text = ", ".join(
                f"{rate:.0f}%" if rate.is_integer() else f"{rate:.2f}%"
                for rate in vat_rates
            )
            vat_label = f"VAT - Mixed Rates ({rate_text})"
        return {
            "subtotal": subtotal,
            "vat": vat,
            "total": total,
            "paid": paid,
            "balance_due": balance_due,
            "vat_label": vat_label,
        }

    def _table_columns(self, left: float) -> List[Tuple[str, float]]:
        return [
            ("NO", 18),
            ("Item & Description", 124),
            ("Batch Number", 50),
            ("Expiry Date", 45),
            ("Qty", 24),
            ("TAX %", 30),
            ("RSP Incl VAT", 52),
            ("RSP Without VAT", 54),
            ("Discount", 42),
            ("Amount Per Unit", 46),
            ("Total Amount", 42),
        ]

    def _draw_text_block(self, c, x: float, y: float, lines: List[str], font="Helvetica", size=9, leading=11):
        c.setFont(font, size)
        for line in lines:
            c.drawString(x, y, line)
            y -= leading
        return y

    def _draw_header(self, c, page_no: int) -> float:
        left = self.margin_x
        right = self.page_width - self.margin_x
        top = self.page_height - self.margin_top
        width = right - left

        c.setStrokeColor(self.border_color)
        c.setLineWidth(0.8)
        c.rect(left, self.margin_bottom, width, top - self.margin_bottom)

        header_h = 86
        block_y = top
        c.line(left, block_y - header_h, right, block_y - header_h)


        logo_path = self._logo_path()
        if logo_path:
            c.drawImage(logo_path, left + 14, block_y - 64, width=58, height=52, preserveAspectRatio=True, mask="auto")

        company_x = left + 82
        c.setFillColor(self.heading_text)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(company_x, block_y - 24, self.company["name"][:54])
        c.setFillColor(self.muted_text)
        c.setFont("Helvetica", 7)
        company_lines = list(self.company.get("address_lines", []))
        if self.company.get("city_state_zip"):
            company_lines.append(self.company["city_state_zip"])
        if self.company.get("country"):
            company_lines.append(self.company["country"])
        if self.company.get("trn"):
            company_lines.append(f"TRN {self.company['trn']}")
        self._draw_text_block(c, company_x, block_y - 36, company_lines[:5], size=7, leading=9)

        c.setFillColor(self.heading_text)
        c.setFont("Helvetica", 22)
        c.drawRightString(right - 16, block_y - 30, self.company.get("invoice_title", "TAX INVOICE"))
        c.setFont("Helvetica", 7)
        c.drawRightString(right - 16, block_y - 50, f"Invoice Number {self.invoice.invoice_number}")

        meta_top = block_y - header_h
        meta_h = 52
        c.line(left, meta_top - meta_h, right, meta_top - meta_h)
        split_x = left + width * 0.43
        c.line(split_x, meta_top, split_x, meta_top - meta_h)

        c.setFont("Helvetica", 7)
        c.setFillColor(self.muted_text)
        left_meta = [
            ("Invoice Date", self._format_date(self.invoice.invoice_date)),
            ("Payment Terms", self._terms_display()),
            ("Due Date", self._format_date(self.invoice.due_date)),
        ]
        y = meta_top - 12
        for label, value in left_meta:
            c.drawString(left + 8, y, label)
            c.drawString(left + 92, y, f": {value}")
            y -= 12

        bill_ship_top = meta_top - meta_h
        block_h = 76
        c.line(left, bill_ship_top - block_h, right, bill_ship_top - block_h)
        c.line(split_x, bill_ship_top, split_x, bill_ship_top - block_h)
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(self.heading_text)
        c.drawString(left + 8, bill_ship_top - 12, "Bill To")
        c.drawString(split_x + 8, bill_ship_top - 12, "Ship To")
        bill_lines = self._customer_block_lines(False)[:6]
        ship_lines = self._customer_block_lines(True)[:6]
        if bill_lines:
            c.setFont("Helvetica-Bold", 7)
            c.drawString(left + 8, bill_ship_top - 26, bill_lines[0])
            self._draw_text_block(c, left + 8, bill_ship_top - 36, bill_lines[1:], size=7, leading=9)
        if ship_lines:
            c.setFont("Helvetica-Bold", 7)
            c.drawString(split_x + 8, bill_ship_top - 26, ship_lines[0])
            self._draw_text_block(c, split_x + 8, bill_ship_top - 36, ship_lines[1:], size=7, leading=9)
        return bill_ship_top - block_h

    def _draw_table_header(self, c, y: float, columns: List[Tuple[str, float]], starts: List[float]):
        total_width = sum(width for _, width in columns)
        left = self.margin_x
        c.setFillColor(self.table_header_fill)
        c.rect(left, y - 22, total_width, 22, fill=1, stroke=0)
        c.setStrokeColor(self.light_border)
        c.line(left, y, left + total_width, y)
        c.line(left, y - 22, left + total_width, y - 22)
        for idx, ((label, width), start) in enumerate(zip(columns, starts)):
            if idx > 0:
                c.line(start, y, start, y - 22)
            c.setFillColor(self.muted_text)
            c.setFont("Helvetica-Bold", 6)
            lines = self._wrap_lines(label, width - 6, "Helvetica-Bold", 6, max_lines=2)
            text_y = y - 9
            for line in lines:
                c.drawCentredString(start + width / 2, text_y, line)
                text_y -= 7
        c.setFillColor(self.heading_text)
        return y - 22

    def _draw_row(self, c, y: float, row_no: int, row: Dict[str, object], columns: List[Tuple[str, float]], starts: List[float]):
        height = self._row_height(row)
        left = self.margin_x
        total_width = sum(width for _, width in columns)
        c.setStrokeColor(self.light_border)
        c.line(left, y - height, left + total_width, y - height)
        for idx, start in enumerate(starts):
            c.line(start, y, start, y - height)
        c.line(left + total_width, y, left + total_width, y - height)

        c.setFillColor(self.heading_text)
        c.setFont("Helvetica", 7)
        top_text_y = y - 12
        values = [
            str(row_no),
            None,
            row["batch"],
            row["expiry"],
            row["qty"],
            row["vat_rate"],
            row["rsp_incl"],
            row["rsp_without"],
            row["discount"],
            row["amount_per_unit"],
            row["line_amount"],
        ]

        for idx, value in enumerate(values):
            start = starts[idx]
            width = columns[idx][1]
            if idx == 1:
                continue
            if idx in {6, 7, 8, 9, 10}:
                c.drawRightString(start + width - 4, top_text_y, str(value))
            elif idx in {0, 4, 5}:
                c.drawCentredString(start + width / 2, top_text_y, str(value))
            else:
                c.drawString(start + 4, top_text_y, str(value))

        name_x = starts[1] + 4
        text_y = y - 11
        c.setFont("Helvetica-Bold", 7)
        for line in row["name_lines"]:
            c.drawString(name_x, text_y, line)
            text_y -= 8
        if row["desc_lines"]:
            c.setFillColor(self.muted_text)
            c.setFont("Helvetica", 6)
            for line in row["desc_lines"]:
                c.drawString(name_x, text_y, line)
                text_y -= 7
            c.setFillColor(self.heading_text)
        return y - height

    def _draw_footer(self, c, page_no: int, total_pages: int):
        c.setFillColor(self.muted_text)
        c.setFont("Helvetica", 7)
        c.drawRightString(
            self.page_width - self.margin_x,
            self.margin_bottom - 10,
            f"Page {page_no} of {total_pages}",
        )

    def _draw_last_page_summary(self, c, y: float):
        left = self.margin_x
        right = self.page_width - self.margin_x
        width = right - left
        summary = self._summary_values()

        footer_top = y - 8
        footer_bottom = self.margin_bottom + 12
        c.setStrokeColor(self.border_color)
        c.rect(left, footer_bottom, width, footer_top - footer_bottom, stroke=1, fill=0)

        split_x = left + width * 0.64
        c.line(split_x, footer_top, split_x, footer_bottom)

        amount_title_y = footer_top - 14
        c.setFillColor(self.muted_text)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(left + 8, amount_title_y, "Total In Words")
        c.setFillColor(self.heading_text)
        c.setFont("Helvetica-BoldOblique", 7)
        words = self._wrap_lines(self._amount_in_words(summary["total"]), split_x - left - 20, "Helvetica-BoldOblique", 7, max_lines=3)
        self._draw_text_block(c, left + 8, amount_title_y - 14, words, font="Helvetica-BoldOblique", size=7, leading=9)

        bank_y = amount_title_y - 58
        c.setFillColor(self.muted_text)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(left + 8, bank_y, "Bank Details")
        c.setFillColor(self.heading_text)
        c.setFont("Helvetica", 7)
        bank_lines = [
            f"Account Name: {self.company.get('account_name') or self.company.get('name', '')}",
            f"Bank Name: {self.company['bank_name']}" if self.company.get("bank_name") else "",
            f"Account Number: {self.company['bank_account']}" if self.company.get("bank_account") else "",
            f"IBAN: {self.company['iban']}" if self.company.get("iban") else "",
            f"Swift Code: {self.company['swift']}" if self.company.get("swift") else "",
        ]
        self._draw_text_block(c, left + 8, bank_y - 14, [line for line in bank_lines if line][:5], size=7, leading=9)

        if self.invoice.terms_and_conditions:
            terms_y = max(footer_bottom + 28, bank_y - 80)
            c.setFillColor(self.muted_text)
            c.setFont("Helvetica-Bold", 7)
            c.drawString(left + 8, terms_y, "Terms & Conditions")
            c.setFillColor(self.heading_text)
            terms_lines = self._wrap_lines(
                self.invoice.terms_and_conditions,
                split_x - left - 20,
                "Helvetica",
                6,
                max_lines=5,
            )
            self._draw_text_block(c, left + 8, terms_y - 12, terms_lines, size=6, leading=8)

        box_x = split_x + 10
        box_w = right - box_x - 10
        summary_rows = [
            ("Sub Total", summary["subtotal"]),
            (summary.get("vat_label", "VAT"), summary["vat"]),
            ("Total", summary["total"]),
            ("Balance Due", summary["balance_due"]),
        ]
        row_y = footer_top - 18
        c.setFillColor(self.heading_text)
        c.setFont("Helvetica", 8)
        for label, value in summary_rows:
            c.drawString(box_x, row_y, label)
            c.drawRightString(right - 10, row_y, self._money_plain(value))
            row_y -= 16

    def generate(self) -> io.BytesIO:
        c = canvas.Canvas(self.buffer, pagesize=self.page_size)
        c.setTitle(f"Invoice {self.invoice.invoice_number}")

        columns = self._table_columns(self.margin_x)
        starts = []
        cursor = self.margin_x
        for _, width in columns:
            starts.append(cursor)
            cursor += width
        rows = [self._row_dict(item) for item in self.items]
        if not rows:
            rows = [{
                "name_lines": ["No line items"],
                "desc_lines": [],
                "batch": "—",
                "expiry": "—",
                "qty": "0",
                "vat_rate": "0.00%",
                "rsp_incl": "0.00",
                "rsp_without": "0.00",
                "discount": "0.00",
                "amount_per_unit": "0.00",
                "line_amount": "0.00",
            }]

        row_idx = 0
        total_pages = 1
        simulated_pages = []
        while row_idx < len(rows):
            page_rows = []
            available_y = self.page_height - self.margin_top - 212
            bottom_limit = self.margin_bottom + 190
            y = available_y
            while row_idx < len(rows):
                height = self._row_height(rows[row_idx])
                if y - height < bottom_limit and page_rows:
                    break
                page_rows.append(rows[row_idx])
                y -= height
                row_idx += 1
            simulated_pages.append(page_rows)
        total_pages = max(1, len(simulated_pages))

        item_no = 1
        for page_no, page_rows in enumerate(simulated_pages, start=1):
            table_top = self._draw_header(c, page_no)
            c.setStrokeColor(self.border_color)
            table_width = sum(width for _, width in columns)
            c.line(self.margin_x, table_top, self.margin_x + table_width, table_top)
            y = self._draw_table_header(c, table_top, columns, starts)
            for row in page_rows:
                y = self._draw_row(c, y, item_no, row, columns, starts)
                item_no += 1

            is_last = page_no == total_pages
            if is_last:
                footer_anchor_y = min(y, self.margin_bottom + 196)
                self._draw_last_page_summary(c, footer_anchor_y)
            self._draw_footer(c, page_no, total_pages)
            if not is_last:
                c.showPage()

        c.save()
        self.buffer.seek(0)
        return self.buffer
