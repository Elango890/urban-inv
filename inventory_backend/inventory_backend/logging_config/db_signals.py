import logging

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver


logger = logging.getLogger("app.db")


def _model_label(instance):
    meta = instance._meta
    return f"{meta.app_label}.{meta.model_name}"


@receiver(post_save, dispatch_uid="app_db_post_save", weak=False)
def log_model_save(sender, instance, created, **kwargs):
    # Skip Django internal models to reduce noise
    if sender._meta.app_label in {"contenttypes", "sessions", "admin"}:
        return
    action = "created" if created else "updated"
    logger.debug("%s %s id=%s", _model_label(instance), action, instance.pk)


@receiver(post_delete, dispatch_uid="app_db_post_delete", weak=False)
def log_model_delete(sender, instance, **kwargs):
    if sender._meta.app_label in {"contenttypes", "sessions", "admin"}:
        return
    logger.debug("%s deleted id=%s", _model_label(instance), instance.pk)
