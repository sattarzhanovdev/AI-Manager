from importlib import import_module
from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = "core"

    def ready(self):
        import_module("core.schema")
        import_module("core.signals")
