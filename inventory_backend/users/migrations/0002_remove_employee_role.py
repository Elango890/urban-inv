from django.db import migrations, models


def migrate_employee_to_staff(apps, schema_editor):
    User = apps.get_model("users", "User")
    User.objects.filter(role="employee").update(role="staff")


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(migrate_employee_to_staff, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[
                    ("admin", "Admin"),
                    ("staff", "Staff"),
                    ("salesperson", "Salesperson"),
                ],
                default="staff",
                max_length=20,
            ),
        ),
    ]
