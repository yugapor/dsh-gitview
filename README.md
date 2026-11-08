# dsh-gitview

A Git panel for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web sidebar.

- Working-tree changes, staging and commits
- Unified or side-by-side diffs with syntax highlighting
- Commit graph, branches, blame and reflog
- CI status for GitHub, GitLab and Gitea; step details for GitHub Actions
- Optional commit-message generation using the session's selected model
- A wide **Git** tab beside Chat and Trajectory, with a Review mode (stage, commit, side-by-side diff) and a Repository mode (history, branches, CI)
- Worktrees: follows the session into the worktree its agent works in, lists every checkout of the repository, and switches, creates, locks, removes or prunes them

## Install

Requires Node.js **24+**, Git, pnpm, and one of the DSH versions listed under `engines.dsh` in `package.json` (each one is install-tested in CI). Other DSH versions are not tested; [rdsh](https://github.com/jimoto-no-llm/rustdsh) installs this plugin by default and moves DSH along its `rc` channel, so new tags are checked weekly against that list. Desktop is not tested.

```sh
dsh plugin --profile web add dsh-gitview
```

Restart DSH with your existing options and port, then open **Git** in the right sidebar or as a tab beside Chat and Trajectory. Do not enable an older manually installed Git panel alongside this package.

To remove:

```sh
dsh plugin --profile web remove dsh-gitview
```

## Placement

Settings → General → **Git view placement** chooses the right sidebar, the conversation tab, or both (default). The choice is stored per browser, not per user or session.

## Worktrees

Git runs in the session's **effective** working directory: when the agent enters a worktree (DSH's `create_worktree` tool, or `working_directory`), the view follows it, and the header marks a linked worktree. On DSH 0.2.0 that directory is the session's original one.

Repository mode and the sidebar's Branches view list every checkout: where this session works, the project directory, checkouts an agent created under `.agents/worktrees`, and locked or missing ones, with their changed files. A branch held by another checkout is tagged. From the list:

- **Switch here** moves this session's working directory to that checkout, as the agent's own tools do; the agent is told. It needs a running session.
- **New** creates a branch in a new checkout and switches to it through DSH's worktree service, which the **Change requests & worktrees** plugin provides. Uncommitted changes are not copied; from inside a linked worktree, DSH nests the new checkout in it.
- **Lock**, **Unlock**, **Remove** and **Prune** run the matching `git worktree` command. Remove and Prune ask first. Nothing is forced: Git refuses to remove a checkout with changes, the main checkout and the session's own cannot be removed, and branches are kept.

## CI and AI

GitHub uses the host's `gh` authentication. GitLab and Gitea use `GITLAB_TOKEN` and `GITEA_TOKEN`; without credentials, public CI is attempted. Self-hosted services require an explicit provider and token-environment-variable mapping in the plugin configuration.

CI is polled while the panel is visible and focused. Checks left pending for over 24 hours are marked as overdue, not successful. This plugin does not rerun or cancel CI.

Commit-message generation sends **staged changes** to the selected model provider and may incur charges. It does not commit automatically. **Ask AI** adds CI metadata to your chat draft without sending it; logs are not attached. Authentication tokens are not returned to the browser.

## Development

The browser half is written in `src/client/` and built into `lib/client.js`, which is committed because the Host serves it verbatim:

```sh
npm ci
npm run build   # src/client → lib/client.js
npm run check   # types, a stale-build check, syntax
npm test
```

Tests need `js-yaml@4.3.2` available through `NODE_PATH`. Package verification also needs pnpm and a DSH listed in `engines.dsh` (`DSH_BIN` selects the binary):

```sh
npm run test:package
```

This builds a `.tgz`, checks its contents, and tests standard installation, configuration composition and removal in a temporary DSH profile. It does not start a server or call a model. The verified package is saved in `dist/`. GitHub Actions runs these checks once per listed DSH version and retains the package artifacts for 14 days. After a push to `main` passes every listed version, CI publishes the `package.json` version to npm through trusted publishing and creates its `v<version>` release, unless npm already has that version.

To see whether npm has published a DSH version the list does not cover yet:

```sh
npm run test:track
```

The same check runs weekly in GitHub Actions. To add a version: install it, run `DSH_BIN=<path> npm run test:package`, then add the version to `engines.dsh` and both `peerDependencies` in `package.json`.

## License

[MIT](LICENSE)
