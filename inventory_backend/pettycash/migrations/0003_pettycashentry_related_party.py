from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("masters", "0001_initial"),
        ("pettycash", "0002_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="pettycashentry",
            name="related_party_type",
            field=models.CharField(
                choices=[("own", "Own"), ("customer", "Customer"), ("vendor", "Vendor")],
                default="own",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="pettycashentry",
            name="customer",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="petty_cash_entries",
                to="masters.customer",
            ),
        ),
        migrations.AddField(
            model_name="pettycashentry",
            name="vendor",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="petty_cash_entries",
                to="masters.vendor",
            ),
        ),
    ]
