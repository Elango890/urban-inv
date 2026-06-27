from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("stock", "0003_add_returned_movement_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="stock",
            name="expired_quantity",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AlterField(
            model_name="stockhistory",
            name="movement_type",
            field=models.CharField(
                choices=[
                    ("purchase_receipt", "Purchase Receipt"),
                    ("sale_dispatch", "Sale Dispatch"),
                    ("add", "Manual Add"),
                    ("remove", "Manual Remove"),
                    ("damaged", "Damaged"),
                    ("expired", "Expired"),
                    ("transfer_in", "Transfer In"),
                    ("transfer_out", "Transfer Out"),
                    ("returned", "Sales Return"),
                    ("opening", "Opening Balance"),
                ],
                max_length=25,
            ),
        ),
    ]
