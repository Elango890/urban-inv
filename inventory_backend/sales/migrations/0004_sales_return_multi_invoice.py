import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0003_sales_returns"),
    ]

    operations = [
        migrations.AlterField(
            model_name="salesreturn",
            name="sales_invoice",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="returns",
                to="sales.salesinvoice",
            ),
        ),
        migrations.AddField(
            model_name="salesreturnitem",
            name="disposition",
            field=models.CharField(
                choices=[
                    ("restock", "Restock"),
                    ("damaged", "Damaged"),
                    ("expired", "Expired"),
                ],
                default="restock",
                max_length=12,
            ),
        ),
    ]
