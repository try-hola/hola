# Gitea bundle

A minimal [Gitea](https://about.gitea.com/) bundle — a good "first app" to deploy with Hola.

## Deploy

With the Hola stack running (see `packages/compose`) and `HOLA_TOKEN` set to your admin API key:

```bash
export HOLA_API_URL=https://app.<your-domain>   # or http://localhost:3001 against a local server
export HOLA_TOKEN=<admin-api-key>               # docker compose exec server cat /data/config/admin-api-key
hola bundle deploy --path examples/bundles/gitea --app-id gitea
```

The CLI imports the compose, validates and finalizes a draft, creates the deployment, and watches
the job until it reaches a terminal state. Gitea is then reached at `gitea.<HOLA_BASE_DOMAIN>`
through Traefik.

## Notes
- No host ports are published; ingress is via Traefik to container port `3000`. Set
  `GITEA__server__ROOT_URL` to your `gitea.<HOLA_BASE_DOMAIN>` URL.
- For Gitea Actions, add an `act_runner` service to this compose once Gitea is up.
- Routing a deployed app through Traefik on a real Docker host is exercised end-to-end by the
  integration test in issue #19.
