from django.apps import apps
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from masters.models import FinancialYear
from users.models import User


TARGET_APP_LABELS = {
    "admin",
    "audit",
    "masters",
    "pettycash",
    "purchases",
    "sales",
    "sessions",
    "stock",
}

PRESERVED_MODELS = {
    ("masters", "financialyear"),
    ("users", "user"),
}


class Command(BaseCommand):
    help = (
        "Delete all business data while preserving FinancialYear rows and "
        "superuser accounts."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Confirm the deletion without an interactive prompt.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be deleted without changing data.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        confirmed = options["yes"]

        if not dry_run and not confirmed:
            raise CommandError("Use --yes to confirm deletion, or --dry-run to inspect.")

        target_models = self._get_target_models()
        truncate_tables = [model._meta.db_table for model in target_models]

        self.stdout.write(self.style.WARNING("Preserving models:"))
        self.stdout.write("  - masters.FinancialYear")
        self.stdout.write("  - users.User (superusers only)")
        self.stdout.write("")
        self.stdout.write(self.style.WARNING("Clearing tables:"))
        for model in target_models:
            self.stdout.write(
                f"  - {model._meta.app_label}.{model.__name__} ({model._meta.db_table})"
            )
        self.stdout.write("  - users.User non-superusers")

        if dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.SUCCESS("Dry run complete. No data deleted."))
            return

        with transaction.atomic():
            self._truncate_tables(truncate_tables)
            deleted_users, _ = User.objects.filter(is_superuser=False).delete()

        fy_count = FinancialYear.objects.count()
        superuser_count = User.objects.filter(is_superuser=True).count()

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Business data reset complete."))
        self.stdout.write(f"Deleted non-superuser user rows: {deleted_users}")
        self.stdout.write(f"Remaining financial years: {fy_count}")
        self.stdout.write(f"Remaining superusers: {superuser_count}")

    def _get_target_models(self):
        models_to_clear = []
        for model in apps.get_models():
            meta = model._meta
            if meta.proxy or not meta.managed:
                continue
            if (meta.app_label, meta.model_name) in PRESERVED_MODELS:
                continue
            if meta.app_label not in TARGET_APP_LABELS:
                continue
            models_to_clear.append(model)
        models_to_clear.sort(key=lambda model: (model._meta.app_label, model._meta.model_name))
        return models_to_clear

    def _truncate_tables(self, table_names):
        if not table_names:
            return

        quoted_tables = ", ".join(connection.ops.quote_name(name) for name in table_names)

        with connection.cursor() as cursor:
            if connection.vendor == "postgresql":
                cursor.execute(f"TRUNCATE TABLE {quoted_tables} RESTART IDENTITY CASCADE;")
                return

            if connection.vendor == "sqlite":
                cursor.execute("PRAGMA foreign_keys = OFF;")
                try:
                    for table_name in table_names:
                        cursor.execute(
                            f"DELETE FROM {connection.ops.quote_name(table_name)};"
                        )
                    for sequence_row in connection.introspection.sequence_list():
                        cursor.execute(
                            "DELETE FROM sqlite_sequence WHERE name = %s;",
                            [sequence_row["table"]],
                        )
                finally:
                    cursor.execute("PRAGMA foreign_keys = ON;")
                return

            for table_name in table_names:
                cursor.execute(f"DELETE FROM {connection.ops.quote_name(table_name)};")
