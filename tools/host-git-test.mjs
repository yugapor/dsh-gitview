/**
 * Boot-free test for the host git operations.
 *
 * `lib/index.js` takes its dependencies as arguments, so the whole host half can
 * be driven against a scripted `subprocess` with no DSH, no repository, and no
 * real git process. It checks command construction (argv, cwd, env, caps), the
 * exit-code classification, and the fallback paths.
 *
 * Run: node tools/host-git-test.mjs
 */
import assert from "node:assert/strict";
import {
	BLAME_PATH,
	BRANCHES_PATH,
	DIFF_PATH,
	HISTORY_PATH,
	MUTATE_PATH,
	MESSAGE_PATH,
	CI_PATH,
	AUTH_PATH,
	MUTATIONS,
	REFLOG_PATH,
	STATUS_PATH,
	apply,
	applyMutation,
	blameResponse,
	branchesResponse,
	cwdFor,
	modelFor,
	generateCommitMessage,
	messageResponse,
	diffResponse,
	historyResponse,
	inject,
	isSafeRepoPath,
	isSafeRev,
	mutateResponse,
	name,
	readBase,
	readBlame,
	readBranches,
	readDiff,
	readHistory,
	readReflog,
	readRepoState,
	readStatus,
	readIdentity,
	connectionResponse,
	reflogResponse,
	resolveGit,
	runGit,
	statusResponse
} from "../lib/index.js";

console.log("host-git-test");

let passed = 0;
async function check(name, fn) {
	await fn();
	passed++;
	console.log(`  ok  ${name}`);
}

/**
 * A scripted `subprocess` service.
 *
 * `reply` receives the argv WITHOUT the executable and returns what the command
 * should have printed. Every spawn spec is recorded so the test can assert on
 * cwd, env, stdio caps and graceMs.
 */
function fakeSubprocess(reply, options = {}) {
	const specs = [];
	return {
		specs,
		async resolveExecutable() {
			if (options.executableFails === true) throw new Error("not found");
			return options.executable ?? "/usr/bin/git";
		},
		spawn(spec) {
			specs.push(spec);
			const result = reply(spec.argv.slice(1), spec) ?? { exitCode: 0, stdout: "", stderr: "" };
			return {
				done: Promise.resolve({ exitCode: result.exitCode ?? 0, signal: null }),
				collected: {
					stdout: {
						truncated: result.truncated === true,
						readFrom: () => ({ text: result.stdout ?? "", nextOffset: 0, lossy: false })
					},
					stderr: {
						truncated: false,
						readFrom: () => ({ text: result.stderr ?? "", nextOffset: 0, lossy: false })
					}
				}
			};
		}
	};
}

/** Canned porcelain status: one modified file, one untracked, nested. */
const STATUS_Z = [
	"## main...origin/main [ahead 1, behind 2]",
	" M src/a.js",
	"?? notes.md",
	""
].join("\0");

/** Long-form status for a repository stopped in the middle of a rebase. */
const STATUS_LONG = [
	"interactive rebase in progress; onto deadbee",
	"Last command done (1 command done):",
	"   pick abc1234 work",
	"No commands remaining.",
	"You are currently rebasing branch 'topic' on 'deadbee'.",
	""
].join("\n");

/** Three commits: two the base branch has not seen, one that it has. */
const NEWER = "1".repeat(40);
const NEWEST = "2".repeat(40);
const SHARED = "3".repeat(40);

const logRecord = (sha, parents, subject, decoration = "") =>
	[sha, sha.slice(0, 7), parents, "Fixture", "fixture@example.test", "2026-01-02T03:04:05+09:00", decoration, subject].join("\u001f");

const LOG_STREAM =
	[
		logRecord(NEWER, NEWEST, "newer work", "HEAD -> topic"),
		logRecord(NEWEST, SHARED, "newest work"),
		logRecord(SHARED, "", "already in main", "main")
	].join("\u001e") + "\u001e";

const branchRecord = (full, name, short, head, upstream, track) =>
	[full, name, short, head, upstream, track, "2026-01-02T03:04:05+09:00", "subject"].join("\u001f");

/** One remote-tracking branch and two locals; `topic` is the current one. */
const BRANCH_STREAM =
	[
		branchRecord("refs/remotes/origin/main", "origin/main", "aaaaaaa", " ", "", ""),
		branchRecord("refs/heads/topic", "topic", "bbbbbbb", "*", "origin/topic", "ahead 1, behind 2"),
		branchRecord("refs/heads/main", "main", "ccccccc", " ", "origin/main", "")
	].join("\u001e") + "\u001e";

const reflogRecord = (short, selector, subject) => [short, selector, subject].join("\u001f");

const REFLOG_STREAM =
	[
		reflogRecord("aaaaaaa", "HEAD@{2026-01-02T00:00:00+09:00}", "rebase (start): checkout main"),
		reflogRecord("bbbbbbb", "HEAD@{2026-01-01T00:00:00+09:00}", "commit: work")
	].join("\u001e") + "\u001e";

/** One `--line-porcelain` record: the metadata repeats for every line, as git sends it. */
const blameRecord = (sha, line, author, seconds, summary, content) =>
	[
		`${sha} ${line} ${line}`,
		`author ${author}`,
		`author-mail <${author.toLowerCase()}@example.com>`,
		`author-time ${seconds}`,
		`author-tz +0900`,
		`committer ${author}`,
		`committer-time ${seconds}`,
		`committer-tz +0900`,
		`summary ${summary}`,
		`filename a.js`,
		`\t${content}`
	].join("\n");

const BLAME_STREAM = [
	blameRecord(NEWEST, 1, "Ann", 1767225845, "feat: one", "const a = 1;"),
	blameRecord(NEWER, 2, "Bob", 1600000000, "fix: two", "let b = 2;")
].join("\n");

/** Answer every command the plugin issues; anything else is a test bug. */
function happyReply(argv, spec) {
	if (argv[0] === "rev-parse") {
		if (argv.includes("--show-toplevel")) return { exitCode: 0, stdout: "/repo\n" };
		// `main` exists (so it is the base) and HEAD exists; `master` does not.
		return { exitCode: argv[argv.length - 1] === "refs/heads/master" ? 1 : 0, stdout: "" };
	}
	if (argv[0] === "status") {
		if (argv.includes("--porcelain=v1")) return { exitCode: 0, stdout: STATUS_Z };
		return { exitCode: 0, stdout: STATUS_LONG };
	}
	if (argv[0] === "rev-list") {
		// "<only in base>\t<only in HEAD>": one behind, two ahead.
		if (argv.includes("--left-right")) return { exitCode: 0, stdout: "1\t2\n" };
		return { exitCode: 0, stdout: `${NEWER}\n${NEWEST}\n` };
	}
	if (argv[0] === "log") return { exitCode: 0, stdout: LOG_STREAM };
	if (argv[0] === "for-each-ref") return { exitCode: 0, stdout: BRANCH_STREAM };
	if (argv[0] === "reflog") return { exitCode: 0, stdout: REFLOG_STREAM };
	if (argv[0] === "blame") {
		if (argv[argv.length - 1] === "missing.txt") return { exitCode: 128, stderr: "fatal: no such path 'missing.txt' in HEAD\n" };
		return { exitCode: 0, stdout: BLAME_STREAM };
	}
	if (argv[0] === "diff" || argv[0] === "show") return { exitCode: 0, stdout: "diff --git a/a.js b/a.js\n" };
	if (["add", "restore", "rm", "commit"].includes(argv[0])) return { exitCode: 0, stdout: "" };
	if (argv[0] === "config") return { exitCode: 0, stdout: `local\0file:.git/config\0${argv.at(-1) === "user.name" ? "Fixture" : "fixture@example.test"}\0` };
	if (argv[0] === "var") return { exitCode: 0, stdout: "Fixture <fixture@example.test> 1767225600 +0900\n" };
	throw new Error(`unexpected argv: ${argv.join(" ")} (cwd=${spec.cwd})`);
}

// ── resolveGit ──────────────────────────────────────────────────────────────

await check("resolveGit returns the path, or null when git is absent", async () => {
	assert.equal(await resolveGit(fakeSubprocess(() => ({}))), "/usr/bin/git");
	assert.equal(await resolveGit(fakeSubprocess(() => ({}), { executableFails: true })), null);
});

// ── runGit ──────────────────────────────────────────────────────────────────

await check("runGit sends an explicit cwd, env and bounded stdio", async () => {
	const subprocess = fakeSubprocess(() => ({ exitCode: 0, stdout: "ok" }));
	const result = await runGit(subprocess, ["/usr/bin/git", "status"], { cwd: "/repo" });

	assert.equal(result.exitCode, 0);
	assert.equal(result.stdout, "ok");
	const [spec] = subprocess.specs;
	assert.deepEqual([...spec.argv], ["/usr/bin/git", "status"]);
	assert.equal(spec.cwd, "/repo");
	assert.equal(spec.stdio.stdin, "ignore");
	assert.equal(typeof spec.stdio.stdout.maxBytes, "number");
	assert.equal(spec.graceMs, 2000);
	// A read-only status must never take the index lock, and must never prompt.
	assert.equal(spec.env.GIT_OPTIONAL_LOCKS, "0");
	assert.equal(spec.env.GIT_TERMINAL_PROMPT, "0");
	assert.equal(spec.env.GIT_CONFIG_COUNT, "0");
});

await check("runGit propagates the output truncation flag", async () => {
	const subprocess = fakeSubprocess(() => ({ exitCode: 0, stdout: "tail", truncated: true }));
	const result = await runGit(subprocess, ["/usr/bin/git", "status"], { cwd: "/repo" });
	assert.equal(result.truncated, true);
});

// ── readStatus ──────────────────────────────────────────────────────────────

await check("no working directory reports no-workspace without spawning", async () => {
	const subprocess = fakeSubprocess(() => ({}));
	const result = await readStatus({ subprocess, executable: "/usr/bin/git", cwd: undefined });
	assert.equal(result.kind, "no-workspace");
	assert.equal(subprocess.specs.length, 0);
});

await check("a missing executable reports no-repository without spawning", async () => {
	const subprocess = fakeSubprocess(() => ({}));
	const result = await readStatus({ subprocess, executable: null, cwd: "/repo" });
	assert.equal(result.kind, "no-repository");
	assert.equal(subprocess.specs.length, 0);
});

await check("outside a repository reports no-repository", async () => {
	const subprocess = fakeSubprocess(() => ({ exitCode: 128, stderr: "not a git repository" }));
	const result = await readStatus({ subprocess, executable: "/usr/bin/git", cwd: "/tmp" });
	assert.equal(result.kind, "no-repository");
});

await check("a ready repository reports the branch, counts and tree", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const result = await readStatus({ subprocess, executable: "/usr/bin/git", cwd: "/repo/sub" });

	assert.equal(result.kind, "ready");
	assert.equal(result.repoRoot, "/repo");
	assert.equal(result.branch, "main");
	assert.equal(result.upstream, "origin/main");
	assert.equal(result.ahead, 1);
	assert.equal(result.behind, 2);
	assert.equal(result.changed, 2);
	assert.equal(result.truncated, false);

	// The tree is rooted at the repository, not at the session's subdirectory.
	assert.equal(result.tree.name, "repo");
	assert.equal(result.tree.total, 2);
	assert.deepEqual(
		[...result.tree.children.map((node) => `${node.type}:${node.name}`)],
		["dir:src", "file:notes.md"]
	);
	assert.deepEqual([...Object.keys(result.tree.counts)].sort(), ["modified", "untracked"]);
});

await check("status runs at the repository root, untracked files listed individually", async () => {
	const subprocess = fakeSubprocess(happyReply);
	await readStatus({ subprocess, executable: "/usr/bin/git", cwd: "/repo/sub" });

	const [rootSpec, statusSpec] = subprocess.specs;
	assert.equal(rootSpec.cwd, "/repo/sub", "rev-parse runs in the session directory");
	assert.equal(statusSpec.cwd, "/repo", "status runs at the repository root");
	const argv = [...statusSpec.argv];
	assert.ok(argv.includes("--porcelain=v1"));
	assert.ok(argv.includes("-z"), "the -z form keeps paths verbatim");
	assert.ok(argv.includes("--untracked-files=all"), "a tree view must not collapse untracked directories");
	assert.ok(argv.includes("--branch"), "the branch header drives the tab header");
});

await check("a truncated status is surfaced as truncated", async () => {
	const subprocess = fakeSubprocess((argv) => {
		if (argv[0] === "rev-parse") return { exitCode: 0, stdout: "/repo\n" };
		return { exitCode: 0, stdout: STATUS_Z, truncated: true };
	});
	const result = await readStatus({ subprocess, executable: "/usr/bin/git", cwd: "/repo" });
	assert.equal(result.truncated, true);
});

// ── readDiff ────────────────────────────────────────────────────────────────

await check("a tracked change returns the HEAD patch", async () => {
	const subprocess = fakeSubprocess((argv) => {
		if (argv[0] === "rev-parse") return { exitCode: 0, stdout: "/repo\n" };
		if (argv[0] === "diff") return { exitCode: 0, stdout: "diff --git a/src/a.js b/src/a.js\n-M\n+N\n" };
		throw new Error(`unexpected argv: ${argv.join(" ")}`);
	});
	const result = await readDiff({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "src/a.js" });

	assert.equal(result.kind, "ready");
	assert.equal(result.path, "src/a.js");
	assert.match(result.text, /^diff --git/);
	assert.equal(result.binary, false);
	// The baseline is HEAD, so staged and unstaged edits appear in one view.
	const diffSpec = subprocess.specs.find((spec) => spec.argv[1] === "diff");
	assert.deepEqual([...diffSpec.argv].slice(1, 6), ["diff", "--no-color", "--no-ext-diff", "HEAD", "--"]);
	assert.equal(diffSpec.argv.at(-1), "src/a.js");
});

await check("an empty HEAD patch falls back to --no-index for an untracked file", async () => {
	const calls = [];
	const subprocess = fakeSubprocess((argv) => {
		if (argv[0] === "rev-parse") return { exitCode: 0, stdout: "/repo\n" };
		if (argv[0] === "diff") {
			calls.push([...argv]);
			// git diff exits 1 when --no-index finds a difference.
			return argv.includes("--no-index")
				? { exitCode: 1, stdout: "diff --git a/dev/null b/notes.md\n+hello\n" }
				: { exitCode: 0, stdout: "" };
		}
		throw new Error(`unexpected argv: ${argv.join(" ")}`);
	});
	const result = await readDiff({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "notes.md" });

	assert.equal(result.kind, "ready");
	assert.match(result.text, /\+hello/);
	assert.equal(calls.length, 2, "the fallback must run exactly once");
	assert.ok(calls[1].includes("--no-index"));
});

await check("a binary patch is flagged", async () => {
	const subprocess = fakeSubprocess((argv) => {
		if (argv[0] === "rev-parse") return { exitCode: 0, stdout: "/repo\n" };
		return { exitCode: 0, stdout: "Binary files a/logo.png and b/logo.png differ\n" };
	});
	const result = await readDiff({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "logo.png" });
	assert.equal(result.binary, true);
});

await check("readDiff classifies a missing workspace and a missing git", async () => {
	const subprocess = fakeSubprocess(() => ({}));
	assert.equal((await readDiff({ subprocess, executable: "/usr/bin/git", cwd: undefined, path: "a" })).kind, "no-workspace");
	assert.equal((await readDiff({ subprocess, executable: null, cwd: "/repo", path: "a" })).kind, "no-repository");
	assert.equal(subprocess.specs.length, 0);
});

// ── the /api routes ────────────────────────────────────────────────────────

const ORIGIN = "http://127.0.0.1:3000";

/** Handler dependencies that always answer, with overridable pieces. */
function handlerDeps(overrides = {}) {
	return {
		subprocess: fakeSubprocess(happyReply),
		executable: async () => "/usr/bin/git",
		cwdFor: async () => "/repo",
		...overrides
	};
}

/** Drive one route with a WHATWG request, as the connection bridge would. */
async function call(handler, path, deps = handlerDeps()) {
	const response = await handler(new Request(`${ORIGIN}${path}`), deps);
	return { response, json: await response.json() };
}

await check("the route requires a session id", async () => {
	const { response, json } = await call(statusResponse, STATUS_PATH);
	assert.equal(response.status, 400);
	assert.equal(json.code, "missing-session");
	// The diff route refuses just the same, before it looks at the path.
	const diff = await call(diffResponse, DIFF_PATH);
	assert.equal(diff.response.status, 400);
	assert.equal(diff.json.code, "missing-session");
});

await check("the tree route answers JSON that must not be cached", async () => {
	const { response, json } = await call(statusResponse, `${STATUS_PATH}?sessionId=s1`);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(json.kind, "ready");
	assert.equal(json.branch, "main");
	assert.equal(json.tree.total, 2);
});

await check("a session with no working directory is an ordinary 200 answer", async () => {
	const { response, json } = await call(statusResponse, `${STATUS_PATH}?sessionId=s1`, handlerDeps({ cwdFor: async () => undefined }));
	assert.equal(response.status, 200, "no-workspace is a state, not a request error");
	assert.equal(json.kind, "no-workspace");
});

await check("a traversing path is refused before git sees it", async () => {
	for (const path of ["../etc/passwd", "/etc/passwd", "a/../../b", "C:/windows"]) {
		const { response, json } = await call(diffResponse, `${DIFF_PATH}?sessionId=s1&path=${encodeURIComponent(path)}`);
		assert.equal(response.status, 400, `expected 400 for ${path}`);
		assert.equal(json.code, "invalid-path");
	}
});

await check("a valid diff request answers the patch", async () => {
	const deps = handlerDeps({
		subprocess: fakeSubprocess((argv) => {
			if (argv[0] === "rev-parse") return { exitCode: 0, stdout: "/repo\n" };
			return { exitCode: 0, stdout: "diff --git a/src/a.js b/src/a.js\n" };
		})
	});
	const { response, json } = await call(
		diffResponse,
		`${DIFF_PATH}?sessionId=s1&path=${encodeURIComponent("src/a.js")}`,
		deps
	);
	assert.equal(response.status, 200);
	assert.equal(json.kind, "ready");
	assert.equal(json.path, "src/a.js");
	assert.match(json.text, /^diff --git/);
});

await check("a thrown failure becomes a 500, never a crashed host", async () => {
	const { response, json } = await call(statusResponse, `${STATUS_PATH}?sessionId=s1`, handlerDeps({
		cwdFor: async () => {
			throw new Error("session store exploded");
		}
	}));
	assert.equal(response.status, 500);
	assert.equal(json.code, "internal");
	assert.match(json.message, /session store exploded/);
});

await check("isSafeRepoPath accepts ordinary repository paths", () => {
	for (const path of ["src/a.js", "a/b/c.txt", "日本語/メモ.md", "file with spaces.js", "a..b.js", "./a"]) {
		assert.equal(isSafeRepoPath(path), true, `expected safe: ${path}`);
	}
	for (const path of ["", "/abs", "\\abs", "C:/x", "../x", "a/../../b", ".."]) {
		assert.equal(isSafeRepoPath(path), false, `expected unsafe: ${path}`);
	}
});

// ── session working directory ───────────────────────────────────────────────

await check("a live session resolves its own working directory", async () => {
	const ctx = {
		sessions: { get: () => ({ header: { cwd: "/work" } }) },
		sandboxPolicy: { workspaceRoot: "/fallback" },
		get: () => undefined
	};
	assert.equal(await cwdFor(ctx, "s1"), "/work");
});

await check("a header without a cwd falls back to the composition root", async () => {
	const ctx = {
		sessions: { get: () => ({ header: {} }) },
		sandboxPolicy: { workspaceRoot: "/fallback" },
		get: () => undefined
	};
	assert.equal(await cwdFor(ctx, "s1"), "/fallback");
});

await check("a session this process never created is read from persistence", async () => {
	const ctx = {
		sessions: { get: () => undefined },
		sandboxPolicy: { workspaceRoot: "/fallback" },
		get: (service) => (service === "sessionPersistence" ? { stat: async () => ({ header: { cwd: "/stored" } }) } : undefined)
	};
	assert.equal(await cwdFor(ctx, "cold"), "/stored");
});

await check("a session nobody knows reports no working directory", async () => {
	const ctx = {
		sessions: { get: () => undefined },
		sandboxPolicy: { workspaceRoot: "/fallback" },
		get: () => undefined
	};
	assert.equal(await cwdFor(ctx, "ghost"), undefined);
	// A persisted header without a cwd still falls back to the composition root.
	const ctx2 = {
		sessions: { get: () => undefined },
		sandboxPolicy: { workspaceRoot: "/fallback" },
		get: () => ({ stat: async () => ({ header: {} }) })
	};
	assert.equal(await cwdFor(ctx2, "cold"), "/fallback");
});

// ── readRepoState / readBase ────────────────────────────────────────────────

await check("the operation in progress is read from long-form status", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const state = await readRepoState({ subprocess, executable: "/usr/bin/git", cwd: "/repo" }, "/repo");
	assert.equal(state.kind, "rebase");
	assert.equal(state.branch, "topic");
	assert.equal(state.onto, "deadbee");
	assert.equal(state.step, 1);
	assert.equal(state.total, 1, "the done count is already the current step");
	// The prose call asks for no untracked listing; the tree comes from porcelain.
	const spec = subprocess.specs.find((s) => s.argv[1] === "status");
	assert.ok(spec.argv.includes("--untracked-files=no"));
});

await check("the base comparison names main and counts both ways", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const base = await readBase({ subprocess, executable: "/usr/bin/git", cwd: "/repo" }, "/repo");
	assert.equal(base.name, "main");
	assert.equal(base.ahead, 2);
	assert.equal(base.behind, 1);
	assert.deepEqual([...base.commits], [NEWER, NEWEST]);
	// The count is read as "<behind>\t<ahead>", not the other way round.
	const counts = subprocess.specs.find((spec) => spec.argv.includes("--left-right"));
	assert.ok(counts.argv.includes("main...HEAD"));
});

await check("a repository with neither main nor master reports no base", async () => {
	const subprocess = fakeSubprocess((argv) => {
		if (argv[0] === "rev-parse") {
			return argv.includes("--show-toplevel") ? { exitCode: 0, stdout: "/repo\n" } : { exitCode: 1, stdout: "" };
		}
		throw new Error(`unexpected argv: ${argv.join(" ")}`);
	});
	const base = await readBase({ subprocess, executable: "/usr/bin/git", cwd: "/repo" }, "/repo");
	assert.equal(base.name, null);
	assert.equal(base.ahead, 0);
	assert.equal(base.behind, 0);
	assert.deepEqual([...base.commits], []);
	assert.equal(subprocess.specs.some((spec) => spec.argv[1] === "rev-list"), false, "no comparison without a base");
});

// ── readHistory ─────────────────────────────────────────────────────────────

await check("history carries the graph, the base and the ahead marks", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const history = await readHistory({ subprocess, executable: "/usr/bin/git", cwd: "/repo" });

	assert.equal(history.kind, "ready");
	assert.equal(history.repoRoot, "/repo");
	assert.equal(history.base.name, "main");
	assert.equal(history.total, 3);
	assert.equal(history.truncated, false);
	assert.equal(history.empty, undefined);
	assert.deepEqual([...history.commits.map((commit) => commit.short)], ["1111111", "2222222", "3333333"]);
	assert.deepEqual([...history.commits.map((commit) => commit.ahead)], [true, true, false], "only what main lacks is marked");
	assert.deepEqual([...history.commits.map((commit) => commit.column)], [0, 0, 0]);
	assert.deepEqual([...history.commits[0].refs], [{ kind: "head", name: "topic" }]);

	// `--all` is what makes the graph show branches, not just HEAD's ancestors.
	const logSpec = subprocess.specs.find((spec) => spec.argv[1] === "log");
	assert.ok(logSpec.argv.includes("--all"));
	assert.ok(logSpec.argv.includes("--date-order"));
});

await check("an unborn branch is an empty history, not an error", async () => {
	const subprocess = fakeSubprocess((argv) => {
		if (argv[0] === "rev-parse") {
			return argv.includes("--show-toplevel") ? { exitCode: 0, stdout: "/repo\n" } : { exitCode: 1, stdout: "" };
		}
		if (argv[0] === "log") return { exitCode: 128, stderr: "your current branch 'main' does not have any commits yet" };
		return { exitCode: 0, stdout: "" };
	});
	const history = await readHistory({ subprocess, executable: "/usr/bin/git", cwd: "/repo" });
	assert.equal(history.kind, "ready");
	assert.equal(history.empty, true);
	assert.deepEqual([...history.commits], []);
});

// ── readBranches / readReflog ───────────────────────────────────────────────

await check("branches come back current-first, local before remote", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const result = await readBranches({ subprocess, executable: "/usr/bin/git", cwd: "/repo" });

	assert.equal(result.kind, "ready");
	assert.deepEqual([...result.branches.map((branch) => branch.name)], ["topic", "main", "origin/main"]);
	assert.equal(result.branches[0].current, true);
	assert.equal(result.branches[0].remote, false);
	assert.equal(result.branches[0].ahead, 1);
	assert.equal(result.branches[0].behind, 2);
	assert.equal(result.branches[2].remote, true, "a slash in a name must not decide this");
	assert.equal(result.state.kind, "rebase", "the branch list carries the operation too");

	// refs/heads and refs/remotes are both asked for; tags are not.
	const refSpec = subprocess.specs.find((spec) => spec.argv[1] === "for-each-ref");
	assert.deepEqual([...refSpec.argv].filter((arg) => arg.startsWith("refs/")), ["refs/heads", "refs/remotes"]);
});

await check("the reflog keeps each entry's own timestamp", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const result = await readReflog({ subprocess, executable: "/usr/bin/git", cwd: "/repo" });

	assert.equal(result.kind, "ready");
	assert.equal(result.entries.length, 2);
	assert.equal(result.entries[0].action, "rebase (start)");
	assert.equal(result.entries[0].subject, "checkout main");
	assert.equal(result.entries[0].date, "2026-01-02T00:00:00+09:00");

	// --date is what puts the entry time in %gd; without it the selector is an index.
	const spec = subprocess.specs.find((s) => s.argv[1] === "reflog");
	assert.ok(spec.argv.includes("--date=iso-strict"));
});

// ── applyMutation ───────────────────────────────────────────────────────────

await check("the mutation set is closed and cannot rewrite history", () => {
	assert.deepEqual([...MUTATIONS].sort(), ["commit", "stage", "stage-all", "unstage", "unstage-all"]);
	for (const dangerous of ["reset", "checkout", "clean", "push", "rebase", "merge", "cherry-pick", "branch", "stash", "tag", "fetch", "pull"]) {
		assert.equal(MUTATIONS.has(dangerous), false, `${dangerous} must never be reachable from a request`);
	}
});

await check("stage and unstage build the inverse commands", async () => {
	const staged = fakeSubprocess(happyReply);
	const on = await applyMutation({ subprocess: staged, executable: "/usr/bin/git", cwd: "/repo", action: "stage", paths: ["src/a.js"] });
	assert.equal(on.kind, "ready");
	assert.equal(on.action, "stage");
	assert.equal(on.status.kind, "ready", "the refreshed status rides along");
	const addSpec = staged.specs.find((spec) => spec.argv[1] === "add");
	assert.deepEqual([...addSpec.argv].slice(1), ["add", "-A", "--", "src/a.js"]);

	const unstaged = fakeSubprocess(happyReply);
	const off = await applyMutation({ subprocess: unstaged, executable: "/usr/bin/git", cwd: "/repo", action: "unstage", paths: ["src/a.js"] });
	assert.equal(off.kind, "ready");
	const restoreSpec = unstaged.specs.find((spec) => spec.argv[1] === "restore");
	assert.deepEqual([...restoreSpec.argv].slice(1), ["restore", "--staged", "--", "src/a.js"]);
});

await check("the all-forms stage and unstage the whole tree", async () => {
	const staged = fakeSubprocess(happyReply);
	await applyMutation({ subprocess: staged, executable: "/usr/bin/git", cwd: "/repo", action: "stage-all" });
	const addSpec = staged.specs.find((spec) => spec.argv[1] === "add");
	assert.deepEqual([...addSpec.argv].slice(1), ["add", "-A"], "stage-all carries no pathspec at all");

	const unstaged = fakeSubprocess(happyReply);
	await applyMutation({ subprocess: unstaged, executable: "/usr/bin/git", cwd: "/repo", action: "unstage-all" });
	const restoreSpec = unstaged.specs.find((spec) => spec.argv[1] === "restore");
	assert.deepEqual([...restoreSpec.argv].slice(1), ["restore", "--staged", "--", "."]);
});

await check("unstage on a repository with no commits uses rm --cached", async () => {
	const subprocess = fakeSubprocess((argv) => {
		if (argv[0] === "rev-parse") {
			if (argv.includes("--show-toplevel")) return { exitCode: 0, stdout: "/repo\n" };
			if (argv.includes("--verify")) return { exitCode: 1, stdout: "" };
			return { exitCode: 0, stdout: "" };
		}
		return { exitCode: 0, stdout: "" };
	});
	const result = await applyMutation({ subprocess, executable: "/usr/bin/git", cwd: "/repo", action: "unstage", paths: ["a.txt"] });

	assert.equal(result.kind, "ready");
	const spec = subprocess.specs.find((s) => s.argv[1] === "rm");
	assert.deepEqual([...spec.argv].slice(1), ["rm", "--cached", "-r", "--", "a.txt"]);
	assert.equal(subprocess.specs.some((s) => s.argv[1] === "restore"), false, "restore --staged cannot run without a HEAD");
});

await check("commit requires a message and passes it as one argv word", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const result = await applyMutation({ subprocess, executable: "/usr/bin/git", cwd: "/repo", action: "commit", message: "  fix: the thing  " });
	assert.equal(result.kind, "ready");
	const spec = subprocess.specs.find((s) => s.argv[1] === "commit");
	assert.deepEqual([...spec.argv].slice(1), ["commit", "-m", "fix: the thing"], "the message is trimmed and never shell-split");
});

await check("mutations refuse a bad verb, an empty message or no paths", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const deps = { subprocess, executable: "/usr/bin/git", cwd: "/repo" };
	assert.equal((await applyMutation({ ...deps, action: "reset-hard" })).code, "unknown-action");
	assert.equal((await applyMutation({ ...deps, action: "commit", message: "   " })).code, "empty-message");
	assert.equal((await applyMutation({ ...deps, action: "stage", paths: [] })).code, "no-paths");
	assert.equal((await applyMutation({ ...deps, action: "unstage", paths: ["../outside"] })).code, "no-paths", "an unsafe path is dropped, not obeyed");
	assert.equal((await applyMutation({ ...deps, action: "stage", paths: ["/etc/passwd"] })).code, "no-paths");
	// A refusal must never reach a mutating command.
	const mutating = subprocess.specs.filter((spec) => ["add", "restore", "rm", "commit"].includes(spec.argv[1]));
	assert.deepEqual([...mutating], [], "a refused action runs no git command that writes");
});

await check("a git failure is reported with git's own sentence", async () => {
	const subprocess = fakeSubprocess((argv) => {
		if (argv[0] === "rev-parse") return { exitCode: 0, stdout: argv.includes("--show-toplevel") ? "/repo\n" : "" };
		if (argv[0] === "commit") return { exitCode: 1, stderr: "nothing to commit, working tree clean\n" };
		throw new Error(`unexpected argv: ${argv.join(" ")}`);
	});
	const result = await applyMutation({ subprocess, executable: "/usr/bin/git", cwd: "/repo", action: "commit", message: "msg" });

	assert.equal(result.kind, "failed");
	assert.equal(result.action, "commit");
	assert.equal(result.exitCode, 1);
	assert.match(result.message, /nothing to commit/);
	assert.equal(result.status, undefined, "a failure must not hand back a status that implies success");
});

// ── isSafeRev ───────────────────────────────────────────────────────────────

await check("isSafeRev accepts object names and refs, refuses options", () => {
	for (const rev of ["deadbee", "a".repeat(40), "HEAD", "main", "origin/main", "HEAD~1", "HEAD^2", "v1.0.0"]) {
		assert.equal(isSafeRev(rev), true, `expected safe: ${rev}`);
	}
	for (const rev of ["", "-x", "--upload-pack=evil", "a..b", "main..other"]) {
		assert.equal(isSafeRev(rev), false, `expected unsafe: ${rev}`);
	}
	assert.equal(isSafeRev(undefined), false);
	assert.equal(isSafeRev(null), false);
});

// ── diff scopes ─────────────────────────────────────────────────────────────

await check("each diff scope chooses its own baseline", async () => {
	const index = fakeSubprocess(happyReply);
	await readDiff({ subprocess: index, executable: "/usr/bin/git", cwd: "/repo", path: "a.js", scope: "index" });
	const indexSpec = index.specs.find((spec) => spec.argv[1] === "diff");
	assert.deepEqual([...indexSpec.argv].slice(1), ["diff", "--no-color", "--no-ext-diff", "--cached", "HEAD", "--", "a.js"]);

	const worktree = fakeSubprocess(happyReply);
	await readDiff({ subprocess: worktree, executable: "/usr/bin/git", cwd: "/repo", path: "a.js", scope: "worktree" });
	const worktreeSpec = worktree.specs.find((spec) => spec.argv[1] === "diff");
	assert.deepEqual([...worktreeSpec.argv].slice(1), ["diff", "--no-color", "--no-ext-diff", "--", "a.js"]);

	const commit = fakeSubprocess(happyReply);
	const result = await readDiff({ subprocess: commit, executable: "/usr/bin/git", cwd: "/repo", path: "a.js", scope: "commit", rev: "deadbee" });
	assert.equal(result.scope, "commit");
	const showSpec = commit.specs.find((spec) => spec.argv[1] === "show");
	// `--format=` strips the commit header so only the patch is rendered.
	assert.deepEqual([...showSpec.argv].slice(1), ["show", "--no-color", "--no-ext-diff", "--format=", "deadbee", "--", "a.js"]);
});

await check("an empty path means the whole commit, and only for the commit scope", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const whole = await readDiff({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "", scope: "commit", rev: "deadbee" });
	assert.equal(whole.kind, "ready");
	// No `--` separator: `git show <rev>` alone is the whole commit.
	const showSpec = subprocess.specs.find((spec) => spec.argv[1] === "show");
	assert.deepEqual([...showSpec.argv].slice(1), ["show", "--no-color", "--no-ext-diff", "--format=", "deadbee"]);

	// Every other scope still needs a path.
	const head = fakeSubprocess(happyReply);
	assert.equal((await readDiff({ subprocess: head, executable: "/usr/bin/git", cwd: "/repo", path: "" })).code, "invalid-path");
	// ... and a whole-commit request still needs a safe revision.
	assert.equal((await readDiff({ subprocess: head, executable: "/usr/bin/git", cwd: "/repo", path: "", scope: "commit", rev: "--evil" })).code, "invalid-rev");
	assert.equal(head.specs.length, 0);
});

await check("the diff route accepts a whole-commit request without a path", async () => {
	const ok = await call(diffResponse, `${DIFF_PATH}?sessionId=s1&scope=commit&rev=deadbee`);
	assert.equal(ok.response.status, 200);
	assert.equal(ok.json.kind, "ready");
	assert.equal(ok.json.path, "");

	// The empty path is refused for the default scope.
	const refused = await call(diffResponse, `${DIFF_PATH}?sessionId=s1`);
	assert.equal(refused.response.status, 400);
	assert.equal(refused.json.code, "invalid-path");
});

await check("an unsafe revision or path is rejected without spawning", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const deps = { subprocess, executable: "/usr/bin/git", cwd: "/repo" };
	assert.equal((await readDiff({ ...deps, path: "a.js", scope: "commit", rev: "--upload-pack=x" })).code, "invalid-rev");
	assert.equal((await readDiff({ ...deps, path: "../escape" })).code, "invalid-path");
	assert.equal(subprocess.specs.length, 0);
});

// ── the read and write route handlers ───────────────────────────────────────

/** Drive one route with a JSON POST body. */
async function post(handler, path, body, deps = handlerDeps()) {
	const response = await handler(
		new Request(`${ORIGIN}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: typeof body === "string" ? body : JSON.stringify(body)
		}),
		deps
	);
	return { response, json: await response.json() };
}

await check("the read routes answer their payloads", async () => {
	const history = await call(historyResponse, `${HISTORY_PATH}?sessionId=s1`);
	assert.equal(history.response.status, 200);
	assert.equal(history.json.kind, "ready");
	assert.equal(history.json.commits.length, 3);

	const branches = await call(branchesResponse, `${BRANCHES_PATH}?sessionId=s1`);
	assert.equal(branches.response.status, 200);
	assert.deepEqual([...branches.json.branches.map((branch) => branch.name)], ["topic", "main", "origin/main"]);

	const reflog = await call(reflogResponse, `${REFLOG_PATH}?sessionId=s1`);
	assert.equal(reflog.response.status, 200);
	assert.equal(reflog.json.entries[0].action, "rebase (start)");
});

await check("every route requires a session id", async () => {
	for (const handler of [statusResponse, diffResponse, historyResponse, branchesResponse, reflogResponse]) {
		const { response, json } = await call(handler, "/api/git.x");
		assert.equal(response.status, 400);
		assert.equal(json.code, "missing-session");
	}
	const { response, json } = await post(mutateResponse, MUTATE_PATH, { action: "stage-all" });
	assert.equal(response.status, 400);
	assert.equal(json.code, "missing-session");
});

await check("the mutation route runs the action and returns the new state", async () => {
	const { response, json } = await post(mutateResponse, `${MUTATE_PATH}?sessionId=s1`, { action: "stage", paths: ["src/a.js"] });
	assert.equal(response.status, 200);
	assert.equal(json.kind, "ready");
	assert.equal(json.action, "stage");
	assert.equal(json.status.kind, "ready");
});

await check("the mutation route rejects a bad body or verb with 400", async () => {
	const notJson = await post(mutateResponse, `${MUTATE_PATH}?sessionId=s1`, "not json at all");
	assert.equal(notJson.response.status, 400);
	assert.equal(notJson.json.code, "invalid-body");

	const badVerb = await post(mutateResponse, `${MUTATE_PATH}?sessionId=s1`, { action: "push --force" });
	assert.equal(badVerb.response.status, 400);
	assert.equal(badVerb.json.code, "unknown-action");

	const noAction = await post(mutateResponse, `${MUTATE_PATH}?sessionId=s1`, {});
	assert.equal(noAction.response.status, 400);
	assert.equal(noAction.json.code, "unknown-action");
});

await check("the diff route refuses an unsafe commit revision", async () => {
	const refused = await call(
		diffResponse,
		`${DIFF_PATH}?sessionId=s1&path=a.js&scope=commit&rev=${encodeURIComponent("--upload-pack=x")}`
	);
	assert.equal(refused.response.status, 400);
	assert.equal(refused.json.code, "invalid-rev");

	const allowed = await call(diffResponse, `${DIFF_PATH}?sessionId=s1&path=a.js&scope=commit&rev=deadbee`);
	assert.equal(allowed.response.status, 200);
	assert.equal(allowed.json.kind, "ready");
	assert.equal(allowed.json.scope, "commit");
});

// ── readBlame ───────────────────────────────────────────────────────────────

await check("readBlame runs blame --line-porcelain for the path and summarises it", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const result = await readBlame({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "a.js" });
	assert.equal(result.kind, "ready");
	assert.equal(result.path, "a.js");
	assert.equal(result.rev, "HEAD", "the default revision is reported, not left blank");

	const blameSpec = subprocess.specs.find((spec) => spec.argv[1] === "blame");
	// The `--` separator keeps a path that looks like a revision from being read as one.
	assert.deepEqual([...blameSpec.argv].slice(1), ["blame", "--line-porcelain", "--no-progress", "--", "a.js"]);
	assert.equal(blameSpec.cwd, "/repo", "blame runs at the repository root, not the session cwd");

	assert.equal(result.lines.length, 2);
	assert.deepEqual([...result.lines.map((line) => line.text)], ["const a = 1;", "let b = 2;"]);
	assert.equal(result.commits, 2);
	assert.deepEqual([...result.authors], ["Ann", "Bob"]);
	assert.equal(result.truncated, false);
});

await check("readBlame passes an explicit revision before the separator", async () => {
	const subprocess = fakeSubprocess(happyReply);
	await readBlame({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "a.js", rev: "HEAD~2" });
	const blameSpec = subprocess.specs.find((spec) => spec.argv[1] === "blame");
	assert.deepEqual([...blameSpec.argv].slice(1), ["blame", "--line-porcelain", "--no-progress", "HEAD~2", "--", "a.js"]);
});

await check("readBlame reports a git failure in git's own words", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const result = await readBlame({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "missing.txt" });
	assert.equal(result.kind, "failed");
	assert.match(result.message, /no such path/);
});

await check("readBlame refuses a bad path or revision before spawning", async () => {
	const subprocess = fakeSubprocess(happyReply);
	assert.equal((await readBlame({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "../escape" })).code, "invalid-path");
	assert.equal((await readBlame({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "" })).code, "invalid-path");
	// Blame is always about one file, so an empty path is malformed rather than a
	// question about the repository.
	assert.equal((await readBlame({ subprocess, executable: "/usr/bin/git", cwd: "/repo", path: "a.js", rev: "--evil" })).code, "invalid-rev");
	assert.equal(subprocess.specs.length, 0, "a refused request must cost no process");
});

await check("the blame route validates the path and answers the summary", async () => {
	const ok = await call(blameResponse, `${BLAME_PATH}?sessionId=s1&path=a.js`);
	assert.equal(ok.response.status, 200);
	assert.equal(ok.json.kind, "ready");
	assert.equal(ok.json.lines.length, 2);

	// A path is required, and an unsafe revision is refused.
	assert.equal((await call(blameResponse, `${BLAME_PATH}?sessionId=s1`)).json.code, "invalid-path");
	assert.equal((await call(blameResponse, `${BLAME_PATH}?sessionId=s1&path=a.js&rev=--evil`)).json.code, "invalid-rev");
});

// ── plugin wiring ───────────────────────────────────────────────────────────

await check("apply claims ten authenticated routes, with generation separate from mutations", async () => {
	const routes = [];
	const ctx = {
		subprocess: fakeSubprocess(() => ({})),
		connection: {
			fetch: {
				register(route) {
					routes.push(route);
					return Promise.resolve(() => {});
				}
			}
		}
	};

	apply(ctx);

	assert.equal(name, "git-tree");
	assert.deepEqual([...inject], ["connection", "subprocess", "sessions", "sandboxPolicy", "llm", "sessionQuery", "agentDefaultModel"]);
	// The path must carry the literal /api/ prefix: assertFetchRoute rejects a
	// path without it, so this is a registration-time contract.
	assert.equal(STATUS_PATH, "/api/git.tree");
	assert.equal(DIFF_PATH, "/api/git.diff");
	assert.equal(HISTORY_PATH, "/api/git.history");
	assert.equal(BRANCHES_PATH, "/api/git.branches");
	assert.equal(REFLOG_PATH, "/api/git.reflog");
	assert.equal(BLAME_PATH, "/api/git.blame");
	assert.equal(MUTATE_PATH, "/api/git.mutate");
	assert.equal(MESSAGE_PATH, "/api/git.message");
	assert.equal(CI_PATH, "/api/git.ci");
	assert.equal(AUTH_PATH, "/api/git.auth");
	assert.equal(routes.length, 10);

	// Git mutations and paid model calls both require an explicit POST.
	const writing = routes.filter((route) => route.methods.includes("POST"));
	assert.deepEqual(writing.map((route) => route.path), ["/api/git.mutate", "/api/git.message"]);

	for (const route of routes) {
		assert.ok(route.path.startsWith("/api/"), `route path must start with /api/: ${route.path}`);
		assert.equal(route.requestBody, "buffered");
		assert.equal(typeof route.fetch, "function");
		assert.ok(["GET", "POST"].includes(route.methods[0]));
	}
	assert.equal(new Set(routes.map((route) => route.path)).size, 10, "no route may be claimed twice");
});

await check("model selection uses the next model, supports cold reads, and releases its observation", async () => {
	let disposed = 0;
	let next = { provider: "selected", model: "new-model", reasoningEffort: "high" };
	const ctx = {
		sessionQuery: { observeSession: async (id, options) => {
			assert.equal(id, "s1");
			return { projections: { values: { modelSelection: { next } } }, [Symbol.dispose]: () => { disposed++; } };
		} },
		agentDefaultModel: { currentSelection: () => ({ provider: "default", model: "fallback" }) }
	};
	assert.deepEqual(await modelFor(ctx, "s1"), next);
	assert.notEqual(await modelFor(ctx, "s1"), next, "selection is detached");
	next = null;
	assert.deepEqual(await modelFor(ctx, "s1"), { provider: "default", model: "fallback" });
	assert.equal(disposed, 3);
});

const MESSAGE_PATCH = "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new\n";
function generationDeps(overrides = {}) {
	return {
		subprocess: fakeSubprocess((argv) => argv[0] === "rev-parse" ? { stdout: "/repo\n" } : { stdout: argv.includes("--cached") ? MESSAGE_PATCH : "" }),
		executable: "/usr/bin/git", cwd: "/repo", sessionId: "s1", language: "ja",
		modelFor: async () => ({ provider: "fixture", model: "selected", reasoningEffort: "high" }),
		llm: { async *stream() {
			yield { type: "text-delta", index: 0, text: "変更を追加" };
			yield { type: "block-end", index: 0, block: { type: "text", text: "変更を追加" } };
			yield { type: "finish", reason: { kind: "stop" } };
		} },
		...overrides
	};
}

await check("commit generation sends only the bounded index diff to the selected model, without tools", async () => {
	const deps = generationDeps();
	let request;
	const original = deps.llm.stream;
	deps.llm.stream = (options) => { request = options; return original(); };
	const result = await generateCommitMessage(deps);
	assert.equal(result.message, "変更を追加", "final block replaces deltas, not duplicates them");
	assert.deepEqual(result.model, { provider: "fixture", model: "selected" });
	assert.equal(request.model, "selected");
	assert.equal(request.reasoningEffort, "high");
	assert.deepEqual(request.messages, [{ role: "user", content: [{ type: "text", text: MESSAGE_PATCH }] }]);
	assert.match(request.system, /Japanese.*untrusted data/);
	assert.equal(request.tools, undefined);
	assert.equal(request.maxTokens, 2048);
	assert.equal(request.sessionId, "s1");
	assert.ok(request.signal instanceof AbortSignal);
	const patch = deps.subprocess.specs.at(-1);
	assert.ok(patch.argv.includes("--cached"));
	assert.ok(patch.argv.includes("--no-ext-diff"));
	assert.ok(patch.argv.includes("--no-textconv"));
	assert.equal(patch.stdio.stdout.maxBytes, 128 * 1024);
	assert.equal(deps.subprocess.specs.some((spec) => /^(add|commit|reset|restore)$/.test(spec.argv[1])), false);
});

await check("empty, conflicted, oversized and truncated staged diffs never call a model", async () => {
	for (const [expected, output] of [
		["nothing-staged", { stdout: "" }],
		["diff-too-large", { stdout: "tail", truncated: true }],
		["diff-too-large", { stdout: "a".repeat(128 * 1024 + 1) }],
		["unresolved-conflicts", { conflict: true }]
	]) {
		const deps = generationDeps({
			subprocess: fakeSubprocess((argv) => argv[0] === "rev-parse" ? { stdout: "/repo\n" } : argv.includes("--cached") ? output : { stdout: output.conflict ? "a.js\0" : "" }),
			llm: { stream() { throw new Error("a refused diff must not spend tokens"); } },
			modelFor() { throw new Error("no selection read is needed"); }
		});
		assert.equal((await generateCommitMessage(deps)).code, expected);
	}
	assert.equal((await generateCommitMessage(generationDeps({ modelFor: async () => null }))).code, "model-unavailable");
});

await check("commit generation rejects tools, incomplete finishes and malformed messages", async () => {
	for (const chunks of [
		[{ type: "tool-call-delta", index: 0 }],
		[{ type: "text-delta", index: 0, text: "partial" }, { type: "finish", reason: { kind: "max-tokens" } }],
		[{ type: "text-delta", index: 0, text: "no finish" }],
		[{ type: "text-delta", index: 0, text: "first\nsecond" }, { type: "finish", reason: { kind: "stop" } }],
		[{ type: "text-delta", index: 0, text: "x".repeat(8193) }]
	]) {
		const result = await generateCommitMessage(generationDeps({ llm: { async *stream() { yield* chunks; } } }));
		assert.equal(result.kind, "rejected");
		assert.equal(result.message, undefined);
	}
});

await check("the generation POST validates language and session, and reports provider failures", async () => {
	const deps = { ...generationDeps(), executable: async () => "/usr/bin/git", cwdFor: async () => "/repo" };
	const request = (body, suffix = "?sessionId=s1") => new Request(`${ORIGIN}${MESSAGE_PATH}${suffix}`, { method: "POST", body: JSON.stringify(body) });
	assert.equal((await messageResponse(request({ language: "ja" }, ""), deps)).status, 400);
	assert.equal((await messageResponse(request({ language: "xx" }), deps)).status, 400);
	assert.equal((await (await messageResponse(request({ language: "ja" }), deps)).json()).message, "変更を追加");
	deps.llm = { async *stream() { throw new Error("provider unavailable"); } };
	const failure = await (await messageResponse(request({ language: "ja" }), deps)).json();
	assert.equal(failure.kind, "failed");
	assert.match(failure.message, /provider unavailable/);
});

await check("concurrent generation for one session is refused, and cancellation is honored", async () => {
	const routes = [];
	let release;
	const gate = new Promise((done) => { release = done; });
	const deps = generationDeps();
	apply({
		subprocess: deps.subprocess,
		sessions: { get: () => ({ header: { cwd: "/repo" } }) },
		sessionQuery: { observeSession: async () => ({ projections: { values: { modelSelection: { next: { provider: "fixture", model: "selected" } } } }, [Symbol.dispose]() {} }) },
		llm: { async *stream() { await gate; yield { type: "text-delta", index: 0, text: "Draft" }; yield { type: "finish", reason: { kind: "stop" } }; } },
		connection: { fetch: { register: (route) => routes.push(route) } }
	});
	const endpoint = routes.find((route) => route.path === MESSAGE_PATH);
	const request = () => new Request(`${ORIGIN}${MESSAGE_PATH}?sessionId=s1`, { method: "POST", body: JSON.stringify({ language: "en" }) });
	const pending = endpoint.fetch(request());
	assert.equal((await (await endpoint.fetch(request())).json()).code, "generation-busy");
	release();
	assert.equal((await (await pending).json()).kind, "ready");
	assert.equal((await (await endpoint.fetch(request())).json()).kind, "ready", "the lock is released");
	await assert.rejects(generateCommitMessage(generationDeps({ signal: AbortSignal.abort() })), { name: "AbortError" });
});

await check("status reads index and worktree counts separately, without external diff helpers", async () => {
	const subprocess = fakeSubprocess((argv, spec) => argv.includes("--numstat")
		? { stdout: argv.includes("--cached") ? "3\t1\tsrc/a.js\0" : "8\t2\tsrc/a.js\0" }
		: happyReply(argv, spec));
	const result = await readStatus({ subprocess, executable: "/usr/bin/git", cwd: "/repo/sub" });
	const file = result.tree.children[0].children[0];
	assert.deepEqual(file.changes.index, { added: 3, deleted: 1, binary: false });
	assert.deepEqual(file.changes.worktree, { added: 8, deleted: 2, binary: false });
	for (const spec of subprocess.specs.filter((spec) => spec.argv.includes("--numstat"))) {
		assert.equal(spec.cwd, "/repo");
		assert.ok(spec.argv.includes("-z"));
		assert.ok(spec.argv.includes("--no-ext-diff"));
		assert.ok(spec.argv.includes("--no-textconv"));
	}
});

await check("missing or truncated counts do not invent numbers or hide a readable status", async () => {
	const subprocess = fakeSubprocess((argv, spec) => argv.includes("--numstat")
		? argv.includes("--cached") ? { exitCode: 128 } : { stdout: "8\t2\tsrc/a.js\0", truncated: true }
		: happyReply(argv, spec));
	const result = await readStatus({ subprocess, executable: "/usr/bin/git", cwd: "/repo" });
	assert.equal(result.kind, "ready");
	assert.deepEqual(result.tree.children[0].children[0].changes, { index: null, worktree: null });
});

await check("identity reads effective config scopes/origins and both Git identities, without writes", async () => {
	const subprocess = fakeSubprocess(happyReply);
	const result = await readIdentity({ subprocess, executable: "/usr/bin/git" }, "/repo");
	assert.deepEqual(result.config.name, { kind: "set", value: "Fixture", scope: "local", origin: "file:.git/config" });
	assert.equal(result.author.email, "fixture@example.test");
	assert.deepEqual(result.author, result.committer);
	assert.equal(subprocess.specs.length, 4);
	assert.equal(subprocess.specs.every(({ argv, cwd }) => ["config", "var"].includes(argv[1]) && cwd === "/repo"), true);
});
await check("identity distinguishes unset config, unavailable identities and failed reads", async () => {
	const subprocess = fakeSubprocess((args) => args[0] === "config" ? { exitCode: 1 } : { exitCode: 128 });
	const missing = await readIdentity({ subprocess, executable: "git" }, "/repo");
	assert.equal(missing.config.email.kind, "unset"); assert.equal(missing.author.kind, "unavailable");
	const failed = await readIdentity({ subprocess: fakeSubprocess(() => ({ exitCode: 0, stdout: "bad", truncated: true })), executable: "git" }, "/repo");
	assert.equal(failed.config.name.kind, "failed"); assert.equal(failed.author.kind, "failed");
});
await check("connection routes require sessions and report no remote without touching the network", async () => {
	const missing = await connectionResponse(new Request(`http://localhost${CI_PATH}`), handlerDeps());
	assert.equal(missing.status, 400);
	const subprocess = fakeSubprocess((args) => args[0] === "remote" ? { stdout: "" } : { stdout: "/repo\n" });
	const response = await connectionResponse(new Request(`http://localhost${CI_PATH}?sessionId=s1`), handlerDeps({ subprocess }));
	assert.equal((await response.json()).kind, "no-remote");
	assert.equal(response.headers.get("cache-control"), "no-store");
});
await check("connection failures never echo subprocess credentials to the browser", async () => {
	const response = await connectionResponse(new Request(`http://localhost${AUTH_PATH}?sessionId=s1`), handlerDeps({ cwdFor: () => { throw new Error("PRIVATE-TOKEN"); } }), true);
	const result = await response.json();
	assert.equal(result.code, "connection-failed"); assert.equal(JSON.stringify(result).includes("PRIVATE-TOKEN"), false);
});
console.log(`\nPASS  ${passed} checks`);
