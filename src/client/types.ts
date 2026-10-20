/**
 * The shapes the conversation view reads off the Host's `api/git.*` routes.
 *
 * Only the fields this view uses are named; the Host half (`lib/index.js`,
 * `lib/git.js`) is the authority for the rest.
 */

/** The `{ok, value}` / `{ok, error}` envelope every route call resolves to. */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

/** A loaded resource, as `useLoad` and `useLiveLoad` hand it back. */
export interface Resource<T> {
	phase: "idle" | "loading" | "ready" | "error";
	key?: string;
	value?: T;
	message?: string;
	refreshing?: boolean;
	pollError?: string;
	updatedAt?: number;
}

export interface TreeNode {
	type: "dir" | "file";
	name: string;
	path: string;
	state?: string;
	staged?: boolean;
	unstaged?: boolean;
	children?: TreeNode[];
	total?: number;
}

export interface Base {
	name: string | null;
	ahead: number;
	behind: number;
}

export interface StatusReady {
	kind: "ready";
	branch: string | null;
	upstream: string | null;
	ahead: number;
	behind: number;
	detached: boolean;
	unborn: boolean;
	repoRoot: string;
	changed: number;
	truncated: boolean;
	tree: TreeNode;
	identity: unknown;
	state?: unknown;
	base?: Base | null;
}
export type Status = StatusReady | { kind: "no-workspace" | "no-repository" };

export interface Ref {
	kind: string;
	name: string | null;
}

export interface Commit {
	sha: string;
	short?: string;
	subject?: string;
	author?: string;
	date?: string;
	parents?: string[];
	refs?: Ref[];
	ahead?: boolean;
	column?: number;
	columns?: number[];
	through?: number[];
	width?: number;
}

export interface History {
	kind: "ready";
	commits: Commit[];
	total: number;
	truncated: boolean;
	base: Base | null;
}

export interface Branch {
	name: string;
	current: boolean;
	remote: boolean;
	upstream: string | null;
	ahead: number;
	behind: number;
	gone: boolean;
}

export interface ReflogEntry {
	short: string;
	selector: string;
	action: string;
	subject: string;
	date: string | null;
}

export interface Patch {
	kind?: string;
	text?: string;
	binary?: boolean;
	truncated?: boolean;
}

export interface BlameLine {
	sha: string;
	short: string;
	author: string;
	date: string;
	summary: string;
}

export interface CICheck {
	name: string;
	state: string;
	url?: string;
	group?: string;
	steps?: { number: number; state: string }[];
	stepsError?: string;
}

export interface CI {
	kind: string;
	state?: string;
	repository?: string;
	provider?: string;
	host?: string;
	sha?: string;
	checks?: CICheck[];
}

/** The business share injected into both bodies: the whole data channel. */
export interface GitBusiness {
	loadStatus(sessionId: string, signal?: AbortSignal): Promise<Envelope<Status>>;
	loadDiff(sessionId: string, path: string, scope: string, rev: string, signal?: AbortSignal): Promise<Envelope<Patch>>;
	loadHistory(sessionId: string, signal?: AbortSignal): Promise<Envelope<History>>;
	loadBranches(sessionId: string, signal?: AbortSignal): Promise<Envelope<{ kind: string; branches?: Branch[] }>>;
	loadReflog(sessionId: string, signal?: AbortSignal): Promise<Envelope<{ kind: string; entries?: ReflogEntry[] }>>;
	loadBlame(sessionId: string, path: string, signal?: AbortSignal): Promise<Envelope<unknown>>;
	loadCI(sessionId: string, remote: string, signal?: AbortSignal): Promise<Envelope<CI>>;
	loadAuth(sessionId: string, remote: string, signal?: AbortSignal): Promise<Envelope<unknown>>;
	askAI(sessionId: string, text: string): boolean;
	generateMessage(sessionId: string, language: string, signal?: AbortSignal): Promise<Envelope<unknown>>;
	mutate(sessionId: string, body: object, signal?: AbortSignal): Promise<Envelope<unknown>>;
}

/** Namespace-bound translate, as the slot runtime supplies it. */
export type Translate = (key: string) => string;

/**
 * The standard props this view reads. Declared here because the shell's own
 * `ConvViewProps` resolves them only with its whole package graph installed.
 */
export interface ViewProps extends GitBusiness {
	sessionId: string;
	useSessions: <T>(selector: (sessions: { byId: Record<string, { cwd?: string } | undefined> }) => T) => T;
	t: Translate;
}

/** What `useGitActions` hands back: the writes both surfaces share. */
export interface GitActions {
	busy: boolean;
	notice: string | null;
	setNotice(value: string | null): void;
	message: string;
	setMessage(value: string): void;
	generating: boolean;
	generatedModel: string | null;
	runMutation(body: object): Promise<boolean>;
	onCommit(text: string): Promise<void>;
	onGenerate(): Promise<void>;
}
