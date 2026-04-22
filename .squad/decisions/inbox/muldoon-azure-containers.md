# Decision: Azure Container Apps Deployment Architecture

**Date:** 2025-07-25
**Author:** Muldoon (Backend Dev)
**Status:** Implemented

## Context
APEX needs a cloud deployment pipeline. The monorepo (client/server/shared) must be containerized and deployed to Azure.

## Decision
- **Two-container architecture** on Azure Container Apps: `apex-client` (Nginx + React build, external ingress) and `apex-api` (Node.js, internal ingress only).
- **Nginx reverse proxy** on the client container forwards `/api/*` to the API container's internal FQDN — no CORS needed, single public endpoint.
- **SQLite persistence** uses an EmptyDir volume at `/data/apex.db`. This is ephemeral — data survives container restarts but not re-provisioning. For production durability, migrate to Azure File Share or Azure SQL.
- **Managed identity** for ACR pull — no admin credentials stored anywhere.
- **OIDC** for GitHub Actions → Azure authentication (federated credentials, no secrets rotation needed).
- **Single-replica API** (`maxReplicas: 1`) because SQLite doesn't support concurrent writers. Client scales to 3 replicas.
- **Health probes** on both containers: API uses `/api/status`, client uses `/`.

## Alternatives Considered
- Azure App Service: Simpler but less control over multi-container networking.
- Azure Kubernetes Service: Overkill for two containers.
- Postgres instead of SQLite: Better for production but adds complexity and cost. Deferred.

## Impact
- CI/CD deploys on every push to `main` via GitHub Actions.
- Six GitHub secrets required: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RG`, `FINNHUB_API_KEY`, `OPENAI_API_KEY`.
- Bicep infra is idempotent — safe to re-run.
