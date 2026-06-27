from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("stock", "0002_initial"),
    ]

    operations = [
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
                    ("transfer_in", "Transfer In"),
                    ("transfer_out", "Transfer Out"),
                    ("returned", "Sales Return"),
                    ("opening", "Opening Balance"),
                ],
                max_length=25,
            ),
        ),
    ]
