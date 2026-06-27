import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("purchases", "0002_initial"),
        ("sales", "0004_sales_return_multi_invoice"),
        ("stock", "0004_stock_expired_quantity"),
    ]

    operations = [
        migrations.AddField(
            model_name="stockhistory",
            name="batch_number",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="stockhistory",
            name="expiry_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="StockBatch",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("batch_number", models.CharField(blank=True, default="", max_length=100)),
                ("expiry_date", models.DateField(blank=True, null=True)),
                ("quantity_received", models.PositiveIntegerField(default=0)),
                ("quantity_available", models.PositiveIntegerField(default=0)),
                ("item", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="batch_stocks", to="masters.item")),
                ("purchase_entry_item", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="stock_batches", to="purchases.purchaseentryitem")),
                ("sales_return_item", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="restocked_batches", to="sales.salesreturnitem")),
                ("warehouse", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="batch_stocks", to="stock.warehouse")),
            ],
            options={
                "ordering": ["expiry_date", "created_at", "id"],
                "indexes": [
                    models.Index(fields=["item", "warehouse", "expiry_date"], name="stockbatch_wh_exp_idx"),
                    models.Index(fields=["item", "quantity_available"], name="stockbatch_avail_idx"),
                ],
            },
        ),
        migrations.CreateModel(
            name="SalesItemBatchAllocation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quantity", models.PositiveIntegerField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("sales_invoice_item", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="batch_allocations", to="sales.salesinvoiceitem")),
                ("stock_batch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="sales_allocations", to="stock.stockbatch")),
            ],
            options={
                "ordering": ["created_at", "id"],
            },
        ),
    ]
