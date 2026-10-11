/**
 * Boot-free test for the pure git-status layer.
 *
 * `lib/git.js` has no DSH and no I/O on purpose, so the entire data shape the
 * sidebar draws can be checked here — porcelain quirks, tree roll-up, sorting,
 * and truncation — without a Host, a repository, or a browser.
 *
 * Run: node tools/git-parse-test.mjs
 */
import assert from "node:assert/strict";
import {
	assignLanes,
	buildHistory,
	classify,
	parseBlame,
	parseBranches,
	parseDecoration,
	parseLog,
	parseNumstatZ,
	parseReflog,
	parseRepoState,
	parseStatusZ,
	parseTrack,
	summarize,
	summarizeBlame
} from "../lib/git.js";

let checks = 0;
function check(name, fn) {
	fn();
	checks++;
	console.log(`  ok  ${name}`);
}

/** Porcelain records are NUL-separated; build them from readable lines. */
const z = (...fields) => fields.join("\0") + "\0";

/** One `git log` record, in LOG_FORMAT field order. */
const logRecord = (sha, short, parents, author, email, date, decoration, subject) =>
	[sha, short, parents, author, email, date, decoration, subject].join("\u001f");

/** A whole `git log` stream. */
const logStream = (...recs) => recs.join("\u001e") + "\u001e";

/** One `for-each-ref` record, in BRANCH_FORMAT field order. */
const branchRecord = (full, name, short, head, upstream, track, date, subject) =>
	[full, name, short, head, upstream, track, date, subject].join("\u001f");

/** A whole `for-each-ref` stream. */
const branchStream = (...recs) => recs.join("\u001e") + "\u001e";

/** One `git reflog` record: short, selector, subject. */
const reflogStream = (...recs) => recs.map((rec) => rec.join("\u001f")).join("\u001e") + "\u001e";

console.log("git-parse-test");

check("parses branch header with ahead/behind", () => {
	const parsed = parseStatusZ(z("## main...origin/main [ahead 1, behind 2]", " M a.js"));
	assert.equal(parsed.branch, "main");
	assert.equal(parsed.upstream, "origin/main");
	assert.equal(parsed.ahead, 1);
	assert.equal(parsed.behind, 2);
	assert.equal(parsed.detached, false);
	assert.equal(parsed.entries.length, 1);
});

check("parses a plain branch with no upstream", () => {
	const parsed = parseStatusZ(z("## topic"));
	assert.equal(parsed.branch, "topic");
	assert.equal(parsed.upstream, null);
	assert.equal(parsed.ahead, 0);
});

check("detects a detached HEAD", () => {
	const parsed = parseStatusZ(z("## HEAD (no branch)", " M a.js"));
	assert.equal(parsed.detached, true);
	assert.equal(parsed.branch, "HEAD");
});

check("detects an unborn branch", () => {
	const parsed = parseStatusZ(z("## No commits yet on main", "?? a.js"));
	assert.equal(parsed.unborn, true);
	assert.equal(parsed.branch, "main");
});

check("status letters classify in both directions", () => {
	// XY: the first letter is the index side, the second the worktree side.
	assert.deepEqual(classify(" ", "M"), { state: "modified", staged: false, unstaged: true });
	assert.deepEqual(classify("M", " "), { state: "modified", staged: true, unstaged: false });
	assert.deepEqual(classify("M", "M"), { state: "modified", staged: true, unstaged: true });
	assert.deepEqual(classify("A", " "), { state: "added", staged: true, unstaged: false });
	assert.deepEqual(classify(" ", "D"), { state: "deleted", staged: false, unstaged: true });
	assert.deepEqual(classify("R", " "), { state: "renamed", staged: true, unstaged: false });
	assert.deepEqual(classify("?", "?"), { state: "untracked", staged: false, unstaged: true });
	assert.deepEqual(classify("!", "!"), { state: "ignored", staged: false, unstaged: false });
	for (const pair of ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]) {
		assert.equal(classify(pair[0], pair[1]).state, "conflicted", pair);
	}
});

check("a rename consumes its extra source-path record", () => {
	const parsed = parseStatusZ(z("R  src/b.js", "src/old.js", " M src/c.js"));
	assert.equal(parsed.entries.length, 2, "the source path must not become its own entry");
	assert.equal(parsed.entries[0].path, "src/b.js");
	assert.equal(parsed.entries[0].origPath, "src/old.js");
	assert.equal(parsed.entries[0].state, "renamed");
	assert.equal(parsed.entries[1].path, "src/c.js");
	assert.equal(parsed.entries[1].origPath, null);
});

check("paths with spaces and non-ASCII survive -z verbatim", () => {
	const parsed = parseStatusZ(z("?? a file with spaces.txt", "?? 日本語/メモ.md"));
	assert.equal(parsed.entries[0].path, "a file with spaces.txt");
	assert.equal(parsed.entries[1].path, "日本語/メモ.md");
});

check("builds a nested tree and rolls counts up", () => {
	const raw = z(
		"## main...origin/main [ahead 1]",
		" M src/a.js",
		"R  src/b.js",
		"src/old.js",
		"M  src/deep/nested/c.js",
		"?? notes.md"
	);
	const summary = summarize(raw, { repoRoot: "/repo" });

	assert.equal(summary.branch, "main");
	assert.equal(summary.changed, 4, "changed counts entries, and a rename is one entry");

	const root = summary.tree;
	assert.equal(root.type, "dir");
	assert.equal(root.name, "repo");
	assert.equal(root.total, 4);
	assert.deepEqual(root.counts, { modified: 2, renamed: 1, untracked: 1 });

	// Directories sort before files, and files sort naturally by name.
	assert.deepEqual(
		root.children.map((node) => `${node.type}:${node.name}`),
		["dir:src", "file:notes.md"]
	);
	const src = root.children[0];
	assert.equal(src.path, "src");
	assert.equal(src.total, 3);
	assert.deepEqual(src.counts, { modified: 2, renamed: 1 });

	// Nested directories are created on demand at every depth.
	const deep = src.children.find((node) => node.name === "deep");
	assert.equal(deep.type, "dir");
	assert.equal(deep.total, 1);
	assert.equal(deep.children[0].type, "dir");
	assert.equal(deep.children[0].children[0].path, "src/deep/nested/c.js");
	assert.equal(deep.children[0].children[0].state, "modified");
});

check("sorts naturally, so file2 precedes file10", () => {
	const raw = z("?? file10.txt", "?? file2.txt", "?? File1.txt");
	const root = summarize(raw, { repoRoot: "/repo" }).tree;
	assert.deepEqual(
		root.children.map((node) => node.name),
		["File1.txt", "file2.txt", "file10.txt"]
	);
});

check("truncates rather than shipping an unbounded payload", () => {
	const raw = z(...Array.from({ length: 10 }, (_, i) => `?? f${String(i).padStart(2, "0")}.txt`));
	const summary = summarize(raw, { repoRoot: "/repo", maxNodes: 4 });
	assert.equal(summary.truncated, true);
	assert.equal(summary.tree.total, 4);
	assert.equal(summary.changed, 10, "the true count survives truncation");
});

check("the finished tree is JSON-safe (no parent cycles)", () => {
	const raw = z(" M src/a/b/c.js", "?? d.md");
	const summary = summarize(raw, { repoRoot: "/repo" });
	const round = JSON.parse(JSON.stringify(summary));
	assert.equal(round.tree.total, 2);
	assert.equal(round.tree.children[0].children[0].children[0].children[0].path, "src/a/b/c.js");
});

check("an empty working tree yields an empty root, not an error", () => {
	const summary = summarize(z("## main"), { repoRoot: "/repo" });
	assert.equal(summary.changed, 0);
	assert.equal(summary.tree.total, 0);
	assert.deepEqual(summary.tree.children, []);
});

//#region history, graph, branches, reflog

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const M = "d".repeat(40);
const P1 = "e".repeat(40);
const P2 = "f".repeat(40);
const BASE = "1".repeat(40);
const X = "2".repeat(40);
const Y = "3".repeat(40);

check("reads a decoration list without guessing local from remote", () => {
	const refs = parseDecoration("HEAD -> feature/x, origin/main, feature/x, tag: v1.0");
	assert.deepEqual(refs, [
		{ kind: "head", name: "feature/x" },
		{ kind: "other", name: "origin/main" },
		{ kind: "other", name: "feature/x" },
		{ kind: "tag", name: "v1.0" }
	]);
	// A detached HEAD carries no branch name.
	assert.deepEqual(parseDecoration("HEAD, tag: v2"), [
		{ kind: "head", name: null },
		{ kind: "tag", name: "v2" }
	]);
	assert.deepEqual(parseDecoration(""), []);
});

check("parses a log stream into commits with parents, refs and subject", () => {
	const commits = parseLog(
		logStream(
			logRecord(M, "ddddddd", `${P1} ${P2}`, "ygp", "y@example.test", "2026-01-02T03:04:05+09:00", "HEAD -> main, tag: v1", "Merge branch 'topic'"),
			logRecord(P1, "eeeeeee", BASE, "ygp", "y@example.test", "2026-01-01T00:00:00+09:00", "", "fix: a thing")
		)
	);
	assert.equal(commits.length, 2);
	assert.equal(commits[0].sha, M);
	assert.deepEqual(commits[0].parents, [P1, P2]);
	assert.deepEqual(commits[0].refs, [
		{ kind: "head", name: "main" },
		{ kind: "tag", name: "v1" }
	]);
	assert.equal(commits[0].subject, "Merge branch 'topic'");
	assert.deepEqual(commits[1].parents, [BASE]);
	// A root commit has no parents at all, not a list holding an empty string.
	assert.deepEqual(parseLog(logStream(logRecord(C, "ccccccc", "", "a", "e", "d", "", "root")))[0].parents, []);
});

check("a truncated tail record is dropped rather than parsed as a commit", () => {
	const stream = logStream(logRecord(A, "aaaaaaa", B, "ygp", "y@example.test", "d", "", "kept")) + "fffffff\u001fdeadbe";
	const commits = parseLog(stream);
	assert.equal(commits.length, 1);
	assert.equal(commits[0].sha, A);
});

check("linear history stays in one lane", () => {
	const rows = assignLanes(parseLog(logStream(
		logRecord(A, "aaaaaaa", B, "a", "e", "d", "HEAD -> main", "third"),
		logRecord(B, "bbbbbbb", C, "a", "e", "d", "", "second"),
		logRecord(C, "ccccccc", "", "a", "e", "d", "", "first")
	)));
	assert.deepEqual(rows.map((row) => row.column), [0, 0, 0]);
	assert.deepEqual(rows.map((row) => row.width), [1, 1, 1]);
	// The middle commit sits on a lane that continues below it.
	assert.deepEqual(rows[1].through, [0]);
	// The root commit closes the lane, so nothing is drawn below it.
	assert.deepEqual(rows[2].parents, []);
	assert.deepEqual(rows[2].through, []);
	assert.deepEqual(rows[2].starts, []);
});

check("a merge opens a second lane and draws to both parents", () => {
	const rows = assignLanes(parseLog(logStream(
		logRecord(M, "ddddddd", `${P1} ${P2}`, "a", "e", "d", "HEAD -> main", "merge"),
		logRecord(P1, "eeeeeee", BASE, "a", "e", "d", "", "on main"),
		logRecord(P2, "fffffff", BASE, "a", "e", "d", "", "on topic"),
		logRecord(BASE, "1111111", "", "a", "e", "d", "", "base")
	)));
	// The merge lives in lane 0 and its second parent starts lane 1.
	assert.equal(rows[0].column, 0);
	assert.deepEqual(rows[0].columns, [0, 1]);
	assert.deepEqual(rows[0].starts, [1]);
	// The second parent walks in lane 1 while lane 0 passes through.
	assert.equal(rows[2].column, 1);
	assert.deepEqual(rows[2].through, [0]);
	// Both parents converge on BASE, which therefore stays in lane 0 only.
	assert.deepEqual(rows[2].columns, [0]);
	assert.deepEqual(rows[3].column, 0);
	assert.equal(rows[3].width, 1, "the extra lane is closed once its history converges");
});

check("two unrelated tips share the base lane", () => {
	const rows = assignLanes(parseLog(logStream(
		logRecord(X, "2222222", BASE, "a", "e", "d", "HEAD -> main", "x"),
		logRecord(Y, "3333333", BASE, "a", "e", "d", "topic", "y"),
		logRecord(BASE, "1111111", "", "a", "e", "d", "", "base")
	)));
	assert.deepEqual(rows.map((row) => row.column), [0, 1, 0]);
	// The second tip reaches down into the base lane rather than opening a third.
	assert.deepEqual(rows[1].columns, [0]);
	assert.deepEqual(rows[1].through, [0]);
});

check("a lane count beyond maxLanes is clamped, not thrown", () => {
	const commits = parseLog(logStream(
		...Array.from({ length: 40 }, (_, i) =>
			logRecord(String(i).padStart(40, "0"), "s", i === 39 ? "" : String(i + 1).padStart(40, "0"), "a", "e", "d", "", `c${i}`))
	));
	const rows = assignLanes(commits, { maxLanes: 4 });
	assert.ok(rows.every((row) => row.width <= 4 && row.column <= 3));
	assert.ok(rows.every((row) => row.columns.every((at) => at < 4)));
});

check("track text becomes ahead/behind/gone counts", () => {
	assert.deepEqual(parseTrack("ahead 2, behind 3"), { ahead: 2, behind: 3, gone: false });
	assert.deepEqual(parseTrack("ahead 1"), { ahead: 1, behind: 0, gone: false });
	assert.deepEqual(parseTrack(""), { ahead: 0, behind: 0, gone: false });
	assert.deepEqual(parseTrack("gone"), { ahead: 0, behind: 0, gone: true });
});

check("branches are told apart by full refname, current first", () => {
	const branches = parseBranches(branchStream(
		branchRecord("refs/remotes/origin/main", "origin/main", "aaaaaaa", " ", "", "", "2026-01-01T00:00:00+09:00", "remote tip"),
		branchRecord("refs/heads/topic", "topic", "bbbbbbb", " ", "origin/topic", "ahead 1", "2026-01-02T00:00:00+09:00", "work"),
		branchRecord("refs/heads/main", "main", "ccccccc", "*", "origin/main", "ahead 1, behind 2", "2026-01-03T00:00:00+09:00", "head")
	));
	assert.deepEqual(branches.map((branch) => branch.name), ["main", "topic", "origin/main"]);
	assert.equal(branches[0].current, true);
	assert.equal(branches[0].remote, false);
	assert.equal(branches[0].ahead, 1);
	assert.equal(branches[0].behind, 2);
	assert.equal(branches[1].upstream, "origin/topic");
	assert.equal(branches[2].remote, true, "a slash in the name must not decide this");
	assert.equal(branches[2].upstream, null);
});

check("a remote-tracking branch named like a local one is still remote", () => {
	// The regression this guards: `feature/x` is a legal LOCAL branch name.
	const branches = parseBranches(branchStream(
		branchRecord("refs/heads/feature/x", "feature/x", "aaaaaaa", "*", "", "", "", "local"),
		branchRecord("refs/remotes/origin/feature/x", "origin/feature/x", "bbbbbbb", " ", "", "", "", "remote")
	));
	assert.deepEqual(branches.map((b) => b.remote), [false, true]);
});

check("a branch whose upstream was deleted reports gone", () => {
	const branches = parseBranches(branchStream(
		branchRecord("refs/heads/stale", "stale", "aaaaaaa", "*", "origin/stale", "gone", "", "s")
	));
	assert.equal(branches[0].gone, true);
	assert.equal(branches[0].upstream, "origin/stale");
});

check("reflog subjects are split into an action and its detail", () => {
	// Selectors verbatim from real git under --date=iso-strict: the entry time
	// lives in the selector, and %aI would have reported the commit's author date.
	const entries = parseReflog(reflogStream(
		["aaaaaaa", "HEAD@{2026-01-03T00:00:00+09:00}", "rebase (finish): returning to refs/heads/topic"],
		["bbbbbbb", "HEAD@{2026-01-02T00:00:00+09:00}", "rebase (start): checkout main"],
		["ccccccc", "HEAD@{2026-01-01T00:00:00+09:00}", "commit: add the thing"],
		["ddddddd", "HEAD@{4}", "checkout: moving from main to topic"]
	));
	assert.equal(entries.length, 4);
	assert.equal(entries[0].action, "rebase (finish)");
	assert.equal(entries[0].subject, "returning to refs/heads/topic");
	assert.equal(entries[0].ref, "HEAD");
	assert.equal(entries[0].date, "2026-01-03T00:00:00+09:00");
	assert.equal(entries[0].index, null, "a dated selector carries no numeric index");
	assert.equal(entries[1].action, "rebase (start)");
	assert.equal(entries[2].action, "commit");
	assert.equal(entries[2].subject, "add the thing");
	// A plain selector still yields its index and reports no date.
	assert.equal(entries[3].index, 4);
	assert.equal(entries[3].date, null);
	// A subject with no colon keeps the whole text as the action.
	assert.equal(parseReflog(reflogStream(["e".repeat(7), "HEAD@{0}", "clone"]))[0].action, "clone");
});

check("recognizes an in-progress rebase, its branch, its target and its step", () => {
	// Verbatim shape from a real stopped rebase (tools/git-e2e-test.mjs pins it).
	const state = parseRepoState([
		"interactive rebase in progress; onto abc1234",
		"Last command done (2 commands done):",
		"   pick abc1234 base",
		"Next command to do (3 remaining commands):",
		"   pick def5678 next",
		"You are currently rebasing branch 'topic' on 'abc1234'."
	].join("\n"));
	assert.equal(state.kind, "rebase");
	assert.equal(state.branch, "topic");
	assert.equal(state.onto, "abc1234");
	// The done count includes the pick that conflicted, so it IS the current step.
	assert.equal(state.step, 2);
	assert.equal(state.total, 5);
});

check("a rebase with nothing left reports its final step, not step past the end", () => {
	// Also from the real probe: one pick, conflicted, nothing remaining.
	const state = parseRepoState([
		"interactive rebase in progress; onto 64319f9",
		"Last command done (1 command done):",
		"   pick 2d7dafe # topic",
		"No commands remaining.",
		"You are currently rebasing branch 'topic' on '64319f9'."
	].join("\n"));
	assert.equal(state.step, 1);
	assert.equal(state.total, 1, "step must never exceed total");
});

check("a rebase whose sentence is absent still reports onto", () => {
	const state = parseRepoState("interactive rebase in progress; onto deadbee\n");
	assert.equal(state.kind, "rebase");
	assert.equal(state.onto, "deadbee");
	assert.equal(state.step, null);
});

check("a conflicted merge is recognized from its abort hint alone", () => {
	// Verbatim from real git: there is NO "in the middle of a merge" sentence, so
	// the hint is the only thing that identifies this state.
	const state = parseRepoState([
		"On branch main",
		"You have unmerged paths.",
		'  (fix conflicts and run "git commit")',
		'  (use "git merge --abort" to abort the merge)',
		"",
		"Unmerged paths:",
		'  (use "git add <file>..." to mark resolution)',
		"\tboth modified:   a.txt"
	].join("\n"));
	assert.equal(state.kind, "merge", "the abort hint is the load-bearing signal");
});

check("recognizes cherry-pick and captures the commit it is applying", () => {
	// Also verbatim from real git.
	const state = parseRepoState([
		"On branch main",
		"You are currently cherry-picking commit 5ed5b7b.",
		'  (fix conflicts and run "git cherry-pick --continue")',
		'  (use "git cherry-pick --abort" to cancel the cherry-pick operation)'
	].join("\n"));
	assert.equal(state.kind, "cherry-pick");
	assert.equal(state.commit, "5ed5b7b");
});

check("recognizes revert, am, bisect and a bare rebase hint", () => {
	assert.equal(parseRepoState('  (use "git revert --abort" to cancel the revert operation)\n').kind, "revert");
	assert.equal(parseRepoState('  (use "git am --abort" to restore the original branch)\n').kind, "am");
	assert.equal(parseRepoState("You are currently reverting commit abc1234.\n").kind, "revert");
	assert.equal(parseRepoState("You are currently bisecting, started from branch 'main'.\n").kind, "bisect");
	assert.equal(parseRepoState('  (use "git rebase --abort" to check out the original branch)\n').kind, "rebase");
	// A cherry-pick's sha is captured whether or not the hint is present.
	assert.equal(parseRepoState("You are currently reverting commit deadbee.\n").commit, "deadbee");
});

check("an ordinary status reports no operation in progress", () => {
	const state = parseRepoState("On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit\n");
	assert.equal(state.kind, null);
	assert.equal(state.step, null);
});

check("history marks the commits that are still ahead of the base", () => {
	const history = buildHistory(
		logStream(
			logRecord(A, "aaaaaaa", B, "a", "e", "d", "HEAD -> topic", "ahead one"),
			logRecord(B, "bbbbbbb", C, "a", "e", "d", "", "ahead two"),
			logRecord(C, "ccccccc", "", "a", "e", "d", "main", "already in main")
		),
		{ aheadOf: new Set([A, B]) }
	);
	assert.equal(history.total, 3);
	assert.equal(history.truncated, false);
	assert.deepEqual(history.commits.map((commit) => commit.ahead), [true, true, false]);
	// The graph geometry survives the marking pass.
	assert.deepEqual(history.commits.map((commit) => commit.column), [0, 0, 0]);
});

check("history truncates a long log but still draws the visible window", () => {
	const recs = Array.from({ length: 10 }, (_, i) =>
		logRecord(String(i).padStart(40, "0"), "s", i === 9 ? "" : String(i + 1).padStart(40, "0"), "a", "e", "d", "", `c${i}`));
	const history = buildHistory(logStream(...recs), { maxCommits: 4 });
	assert.equal(history.total, 10);
	assert.equal(history.truncated, true);
	assert.equal(history.commits.length, 4);
	assert.deepEqual(history.commits.map((commit) => commit.column), [0, 0, 0, 0]);
});

//#endregion

//#region blame

/**
 * Build one `--line-porcelain` record.
 *
 * `--line-porcelain` repeats the metadata for EVERY line, which is the property the
 * parser relies on, so the fixture repeats it too.
 */
function blameRecord(sha, line, author, seconds, summary, content) {
	return [
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
}

check("parseBlame reads each record's commit, author and source line", () => {
	const raw = [blameRecord("a".repeat(40), 1, "Ann", 1767225845, "feat: one", "const a = 1;"), blameRecord("b".repeat(40), 2, "Bob", 1600000000, "fix: two", "let b = 2;")].join("\n");
	const { lines, truncated } = parseBlame(raw);
	assert.equal(truncated, false);
	assert.equal(lines.length, 2);
	assert.deepEqual(
		[...lines.map((line) => `${line.short} ${line.author} ${line.text}`)],
		["aaaaaaa Ann const a = 1;", "bbbbbbb Bob let b = 2;"]
	);
	assert.equal(lines[0].date, new Date(1767225845 * 1000).toISOString());
	assert.equal(lines[0].summary, "feat: one");
	assert.equal(lines[0].uncommitted, false);
});

check("parseBlame keeps a blank line and a line that itself begins with a tab", () => {
	// The leading TAB is a separator, so the content is everything after exactly one.
	const raw = [blameRecord("a".repeat(40), 1, "Ann", 1, "s", ""), blameRecord("a".repeat(40), 2, "Ann", 1, "s", "\tindented;")].join("\n");
	const { lines } = parseBlame(raw);
	assert.equal(lines.length, 2);
	assert.equal(lines[0].text, "");
	assert.equal(lines[1].text, "\tindented;");
});

check("parseBlame flags a line git has not committed yet", () => {
	const raw = blameRecord("0".repeat(40), 1, "Not Committed Yet", 1, "s", "new;");
	const { lines } = parseBlame(raw);
	assert.equal(lines[0].uncommitted, true);
	assert.equal(lines[0].short, "0000000");
});

check("parseBlame stops at maxLines and says so", () => {
	const raw = Array.from({ length: 10 }, (_, index) => blameRecord("a".repeat(40), index + 1, "Ann", 1, "s", `line ${index}`)).join("\n");
	const { lines, truncated } = parseBlame(raw, { maxLines: 3 });
	assert.equal(truncated, true);
	assert.equal(lines.length, 3);
	assert.equal(lines[2].text, "line 2");
});

check("parseBlame ignores text before the first record and a missing author-time", () => {
	const raw = ["warning: something", blameRecord("a".repeat(40), 1, "Ann", 1, "s", "x").replace(/^author-time 1\n/m, "")].join("\n");
	const { lines } = parseBlame(raw);
	assert.equal(lines.length, 1);
	assert.equal(lines[0].date, null, "an absent author-time must not invent a date");
	assert.equal(lines[0].author, "Ann");
});

check("summarizeBlame counts distinct commits and authors", () => {
	const raw = [
		blameRecord("a".repeat(40), 1, "Ann", 1767225845, "s", "one"),
		blameRecord("a".repeat(40), 2, "Ann", 1767225845, "s", "two"),
		blameRecord("b".repeat(40), 3, "Bob", 1600000000, "s", "three")
	].join("\n");
	const { lines } = parseBlame(raw);
	const summary = summarizeBlame(lines);
	assert.equal(summary.commits, 2, "two records share a commit");
	assert.deepEqual([...summary.authors], ["Ann", "Bob"]);
	assert.equal(summary.newest, new Date(1767225845 * 1000).toISOString());
});

check("summarizeBlame on an empty file reports nothing rather than throwing", () => {
	assert.deepEqual({ ...summarizeBlame([]) }, { commits: 0, authors: [], newest: null });
});

//#endregion

check("numstat keeps unusual paths, rename destinations and binary counts", () => {
	const stats = parseNumstatZ(z("12\t4\t日本語\tfile\n.js", "-\t-\timage.bin", "0\t0\t", "old name", "new name", "1\t0\t__proto__"));
	assert.deepEqual(stats.get("日本語\tfile\n.js"), { added: 12, deleted: 4, binary: false });
	assert.deepEqual(stats.get("image.bin"), { added: null, deleted: null, binary: true });
	assert.deepEqual(stats.get("new name"), { added: 0, deleted: 0, binary: false });
	assert.equal(stats.has("old name"), false);
	assert.equal(stats.get("__proto__").added, 1);
	assert.equal(parseNumstatZ("2\t1\tpartial").size, 0, "an unterminated record is incomplete");
	assert.equal(parseNumstatZ(z("0\t0\t", "old")).size, 0, "an incomplete rename has no destination");
});

console.log(`\nPASS  ${checks} checks`);
