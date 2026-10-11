/**
 * Pure git-status plumbing for the git-tree plugin.
 *
 * This file holds no DSH and no I/O: it turns `git status --porcelain=v1 -z`
 * output into a nested directory tree the sidebar can draw. Keeping it pure is
 * what lets `tools/git-parse-test.mjs` exercise the whole data shape without
 * booting a Host or touching a repository.
 *
 * The one rule that shapes everything below: paths come out of git relative to
 * the repository root, NOT relative to the session's working directory, so the
 * tree is rooted at the repository and the caller learns that root separately.
 */

/** Status pairs git reports for an unmerged path. */
const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/**
 * Map one porcelain `XY` pair to the single state the UI paints.
 *
 * `X` is the index (staged) side and `Y` the worktree side. A path can be dirty
 * on both sides at once (`MM`), which is why the flags are reported next to the
 * state instead of being folded into it.
 *
 * @param index - the `X` status letter.
 * @param worktree - the `Y` status letter.
 * @returns the display state plus its staged/unstaged flags.
 */
export function classify(index, worktree) {
	if (index === "?" && worktree === "?") {
		return { state: "untracked", staged: false, unstaged: true };
	}
	if (index === "!" && worktree === "!") {
		return { state: "ignored", staged: false, unstaged: false };
	}
	if (UNMERGED.has(index + worktree)) {
		return { state: "conflicted", staged: true, unstaged: true };
	}
	const staged = index !== " " && index !== "?";
	const unstaged = worktree !== " " && worktree !== "?";
	// When both sides are dirty the index letter describes the more actionable
	// change (` D` after `M ` is a deletion the user staged a modification of).
	const letter = staged ? index : worktree;
	const byLetter = {
		A: "added",
		D: "deleted",
		R: "renamed",
		C: "copied",
		T: "typechange",
		M: "modified"
	};
	return { state: byLetter[letter] ?? "modified", staged, unstaged };
}

/**
 * Parse `git status --porcelain=v1 -z` output.
 *
 * The `-z` form is used deliberately: paths arrive verbatim (no C-quoting, so
 * non-ASCII and spaced paths need no unescaping), at the cost of two parsing
 * details handled here:
 *
 *  - with `--branch`, the first record is a `## …` header, not an `XY` entry;
 *  - a rename/copy entry is followed by one extra record holding the source path.
 *
 * @param raw - the command's stdout.
 * @returns the branch header plus one record per changed path.
 */
export function parseStatusZ(raw) {
	const fields = String(raw).split("\0");
	const entries = [];
	const header = { branch: null, upstream: null, ahead: 0, behind: 0, detached: false, unborn: false };

	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];
		if (field === "") continue;

		if (field.startsWith("## ")) {
			readBranchHeader(field.slice(3), header);
			continue;
		}
		if (field.length < 4) continue;

		const index = field[0];
		const worktree = field[1];
		const path = field.slice(3);
		let origPath = null;
		if (index === "R" || index === "C") {
			const next = fields[i + 1];
			if (next !== undefined && next !== "") {
				origPath = next;
				i++;
			}
		}
		entries.push({ path, origPath, index, worktree, ...classify(index, worktree) });
	}
	return { ...header, entries };
}

/** Read --numstat -z without quoting paths; renames carry two extra NUL fields. */
export function parseNumstatZ(raw) {
	const fields = String(raw).split("\0");
	const stats = new Map();
	for (let i = 0; i < fields.length - 1; i++) {
		const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[i]);
		if (match === null) continue;
		let path = match[3];
		if (path === "") {
			if (i + 2 >= fields.length - 1) break;
			path = fields[i + 2];
			i += 2;
		}
		if (path === "") continue;
		const binary = match[1] === "-" || match[2] === "-";
		stats.set(path, { added: binary ? null : Number(match[1]), deleted: binary ? null : Number(match[2]), binary });
	}
	return stats;
}

/**
 * Read the `## …` branch header into `header`, in place.
 *
 * The header is one of `## main...origin/main [ahead 1, behind 2]`, `## main`,
 * `## HEAD (no branch)` (detached), or `## No commits yet on main` (unborn).
 *
 * @param text - the header without its leading `## `.
 * @param header - the record to fill.
 */
function readBranchHeader(text, header) {
	if (text.startsWith("HEAD (no branch)")) {
		header.detached = true;
		header.branch = "HEAD";
		return;
	}
	if (text.startsWith("No commits yet on ")) {
		header.unborn = true;
		header.branch = text.slice("No commits yet on ".length);
		return;
	}
	const bracket = text.indexOf(" [");
	const head = bracket === -1 ? text : text.slice(0, bracket);
	const tail = bracket === -1 ? "" : text.slice(bracket + 2, text.endsWith("]") ? -1 : undefined);
	const dots = head.indexOf("...");
	header.branch = dots === -1 ? head : head.slice(0, dots);
	header.upstream = dots === -1 ? null : head.slice(dots + 3);
	for (const match of tail.matchAll(/(ahead|behind) (\d+)/g)) {
		if (match[1] === "ahead") header.ahead = Number(match[2]);
		else header.behind = Number(match[2]);
	}
}

/** Natural, case-insensitive comparison so `file2` sorts before `file10`. */
function compareNames(a, b) {
	return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/**
 * Build the nested tree the sidebar renders from a flat entry list.
 *
 * Directories are created on demand and each one carries rolled-up counts, so a
 * collapsed directory can still say how much is inside it. Directory and file
 * counts are capped: a repository with more changed paths than `maxNodes` keeps
 * its first `maxNodes` files in display order and reports `truncated` rather
 * than shipping an unbounded payload to the browser.
 *
 * @param entries - records from {@link parseStatusZ}.
 * @param options - `repoRoot` names the root node; `maxNodes` bounds file nodes.
 * @returns the root node plus a `truncated` flag.
 */
export function buildTree(entries, options = {}) {
	const repoRoot = options.repoRoot ?? "";
	const maxNodes = options.maxNodes ?? 5000;
	const root = makeDir(baseName(repoRoot) || repoRoot || "/", "");
	const directories = new Map([["", root]]);
	let truncated = false;

	// Sort first so truncation keeps a stable, readable prefix of the tree.
	const ordered = [...entries].sort((a, b) => compareNames(a.path, b.path));

	for (const entry of ordered) {
		const segments = entry.path.split("/").filter((segment) => segment !== "");
		if (segments.length === 0) continue;

		let parent = root;
		let prefix = "";
		for (let i = 0; i < segments.length - 1; i++) {
			prefix = prefix === "" ? segments[i] : `${prefix}/${segments[i]}`;
			let directory = directories.get(prefix);
			if (directory === undefined) {
				directory = makeDir(segments[i], prefix);
				directory.parent = parent;
				directories.set(prefix, directory);
				parent.children.push(directory);
			}
			parent = directory;
		}

		if (root.total >= maxNodes) {
			truncated = true;
			break;
		}
		const name = segments[segments.length - 1];
		const file = {
			type: "file",
			name,
			path: entry.path,
			origPath: entry.origPath,
			state: entry.state,
			index: entry.index,
			worktree: entry.worktree,
			staged: entry.staged,
			unstaged: entry.unstaged
		};
		if (options.stats !== undefined) {
			file.changes = { index: options.stats.index.get(entry.path) ?? null, worktree: options.stats.worktree.get(entry.path) ?? null };
		}
		file.parent = parent;
		parent.children.push(file);
		countUp(parent, entry.state);
	}

	return { root, truncated };
}

/** Create an empty directory node. */
function makeDir(name, path) {
	return { type: "dir", name, path, children: [], counts: {}, total: 0 };
}

/** Roll one file's state up through its ancestors. */
function countUp(node, state) {
	for (let current = node; current !== undefined; current = current.parent) {
		current.counts[state] = (current.counts[state] ?? 0) + 1;
		current.total += 1;
	}
}

/** The final path segment, used to label the repository root node. */
function baseName(path) {
	const trimmed = String(path).replace(/\/+$/, "");
	const cut = trimmed.lastIndexOf("/");
	return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

/** Drop the `parent` back-references before the tree crosses the wire. */
export function stripParents(node) {
	const { parent, ...rest } = node;
	if (rest.children !== undefined) rest.children = rest.children.map(stripParents);
	return rest;
}

/** Sort + detach: the form that is safe to return from a Remote method. */
export function finishTree(root) {
	sortRecursive(root);
	return stripParents(root);
}

/** Sort each level directories-first, then by natural name. */
function sortRecursive(node) {
	if (node.children === undefined) return;
	node.children.sort((a, b) => {
		if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
		return compareNames(a.name, b.name);
	});
	for (const child of node.children) sortRecursive(child);
}

/**
 * Assemble the whole payload the tab renders: repository identity, the branch
 * header, and the tree.
 *
 * @param raw - stdout of `git status --porcelain=v1 -z --branch`.
 * @param options - `repoRoot` and `maxNodes`, as for {@link buildTree}.
 */
export function summarize(raw, options = {}) {
	const parsed = parseStatusZ(raw);
	const { root, truncated } = buildTree(parsed.entries, options);
	return {
		repoRoot: options.repoRoot ?? "",
		branch: parsed.branch,
		upstream: parsed.upstream,
		ahead: parsed.ahead,
		behind: parsed.behind,
		detached: parsed.detached,
		unborn: parsed.unborn,
		changed: parsed.entries.length,
		truncated,
		tree: finishTree(root)
	};
}

//#region history

/** Field and record separators for every record-oriented git format below. */
const FIELD = "\u001f";
const RECORD = "\u001e";

/**
 * `git log` format. `%H`/`%P` carry the shape of the graph; `%D` the labels.
 *
 * `%x1f` and `%x1e` are git's own escapes for the two separators, and neither
 * byte can occur in a commit message, so no record ever needs quoting.
 */
export const LOG_FORMAT = `%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1e`;

/**
 * `git for-each-ref` format for branches.
 *
 * Unlike `git log`, ref-filter does not understand `%x1f`, so the separators are
 * embedded as literal control bytes — safe because a refname may not contain one
 * (git forbids control characters, space, and `~^:?*[\`).
 */
export const BRANCH_FORMAT =
	[
		"%(refname)", // full name: tells a local branch from a remote-tracking one
		"%(refname:short)",
		"%(objectname:short)",
		"%(HEAD)",
		"%(upstream:short)",
		"%(upstream:track,nobracket)",
		"%(committerdate:iso-strict)",
		"%(contents:subject)"
	].join(FIELD) + RECORD;

/**
 * `git reflog` format: the commit, the selector, and the subject.
 *
 * The entry's own time is carried by `%gd` under `--date=iso-strict`, NOT by
 * `%aI`: with `-g`, `%aI` still reports the commit's author date, so a rebase
 * entry pointing at an old commit would be stamped with that old date. Verified
 * against real git — the two disagree whenever a commit was written earlier.
 */
export const REFLOG_FORMAT = `%h%x1f%gd%x1f%gs%x1e`;

/** Split a record-oriented stream into non-empty records. */
function records(raw) {
	return String(raw)
		.split(RECORD)
		.map((record) => record.replace(/^\n+/, ""))
		.filter((record) => record !== "");
}

/**
 * Read a `%D` decoration list into refs.
 *
 * Only two kinds are decided here: `HEAD -> branch` and `tag: name`. Whether a
 * bare name is a local branch or a remote-tracking one cannot be told from the
 * short form (a local branch may legitimately be called `feature/x`), so those
 * arrive as `other` and the caller resolves them against the branch list.
 *
 * @param text - the `%D` field.
 */
export function parseDecoration(text) {
	const refs = [];
	for (const raw of String(text).split(", ")) {
		const item = raw.trim();
		if (item === "") continue;
		if (item.startsWith("HEAD -> ")) refs.push({ kind: "head", name: item.slice("HEAD -> ".length) });
		else if (item === "HEAD") refs.push({ kind: "head", name: null });
		else if (item.startsWith("tag: ")) refs.push({ kind: "tag", name: item.slice("tag: ".length) });
		else refs.push({ kind: "other", name: item });
	}
	return refs;
}

/**
 * Parse `git log --format=<LOG_FORMAT>` output, newest first.
 *
 * @param raw - the command's stdout.
 * @returns one record per commit, parents still as shas.
 */
export function parseLog(raw) {
	const commits = [];
	for (const record of records(raw)) {
		const [sha, short, parents, author, email, date, decoration, subject] = record.split(FIELD);
		// A bounded stdout can cut the stream mid-record. Truncation always costs
		// the TRAILING fields, so a missing subject (which may legitimately be empty
		// but never absent) is what identifies a partial record.
		if (sha === undefined || subject === undefined || !/^[0-9a-f]{7,64}$/.test(sha)) continue;
		commits.push({
			sha,
			short: short ?? sha.slice(0, 7),
			parents: parents === undefined || parents === "" ? [] : parents.split(" ").filter(Boolean),
			author: author ?? "",
			email: email ?? "",
			date: date ?? "",
			refs: parseDecoration(decoration ?? ""),
			subject: subject ?? ""
		});
	}
	return commits;
}

/**
 * Lay commits out in lanes so the History view can draw a graph.
 *
 * The walk keeps one lane per commit it is still waiting to see. Reaching a
 * commit claims the lane that was waiting for it (or the leftmost free lane),
 * and that lane then waits for the commit's first parent — which is what makes a
 * branch read as a straight line. Extra parents (a merge) open lanes of their
 * own, and once two lanes wait for the same commit the right-hand one is
 * dropped, so a merge does not fan out forever.
 *
 * The result is geometry only: `column` is the commit's own lane, `through` are
 * lanes that pass this row untouched, `ends` are lanes that merge into this
 * commit from above, `starts` are lanes that leave it below, and `parents` are
 * the lanes its parents now occupy.
 *
 * @param commits - records from {@link parseLog}, newest first.
 * @param options - `maxLanes` bounds the reported width.
 */
export function assignLanes(commits, options = {}) {
	const maxLanes = options.maxLanes ?? 24;
	/** Lane index -> the sha that lane is waiting for, or null when free. */
	const lanes = [];
	const rows = [];

	const freeLane = () => {
		const at = lanes.indexOf(null);
		return at === -1 ? lanes.length : at;
	};

	for (const commit of commits) {
		const before = lanes.slice();

		let column = lanes.indexOf(commit.sha);
		if (column === -1) {
			column = freeLane();
			lanes[column] = commit.sha;
		}

		// The lane now waits for the first parent; extra parents need their own.
		const [first, ...rest] = commit.parents;
		lanes[column] = first ?? null;
		for (const parent of rest) {
			if (lanes.indexOf(parent) === -1) lanes[freeLane()] = parent;
		}

		// Collapse lanes that wait for the same commit, keeping the leftmost, so a
		// merge's two histories share one line from here on.
		for (let i = 0; i < lanes.length; i++) {
			if (lanes[i] === null) continue;
			for (let j = i + 1; j < lanes.length; j++) {
				if (lanes[j] === lanes[i]) lanes[j] = null;
			}
		}
		while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

		const after = lanes.slice();
		const width = Math.min(Math.max(before.length, after.length, column + 1), maxLanes);
		const through = [];
		const ends = [];
		const starts = [];
		for (let i = 0; i < width; i++) {
			const had = before[i] !== undefined && before[i] !== null;
			const has = after[i] !== undefined && after[i] !== null;
			if (had && has) through.push(i);
			else if (had && i !== column) ends.push(i);
			else if (!had && has && i !== column) starts.push(i);
		}

		// Resolved after the collapse, so a lane that was dropped is never drawn.
		const parents = commit.parents.map((parent) => lanes.indexOf(parent)).filter((at) => at !== -1 && at < maxLanes);

		rows.push({
			...commit,
			column: Math.min(column, maxLanes - 1),
			width,
			through,
			ends,
			starts,
			columns: parents
		});
	}
	return rows;
}

/**
 * Read `%(upstream:track,nobracket)` into counts.
 *
 * The field is `ahead 1, behind 2`, `gone` when the upstream was deleted, or
 * empty when the branch has no upstream or is level with it.
 *
 * @param text - the track field.
 */
export function parseTrack(text) {
	const track = { ahead: 0, behind: 0, gone: false };
	for (const match of String(text).matchAll(/(ahead|behind) (\d+)/g)) {
		if (match[1] === "ahead") track.ahead = Number(match[2]);
		else track.behind = Number(match[2]);
	}
	if (String(text).trim() === "gone") track.gone = true;
	return track;
}

/**
 * Parse `git for-each-ref --format=<BRANCH_FORMAT>` output.
 *
 * @param raw - the command's stdout.
 * @returns one record per branch, local or remote-tracking.
 */
export function parseBranches(raw) {
	const branches = [];
	for (const record of records(raw)) {
		const [full, name, sha, head, upstream, track, date, subject] = record.split(FIELD);
		if (name === undefined || name === "") continue;
		const counts = parseTrack(track ?? "");
		branches.push({
			name,
			short: sha ?? "",
			current: head === "*",
			// Decided from the full refname, which is the only unambiguous source.
			remote: (full ?? "").startsWith("refs/remotes/"),
			upstream: upstream === undefined || upstream === "" ? null : upstream,
			ahead: counts.ahead,
			behind: counts.behind,
			gone: counts.gone,
			date: date ?? "",
			subject: subject ?? ""
		});
	}
	// Current first, then local before remote, then by name.
	return branches.sort((a, b) => {
		if (a.current !== b.current) return a.current ? -1 : 1;
		if (a.remote !== b.remote) return a.remote ? 1 : -1;
		return compareNames(a.name, b.name);
	});
}

/**
 * Parse `git reflog --format=<REFLOG_FORMAT>` output.
 *
 * This is what makes a rebase traceable after the fact: the subject reads
 * `rebase (start): checkout main`, `commit: …`, `reset: moving to …`, so the
 * action is everything before the first colon.
 *
 * @param raw - the command's stdout.
 */
export function parseReflog(raw) {
	const entries = [];
	for (const record of records(raw)) {
		const [short, selector, subject] = record.split(FIELD);
		if (selector === undefined || selector === "") continue;
		const text = subject ?? "";
		const colon = text.indexOf(":");

		// The selector is `HEAD@{0}` by default and `HEAD@{<iso date>}` under
		// `--date`, so the time is read out of it rather than from a separate field.
		const open = selector.indexOf("@{");
		const close = selector.lastIndexOf("}");
		const inner = open === -1 || close <= open ? "" : selector.slice(open + 2, close);
		entries.push({
			short: short ?? "",
			selector,
			ref: open === -1 ? selector : selector.slice(0, open),
			date: /^\d{4}-\d{2}-\d{2}T/.test(inner) ? inner : null,
			index: /^\d+$/.test(inner) ? Number(inner) : null,
			action: colon === -1 ? text : text.slice(0, colon),
			subject: colon === -1 ? "" : text.slice(colon + 1).trim()
		});
	}
	return entries;
}

/**
 * Read the operation a repository is in the middle of, from `git status` prose.
 *
 * Long-form `git status` is the one place git states this in text; the porcelain
 * formats omit it.
 *
 * The load-bearing signal is the ABORT HINT. Whenever an operation is in
 * progress git offers `(use "git <op> --abort" …)`, and that is the only marker
 * common to all of them — a conflicted merge, verified against real git, prints
 * `You have unmerged paths.` and the hint but no "in the middle of a merge"
 * sentence at all. The per-operation sentences are kept only as a fallback and
 * as a source of detail.
 *
 * @param text - stdout of a long-form `git status`.
 */
export function parseRepoState(text) {
	const state = { kind: null, branch: null, onto: null, commit: null, step: null, total: null };
	const body = String(text);

	const abort = body.match(/git (merge|rebase|cherry-pick|revert|am) --abort/);
	if (abort !== null) state.kind = abort[1];
	else if (/currently rebasing/.test(body) || /rebase in progress; onto /.test(body)) state.kind = "rebase";
	else if (/currently cherry-picking/.test(body)) state.kind = "cherry-pick";
	else if (/currently reverting/.test(body)) state.kind = "revert";
	else if (/currently bisecting/.test(body)) state.kind = "bisect";
	else if (/in the middle of an? am session/.test(body)) state.kind = "am";

	// One commit is being applied on top of another: name it, and the branch and
	// target a rebase is moving.
	const picking = body.match(/currently (?:cherry-picking|reverting) commit (\S+?)\./);
	if (picking !== null) state.commit = picking[1];
	const rebasing = body.match(/currently rebasing branch '([^']*)' on '([^']*)'/);
	if (rebasing !== null) {
		state.branch = rebasing[1];
		state.onto = rebasing[2];
	} else {
		// An interactive rebase always opens with `interactive rebase in progress;
		// onto <sha>`, which survives even when the sentence below it does not.
		const onto = body.match(/rebase in progress; onto (\S+)/);
		if (onto !== null) state.onto = onto[1];
	}

	// Progress reads as "Last command done (1 command done):" plus either "Next
	// command to do (2 remaining commands):" or "No commands remaining.". The
	// done count INCLUDES the command that just conflicted — verified against a
	// real stopped rebase — so the current step is that count, not one past it.
	const done = body.match(/\((\d+) commands? done\)/);
	const remaining = body.match(/\((\d+) remaining commands?\)/);
	if (done !== null) {
		const finished = Number(done[1]);
		state.step = finished;
		state.total = finished + (remaining === null ? 0 : Number(remaining[1]));
	}
	return state;
}

/**
 * Assemble the History payload: commits laid out in lanes, each marked with
 * whether it is still ahead of the base branch.
 *
 * @param raw - stdout of `git log --format=<LOG_FORMAT>`.
 * @param options - `aheadOf` is a Set of shas not yet in the base branch;
 *   `maxCommits` and `maxLanes` bound the payload and the graph width.
 */
export function buildHistory(raw, options = {}) {
	const aheadOf = options.aheadOf ?? new Set();
	const maxCommits = options.maxCommits ?? 300;
	const commits = parseLog(raw);
	// Only the visible window is laid out, so a bounded log still yields a graph.
	const window = commits.slice(0, maxCommits);
	const rows = assignLanes(window, { maxLanes: options.maxLanes ?? 24 });
	return {
		commits: rows.map((row) => ({ ...row, ahead: row.sha !== undefined && aheadOf.has(row.sha) })),
		total: commits.length,
		truncated: commits.length > window.length
	};
}

//#endregion

//#region blame

/**
 * Parse `git blame --line-porcelain`.
 *
 * `--line-porcelain` repeats the FULL commit metadata for every line (unlike
 * `--porcelain`, which elides it after the first line of a group), so one pass
 * yields everything the view shows without a second lookup per distinct commit.
 *
 * A record is a header line naming the commit and the line numbers, then metadata
 * lines, then the source line prefixed with a TAB. The prefix — not a delimiter —
 * is why the content is taken with `slice(1)`: a line that legitimately begins with
 * a TAB keeps it.
 *
 * Reading stops at `maxLines`, and `truncated` says so; a `git blame` on a very
 * large file would otherwise fill the sidebar with rows nobody scrolls to.
 *
 * @param raw - the command's stdout.
 * @param options - `maxLines` (default 4000).
 * @returns `{lines, truncated}` where each line is
 *   `{sha, short, author, date, summary, uncommitted, text}`.
 */
export function parseBlame(raw, options = {}) {
	const maxLines = options.maxLines ?? 4000;
	const lines = [];
	let current = null;

	for (const text of String(raw).split("\n")) {
		if (text.startsWith("\t")) {
			// The content line closes the record. Anything before the first header is
			// not part of a record and is ignored rather than mis-attributed.
			if (current !== null) {
				current.text = text.slice(1);
				lines.push(current);
				current = null;
				if (lines.length >= maxLines) return { lines, truncated: true };
			}
			continue;
		}

		// `<sha> <orig-line> <final-line> [<group-size>]`
		if (/^[0-9a-f]{7,64} \d+ \d+(?: \d+)?$/.test(text)) {
			const sha = text.slice(0, text.indexOf(" "));
			current = {
				sha,
				short: sha.slice(0, 7),
				author: "",
				date: null,
				summary: "",
				// A line git has not committed yet is blamed on an all-zero sha.
				uncommitted: /^0+$/.test(sha),
				text: ""
			};
			continue;
		}

		if (current === null) continue;
		if (text.startsWith("author-time ")) {
			const seconds = Number(text.slice("author-time ".length));
			current.date = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
		} else if (text.startsWith("author ")) {
			current.author = text.slice("author ".length);
		} else if (text.startsWith("summary ")) {
			current.summary = text.slice("summary ".length);
		}
	}

	return { lines, truncated: false };
}

/**
 * Who owns a blamed file, in the terms a header can show.
 *
 * @param lines - the output of {@link parseBlame}.
 * @returns `{commits, authors, newest}`: the number of distinct commits that last
 *   touched a line, the distinct author names, and the most recent author date.
 */
export function summarizeBlame(lines) {
	const commits = new Set();
	const authors = new Set();
	let newest = null;
	for (const line of lines) {
		commits.add(line.sha);
		if (line.author !== "") authors.add(line.author);
		if (line.date !== null && (newest === null || line.date > newest)) newest = line.date;
	}
	return { commits: commits.size, authors: [...authors].sort(), newest };
}

//#endregion
