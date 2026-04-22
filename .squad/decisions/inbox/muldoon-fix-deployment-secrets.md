# Decision: Align Deployment Secrets with Azure OpenAI Configuration

**Author:** Muldoon (Backend Dev)
**Date:** 2025-07-26
**Status:** Implemented

## Context
The project uses Azure OpenAI (not plain OpenAI). The `.env` file has `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_VERSION`. However, the deployment pipeline and Bicep infra only passed `OPENAI_API_KEY`, which would fail at runtime. Additionally, `ALPHA_VANTAGE_MCP_API_KEY` was missing from deployment entirely, and health probes pointed to a non-existent `/api/status` path.

## Decision
1. Replace `OPENAI_API_KEY` with the full Azure OpenAI config (key, endpoint, deployment, API version) across the CI/CD workflow, main Bicep template, and container app module.
2. Add `ALPHA_VANTAGE_MCP_API_KEY` to the deployment pipeline.
3. Treat API keys and endpoint URL as Container Apps secrets (via `@secure()` Bicep params and `secretRef`). Deployment name and API version are non-sensitive config passed as plain env vars.
4. Fix health probe paths to `/api/health` to match the actual Express route.

## Required GitHub Secrets
The following secrets must be configured in the repo's GitHub Actions settings:
- `FINNHUB_API_KEY`
- `ALPHA_VANTAGE_MCP_API_KEY`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION`

## Impact
- All team members: no code changes needed, only GitHub repo secrets must be set before deploying.
- Ellie: no frontend impact.
- Malcolm: signal services that call Azure OpenAI will now receive correct credentials in production.
