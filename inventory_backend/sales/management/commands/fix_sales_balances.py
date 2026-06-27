from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum


class Command(BaseCommand):
    help = "Fix sales invoice balances and sync customer outstanding amounts"

    @transaction.atomic
    def handle(self, *args, **options):
        from sales.models import SalesInvoice
        from masters.models import Customer

        self.stdout.write("Step 1: Fixing SalesInvoice paid/balance/payment_status...")

        fixed = 0
        for inv in SalesInvoice.objects.all():
            total_paid = inv.payments.aggregate(t=Sum("amount"))["t"] or 0
            total_paid = float(total_paid)
            total_amount = float(inv.total_amount)

            balance = max(0, total_amount - total_paid)
            if total_paid <= 0:
                status = "unpaid"
            elif total_paid >= total_amount - 0.01:
                status = "paid"
            else:
                status = "partial"

            SalesInvoice.objects.filter(pk=inv.pk).update(
                paid_amount=total_paid,
                balance_amount=balance,
                payment_status=status,
            )
            fixed += 1

        self.stdout.write(f"  Fixed {fixed} sales invoices.")

        self.stdout.write("Step 2: Syncing customer outstanding balances...")

        synced = 0
        for customer in Customer.objects.all():
            customer.sync_outstanding()
            synced += 1

        self.stdout.write(f"  Synced {synced} customers.")
        self.stdout.write(self.style.SUCCESS("All sales data repaired successfully."))
