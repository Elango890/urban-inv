from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("masters", "0002_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="batch_number",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="item",
            name="expiry_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
