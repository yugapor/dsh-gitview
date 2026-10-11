/**
 * Integration test: the real host half against a real repository.
 *
 * `tools/host-git-test.mjs` drives the host operations against a scripted
 * `subprocess`, which pins the argv the plugin builds but cannot know whether
 * git accepts it. `tools/git-e2e-test.mjs` runs real git but only against the
 * pure parser. This file closes the gap: it supplies a real `subprocess` backed
 * by the actual git binary, so every command the host issues — the `%x1f`
 * formats, `--left-right --count`, `for-each-ref`, the mutating commands — is
 * executed by git itself and checked through the plugin's own return values.
 *
 * The repository is created in a temporary directory and removed afterwards.
 *
 * Run: node tools/git-integration-test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyMutation,
	generateCommitMessage,
	readBlame,
	readBranches,
	readDiff,
	readHistory,
	readIdentity,
	readReflog,
	readStatus,
	resolveGit
} from "../lib/index.js";

console.log("git-integration-test");

let passed = 0;
async function check(name, fn) {
	await fn();
	passed++;
	console.log(`  ok  ${name}`);
}

/**
 * The smallest `subprocess` service the host half needs, backed by real git.
 *
 * Only `resolveExecutable` and `spawn` are ever called, and `spawn`'s contract is
 * narrow: `done` resolves with an exit code and `collected.*.readFrom(0)` yields
 * the text. `spawnSync` satisfies both without a real pipe protocol.
 */
function realSubprocess() {
	return {
		async resolveExecutable(name) {
			const probe = spawnSync(name, ["--version"], { encoding: "utf8" });
			if (probe.error !== undefined && probe.error !== null) throw probe.error;
			if (probe.status !== 0) throw new Error(`${name} --version exited ${probe.status}`);
			return name;
		},
		spawn(spec) {
			const outcome = spawnSync(spec.argv[0], spec.argv.slice(1), {
				cwd: spec.cwd,
				env: { ...process.env, ...spec.env },
				encoding: "utf8",
				maxBuffer: spec.stdio.stdout.maxBytes
			});
			const stdout = outcome.stdout ?? "";
			const stderr = outcome.stderr ?? "";
			const exitCode = outcome.status ?? (outcome.error === undefined || outcome.error === null ? 0 : 127);
			return {
				done: Promise.resolve({ exitCode, signal: null }),
				collected: {
					stdout: { truncated: false, readFrom: () => ({ text: stdout, nextOffset: 0, lossy: false }) },
					stderr: { truncated: false, readFrom: () => ({ text: stderr, nextOffset: 0, lossy: false }) }
				}
			};
		}
	};
}

const subprocess = realSubprocess();
const executable = await resolveGit(subprocess);

if (executable === null) {
	console.log("  SKIP  git is not installed; the integration test needs a real git");
	console.log("\nPASS  0 checks");
	process.exit(0);
}

/** Create a throwaway repository and run git in it. */
function fixture() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "dsh-gitview-integration-")));
	const git = (...args) => {
		const outcome = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env } });
		assert.equal(outcome.status, 0, `git ${args.join(" ")} failed: ${outcome.stderr}`);
		return outcome.stdout;
	};
	const fails = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" }).status !== 0;
	const put = (name, text) => writeFileSync(join(dir, name), text);

	git("init", "-q", "-b", "main");
	git("config", "user.email", "fixture@example.test");
	git("config", "user.name", "Fixture");
	git("config", "core.hooksPath", join(dir, ".no-hooks"));
	return { dir, git, fails, put };
}

/** The dependencies every host operation takes. */
const deps = (dir) => ({ subprocess, executable, cwd: dir });

// ── readStatus ──────────────────────────────────────────────────────────────

const repo = fixture();
repo.put("a.txt", "base\n");
repo.put("b.txt", "keep\n");
repo.git("add", "-A");
repo.git("commit", "-qm", "base: add a and b");
// A remote-tracking ref, so the branch list has one to classify.
repo.git("update-ref", "refs/remotes/origin/main", "HEAD");

repo.git("checkout", "-q", "-b", "topic");
repo.put("t1.txt", "one\n");
repo.git("add", "t1.txt");
repo.git("commit", "-qm", "topic: add t1");
repo.put("t2.txt", "two\n");
repo.git("add", "t2.txt");
repo.git("commit", "-qm", "topic: add t2");
repo.git("branch", "--set-upstream-to=main", "topic");

// Now dirty the working tree in four different ways.
repo.put("a.txt", "base\nunstaged edit\n");
repo.put("staged.txt", "staged\n");
repo.git("add", "staged.txt");
repo.put("untracked.txt", "loose\n");
rmSync(join(repo.dir, "b.txt"));

try {
	await check("the status route reads a real dirty repository", async () => {
		const status = await readStatus(deps(repo.dir));

		assert.equal(status.kind, "ready");
		assert.equal(status.repoRoot, repo.dir);
		assert.equal(status.branch, "topic");
		assert.equal(status.detached, false);
		assert.equal(status.unborn, false);
		assert.equal(status.changed, 4, "modified, staged, untracked and deleted");
		assert.equal(status.truncated, false);

		// The base is named from the local branches, not from the upstream.
		assert.equal(status.base.name, "main");
		assert.equal(status.base.ahead, 2, "topic has two commits main does not");
		assert.equal(status.base.behind, 0);

		// No operation is in progress in an ordinary dirty tree.
		assert.equal(status.state.kind, null);
	});

	await check("each changed path is classified the way git reports it", async () => {
		const status = await readStatus(deps(repo.dir));
		/** Flatten the tree so a path can be looked up by name. */
		const byPath = new Map();
		const walk = (node, prefix) => {
			if (node.type === "file") byPath.set([...prefix, node.name].join("/"), node);
			for (const child of node.children ?? []) walk(child, [...prefix, node.name]);
		};
		// Start from the children: the root node is named after the repository
		// directory, which is not part of any repository-relative path.
		for (const child of status.tree.children) walk(child, []);

		const staged = byPath.get("staged.txt");
		assert.equal(staged.staged, true, "a newly staged file is on the index side");
		assert.equal(staged.unstaged, false);

		const modified = byPath.get("a.txt");
		assert.equal(modified.staged, false);
		assert.equal(modified.unstaged, true);
		assert.deepEqual(modified.changes.worktree, { added: 1, deleted: 0, binary: false });
		assert.deepEqual(staged.changes.index, { added: 1, deleted: 0, binary: false });

		assert.equal(byPath.get("untracked.txt").state, "untracked");
		assert.deepEqual(byPath.get("untracked.txt").changes, { index: null, worktree: null }, "untracked counts are unknown, not zero");

		const deleted = byPath.get("b.txt");
		assert.equal(deleted.unstaged, true, "a removed file is still a change");
	});

	// ── readHistory ─────────────────────────────────────────────────────────

	await check("the history route graphs a real repository", async () => {
		const history = await readHistory(deps(repo.dir));

		assert.equal(history.kind, "ready");
		assert.equal(history.base.name, "main");
		assert.equal(history.base.ahead, 2);
		assert.equal(history.empty, undefined);
		// base, t1, t2 — and `--all` must not double-count anything.
		assert.equal(history.total, 3);
		assert.equal(history.commits[0].subject, "topic: add t2");
		assert.equal(history.commits[1].subject, "topic: add t1");
		assert.equal(history.commits[2].subject, "base: add a and b");

		// Exactly the two commits main has not seen are marked ahead.
		assert.deepEqual([...history.commits.map((commit) => commit.ahead)], [true, true, false]);

		// A linear history is one lane wide the whole way down.
		assert.deepEqual([...history.commits.map((commit) => commit.column)], [0, 0, 0]);
		assert.deepEqual([...history.commits.map((commit) => commit.width)], [1, 1, 1]);

		// The decoration on the tip names the branch, and the base's names main.
		assert.deepEqual([...history.commits[0].refs], [{ kind: "head", name: "topic" }]);
		assert.ok(history.commits[2].refs.some((ref) => ref.name === "main"));
		assert.ok(history.commits[2].refs.some((ref) => ref.name === "origin/main"));

		// Every commit carries the fields the graph draws.
		for (const commit of history.commits) {
			assert.match(commit.sha, /^[0-9a-f]{40}$/);
			assert.match(commit.date, /^\d{4}-\d{2}-\d{2}T/);
			assert.equal(commit.author, "Fixture");
			assert.equal(typeof commit.column, "number");
			assert.ok(Array.isArray(commit.columns));
		}
	});

	// ── readBranches ────────────────────────────────────────────────────────

	await check("the branches route classifies real refs", async () => {
		const result = await readBranches(deps(repo.dir));

		assert.equal(result.kind, "ready");
		const byName = new Map(result.branches.map((branch) => [branch.name, branch]));
		assert.deepEqual([...byName.keys()].sort(), ["main", "origin/main", "topic"]);

		assert.equal(byName.get("topic").current, true);
		assert.equal(byName.get("topic").remote, false);
		assert.equal(byName.get("topic").upstream, "main");
		assert.equal(byName.get("topic").ahead, 2);
		assert.equal(byName.get("topic").behind, 0);
		assert.equal(byName.get("topic").gone, false);

		assert.equal(byName.get("main").current, false);
		assert.equal(byName.get("main").upstream, null);

		// The remote-tracking ref is told apart by its full refname.
		assert.equal(byName.get("origin/main").remote, true);
		assert.equal(byName.get("origin/main").current, false);

		// The current branch is listed first.
		assert.equal(result.branches[0].name, "topic");
		assert.equal(result.state.kind, null);
	});

	// ── readReflog ──────────────────────────────────────────────────────────

	await check("the reflog route reads real entries with their own times", async () => {
		const result = await readReflog(deps(repo.dir));

		assert.equal(result.kind, "ready");
		assert.ok(result.entries.length >= 4, `expected a few entries, got ${result.entries.length}`);
		assert.ok(
			result.entries.some((entry) => entry.action === "commit"),
			`expected a commit entry, got: ${result.entries.map((entry) => entry.action).join(" | ")}`
		);
		// Each entry carries its own timestamp, read out of the selector.
		for (const entry of result.entries) {
			assert.equal(entry.ref, "HEAD");
			assert.match(entry.date, /^\d{4}-\d{2}-\d{2}T/, `no entry time on ${entry.selector}`);
			assert.equal(typeof entry.short, "string");
			assert.ok(entry.selector.startsWith("HEAD@{"));
		}
		assert.ok(result.entries[0].subject.length > 0);
	});

	// ── readDiff across every scope ─────────────────────────────────────────

	await check("the diff route renders real patches for every scope", async () => {
		const head = await readDiff({ ...deps(repo.dir), path: "a.txt" });
		assert.equal(head.kind, "ready");
		assert.equal(head.scope, "head");
		assert.match(head.text, /^diff --git/);
		assert.match(head.text, /\+unstaged edit/);
		assert.equal(head.binary, false);

		// Only the unstaged side, so the same edit appears without the baseline.
		const worktree = await readDiff({ ...deps(repo.dir), path: "a.txt", scope: "worktree" });
		assert.match(worktree.text, /\+unstaged edit/);

		// The staged side alone: staged.txt is on the index but not in HEAD.
		const index = await readDiff({ ...deps(repo.dir), path: "staged.txt", scope: "index" });
		assert.match(index.text, /^diff --git/);
		assert.match(index.text, /\+staged/);
		// ... and it is absent from HEAD, so the head-scope diff shows it too.
		const added = await readDiff({ ...deps(repo.dir), path: "staged.txt" });
		assert.match(added.text, /\+staged/);

		// One commit's own patch, with `--format=` stripping the commit header.
		const commit = await readDiff({ ...deps(repo.dir), path: "t2.txt", scope: "commit", rev: "HEAD" });
		assert.equal(commit.scope, "commit");
		assert.match(commit.text, /\+two/);
		assert.ok(!/^commit /m.test(commit.text), "the commit header must not leak into the patch");

		// The whole commit, pathless: every file in the commit in one patch.
		const whole = await readDiff({ ...deps(repo.dir), path: "", scope: "commit", rev: "HEAD" });
		assert.equal(whole.kind, "ready");
		assert.equal(whole.path, "");
		assert.match(whole.text, /\+two/, "the tip's own file is in its patch");

		// An untracked file has no HEAD side and falls back to --no-index.
		const loose = await readDiff({ ...deps(repo.dir), path: "untracked.txt" });
		assert.match(loose.text, /\+loose/);

		// A deletion renders as a removal, one removed line in the patch body.
		const removed = await readDiff({ ...deps(repo.dir), path: "b.txt" });
		assert.match(removed.text, /^-keep$/m);
	});

	// ── applyMutation ───────────────────────────────────────────────────────

	await check("the blame route reads a real file and marks the uncommitted line", async () => {
		// `a.txt` holds one committed line and one worktree edit, which is the case
		// worth checking against real git: the edit is blamed on an all-zero sha.
		const result = await readBlame({ ...deps(repo.dir), path: "a.txt" });
		assert.equal(result.kind, "ready");
		assert.equal(result.rev, "HEAD", "the default revision is named, not left blank");
		assert.deepEqual([...result.lines.map((line) => line.text)], ["base", "unstaged edit"]);
		assert.equal(result.lines[0].author, "Fixture");
		assert.equal(result.lines[0].summary, "base: add a and b", "the subject comes from --line-porcelain");
		assert.equal(result.lines[0].uncommitted, false);
		assert.equal(result.lines[1].uncommitted, true, "a line git has not committed gets the all-zero sha");
		assert.equal(result.lines[1].author, "Not Committed Yet");
		// Two distinct shas, so the header's count is not just the line count.
		assert.equal(result.commits, 2);
		assert.equal(result.truncated, false);
	});

	await check("the blame route reports git's own words for a path it cannot blame", async () => {
		const untracked = await readBlame({ ...deps(repo.dir), path: "untracked.txt" });
		assert.equal(untracked.kind, "failed");
		assert.match(untracked.message, /no such path/, "git's first line is the message");
	});

	await check("stage and unstage really move a change between the two sides", async () => {
		const staged = await applyMutation({ ...deps(repo.dir), action: "stage", paths: ["a.txt"] });
		assert.equal(staged.kind, "ready");
		assert.equal(staged.action, "stage");
		assert.equal(staged.status.kind, "ready", "the mutation hands back the new status");
		// The refreshed status must already show the file as staged.
		const stagedEntry = staged.status.tree.children.find((node) => node.name === "a.txt");
		assert.equal(stagedEntry.staged, true, "a.txt is on the index side after staging");
		assert.equal(stagedEntry.unstaged, false);

		const unstaged = await applyMutation({ ...deps(repo.dir), action: "unstage", paths: ["a.txt"] });
		assert.equal(unstaged.kind, "ready");
		const unstagedEntry = unstaged.status.tree.children.find((node) => node.name === "a.txt");
		assert.equal(unstagedEntry.staged, false, "and back on the worktree side after unstaging");
		assert.equal(unstagedEntry.unstaged, true);

		// The working tree itself was never touched by either direction.
		const onDisk = await readDiff({ ...deps(repo.dir), path: "a.txt", scope: "worktree" });
		assert.match(onDisk.text, /\+unstaged edit/);
	});

	await check("stage-all takes every change, and unstage-all gives them back", async () => {
		const all = await applyMutation({ ...deps(repo.dir), action: "stage-all" });
		assert.equal(all.kind, "ready");
		assert.equal(all.status.tree.counts.untracked ?? 0, 0, "nothing is left untracked after stage-all");
		assert.ok((all.status.tree.counts.added ?? 0) >= 2, "the new files are staged as additions");

		const none = await applyMutation({ ...deps(repo.dir), action: "unstage-all" });
		assert.equal(none.kind, "ready");
		assert.ok((none.status.tree.counts.untracked ?? 0) >= 1, "the untracked file is loose again");
	});

	await check("commit records the index, and refuses when there is nothing to record", async () => {
		const before = await readHistory(deps(repo.dir));
		await applyMutation({ ...deps(repo.dir), action: "stage-all" });

		const committed = await applyMutation({ ...deps(repo.dir), action: "commit", message: "integration: commit everything" });
		assert.equal(committed.kind, "ready");
		assert.equal(committed.action, "commit");

		const after = await readHistory(deps(repo.dir));
		assert.equal(after.total, before.total + 1, "the commit landed on the branch");
		assert.equal(after.commits[0].subject, "integration: commit everything");
		assert.equal(after.base.ahead, before.base.ahead + 1, "and counts as ahead of main");

		// The tree is clean now, so a second commit has nothing to record. That is
		// git's own failure and must surface as such, not as a silent success.
		const empty = await applyMutation({ ...deps(repo.dir), action: "commit", message: "nothing here" });
		assert.equal(empty.kind, "failed");
		assert.equal(empty.action, "commit");
		assert.notEqual(empty.exitCode, 0);
		assert.match(empty.message, /nothing to commit|no changes added/i);
		assert.equal(empty.status, undefined);
	});

	await check("a mutation never reaches git when the request is refused", async () => {
		const refused = await applyMutation({ ...deps(repo.dir), action: "reset --hard" });
		assert.equal(refused.kind, "rejected");
		assert.equal(refused.code, "unknown-action");

		const escaped = await applyMutation({ ...deps(repo.dir), action: "stage", paths: ["../../etc/passwd"] });
		assert.equal(escaped.code, "no-paths");

		// The repository is untouched: the history is still the one committed above.
		const history = await readHistory(deps(repo.dir));
		assert.equal(history.commits[0].subject, "integration: commit everything");
	});
} finally {
	rmSync(repo.dir, { recursive: true, force: true });
}

// ── an in-progress rebase, read through the status route ────────────────────

const rebaseRepo = fixture();
try {
	rebaseRepo.put("a.txt", "base\n");
	rebaseRepo.git("add", "-A");
	rebaseRepo.git("commit", "-qm", "base");
	rebaseRepo.git("checkout", "-q", "-b", "rbtopic");
	rebaseRepo.put("a.txt", "rebase side\n");
	rebaseRepo.git("commit", "-qam", "rebase side");
	rebaseRepo.git("checkout", "-q", "main");
	rebaseRepo.put("a.txt", "main side\n");
	rebaseRepo.git("commit", "-qam", "main side");
	rebaseRepo.git("checkout", "-q", "rbtopic");

	await check("the status route reports a real rebase in progress", async () => {
		assert.ok(rebaseRepo.fails("rebase", "main"), "the rebase must stop on a conflict");

		const status = await readStatus(deps(rebaseRepo.dir));
		assert.equal(status.kind, "ready");
		assert.equal(status.state.kind, "rebase");
		assert.equal(status.state.branch, "rbtopic");
		assert.ok(status.state.onto !== null, "the rebase target is named");
		assert.ok(status.state.step !== null && status.state.step <= status.state.total);
		// The conflict also shows up as a conflicted path in the tree.
		assert.ok((status.tree.counts.conflicted ?? 0) >= 1, "the unmerged path is in the tree");

		// A rebase must be visible from the branch list too, not just the tree.
		const branches = await readBranches(deps(rebaseRepo.dir));
		assert.equal(branches.state.kind, "rebase");

		// The reflog is what makes it traceable: git recorded the start.
		const reflog = await readReflog(deps(rebaseRepo.dir));
		assert.ok(
			reflog.entries.some((entry) => entry.action.startsWith("rebase")),
			`expected a rebase entry, got: ${reflog.entries.map((entry) => entry.action).join(" | ")}`
		);

		rebaseRepo.git("rebase", "--abort");
		const after = await readStatus(deps(rebaseRepo.dir));
		assert.equal(after.state.kind, null, "aborting clears the state");
	});
} finally {
	rmSync(rebaseRepo.dir, { recursive: true, force: true });
}

await check("real numstat handles mixed index sides, renames, binary and an unborn HEAD", async () => {
	const statsRepo = fixture();
	try {
		statsRepo.put("fresh.txt", "fresh\n");
		statsRepo.git("add", "fresh.txt");
		const unborn = await readStatus(deps(statsRepo.dir));
		assert.deepEqual(unborn.tree.children[0].changes.index, { added: 1, deleted: 0, binary: false });
		statsRepo.put("both.txt", "one\nsame\n");
		statsRepo.put("old.txt", "rename me\n");
		statsRepo.put("image.bin", "\0before");
		statsRepo.git("add", "-A");
		statsRepo.git("commit", "-qm", "stats base");
		statsRepo.put("both.txt", "staged\nsame\nadded\n");
		statsRepo.git("add", "both.txt");
		statsRepo.put("both.txt", "staged\nchanged\nadded\nmore\n");
		const renamed = "日本語\tnew\n.txt";
		statsRepo.git("mv", "old.txt", renamed);
		statsRepo.put("image.bin", "\0after");
		const result = await readStatus(deps(statsRepo.dir));
		const byPath = new Map(result.tree.children.map((node) => [node.path, node]));
		assert.deepEqual(byPath.get("both.txt").changes.index, { added: 2, deleted: 1, binary: false });
		assert.deepEqual(byPath.get("both.txt").changes.worktree, { added: 2, deleted: 1, binary: false });
		assert.deepEqual(byPath.get(renamed).changes.index, { added: 0, deleted: 0, binary: false });
		assert.deepEqual(byPath.get("image.bin").changes.worktree, { added: null, deleted: null, binary: true });
	} finally {
		rmSync(statsRepo.dir, { recursive: true, force: true });
	}
});

await check("generation reads the real index, including unborn HEAD, without modifying it", async () => {
	const messageRepo = fixture();
	try {
		messageRepo.put("subject.txt", "staged content\n");
		messageRepo.git("add", "subject.txt");
		messageRepo.put("subject.txt", "private unstaged content\n");
		const beforeIndex = messageRepo.git("write-tree");
		const beforeStatus = messageRepo.git("status", "--porcelain=v1");
		const result = await generateCommitMessage({
			...deps(messageRepo.dir), sessionId: "fixture", language: "en",
			modelFor: async () => ({ provider: "fixture", model: "fake" }),
			llm: { async *stream(options) {
				const patch = options.messages[0].content[0].text;
				assert.match(patch, /staged content/);
				assert.equal(patch.includes("private unstaged content"), false);
				yield { type: "text-delta", index: 0, text: "Add subject file" };
				yield { type: "finish", reason: { kind: "stop" } };
			} }
		});
		assert.equal(result.message, "Add subject file");
		assert.equal(messageRepo.git("write-tree"), beforeIndex);
		assert.equal(messageRepo.git("status", "--porcelain=v1"), beforeStatus);
	} finally {
		rmSync(messageRepo.dir, { recursive: true, force: true });
	}
});

await check("identity reports local settings and author/committer overrides exactly as real Git does", async () => {
	const identityRepo = fixture();
	try {
		let result = await readIdentity(deps(identityRepo.dir), identityRepo.dir);
		assert.equal(result.config.name.value, "Fixture"); assert.equal(result.config.email.scope, "local");
		assert.equal(result.config.email.origin, "file:.git/config");
		assert.equal(result.author.name, "Fixture"); assert.equal(result.committer.email, "fixture@example.test");
		identityRepo.git("config", "author.name", "Different Author");
		identityRepo.git("config", "author.email", "author@example.test");
		result = await readIdentity(deps(identityRepo.dir), identityRepo.dir);
		assert.equal(result.config.name.value, "Fixture"); assert.equal(result.author.name, "Different Author");
		assert.equal(result.author.email, "author@example.test"); assert.equal(result.committer.name, "Fixture");
		assert.equal(identityRepo.git("status", "--porcelain=v1"), "");
	} finally { rmSync(identityRepo.dir, { recursive: true, force: true }); }
});
await check("identity honors included configuration without writing back to it", async () => {
	const identityRepo = fixture();
	try {
		identityRepo.put(".git/identity.cfg", "[user]\n name = Included Name\n email = included@example.test\n");
		identityRepo.git("config", "include.path", "identity.cfg");
		const result = await readIdentity(deps(identityRepo.dir), identityRepo.dir);
		assert.equal(result.config.name.value, "Included Name"); assert.equal(result.config.name.scope, "local");
		assert.match(result.config.email.origin, /identity\.cfg$/); assert.equal(result.author.email, "included@example.test");
	} finally { rmSync(identityRepo.dir, { recursive: true, force: true }); }
});
console.log(`\nPASS  ${passed} checks`);
