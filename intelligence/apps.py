from django.apps import AppConfig


class IntelligenceConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'intelligence'
    verbose_name = 'FraudShield — Intelligence & Operations'

    def ready(self):
        """Warm the dashboard cache in a background thread on startup."""
        import threading
        from intelligence.services.analytics_service import warm_dashboard_cache
        t = threading.Thread(target=warm_dashboard_cache, daemon=True)
        t.start()
