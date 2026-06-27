import logging
import time


class APILoggingMiddleware:
    """
    Logs every request/response to app.request and errors to app.error.
    Uses existing LOGGING config handlers (app_file, error_file, console).
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.req_logger = logging.getLogger("app.request")
        self.err_logger = logging.getLogger("app.error")

    def __call__(self, request):
        start = time.time()
        try:
            response = self.get_response(request)
        except Exception:
            duration_ms = int((time.time() - start) * 1000)
            self.err_logger.exception(
                "Unhandled exception | %s %s | %sms | user=%s | ip=%s",
                request.method,
                request.get_full_path(),
                duration_ms,
                getattr(getattr(request, "user", None), "id", None),
                self._client_ip(request),
            )
            raise

        duration_ms = int((time.time() - start) * 1000)
        self.req_logger.info(
            "%s %s | %s | %sms | user=%s | ip=%s",
            request.method,
            request.get_full_path(),
            response.status_code,
            duration_ms,
            getattr(getattr(request, "user", None), "id", None),
            self._client_ip(request),
        )
        return response

    @staticmethod
    def _client_ip(request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")
