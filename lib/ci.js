/** Read-only provider adapters. Credentials stay on the Host; browser input selects only a Git remote. */
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const PROVIDERS = new Set(["github", "gitlab", "gitea"]);
const ERROR_CODES = new Set(["auth-required", "forbidden", "not-found", "rate-limit", "connection-failed", "invalid-config", "invalid-remote", "git-failed", "cli-failed", "invalid-response", "response-too-large"]);

const failure = (code) => Object.assign(new Error(code), { code });
const smallText = (value) => typeof value === "string" ? value.slice(0, 500) : "";
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function safeWebURL(value) {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
	} catch { return null; }
}

/** Unknown hosts require an explicit provider mapping before any network request. */
export function remoteTarget(raw, hosts = {}) {
	let host, path;
	try {
		if (/^[\w.-]+@[^/:]+:/.test(raw)) {
			const match = /^[\w.-]+@([^/:]+):(.+)$/.exec(raw);
			host = match[1].toLowerCase(); path = match[2];
		} else {
			const url = new URL(raw);
			if (!["https:", "ssh:"].includes(url.protocol) || url.search || url.hash) return null;
			host = (url.protocol === "ssh:" ? url.hostname : url.host).toLowerCase();
			path = url.pathname.replace(/^\//, "");
		}
		const defaults = { "github.com": "github", "gitlab.com": "gitlab", "gitea.com": "gitea" };
		const setting = Object.hasOwn(hosts, host) ? hosts[host] : {};
		const provider = setting.provider ?? defaults[host];
		if (!PROVIDERS.has(provider)) return { host, provider: null };
		const basePath = setting.basePath ?? "";
		if (typeof basePath !== "string" || (basePath !== "" && !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath))) throw failure("invalid-config");
		if (basePath) {
			if (!path.startsWith(basePath.slice(1) + "/")) throw failure("invalid-remote");
			path = path.slice(basePath.length);
		}
		path = decodeURIComponent(path).replace(/\.git$/, "").replace(/\/$/, "");
		const parts = path.split("/");
		if (parts.length < 2 || (provider !== "gitlab" && parts.length !== 2) || parts.some((part) => !part || part === "." || part === ".." || !/^[\w.-]+$/.test(part))) throw failure("invalid-remote");
		// A token variable is bound to this configured host, never inferred from an arbitrary remote.
		const tokenEnv = setting.tokenEnv ?? (host === "gitlab.com" ? "GITLAB_TOKEN" : host === "gitea.com" ? "GITEA_TOKEN" : null);
		if (tokenEnv !== null && (typeof tokenEnv !== "string" || !/^[A-Z][A-Z0-9_]*TOKEN[A-Z0-9_]*$/.test(tokenEnv))) throw failure("invalid-config");
		return { host, provider, path, basePath, tokenEnv, origin: `https://${host}` };
	} catch (error) {
		if (error.code) throw error;
		return null;
	}
}

export function ciState(status, conclusion) {
	const value = status === "completed" ? conclusion : status;
	if (["success", "passed"].includes(value)) return "success";
	if (["failure", "failed", "error", "timed_out", "startup_failure", "action_required"].includes(value)) return "failure";
	if (["in_progress", "running", "canceling"].includes(value)) return "running";
	if (["queued", "pending", "requested", "created", "waiting_for_resource", "preparing", "scheduled"].includes(value)) return "pending";
	if (["manual", "blocked", "waiting", "waiting_for_callback"].includes(value)) return "blocked";
	if (["cancelled", "canceled"].includes(value)) return "canceled";
	if (value === "skipped") return "skipped";
	if (["neutral", "warning"].includes(value)) return "neutral";
	return "unknown";
}

export function overallState(checks, partial = false) {
	const states = checks.map((check) => check.state);
	for (const state of ["failure", "running", "pending", "blocked"]) if (states.includes(state)) return state;
	if (partial || states.includes("unknown")) return "unknown";
	if (states.length === 0) return "none";
	if (states.includes("canceled")) return "canceled";
	if (states.includes("success")) return "success";
	return states.every((state) => state === "skipped") ? "skipped" : "neutral";
}

/** APIs return newest first; old attempts must not override a newer result. */
function latest(items, key) {
	const seen = new Set();
	return items.filter((item) => {
		const id = key(item);
		if (seen.has(id)) return false;
		seen.add(id); return true;
	});
}

function check(name, status, url, group = "", conclusion) {
	return { name: smallText(name) || "CI", state: ciState(status, conclusion), url: safeWebURL(url), group: smallText(group) };
}

/** Use only same-repository Actions links; never fetch a URL supplied by a check. */
function githubJobID(raw, target) {
	const safe = safeWebURL(raw);
	if (!safe) return null;
	const url = new URL(safe);
	const prefix = `/${target.path}/`;
	if (url.host !== target.host || !url.pathname.startsWith(prefix)) return null;
	return /^(?:actions\/runs\/[1-9]\d*\/job|runs\/[1-9]\d*\/jobs|runs)\/([1-9]\d*)$/.exec(url.pathname.slice(prefix.length))?.[1] ?? null;
}

function jobSteps(job) {
	if (!Array.isArray(job.steps) || job.steps.some((step) => !step || !Number.isSafeInteger(step.number) || step.number < 1) || new Set(job.steps.map((step) => step.number)).size !== job.steps.length) throw failure("invalid-response");
	return [...job.steps].sort((a, b) => a.number - b.number).slice(0, 100).map((step) => {
		const seconds = (Date.parse(step.completed_at) - Date.parse(step.started_at)) / 1000;
		return { ...check(step.name, step.status, null, "", step.conclusion), number: step.number,
			state: step.status === "queued" ? "not-started" : ciState(step.status, step.conclusion),
			durationSeconds: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null };
	});
}

/** Never follow redirects with credentials, retain raw HTTP errors, or accept unbounded JSON. */
async function httpJSON(url, headers, deps) {
	const response = await (deps.fetch ?? fetch)(url, { headers, signal: deps.signal, redirect: "error" });
	if (!response.ok) {
		await response.body?.cancel();
		throw failure(response.status === 401 ? "auth-required" : response.status === 403 ? "forbidden" : response.status === 404 ? "not-found" : response.status === 429 ? "rate-limit" : "connection-failed");
	}
	const reader = response.body.getReader();
	const chunks = []; let length = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > MAX_BYTES) throw failure("response-too-large");
			chunks.push(value);
		}
	} finally { await reader.cancel(); }
	try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
	catch { throw failure("invalid-response"); }
}

function ghEnvironment(target, env) {
	const keys = target.host === "github.com" || target.host.endsWith(".ghe.com") ? ["GH_TOKEN", "GITHUB_TOKEN"] : ["GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];
	return { GH_PROMPT_DISABLED: "1", GH_DEBUG: undefined, ...Object.fromEntries(keys.map((key) => [key, env[key]])) };
}

function graphqlError(data) {
	if (!data?.errors) return;
	const types = data.errors.map?.((error) => error?.type ?? error?.extensions?.code) ?? [];
	throw failure(types.includes("RATE_LIMITED") ? "rate-limit" : types.includes("UNAUTHORIZED") ? "auth-required" : types.includes("FORBIDDEN") ? "forbidden" : types.includes("NOT_FOUND") ? "not-found" : "invalid-response");
}

async function ghJSON(args, target, deps) {
	const result = await deps.command([deps.gh, ...args, "--hostname", target.host], ghEnvironment(target, deps.env ?? process.env));
	if (result.aborted) throw failure("connection-failed");
	if (result.truncated) throw failure("response-too-large");
	if (result.exitCode !== 0) {
		if (args[1] === "graphql") {
			let data;
			try { data = JSON.parse(result.stdout); } catch { /* HTTP failures need not return JSON. */ }
			graphqlError(data);
		}
		const code = /HTTP (401|403|404|429)/.exec(result.stderr)?.[1];
		throw failure(code === "401" || /gh auth login|GH_TOKEN/.test(result.stderr) ? "auth-required" : code === "403" ? "forbidden" : code === "404" ? "not-found" : code === "429" ? "rate-limit" : "cli-failed");
	}
	try { return JSON.parse(result.stdout); }
	catch { throw failure("invalid-response"); }
}

/** One authorized snapshot includes Checks and external statuses, even without a PR. */
async function githubSnapshot(target, sha, deps) {
	const query = `query($owner:String!,$name:String!,$sha:String!,$cursor:String){
		viewer{id} repository(owner:$owner,name:$name){object(expression:$sha){... on Commit{
			oid statusCheckRollup{contexts(first:100,after:$cursor){nodes{__typename
				... on CheckRun{databaseId name status conclusion startedAt completedAt detailsUrl checkSuite{app{slug}}}
				... on StatusContext{context state createdAt targetUrl}}
				pageInfo{hasNextPage endCursor}}}}}}}`;
	const [owner, name] = target.path.split("/");
	const runs = [], statuses = [], cursors = new Set();
	let cursor, viewer;
	for (let page = 0; page < MAX_PAGES; page++) {
		const data = await ghJSON(["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `sha=${sha}`, ...(cursor ? ["-f", `cursor=${cursor}`] : [])], target, deps);
		deps.signal?.throwIfAborted();
		graphqlError(data);
		if (!data?.data || !Object.hasOwn(data.data, "repository")) throw failure("invalid-response");
		const commit = data?.data?.repository?.object;
		const account = data?.data?.viewer?.id;
		if (!commit) throw failure("not-found");
		if (commit.oid !== sha || typeof account !== "string" || !account || (viewer && viewer !== account)) throw failure("invalid-response");
		viewer = account;
		const contexts = commit.statusCheckRollup?.contexts;
		if (commit.statusCheckRollup === null && page === 0) return { runs, statuses, partial: false, viewer };
		if (!Array.isArray(contexts?.nodes) || contexts.nodes.length > PAGE_SIZE || typeof contexts.pageInfo?.hasNextPage !== "boolean") throw failure("invalid-response");
		for (const node of contexts.nodes) {
			if (node?.__typename === "CheckRun" && typeof node.status === "string" && (node.conclusion === null || typeof node.conclusion === "string")) {
				runs.push({ id: node.databaseId, name: node.name, status: node.status.toLowerCase(), conclusion: node.conclusion?.toLowerCase(), started_at: node.startedAt, completed_at: node.completedAt, details_url: node.detailsUrl, app: node.checkSuite?.app });
			} else if (node?.__typename === "StatusContext" && typeof node.state === "string") {
				statuses.push({ context: node.context, state: node.state.toLowerCase(), created_at: node.createdAt, target_url: node.targetUrl });
			} else throw failure("invalid-response");
		}
		if (!contexts.pageInfo.hasNextPage) return { runs, statuses, partial: false, viewer };
		cursor = contexts.pageInfo.endCursor;
		if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) throw failure("invalid-response");
		cursors.add(cursor);
	}
	return { runs, statuses, partial: true, viewer };
}

async function requestFor(target, deps) {
	if (target.provider === "github") {
		try { deps.gh = await deps.subprocess.resolveExecutable("gh"); } catch { deps.gh = null; }
		if (deps.gh) return (path) => ghJSON(["api", "--method", "GET", path], target, deps);
		// Public CI can be read without gh; private repos will explain that authentication is needed.
		const base = target.host === "github.com" ? "https://api.github.com" : `${target.origin}/api/v3`;
		return (path) => httpJSON(`${base}/${path}`, { accept: "application/vnd.github+json" }, deps);
	}
	const token = target.tokenEnv ? (deps.env ?? process.env)[target.tokenEnv] : undefined;
	const headers = { accept: "application/json", ...(token ? target.provider === "gitlab" ? { "PRIVATE-TOKEN": token } : { Authorization: `token ${token}` } : {}) };
	const base = `${target.origin}${target.basePath}/api/${target.provider === "gitlab" ? "v4" : "v1"}`;
	return (path) => httpJSON(`${base}/${path}`, headers, deps);
}

async function pages(request, path, field, gitea = false) {
	const items = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const data = await request(`${path}${path.includes("?") ? "&" : "?"}${gitea ? "limit" : "per_page"}=${PAGE_SIZE}&page=${page}`);
		const rows = field ? data[field] : data;
		if (!Array.isArray(rows) || rows.some((row) => row === null || typeof row !== "object")) throw failure("invalid-response");
		items.push(...rows);
		const total = field ? data.total_count : undefined;
		if (rows.length === 0 || (typeof total === "number" ? items.length >= total : rows.length < PAGE_SIZE)) return { items, partial: false };
	}
	return { items, partial: true };
}

const adapters = {
	github: {
		async auth(target, request, deps) {
			if (!deps.gh) return { kind: "cli-missing", command: "gh" };
			const status = await ghJSON(["auth", "status", "--active", "--json", "hosts"], target, deps);
			const entry = status.hosts?.[target.host]?.find((entry) => entry.active === true);
			if (!entry) return { kind: "auth-required", command: `gh auth login --hostname ${target.host}` };
			const account = { login: smallText(entry.login), source: smallText(entry.tokenSource), scopes: smallText(entry.scopes), protocol: smallText(entry.gitProtocol) };
			if (entry.state !== "success") return { kind: entry.state === "error" ? "auth-invalid" : "failed", ...account };
			if (!target.path) return { kind: "ready", ...account, access: "account-verified" };
			// Login success does not prove that this particular repo's Checks API is readable.
			try { await request(`repos/${target.path}/commits/${deps.sha || "HEAD"}/check-runs?per_page=1`); }
			catch (error) { return { kind: "failed", ...account, code: error.code ?? "connection-failed" }; }
			return { kind: "ready", ...account, access: "ci-readable" };
		},
		async ci(target, request, sha, deps) {
			let snapshot;
			if (deps.gh) snapshot = await githubSnapshot(target, sha, deps);
			else {
				const [runs, statuses] = await Promise.all([
					pages(request, `repos/${target.path}/commits/${sha}/check-runs?filter=latest`, "check_runs"),
					pages(request, `repos/${target.path}/commits/${sha}/statuses`)
				]);
				snapshot = { runs: runs.items.filter((run) => run.head_sha === sha), statuses: statuses.items, partial: runs.partial || statuses.partial };
			}
			const selected = snapshot.runs;
			const checks = selected.map((run) => ({ ...check(run.name, run.status, run.details_url, "Checks", run.conclusion),
				source: run.app?.slug === "github-actions" ? "actions" : "external", app: smallText(run.app?.slug), startedAt: timestamp(run.started_at) }));
			let detailed = 0;
			await Promise.all(selected.map(async (run, index) => {
				if (run.app?.slug !== "github-actions") return;
				const result = checks[index];
				const id = githubJobID(run.details_url, target);
				if (!id) { result.stepsError = "unavailable"; return; }
				// Authenticate every snapshot; cache only completed details under that exact account/check.
				const cacheKey = snapshot.viewer && run.status === "completed" && typeof run.completed_at === "string"
					? JSON.stringify([target.host, target.path, snapshot.viewer, sha, id, run.id, run.conclusion, run.completed_at]) : null;
				const cached = cacheKey && deps.ciCache?.get(cacheKey);
				if (cached && cached.expires > Date.now()) { Object.assign(result, cached.details); return; }
				// shortcut: expand at most 10 Actions jobs per read; add on-demand loading for larger CI matrices.
				if (detailed++ >= 10) { result.stepsError = "limit"; return; }
				try {
					if (!Number.isSafeInteger(run.id) || run.id < 1) throw failure("invalid-response");
					const job = await request(`repos/${target.path}/actions/jobs/${id}`);
					if (String(job.id) !== id || job.head_sha !== sha || typeof job.check_run_url !== "string" || !job.check_run_url.endsWith(`/repos/${target.path}/check-runs/${run.id}`)) throw failure("invalid-response");
					result.steps = jobSteps(job);
					if (job.steps.length > 100) result.stepsError = "limit";
					if (cacheKey && job.status === "completed" && deps.ciCache && !deps.signal?.aborted) {
						for (const [key, entry] of deps.ciCache) if (entry.expires <= Date.now()) deps.ciCache.delete(key);
						deps.ciCache.delete(cacheKey);
						if (deps.ciCache.size >= 200) deps.ciCache.delete(deps.ciCache.keys().next().value);
						deps.ciCache.set(cacheKey, { expires: Date.now() + 15 * 60000, details: { steps: result.steps, ...(result.stepsError ? { stepsError: result.stepsError } : {}) } });
					}
				} catch (error) {
					result.stepsError = ERROR_CODES.has(error.code) ? error.code : "connection-failed";
				}
			}));
			deps.signal?.throwIfAborted();
			checks.push(...latest(snapshot.statuses, (status) => status.context).map((status) => ({
				...check(status.context, status.state, status.target_url, "Commit status"), source: "external", startedAt: timestamp(status.created_at)
			})));
			const groups = ["actions", "external"].map((source) => {
				const members = checks.filter((item) => item.source === source);
				return { source, count: members.length, state: overallState(members, snapshot.partial) };
			}).filter((group) => group.count > 0);
			return { checks, groups, partial: snapshot.partial };
		}
	},
	gitlab: {
		async auth(target, request) {
			const user = await request("user");
			await request(`projects/${encodeURIComponent(target.path)}/pipelines?per_page=1`);
			return { kind: "ready", login: smallText(user.username), source: target.tokenEnv ?? "", access: "ci-readable" };
		},
		async ci(target, request, sha) {
			const project = `projects/${encodeURIComponent(target.path)}`;
			const [pipelines, statuses] = await Promise.all([
				pages(request, `${project}/pipelines?sha=${sha}&order_by=id&sort=desc`),
				pages(request, `${project}/repository/commits/${sha}/statuses`)
			]);
			const selected = latest(pipelines.items.filter((pipeline) => pipeline.sha === sha), (pipeline) => `${pipeline.ref}:${pipeline.source ?? ""}`);
			const checks = selected.slice(0, 10).map((pipeline) => check(`Pipeline #${pipeline.id} · ${pipeline.ref}`, pipeline.status, pipeline.web_url));
			const selectedIDs = new Set(selected.map((pipeline) => pipeline.id));
			const external = latest(statuses.items.filter((status) => !status.pipeline_id || selectedIDs.has(status.pipeline_id)), (status) => `${status.name}:${status.ref}:${status.pipeline_id}`).map((status) => check(status.name, status.status, status.target_url, "Commit status"));
			// Pipeline results account for allowed-to-fail/manual jobs; don't turn those into a false failure.
			const summary = [...checks, ...statuses.items.filter((status) => !status.pipeline_id).map((status) => check(status.name, status.status, status.target_url))];
			let partial = pipelines.partial || statuses.partial || selected.length > 10;
			for (const pipeline of selected.slice(0, 10)) {
				if (!Number.isSafeInteger(pipeline.id) || pipeline.id < 1) throw failure("invalid-response");
				const jobs = await pages(request, `${project}/pipelines/${pipeline.id}/jobs?include_retried=false`);
				partial ||= jobs.partial;
				checks.push(...jobs.items.map((job) => check(job.name, job.status, job.web_url, `Pipeline #${pipeline.id}${job.stage ? ` · ${smallText(job.stage)}` : ""}${job.allow_failure ? " · allowed failure" : ""}`)));
			}
			return { checks: [...checks, ...external], summary, partial };
		}
	},
	gitea: {
		async auth(target, request) {
			const user = await request("user");
			await request(`repos/${target.path}`);
			return { kind: "ready", login: smallText(user.login), source: target.tokenEnv ?? "", access: "repo-readable" };
		},
		async ci(target, request, sha) {
			const repo = `repos/${target.path}`;
			const statuses = await pages(request, `${repo}/commits/${sha}/status`, "statuses", true);
			let runs;
			try { runs = await pages(request, `${repo}/actions/runs?head_sha=${sha}`, "workflow_runs", true); }
			catch (error) {
				if (error.code !== "not-found") throw error;
				runs = { items: [], partial: true };
			}
			const checks = [
				...latest(runs.items.filter((run) => run.head_sha === sha), (run) => `${run.path ?? run.name}:${run.event}:${run.head_branch}`).map((run) => check(run.name || run.path || run.display_title, run.status, run.html_url, "Actions", run.conclusion)),
				...latest(statuses.items, (status) => status.context).map((status) => check(status.context, status.state, status.target_url, "Commit status"))
			];
			return { checks, partial: runs.partial || statuses.partial };
		}
	}
};

export async function inspectCI(deps) {
	let base = {};
	try {
		deps.signal?.throwIfAborted();
		const remotes = await deps.git(["remote"]);
		if (remotes.exitCode !== 0 || remotes.truncated || remotes.aborted) throw failure("git-failed");
		const names = remotes.stdout.trim().split("\n").filter(Boolean);
		base = { remotes: names };
		if (names.length === 0) {
			if (!deps.auth) return { ...base, kind: "no-remote" };
			const target = { provider: "github", host: "github.com" };
			deps = { ...deps };
			const request = await requestFor(target, deps);
			return { ...base, ...target, ...await adapters.github.auth(target, request, deps) };
		}
		const remote = deps.remote || (names.includes("origin") ? "origin" : names[0]);
		if (!names.includes(remote) || !/^[A-Za-z0-9._/-]{1,200}$/.test(remote) || remote.startsWith("-")) return { ...base, kind: "failed", code: "invalid-remote" };
		base.remote = remote;
		const url = await deps.git(["remote", "get-url", "--", remote]);
		if (url.exitCode !== 0 || url.truncated || url.aborted) throw failure("git-failed");
		const target = remoteTarget(url.stdout.trim(), deps.config.hosts ?? {});
		if (!target) return { ...base, kind: "unsupported-remote" };
		base = { ...base, host: target.host, provider: target.provider, repository: target.path };
		if (!target.provider) return { ...base, kind: "unsupported-host" };
		const head = await deps.git(["rev-parse", "--verify", "HEAD"]);
		if (head.truncated || head.aborted) throw failure("git-failed");
		const sha = head.stdout.trim();
		if (!deps.auth && head.exitCode !== 0) return { ...base, kind: "no-head" };
		if (head.exitCode === 0 && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw failure("git-failed");
		base.sha = head.exitCode === 0 ? sha : null;
		deps = { ...deps, sha: base.sha };
		const request = await requestFor(target, deps);
		const adapter = adapters[target.provider];
		if (deps.auth) return { ...base, ...await adapter.auth(target, request, deps) };
		const result = await adapter.ci(target, request, sha, deps);
		return { ...base, kind: "ready", ...result, state: overallState(result.summary ?? result.checks, result.partial) };
	} catch (error) {
		return { ...base, kind: "failed", code: ERROR_CODES.has(error.code) ? error.code : "connection-failed" };
	}
}
