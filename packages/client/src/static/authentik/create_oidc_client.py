from authentik.providers.oauth2.models import OAuth2Provider, Application
from django.utils.timezone import now, timedelta

# Only run if the app doesn't already exist
if not Application.objects.filter(name="Hola CLI").exists():
    # Create or get the provider
    provider, _ = OAuth2Provider.objects.get_or_create(
        name="Hola OIDC Provider",
        authorization_flow="default-provider-authorization-flow",  # replace with your actual flow slug
        client_authentication="none",
        redirect_uris="http://localhost:8888/callback",
    )

    # Create the application
    app = Application.objects.create(
        name="Hola CLI",
        client_type="public",
        provider=provider,
        redirect_uris="http://localhost:8888/callback",
        access_token_validity=timedelta(days=30),
        refresh_token_validity=timedelta(days=90),
    )

    print("Created OIDC app! Client ID:", app.client_id)
else:
    print("Hola CLI OIDC app already exists. Skipping.")