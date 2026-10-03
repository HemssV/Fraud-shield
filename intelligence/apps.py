from django.apps import AppConfig


class IntelligenceConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'intelligence'
    verbose_name = 'FraudShield — Intelligence & Operations'

    def ready(self):
        """Warm dashboard, cases, and fraud graph caches in background threads on startup."""
        import threading
        from intelligence.services.analytics_service import warm_dashboard_cache
        from intelligence.services.case_service import warm_cases_cache

        def _warm_all():
            warm_dashboard_cache()
            warm_cases_cache()

        t = threading.Thread(target=_warm_all, daemon=True)
        t.start()
