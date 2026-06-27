from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum


class Command(BaseCommand):
    help = "Fix purchase entry balances and sync supplier outstanding amounts"

    @transaction.atomic
    def handle(self, *args, **options):
        from purchases.models import PurchaseEntry
        from masters.models import Supplier

        self.stdout.write("Step 1: Fixing PurchaseEntry paid/balance/payment_status...")

        fixed_entries = 0

        for entry in PurchaseEntry.objects.all():
            total_paid = entry.payments.aggregate(t=Sum("amount"))["t"] or 0
            total_paid = float(total_paid)
            total_amount = float(entry.total_amount)

            balance = max(0, total_amount - total_paid)

            if total_paid <= 0:
                status = "unpaid"
            elif total_paid >= total_amount - 0.01:
                status = "paid"
            else:
                status = "partial"

            PurchaseEntry.objects.filter(pk=entry.pk).update(
                paid_amount=total_paid,
                balance_amount=balance,
                payment_status=status,
            )

            fixed_entries += 1

        self.stdout.write(f"  Fixed {fixed_entries} purchase entries.")

        # ------------------------------------------------------------------

        self.stdout.write("Step 2: Syncing supplier outstanding balances...")

        fixed_suppliers = 0

        for supplier in Supplier.objects.all():
            supplier.sync_outstanding()
            fixed_suppliers += 1

        self.stdout.write(f"  Synced {fixed_suppliers} suppliers.")

        self.stdout.write(self.style.SUCCESS("All purchase data repaired successfully."))