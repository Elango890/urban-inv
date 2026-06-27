from django.apps import AppConfig


class LoggingConfig(AppConfig):
    name = "inventory_backend.logging_config"
    verbose_name = "Logging Config"

    def ready(self):
        # Import signal handlers to enable DB logging
        from . import db_signals  # noqa: F401
