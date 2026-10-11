/**
 * End-to-end test of the git layer against real git.
 *
 * Every other test feeds `lib/git.js` canned porcelain, which proves the
 * parsing logic but not that the porcelain FORMAT is what the code assumes. This
 * one builds a throwaway repository with real git, runs the exact command the
 * host half runs, and checks the tree that comes out. It is the only test that
 * can catch a wrong flag, a renamed-vs-copied mix-up, or quoting surprises.
 *
 * It uses `node:child_process` rather than DSH's `subprocess` service on purpose:
 * the point is to validate the parser against the real tool, independently of
 * the service wrapper.
 *
 * Run: node tools/git-e2e-test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BRANCH_FORMAT,
	LOG_FORMAT,
	REFLOG_FORMAT,
	assignLanes,
	parseBranches,
	parseLog,
	parseReflog,
	parseRepoState,
	summarize
} from "../lib/git.js";

console.log("git-e2e-test");

// git may be absent; skip loudly rather than fail the suite.
try {
	execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
	console.log("  skip  git is not available on this host");
	process.exit(0);
}

const repo = mkdtempSync(join(tmpdir(), "dsh-gitview-e2e-"));
/** Run git in the fixture repository. */
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

/** Run git expecting it to fail (a conflict stops merge/rebase with non-zero). */
const gitFails = (...args) => {
	try {
		execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
		return false;
	} catch {
		return true;
	}
};

let passed = 0;
function check(name, fn) {
	fn();
	passed++;
	console.log(`  ok  ${name}`);
}

function write(relative, contents) {
	const target = join(repo, relative);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, contents);
}

try {
	git("init", "-b", "main");
	// The fixture must not depend on the host's git identity.
	git("config", "user.email", "fixture@example.test");
	git("config", "user.name", "Fixture");
	// Keep the test hermetic: no host hooks or global attributes.
	git("config", "core.hooksPath", join(repo, ".no-hooks"));

	// A baseline commit, so index-vs-worktree states are all reachable.
	write("tracked.txt", "one\n");
	write("deep/nested/file.txt", "deep\n");
	write("old-name.txt", "rename me\n");
	write("日本語/メモ.md", "keep the path verbatim\n");
	git("add", "-A");
	git("commit", "-m", "baseline");

	// Every state this plugin paints, at once.
	write("tracked.txt", "one changed\n"); //  M  modified in the worktree
	write("staged.txt", "new\n");
	git("add", "staged.txt"); // A   added to the index
	write("deep/nested/file.txt", "deep changed\n"); //  M  nested modification
	write("untracked.txt", "loose\n"); // ??  untracked
	write("深い/dir/loose.txt", "loose deep\n"); // ??  untracked, nested
	write("日本語/メモ.md", "changed too\n"); //  M  non-ASCII path, worktree
	git("mv", "old-name.txt", "new-name.txt"); // R   staged rename

	const repoRoot = git("rev-parse", "--show-toplevel").trim();
	const raw = execFileSync(
		"git",
		["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"],
		{ cwd: repo, encoding: "utf8" }
	);
	const summary = summarize(raw, { repoRoot });

	check("the fixture repository is recognized", () => {
		assert.equal(summary.repoRoot, repoRoot);
		assert.equal(summary.branch, "main");
		assert.equal(summary.detached, false);
		assert.equal(summary.truncated, false);
	});

	check("every changed path is found, rename included", () => {
		// tracked.txt, staged.txt, deep/nested/file.txt, untracked.txt,
		// 深い/dir/loose.txt, 日本語/メモ.md, and the rename: seven, one per top-level entry.
		assert.equal(summary.changed, 7, `paths: ${[...summary.tree.children.map((n) => n.name)].join(", ")}`);
		assert.equal(summary.tree.children.length, 7);
	});

	check("states are classified the way git reports them", () => {
		const byPath = new Map();
		const walk = (node) => {
			for (const child of node.children ?? []) {
				if (child.type === "file") byPath.set(child.path, child);
				else walk(child);
			}
		};
		walk(summary.tree);

		assert.equal(byPath.get("tracked.txt").state, "modified");
		assert.equal(byPath.get("tracked.txt").unstaged, true);
		assert.equal(byPath.get("tracked.txt").staged, false);
		assert.equal(byPath.get("staged.txt").state, "added");
		assert.equal(byPath.get("staged.txt").staged, true);
		assert.equal(byPath.get("untracked.txt").state, "untracked");
		assert.equal(byPath.get("deep/nested/file.txt").state, "modified");

		// A rename keeps its source path, which is what the row shows as "← old".
		const renamed = byPath.get("new-name.txt");
		assert.equal(renamed.state, "renamed");
		assert.equal(renamed.origPath, "old-name.txt");
	});

	check("non-ASCII paths arrive verbatim, not C-quoted", () => {
		const names = [];
		const walk = (node) => {
			for (const child of node.children ?? []) {
				names.push(child.path);
				if (child.type === "dir") walk(child);
			}
		};
		walk(summary.tree);
		assert.ok(names.includes("日本語/メモ.md"), `paths: ${names.join(", ")}`);
		assert.ok(!names.some((name) => name.includes("\\3") || name.startsWith('"')), "a path was C-quoted");
	});

	check("--untracked-files=all lists the file, not its directory", () => {
		const deep = summary.tree.children.find((node) => node.name === "深い");
		assert.equal(deep.type, "dir");
		assert.equal(deep.children[0].name, "dir");
		assert.equal(deep.children[0].children[0].path, "深い/dir/loose.txt");
		assert.equal(deep.children[0].children[0].state, "untracked");
	});

	check("the root node is named after the repository directory", () => {
		assert.equal(summary.tree.name, repoRoot.split("/").pop());
	});

	check("counts roll up to the root", () => {
		assert.equal(summary.tree.total, 7);
		assert.equal(summary.tree.counts.untracked, 2);
		assert.equal(summary.tree.counts.modified, 3);
		assert.equal(summary.tree.counts.added, 1);
		assert.equal(summary.tree.counts.renamed, 1);
	});

	check("the -z parse agrees with the line-oriented parse on entry count", () => {
		// Independent cross-check: the plain porcelain output is a different
		// serialization, so agreement on the entry count validates the -z reader
		// (whose rename handling is the part most likely to be wrong).
		const lines = execFileSync(
			"git",
			["status", "--porcelain=v1", "--branch", "--untracked-files=all"],
			{ cwd: repo, encoding: "utf8" }
		)
			.split("\n")
			.filter((line) => line !== "" && !line.startsWith("##"));
		assert.equal(lines.length, summary.changed);
	});

	check("a clean tree reports nothing changed", () => {
		git("add", "-A");
		git("commit", "-m", "settle");
		const clean = summarize(
			execFileSync("git", ["status", "--porcelain=v1", "-z", "--branch"], { cwd: repo, encoding: "utf8" }),
			{ repoRoot }
		);
		assert.equal(clean.changed, 0);
		assert.equal(clean.tree.total, 0);
	});
} finally {
	rmSync(repo, { recursive: true, force: true });
}

// ── history, branches, reflog, in-progress operations ───────────────────────
//
// The parsers above were written against documentation and then corrected
// against reality; these checks are what keep that correction pinned. They run
// the exact formats `lib/git.js` exports, so a format string that git stops
// honouring fails here rather than silently emptying the sidebar.

const historyRepo = mkdtempSync(join(tmpdir(), "dsh-gitview-history-"));

try {
	const hist = (...args) => execFileSync("git", args, { cwd: historyRepo, encoding: "utf8" });
	const histFails = (...args) => {
		try {
			execFileSync("git", args, { cwd: historyRepo, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
			return false;
		} catch {
			return true;
		}
	};
	const put = (name, text) => writeFileSync(join(historyRepo, name), text);

	hist("init", "-q", "-b", "main");
	hist("config", "user.email", "fixture@example.test");
	hist("config", "user.name", "Fixture");
	hist("config", "core.hooksPath", join(historyRepo, ".no-hooks"));

	put("a.txt", "base\n");
	hist("add", "-A");
	hist("commit", "-qm", "base: add a");
	hist("checkout", "-q", "-b", "topic");
	put("b.txt", "topic\n");
	hist("add", "-A");
	hist("commit", "-qm", "topic: add b");
	hist("checkout", "-q", "main");
	put("c.txt", "main\n");
	hist("add", "-A");
	hist("commit", "-qm", "main: add c");
	hist("merge", "--no-ff", "-q", "-m", "Merge branch 'topic'", "topic");
	hist("update-ref", "refs/remotes/origin/main", "HEAD");
	hist("branch", "--set-upstream-to=main", "topic");

	check("the log format yields the real merge topology", () => {
		const commits = parseLog(hist("log", `--format=${LOG_FORMAT}`));
		assert.equal(commits.length, 4);
		assert.equal(commits[0].subject, "Merge branch 'topic'");
		assert.equal(commits[0].parents.length, 2, "a merge commit has two parents");
		// The decoration decodes into HEAD plus the remote-tracking name.
		assert.deepEqual(
			commits[0].refs.find((ref) => ref.kind === "head"),
			{ kind: "head", name: "main" }
		);
		assert.ok(commits[0].refs.some((ref) => ref.name === "origin/main"));
		assert.equal(commits[3].parents.length, 0, "the root commit has no parents");
		// Subjects survive the round trip, colons included.
		assert.ok(commits.some((commit) => commit.subject === "topic: add b"));
	});

	check("the real merge lays out as one lane opening and closing", () => {
		const rows = assignLanes(parseLog(hist("log", `--format=${LOG_FORMAT}`)));
		assert.equal(rows[0].columns.length, 2, "the merge draws to both parents");
		assert.equal(rows[0].column, 0);
		// After the two histories converge the graph is one lane wide again.
		assert.equal(rows[rows.length - 1].width, 1);
		assert.ok(rows.every((row) => row.column < 4), "a 4-commit history stays narrow");
	});

	check("branches are classified from real refnames", () => {
		const branches = parseBranches(hist("for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads", "refs/remotes"));
		const byName = new Map(branches.map((branch) => [branch.name, branch]));
		assert.equal(byName.get("main").current, true);
		assert.equal(byName.get("main").remote, false);
		assert.equal(byName.get("topic").remote, false, "a local branch is not remote");
		assert.equal(byName.get("origin/main").remote, true, "a remote-tracking branch is");
		assert.equal(byName.get("origin/main").current, false);
		// topic has main as its upstream and is two commits behind it.
		assert.equal(byName.get("topic").upstream, "main");
		assert.equal(byName.get("topic").behind, 2);
		assert.equal(byName.get("topic").ahead, 0);
	});

	check("a real stopped rebase reports its branch, target and step", () => {
		// Diverge on the SAME file so the rebase cannot help but conflict.
		hist("checkout", "-q", "-b", "rbtopic", "main");
		put("a.txt", "rebase side\n");
		hist("commit", "-qam", "rebase side");
		hist("checkout", "-q", "main");
		put("a.txt", "main side\n");
		hist("commit", "-qam", "main side");
		hist("checkout", "-q", "rbtopic");
		assert.ok(histFails("rebase", "main"), "the rebase should stop on a conflict");

		const state = parseRepoState(hist("status"));
		assert.equal(state.kind, "rebase");
		assert.equal(state.branch, "rbtopic");
		assert.ok(state.onto !== null, "the rebase target is named");
		assert.ok(state.step !== null && state.step <= state.total, `step ${state.step} must not exceed total ${state.total}`);

		hist("rebase", "--abort");
		assert.equal(parseRepoState(hist("status")).kind, null, "aborting clears the state");
	});

	check("the reflog records the rebase that just happened", () => {
		const entries = parseReflog(hist("reflog", "--date=iso-strict", `--format=${REFLOG_FORMAT}`));
		assert.ok(entries.length > 0);
		assert.ok(
			entries.some((entry) => entry.action === "rebase (start)"),
			`expected a rebase entry, got: ${entries.map((entry) => entry.action).join(" | ")}`
		);
		assert.ok(entries.every((entry) => entry.selector.startsWith("HEAD@{")));
		// The entry time must come from the selector; %aI would give the commit's
		// author date instead, which disagrees for any older commit.
		assert.ok(
			entries.every((entry) => entry.date !== null && /^\d{4}-\d{2}-\d{2}T/.test(entry.date)),
			"every reflog entry carries its own time"
		);
	});

	check("a real conflicted merge is recognized from its abort hint", () => {
		hist("checkout", "-q", "-b", "mergeside", "main");
		put("a.txt", "merge side\n");
		hist("commit", "-qam", "merge side");
		hist("checkout", "-q", "main");
		put("a.txt", "main again\n");
		hist("commit", "-qam", "main again");
		assert.ok(histFails("merge", "mergeside"), "the merge should conflict");

		const status = hist("status");
		assert.ok(!/in the middle of a merge/.test(status), "git prints no such sentence — the hint is the only marker");
		assert.equal(parseRepoState(status).kind, "merge");

		hist("merge", "--abort");
		assert.equal(parseRepoState(hist("status")).kind, null, "aborting clears the merge");
	});
} finally {
	rmSync(historyRepo, { recursive: true, force: true });
}

console.log(`\nPASS  ${passed} checks`);
