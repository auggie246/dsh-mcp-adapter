# Agent guide

This repository builds a DSH plugin that connects the DSH agent to MCP Servers. The Host code is plain ESM in `src/host/`; the client code is JSX in `src/client/` and builds to `lib/client.js`.

## Before work

- Before exploring domain behavior or naming concepts, read `CONTEXT.md` and then the ADRs that touch the area. Follow `docs/agents/domain.md`.
- When a task names a GitHub issue, or changes issue state, use `gh` and follow `docs/agents/issue-tracker.md`.
- When triaging an issue, map each role to the repository label in `docs/agents/triage-labels.md`.
- For development, release, or verification work, follow the matching README section: [Local development](README.md#local-development), [Release](README.md#release), or [Contributing](README.md#contributing).

## Change workflow

1. Read the relevant source, tests, README sections, and ADRs before editing.
2. Change the smallest complete surface. Add or update a focused test for behavior changes.
3. Run `pnpm test` for code changes. Run `pnpm build` when client, package, or release files change.
4. Update `CONTEXT.md` when project vocabulary changes. Add or update an ADR when a design decision changes.
5. Before completion, confirm tests pass, required build artifacts exist, documentation matches behavior, and `git diff --check` passes.

Use one root `AGENTS.md`. Add a nested guide only when a subfolder has a separate workflow or constraints that do not apply to the rest of the repository.
