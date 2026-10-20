# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers running DeepSeek Harness (DSH) Web sessions against a local repository. They are mid-session with a coding agent, alternating between steering the agent in Chat and checking what it actually changed in the working tree, history and CI.

## Product Purpose

dsh-gitview puts Git inside DSH so the user never leaves the session to review, stage, commit or check CI. It ships two surfaces over one data channel (the Host's `api/git.*` routes):

- a narrow right-sidebar tab (existing, `sidebar.right.pane.tab`);
- a wide conversation view beside Chat and Trajectory (`conversation.view`). The user picks the placement in Settings: sidebar, conversation view, or both.

Success: reviewing an agent's changes and understanding the repository's state takes no context switch to a terminal or another app.

## Positioning

Git scoped to the active DSH session's workspace, sitting next to the agent conversation that produced the changes. Commit messages can be drafted by the session's selected model; Ask AI hands CI metadata to the chat draft without sending it.

## Operating Context

- Lives inside the DSH Web shell; theme (light/dark), font size and primitives belong to the shell.
- The conversation view is used both for reviewing the agent's changes (diff-led) and for surveying the repository (history graph, branches, CI). Both jobs carry equal weight.
- Intended to be upstreamed into DSH itself.

## Capabilities and Constraints

- Features (both surfaces): working-tree status, staging, commit, unified/split diffs with highlighting, commit graph, branches, blame, reflog, CI status (GitHub, GitLab, Gitea; GitHub Actions step details), AI commit message, Ask AI.
- The conversation view covers every feature, not a subset.
- Client is written in TypeScript under `src/client/` and built into `lib/client.js` (committed; the Host serves it verbatim). React via `require("react")`, `@deepseek-ai/dsh-client-ui-primitives`; no runtime dependencies.
- DSH 0.2.0-rc.2, Node 24+. Does not rerun or cancel CI. Never commits automatically. Tokens never reach the browser.
- Locales: en, ja.

## Brand Commitments

Must feel native to DSH: sitting beside Chat and Trajectory it should read as a first-party view, distinguished by precision in detail rather than its own visual identity. Uses the shell's `--dsw-*` tokens only.

## Product Principles

1. Native first: same tokens, primitives, density and motion as the shipped views.
2. The agent's change is the subject: what changed, why it matters, and what to do next stay in view.
3. Observe, don't surprise: no automatic commits, sends or CI actions.
4. One data channel, two surfaces: layouts differ, behavior and wording do not.
