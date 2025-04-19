FROM ghcr.io/goauthentik/server:2024.2.2

# Add your OIDC init script
COPY create_oidc_client.py /init/create_oidc_client.py

# Make sure it's readable by the container runtime
RUN chmod 644 /init/create_oidc_client.py