# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture & design | Grant | System design, API contracts, component structure, tech decisions |
| React UI & dashboards | Ellie | Portfolio views, charts, reports, visualizations, components |
| Node.js APIs & services | Muldoon | REST endpoints, trading engine, data pipelines, scheduling, Azure config |
| Market data & signals | Malcolm | Data fetching, sentiment analysis, trend detection, ML/learning logic |
| Code review | Grant | Review PRs, check quality, suggest improvements |
| Testing | Wu | Write tests, find edge cases, verify trading logic, validate signals |
| Scope & priorities | Grant | What to build next, trade-offs, decisions |
| Session logging | Scribe | Automatic — never needs routing |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
8. **GitHub-first workflow** — every code change MUST be committed, pushed, and PR'd. Agents include git add/commit/push in their work. Use GitHub MCP tools or `gh` CLI for PRs. Never leave uncommitted work.
