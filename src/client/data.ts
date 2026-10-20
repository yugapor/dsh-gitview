// @ts-nocheck -- moved verbatim from the hand-written bundle; type it when it is next changed.
import { react } from "./deps";
import { REJECTIONS } from "./model";
import type { GitActions } from "./types";

/** Best-effort message from an error envelope or a thrown value. */
export function messageOf(error) {
	return String(error?.message ?? error?.code ?? error ?? "unknown");
}

/**
 * Load one resource whenever `key` changes, and hand back its state plus a
 * setter so a mutation can adopt the answer it already received.
 *
 * `load` is deliberately NOT a dependency: it is rebuilt on every render, and
 * `key` is the thing that says when to fetch. Passing `null` as the key parks
 * the resource — that is how a view that is not on screen avoids a request.
 *
 * @param key - a string that changes when a fetch is wanted, or null.
 * @param load - returns the `{ok, value}` / `{ok, error}` envelope.
 */
export function useLoad(key, load) {
	const [state, setState] = react.useState({ phase: "idle" });
	react.useEffect(() => {
		if (key === null) return undefined;
		let alive = true;
		setState({ phase: "loading" });
		load().then(
			(result) => {
				if (!alive) return;
				setState(
					result.ok === true
						? { phase: "ready", value: result.value }
						: { phase: "error", message: messageOf(result.error) }
				);
			},
			(error) => {
				if (alive) setState({ phase: "error", message: messageOf(error) });
			}
		);
		return () => {
			alive = false;
		};
	}, [key]);
	return [state, setState];
}

export const ciActive = (check) => ["running", "pending"].includes(check.state);
export const ciOverdue = (check, now = Date.now()) => ciActive(check) && typeof check.startedAt === "string" && now - Date.parse(check.startedAt) >= 24 * 3600000;
export function ciDisplayState(state, checks, now = Date.now()) {
	const active = checks.filter(ciActive);
	return ["running", "pending"].includes(state) && active.length > 0 && active.every((check) => ciOverdue(check, now)) ? "overdue" : state;
}
export function ciInterval(value) {
	const active = value.state === "none" || (value.checks?.length ? value.checks.some((check) => ciActive(check) && !ciOverdue(check)) : ciActive(value));
	const throttled = value.checks?.some((check) => ["forbidden", "rate-limit"].includes(check.stepsError));
	return value.kind === "ready" && active && !throttled ? 15000 : 60000;
}

/** Serial polling keeps the last result visible; hidden tabs abort and stop requests. */
export function useLiveLoad(key, load, signal, interval, paused = false, deferResume = false) {
	const [state, setState] = react.useState({ phase: "idle" });
	react.useEffect(() => {
		if (key === null) return undefined;
		let alive = true, busy = false, timer, controller;
		setState((current) => current.key === key ? current : { phase: "loading", key });
		if (paused) return undefined;
		const hidden = () => document.visibilityState === "hidden" || document.hasFocus?.() === false;
		const update = async () => {
			if (!alive || busy || hidden() || signal?.aborted) return;
			clearTimeout(timer);
			busy = true;
			controller = new AbortController();
			const request = controller;
			let delay = 60000;
			setState((current) => ({ ...current, refreshing: true }));
			try {
				const result = await load(signal ? AbortSignal.any([signal, request.signal]) : request.signal);
				if (!alive || request.signal.aborted || signal?.aborted) return;
				if (result.ok !== true) throw new Error(messageOf(result.error));
				const value = result.value;
				delay = typeof interval === "function" ? interval(value) : interval;
				setState({ phase: "ready", key, value, refreshing: false, updatedAt: Date.now() });
			} catch (error) {
				if (alive && !request.signal.aborted && !signal?.aborted) setState((current) => current.value
					? { ...current, refreshing: false, pollError: messageOf(error) }
					: { phase: "error", key, message: messageOf(error), refreshing: false });
			} finally {
				busy = false;
				if (alive && !hidden() && !signal?.aborted && Number.isFinite(delay)) timer = setTimeout(update, request.signal.aborted ? 0 : delay);
			}
		};
		const visibility = () => {
			clearTimeout(timer);
			if (hidden()) { controller?.abort(); setState((current) => ({ ...current, refreshing: false })); }
			else update();
		};
		document.addEventListener("visibilitychange", visibility);
		window.addEventListener("focus", visibility);
		window.addEventListener("blur", visibility);
		// A mutation supplies its own fresh snapshot; do not immediately overwrite it.
		if (deferResume && state.key === key && state.value && !hidden()) timer = setTimeout(update, interval);
		else update();
		return () => {
			alive = false;
			clearTimeout(timer);
			controller?.abort();
			document.removeEventListener("visibilitychange", visibility);
			window.removeEventListener("focus", visibility);
			window.removeEventListener("blur", visibility);
		};
	}, [key, signal, interval, paused, deferResume]);
	return [state.key === key ? state : { phase: "loading" }, setState];
}

/** The diff layout is one preference shared by both surfaces. */
export const LAYOUT_KEY = "dsh-gitview.diff-layout";
export function readLayout() {
	try { const saved = window.localStorage?.getItem(LAYOUT_KEY); return ["auto", "split", "unified"].includes(saved) ? saved : "auto"; }
	catch { return "auto"; }
}
export function saveLayout(mode) {
	try { window.localStorage?.setItem(LAYOUT_KEY, mode); } catch { /* Browser policy may disable persistence. */ }
}

/**
 * The writes both surfaces share: stage, unstage, commit and the AI draft.
 *
 * A refusal or a git failure is shown as a notice rather than thrown: both are
 * ordinary answers about the repository, and the reader is the one who can act
 * on them. A successful mutation hands its fresh status to `adopt.current`,
 * which the caller points at its own status resource after loading it.
 */
export function useGitActions({ sessionId, signal, t, mutate, generateMessage, adopt }): GitActions {
	const [busy, setBusy] = react.useState(false);
	const [notice, setNotice] = react.useState<string | null>(null);
	const [message, setMessage] = react.useState("");
	const [generating, setGenerating] = react.useState(false);
	const [generatedModel, setGeneratedModel] = react.useState<string | null>(null);

	const runMutation = react.useCallback(
		async (body) => {
			setBusy(true);
			setNotice(null);
			const result = await mutate(sessionId, body, signal);
			setBusy(false);
			if (result.ok !== true) {
				setNotice(t("error").replace("{message}", messageOf(result.error)));
				return false;
			}
			const value = result.value;
			if (value.kind === "failed") {
				setNotice(value.message);
				return false;
			}
			if (value.kind === "rejected") {
				setNotice(t(REJECTIONS[value.code] ?? "rejected.generic"));
				return false;
			}
			if (value.kind !== "ready") {
				setNotice(value.kind === "no-workspace" ? t("noWorkspace") : t("noRepository"));
				return false;
			}
			adopt.current?.(value.status);
			return true;
		},
		[mutate, sessionId, signal, t, adopt]
	);

	const onCommit = react.useCallback(
		async (text) => {
			const ok = await runMutation({ action: "commit", message: text });
			if (ok) setMessage("");
		},
		[runMutation]
	);

	const onGenerate = react.useCallback(async () => {
		if (busy || generating || message.trim() !== "") return;
		setGenerating(true);
		setGeneratedModel(null);
		setNotice(null);
		try {
			const result = await generateMessage(sessionId, t("messageLanguage"), signal);
			if (result.ok !== true) throw new Error(messageOf(result.error));
			const value = result.value;
			if (value.kind !== "ready") {
				setNotice(value.kind === "rejected" ? t(`rejected.${value.code}`) : value.kind === "no-workspace" ? t("noWorkspace") : value.kind === "no-repository" ? t("noRepository") : t("generationError").replace("{message}", value.message));
				return;
			}
			// A draft must never replace text entered while the request was in flight.
			setMessage((current) => current.trim() === "" ? value.message : current);
			setGeneratedModel(`${value.model.provider}/${value.model.model}`);
		} catch (error) {
			setNotice(t("generationError").replace("{message}", messageOf(error)));
		} finally {
			setGenerating(false);
		}
	}, [busy, generating, message, generateMessage, sessionId, signal, t]);

	return { busy, notice, setNotice, message, setMessage, generating, generatedModel, runMutation, onCommit, onGenerate };
}

/**
 * The Host's `/api` routes, written DOCUMENT-RELATIVE — the leading slash is
 * deliberately absent because the shipped convention is
 * `"/open-in-app/apps".slice(1)` / `CHANGED_FILES_PATH.slice(1)`. A relative
 * request keeps working when the app is mounted under a path prefix, and it is
 * same-origin either way, so the browser attaches the auth cookie and the Host's
 * loopback Origin fence admits it.
 */
export const ROUTES = {
	status: "api/git.tree",
	diff: "api/git.diff",
	history: "api/git.history",
	branches: "api/git.branches",
	reflog: "api/git.reflog",
	blame: "api/git.blame",
	mutate: "api/git.mutate",
	message: "api/git.message",
	ci: "api/git.ci",
	auth: "api/git.auth"
};

/** Build a query string, dropping parameters the caller left unset. */
export function query(params) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		search.set(key, String(value));
	}
	return search.toString();
}

/**
 * Call one route and normalize the answer into the `{ok:true,value}` /
 * `{ok:false,error}` envelope the body expects — the same envelope a Remote call
 * returns — so the transport stays invisible above this line.
 *
 * A non-2xx status and a transport failure both become the error branch rather
 * than a rejection, so the body's error path handles every outcome.
 */
export async function read(route, params, signal) {
	try {
		const response = await fetch(`${route}?${query(params)}`, {
			signal,
			headers: { accept: "application/json" }
		});
		if (!response.ok) {
			return { ok: false, error: { code: `http/${response.status}`, message: `HTTP ${response.status}` } };
		}
		return { ok: true, value: await response.json() };
	} catch (error) {
		return { ok: false, error: { code: "transport", message: String(error?.message ?? error) } };
	}
}

/**
 * POST one mutation.
 *
 * The session id goes in the query because that is where the Host's routes read
 * it, and a 400 carries a `code` worth surfacing rather than a bare status.
 */
export async function write(route, sessionId, body, signal) {
	try {
		const response = await fetch(`${route}?${query({ sessionId })}`, {
			method: "POST",
			signal,
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			let code = `http/${response.status}`;
			try {
				const payload = await response.json();
				if (typeof payload?.code === "string") code = payload.code;
			} catch {
				// A non-JSON error body leaves the status as the code.
			}
			return { ok: false, error: { code, message: `HTTP ${response.status}` } };
		}
		return { ok: true, value: await response.json() };
	} catch (error) {
		return { ok: false, error: { code: "transport", message: String(error?.message ?? error) } };
	}
}

/** The git working-tree status for one session: identity, tree, operation, base. */
export function readStatus(sessionId, signal) {
	return read(ROUTES.status, { sessionId }, signal);
}

/** One path's patch, under a chosen baseline. */
export function readDiff(sessionId, path, scope, rev, signal) {
	return read(ROUTES.diff, { sessionId, path, scope, rev }, signal);
}

/** The commit history and its lane geometry. */
export function readHistory(sessionId, signal) {
	return read(ROUTES.history, { sessionId }, signal);
}

/** Local and remote-tracking branches. */
export function readBranches(sessionId, signal) {
	return read(ROUTES.branches, { sessionId }, signal);
}

/** What moved HEAD, newest first. */
export function readReflog(sessionId, signal) {
	return read(ROUTES.reflog, { sessionId }, signal);
}

/** One file's blame at a revision; the path is required by the route. */
export function readBlame(sessionId, path, signal) {
	return read(ROUTES.blame, { sessionId, path }, signal);
}

/** Stage, unstage or commit. */
export function sendMutation(sessionId, body, signal) {
	return write(ROUTES.mutate, sessionId, body, signal);
}
