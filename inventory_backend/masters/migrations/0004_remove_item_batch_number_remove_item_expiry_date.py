from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("masters", "0003_item_batch_expiry"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="item",
            name="batch_number",
        ),
        migrations.RemoveField(
            model_name="item",
            name="expiry_date",
        ),
    ]
