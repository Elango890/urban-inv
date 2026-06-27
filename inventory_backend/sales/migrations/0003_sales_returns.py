from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("stock", "0001_initial"),
        ("sales", "0002_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SalesReturn",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("return_number", models.CharField(max_length=50, unique=True)),
                ("return_date", models.DateField()),
                ("reason", models.TextField(blank=True, default="")),
                ("notes", models.TextField(blank=True, default="")),
                ("status", models.CharField(choices=[("draft", "Draft"), ("confirmed", "Confirmed"), ("cancelled", "Cancelled")], default="draft", max_length=12)),
                ("subtotal", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("tax_amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("total_amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("stock_posted", models.BooleanField(default=False)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="sales_returns", to="masters.customer")),
                ("financial_year", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="sales_returns", to="masters.financialyear")),
                ("sales_invoice", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="returns", to="sales.salesinvoice")),
                ("warehouse", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="sales_returns", to="stock.warehouse")),
            ],
            options={
                "verbose_name": "Sales Return",
                "verbose_name_plural": "Sales Returns",
                "ordering": ["-return_date", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="SalesReturnItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("item_name", models.CharField(default="", max_length=200)),
                ("quantity", models.DecimalField(decimal_places=2, default=1, max_digits=10)),
                ("unit_price", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("tax_rate", models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ("subtotal", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("tax_amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("line_total", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("reason", models.TextField(blank=True, default="")),
                ("item", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="sales_return_items", to="masters.item")),
                ("sales_invoice_item", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="return_items", to="sales.salesinvoiceitem")),
                ("sales_return", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="items", to="sales.salesreturn")),
            ],
            options={
                "verbose_name": "Sales Return Item",
            },
        ),
    ]
