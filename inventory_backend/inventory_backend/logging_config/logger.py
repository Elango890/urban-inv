import logging


def get_logger(name: str) -> logging.Logger:
    """
    Small helper used across apps to get a namespaced logger that maps
    to the LOGGING config in settings.py.
    """
    return logging.getLogger(name)
