from rest_framework.throttling import SimpleRateThrottle


class ReadWriteThrottle(SimpleRateThrottle):
    scope = "read"

    def allow_request(self, request, view):
        self.scope = "read" if request.method in ["GET", "HEAD", "OPTIONS"] else "write"
        self.rate = self.get_rate()
        self.num_requests, self.duration = self.parse_rate(self.rate)
        return super().allow_request(request, view)

    def get_cache_key(self, request, view):
        if not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}
