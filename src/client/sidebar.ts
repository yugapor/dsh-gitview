// @ts-nocheck -- moved verbatim from the hand-written bundle; type it when it is next changed.
import { react, primitives, h } from "./deps";
import { VIEWS } from "./model";
import { ciInterval, readLayout, saveLayout, useGitActions, useLiveLoad, useLoad } from "./data";
import { diffPane, operationBanner, placeholder, viewTab } from "./chrome";
import { BlameView, BranchesView, HistoryView, ReflogView, StatusView } from "./views";
import { CIView, ciSummary } from "./ci";

/** This implementation's identity in the tab system, and its body's slot key. */
export const TAB_ID = "dsh-gitview";
/** The tab kind this package owns. */
export const TAB_KIND = "git-tree";

/**
 * The tab type's static declaration.
 *
 * `keepMounted` retains the views across tab and Session switches so the
 * scroll position, the open view and the loaded data survive. `guide` gets one
 * entry: the sidebar's Start page draws one button per entry, and `order` 20
 * seats Git between the shipped Files (10) and Terminal entries.
 *
 * @param t - namespace-bound translate, re-read on every label call.
 */
export function gitTreeDefinition(t) {
	return {
		id: TAB_ID,
		kind: TAB_KIND,
		priority: "extension",
		keepMounted: true,
		title: () => t("type.label"),
		guide: [
			{
				id: TAB_KIND,
				order: 20,
				title: () => t("guide.title"),
				description: () => t("guide.description")
			}
		]
	};
}


/**
 * The tab's body.
 *
 * Framework props (`useTabInfo`, `sessionId`, `useSessions`, `t`) arrive from
 * the slot runtime; the `load*` / `mutate` share is the business half injected
 * at registration.
 */

export function GitTreeBody({
	useTabInfo,
	sessionId,
	useSessions,
	t,
	loadStatus,
	loadHistory,
	loadBranches,
	loadReflog,
	loadBlame,
	loadDiff,
	loadCI,
	loadAuth,
	askAI,
	generateMessage,
	mutate
}) {
	const { tab } = useTabInfo();
	const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);

	const [view, setView] = react.useState("status");
	const [statusNonce, setStatusNonce] = react.useState(0);
	const [dataNonce, setDataNonce] = react.useState(0);
	const [collapsed, setCollapsed] = react.useState(() => new Set());
	const [detail, setDetail] = react.useState(null);
	const adopt = react.useRef(null);
	const { busy, notice, setNotice, message, setMessage, generating, generatedModel, runMutation, onCommit, onGenerate } =
		useGitActions({ sessionId, signal: tab.signal, t, mutate, generateMessage, adopt });
	// The Blame view is the one view about a PATH rather than the repository, so
	// the typed draft and the requested path are separate: only `blamePath` is
	// ever fetched, and only when the view is on screen.
	const [blameDraft, setBlameDraft] = react.useState("");
	const [blamePath, setBlamePath] = react.useState("");
	const [wrapped, setWrapped] = react.useState(false);
	const [layout, setLayout] = react.useState(readLayout);
	const paneRef = react.useRef(null);
	const [wide, setWide] = react.useState(false);
	react.useEffect(() => {
		if (!detail || !paneRef.current || typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 800));
		observer.observe(paneRef.current);
		return () => observer.disconnect();
	}, [detail !== null]);
	const [copied, setCopied] = react.useState(false);
	const [ciRemote, setCIRemote] = react.useState("");
	const [authNonce, setAuthNonce] = react.useState(0);
	const [filters, setFilters] = react.useState({});
	const [searchCollapsed, setSearchCollapsed] = react.useState(() => new Set());
	const filter = (filters[view] ?? "").trim().toLowerCase();
	react.useEffect(() => setSearchCollapsed(new Set()), [filter, view]);
	const [expanded, setExpanded] = react.useState({});
	const [paneHeight, setPaneHeight] = react.useState(55);
	const [hunk, setHunk] = react.useState(-1);
	const statusKey = cwd === undefined ? null : `status:${sessionId}:${cwd}:${statusNonce}`;

	// The status is read whichever view is on screen: it carries the operation
	// banner, and a rebase must be visible from every view. The other three are
	// fetched only when their view is active.
	const [status, setStatus] = useLiveLoad(
		statusKey,
		(signal) => loadStatus(sessionId, signal), tab.signal, 3000, busy || tab.visible === false, true
	);
	// The mutation already returned the new status, so adopt it: the tree updates
	// without a second round trip or a loading flash. The other views are re-read
	// on their next activation.
	adopt.current = (value) => {
		setStatus({ phase: "ready", key: statusKey, value, updatedAt: Date.now() });
		setDataNonce((n) => n + 1);
	};
	const [history] = useLoad(view === "history" ? `history:${sessionId}:${cwd}:${dataNonce}` : null, () =>
		loadHistory(sessionId, tab.signal)
	);
	const [branches] = useLoad(view === "branches" ? `branches:${sessionId}:${cwd}:${dataNonce}` : null, () =>
		loadBranches(sessionId, tab.signal)
	);
	const [reflog] = useLoad(view === "reflog" ? `reflog:${sessionId}:${cwd}:${dataNonce}` : null, () =>
		loadReflog(sessionId, tab.signal)
	);
	// A path is required before there is anything to ask for, so the key stays
	// null until one has been chosen.
	const [blame] = useLoad(
		view === "blame" && blamePath !== "" ? `blame:${sessionId}:${blamePath}:${dataNonce}` : null,
		() => loadBlame(sessionId, blamePath, tab.signal)
	);
	const [ci] = useLiveLoad(status.value?.kind === "ready" && cwd !== undefined ? `ci:${sessionId}:${cwd}:${ciRemote}:${dataNonce}` : null,
		(signal) => loadCI(sessionId, ciRemote, signal), tab.signal, ciInterval, tab.visible === false);
	const [patch] = useLiveLoad(detail ? JSON.stringify([sessionId, cwd, detail.scope, detail.path, detail.rev, dataNonce]) : null,
		(signal) => loadDiff(sessionId, detail.path, detail.scope, detail.rev, signal), tab.signal, detail?.scope === "commit" ? Infinity : 3000, busy || tab.visible === false);
	const [auth] = useLoad(view === "ci" && authNonce > 0 ? `auth:${sessionId}:${ciRemote}:${authNonce}` : null,
		() => loadAuth(sessionId, ciRemote, tab.signal));

	const statusState = cwd === undefined ? { phase: "no-workspace" } : status;
	const ready = statusState.phase === "ready" && statusState.value?.kind === "ready" ? statusState.value : null;
	// Normalized here as well as guarded in the banner: a payload from an older
	// Host half has no `state` at all.
	const operation = ready === null ? null : (ready.state ?? null);

	const refresh = react.useCallback(() => {
		setStatusNonce((n) => n + 1);
		setDataNonce((n) => n + 1);
		setNotice(null);
	}, []);

	// The refresh command the sidebar's own chrome and shortcuts invoke.
	react.useEffect(() => tab.actions.bindCommands({ refresh }), [tab.actions, refresh]);

	// A selected path belongs to one session, repository and view.
	react.useEffect(() => setDetail(null), [sessionId, cwd, view]);
	react.useEffect(() => setHunk(-1), [detail?.scope, detail?.path, detail?.rev]);

	// A path is relative to one repository, so a different session starts empty
	// rather than blaming the same relative path somewhere else.
	react.useEffect(() => {
		setBlamePath("");
		setBlameDraft("");
		setCIRemote("");
		setAuthNonce(0);
		setFilters({});
		setExpanded({});
	}, [sessionId, cwd]);

	/** Load a patch into the pane below the list. */
	const openDiff = react.useCallback(
		(scope, path, rev, label, sha) => {
			// `sha` is carried on every phase so the History row stays marked
			// while its patch is still arriving.
			setDetail({ scope, path, rev, label, sha });
		},
		[]
	);

	/**
	 * Show one file's blame.
	 *
	 * Blame is a whole view rather than a pane because it is about the file, not
	 * about one change to it; the patch pane hands its path over, which is the
	 * gesture a reader makes after asking "who wrote this line?".
	 */
	const showBlame = react.useCallback((path) => {
		setBlamePath(path);
		setBlameDraft(path);
		setView("blame");
	}, []);

	/** Which diff scope a file row should open by default. */
	const openFileDiff = react.useCallback(
		(node, scope) => {
			// Open exactly the side whose counts and selection the section displays.
			openDiff(scope, node.path, "", node.path);
		},
		[openDiff]
	);

	//#region header
	const header = h(
		"div",
		{
			key: "header",
			className: "gt_header"
		},
		h("div", { className: "gt_repo" },
			h("div", { className: "gt_branch" },
				h(primitives.IconBranchOutlineRegular, { className: "gt_icon" }),
				h("span", { className: "gt_name", title: ready?.branch }, ready?.detached ? t("detached") : ready?.branch ?? "Git"),
				ready?.unborn ? h(primitives.Tag, { tone: "neutral" }, t("unborn")) : null),
			ready === null ? null : h("div", { className: "gt_repoPath", title: ready.repoRoot }, ready.repoRoot),
			ready?.base?.ahead > 0 ? h("div", { className: "gt_meta" }, t("aheadOfBase").replace("{n}", String(ready.base.ahead)).replace("{base}", ready.base.name)) : null),
		ci.value ? h(primitives.Button, { variant: "ghost", size: "sm", onClick: () => setView("ci"), title: ci.pollError ? t("ci.stale") : ci.updatedAt ? t("lastChecked").replace("{time}", new Date(ci.updatedAt).toLocaleTimeString()) : t("view.ci"),
			children: h("span", { className: "gt_ciBadge" }, "CI", ci.pollError || ci.value.kind !== "ready" ? " · !" : ciSummary(ci.value, t)) }) : null,
		h(primitives.Button, { key: "refresh", variant: "ghost", size: "sm", onClick: refresh, children: t("refresh") })
	);

	const tabs = h(
		"div",
		{ key: "tabs", className: "gt_views", role: "group", "aria-label": t("guide.title") },
		VIEWS.map((id) => viewTab(id, view === id, setView, t))
	);
	//#endregion

	// A repository that cannot be read has nothing to switch between, so the
	// explanation stands alone instead of sitting under four empty tabs.
	if (ready === null) {
		return h(
			"div",
			{ className: "gt_root" },
			header,
			h(
				"div",
				{ className: "gt_statusLine" },
				placeholder(statusState, t) ?? t("loading")
			)
		);
	}

	let content = null;
	if (view === "ci") {
		content = h(CIView, { state: ci, auth, authRequested: authNonce > 0, remote: ciRemote, t,
			expanded, onExpand: (key, open) => setExpanded((current) => ({ ...current, [key]: open })),
			onAsk: (check, step) => {
				const context = { repository: ci.value.repository, provider: ci.value.provider, host: ci.value.host, sha: ci.value.sha, job: check.name, state: check.state, url: check.url, ...(step ? { phase: step } : { phases: check.steps }), stepsError: check.stepsError };
				try { if (!askAI(sessionId, `${t("ci.askPrompt")}\n\n${JSON.stringify(context, null, 2)}`)) setNotice(t("ci.askError")); }
				catch { setNotice(t("ci.askError")); }
			},
			onAuth: () => setAuthNonce((n) => n + 1),
			onRemote: (remote) => { setCIRemote(remote); setAuthNonce(0); } });
	} else if (view === "history") {
		content = h(HistoryView, {
			key: "history",
			state: history,
			filter,
			t,
			selected: detail?.sha,
			onOpenCommit: (commit) => openDiff("commit", "", commit.sha, `${commit.short} ${commit.subject}`, commit.sha)
		});
	} else if (view === "branches") {
		content = h(BranchesView, { key: "branches", state: branches, t, filter });
	} else if (view === "blame") {
		content = h(BlameView, {
			key: "blame",
			state: blame,
			t,
			path: blamePath,
			draft: blameDraft,
			setDraft: setBlameDraft,
			// A re-show of the same path must still re-read it, so the nonce moves
			// too: the key would otherwise be identical to the last request.
			onShow: () => {
				setBlamePath(blameDraft.trim());
				setDataNonce((n) => n + 1);
			},
			onOpenCommit: (line) => openDiff("commit", "", line.sha, `${line.short} ${line.summary}`, line.sha),
			selected: detail?.sha
		});
	} else if (view === "reflog") {
		content = h(ReflogView, { key: "reflog", state: reflog, t });
	} else {
		content = h(StatusView, {
			key: "status",
			ready,
			filter,
			collapsed: filter ? searchCollapsed : collapsed,
			setCollapsed: filter ? setSearchCollapsed : setCollapsed,
			busy: busy || generating,
			message,
			setMessage,
			generating,
			generatedModel,
			t,
			selected: detail,
			onOpenDiff: openFileDiff,
			onStage: (path) => runMutation({ action: "stage", paths: [path] }),
			onUnstage: (path) => runMutation({ action: "unstage", paths: [path] }),
			onCommit,
			onGenerate,
			onCommitAction: (action) => runMutation({ action })
		});
	}

	return h(
		"div",
		{ className: "gt_root" },
		header,
		tabs,
		["status", "history", "branches"].includes(view) ? h("div", { className: "gt_search" },
			h("input", { className: "gt_input", type: "search", value: filters[view] ?? "", "aria-label": t(`search.${view}`), placeholder: t(`search.${view}`),
				onChange: (event) => setFilters((current) => ({ ...current, [view]: event.target.value })),
				onKeyDown: (event) => { if (event.key === "Escape") { event.preventDefault(); setFilters((current) => ({ ...current, [view]: "" })); } } }),
			filters[view] ? h(primitives.Button, { variant: "ghost", size: "sm", "aria-label": t("search.clear"), title: t("search.clear"), onClick: () => setFilters((current) => ({ ...current, [view]: "" })), children: "×" }) : null) : null,
		status.pollError ? h("div", { className: "gt_note gt_warning", role: "status" }, t("status.stale")) : null,
		operationBanner(operation, t),
		notice === null
			? null
			: h(
					"div",
					{
						key: "notice",
						role: "alert",
						className: "gt_alert"
					},
					notice,
					h(primitives.Button, {
						variant: "ghost",
						size: "sm",
						onClick: () => setNotice(null),
						children: t("diffClose")
					})
				),
		content,
		detail === null ? null : diffPane({ ...detail, ...patch }, t, () => setDetail(null), showBlame, {
			height: paneHeight, onResize: setPaneHeight, hunk, onHunk: setHunk,
			layout, wide, paneRef, onLayout: (mode) => { setLayout(mode); saveLayout(mode); },
			wrapped, onWrap: () => setWrapped((value) => !value), copied,
			onCopy: async (text) => {
				if (await primitives.writeClipboard(text)) {
					setCopied(true);
					setTimeout(() => setCopied(false), 1000);
				}
			}
		})
	);
}
