from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from core import api

router = DefaultRouter()
for name, (model, access, readonly) in api.RESOURCES.items():
    router.register(name, api.make_viewset(model, access, readonly), basename=name)
urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/provider-events/", api.ProviderEventView.as_view()),
    path("api/v1/auth/login/", api.LoginView.as_view()),
    path("api/v1/auth/accept-invite/", api.AcceptInvitationView.as_view()),
    path("api/v1/auth/session/", api.SessionView.as_view()),
    path("api/v1/auth/sessions/", api.SessionsView.as_view()),
    path("api/v1/read/<str:name>/", api.ReadView.as_view()),
    path("api/v1/commands/<str:name>/", api.CommandView.as_view()),
    path("api/v1/events/", api.EventsView.as_view()),
    path("api/v1/export/", api.ExportView.as_view()),
    path("api/v1/", include(router.urls)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("health/", api.HealthView.as_view()),
]
