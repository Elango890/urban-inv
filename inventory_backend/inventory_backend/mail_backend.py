import logging
import ssl
from functools import cached_property

import certifi
from django.conf import settings
from django.core.mail.backends.smtp import EmailBackend as DjangoSMTPEmailBackend


logger = logging.getLogger(__name__)


class EmailBackend(DjangoSMTPEmailBackend):
    """
    SMTP backend that explicitly uses certifi for TLS verification.

    In local DEBUG environments, if certificate verification still fails,
    we optionally retry once with verification disabled so desktop/dev builds
    are not blocked by macOS/Python trust-store issues.
    """

    @cached_property
    def ssl_context(self):
        return ssl.create_default_context(cafile=certifi.where())

    def open(self):
        try:
            return super().open()
        except ssl.SSLCertVerificationError:
            allow_insecure = bool(
                getattr(settings, "EMAIL_ALLOW_INSECURE_FALLBACK", False)
            )
            if not allow_insecure:
                raise

            logger.warning(
                "Email TLS certificate verification failed. "
                "Retrying with insecure TLS fallback because "
                "EMAIL_ALLOW_INSECURE_FALLBACK is enabled."
            )

            insecure_context = ssl._create_unverified_context()
            original_context = self.__dict__.get("ssl_context")
            self.__dict__["ssl_context"] = insecure_context
            try:
                return super().open()
            finally:
                if original_context is not None:
                    self.__dict__["ssl_context"] = original_context
