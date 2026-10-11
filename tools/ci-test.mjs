import assert from "node:assert/strict";
import { ciState, overallState, remoteTarget, safeWebURL, inspectCI } from "../lib/ci.js";

console.log("ci-test");
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const asJSON = (data) => ({ exitCode: 0, stdout: JSON.stringify(data), stderr: "" });
const graphqlSnapshot = (nodes = [], extra = {}) => ({ data: { viewer: { id: "account-1" }, repository: { object: { oid: SHA, statusCheckRollup: { contexts: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } } }, ...extra });
const graphqlRun = (run) => ({ __typename: "CheckRun", databaseId: run.id, name: run.name, status: run.status.toUpperCase(), conclusion: run.conclusion?.toUpperCase() ?? null, startedAt: run.started_at ?? null, completedAt: run.completed_at ?? null, detailsUrl: run.details_url, checkSuite: { app: run.app ?? null } });

function fixture(options = {}) {
	const requests = [], commands = [], gitCalls = [];
	const routes = options.routes ?? {};
	const answer = (path) => {
		const url = new URL(path, "https://fixture.test/");
		const route = routes[url.pathname];
		assert.ok(route !== undefined, `unexpected request ${path}`);
		return typeof route === "function" ? route(url) : route;
	};
	const deps = {
		config: options.config ?? {}, env: options.env ?? {}, auth: options.auth ?? false,
		remote: options.remote ?? "", signal: options.signal,
		ciCache: options.ciCache,
		git: async (args) => {
			gitCalls.push(args);
			if (args[0] === "remote" && args.length === 1) return { exitCode: 0, stdout: options.remotes ?? "origin\n" };
			if (args[0] === "remote") return { exitCode: 0, stdout: options.url ?? "git@github.com:owner/repo.git\n" };
			return { exitCode: options.unborn ? 128 : 0, stdout: options.unborn ? "" : `${SHA}\n` };
		},
		subprocess: { resolveExecutable: async (name) => { assert.equal(name, "gh"); if (options.noGH) throw new Error("missing"); return "/bin/gh"; } },
		command: async (args, env) => {
			commands.push({ args, env });
			if (args[1] === "auth") return asJSON(options.authStatus ?? { hosts: { "github.com": [{ active: true, state: "success", login: "Fixture", token: "NEVER-RETURN-THIS", scopes: "repo", tokenSource: "keyring", gitProtocol: "ssh" }] } });
			if (args[2] === "graphql") {
				requests.push("graphql");
				if (options.commandError) return options.commandError;
				if (options.graphql) return asJSON(await (typeof options.graphql === "function" ? options.graphql(args) : options.graphql));
				const page = Number(args.find((arg) => arg.startsWith("cursor="))?.slice(7) ?? 1);
				const runs = answer(`/repos/owner/repo/commits/${SHA}/check-runs?page=${page}`);
				const statuses = answer(`/repos/owner/repo/commits/${SHA}/statuses?page=${page}`);
				const nodes = [...runs.check_runs.filter((run) => run.head_sha === SHA).map(graphqlRun), ...statuses.map((status) => ({ __typename: "StatusContext", context: status.context, state: status.state.toUpperCase(), createdAt: status.created_at, targetUrl: status.target_url }))];
				const data = graphqlSnapshot(nodes);
				data.data.repository.object.statusCheckRollup.contexts.pageInfo = { hasNextPage: runs.total_count > page * 100, endCursor: String(page + 1) };
				return asJSON(data);
			}
			requests.push(args[4]);
			return options.commandError ?? asJSON(answer(args[4]));
		},
		fetch: async (url, init) => {
			requests.push({ url, init });
			if (options.fetchError) return new Response("PRIVATE-ERROR-BODY", { status: options.fetchError });
			const data = answer(url);
			if (data instanceof Response) return data;
			return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
		}
	};
	return { deps, requests, commands, gitCalls };
}

await check("HTTPS/SSH remotes normalize without retaining embedded credentials", () => {
	assert.equal(remoteTarget("https://user:SECRET@github.com/owner/repo.git").path, "owner/repo");
	assert.equal(JSON.stringify(remoteTarget("https://user:SECRET@github.com/owner/repo.git")).includes("SECRET"), false);
	assert.equal(remoteTarget("ssh://git@gitlab.com:2222/group/sub/repo.git").path, "group/sub/repo");
	assert.equal(remoteTarget("git@gitea.com:owner/repo.git").provider, "gitea");
	assert.equal(remoteTarget("file:///tmp/repo"), null);
	assert.equal(remoteTarget("http://github.com/owner/repo"), null);
	assert.equal(remoteTarget("git@private.example:owner/repo").provider, null);
});
await check("self-hosted tokens and subpaths require trusted host settings", () => {
	const target = remoteTarget("https://git.example/gitlab/group/repo.git", { "git.example": { provider: "gitlab", basePath: "/gitlab", tokenEnv: "COMPANY_GITLAB_TOKEN" } });
	assert.equal(target.path, "group/repo");
	assert.equal(target.tokenEnv, "COMPANY_GITLAB_TOKEN");
	assert.equal(remoteTarget("git@git.example:owner/repo", { "git.example": { provider: "gitea" } }).tokenEnv, null);
	for (const url of ["https://github.com/owner/%2e%2e/repo", "https://github.com/owner/repo/extra"]) assert.throws(() => remoteTarget(url), /invalid-remote/);
	assert.equal(remoteTarget("https://github.com/owner/repo?token=secret"), null);
	assert.throws(() => remoteTarget("https://git.example/owner/repo", { "git.example": { provider: "gitea", tokenEnv: "HOME" } }), /invalid-config/);
});
await check("states preserve waiting, skipped, canceled and unknown rather than false green", () => {
	assert.equal(ciState("completed", "success"), "success");
	assert.equal(ciState("waiting"), "blocked");
	assert.equal(ciState("completed", null), "unknown");
	assert.equal(overallState([{ state: "success" }], true), "unknown");
	assert.equal(overallState([{ state: "skipped" }]), "skipped");
	assert.equal(overallState([{ state: "canceled" }]), "canceled");
	assert.equal(overallState([]), "none");
	assert.equal(overallState([{ state: "success" }, { state: "failure" }]), "failure");
	assert.equal(safeWebURL("javascript:alert(1)"), null);
	assert.equal(safeWebURL("https://secret@host/log"), null);
});
await check("no remote, unborn HEAD, invalid selection and unknown hosts never connect", async () => {
	for (const [options, kind] of [[{ remotes: "" }, "no-remote"], [{ unborn: true }, "no-head"], [{ url: "git@private.example:owner/repo" }, "unsupported-host"], [{ remote: "missing" }, "failed"]]) {
		const f = fixture(options); const result = await inspectCI(f.deps);
		assert.equal(result.kind, kind); assert.equal(f.requests.length, 0); assert.equal(f.commands.length, 0);
	}
});
await check("GitHub uses gh's host-bound authentication and combines Checks with external statuses", async () => {
	const f = fixture({ env: { GH_TOKEN: "GITHUB-ONLY", GH_ENTERPRISE_TOKEN: "OTHER-HOST" }, routes: {
		[`/repos/owner/repo/commits/${SHA}/check-runs`]: { total_count: 2, check_runs: [{ name: "test", head_sha: SHA, status: "completed", conclusion: "success", details_url: "https://github.com/owner/repo/actions/runs/1" }, { name: "wrong commit", head_sha: OTHER, status: "completed", conclusion: "failure" }] },
		[`/repos/owner/repo/commits/${SHA}/statuses`]: [{ context: "external", state: "pending", target_url: "https://ci.example/log" }, { context: "external", state: "failure" }]
	} });
	const result = await inspectCI(f.deps);
	assert.equal(result.kind, "ready"); assert.equal(result.sha, SHA); assert.equal(result.state, "pending"); assert.equal(result.checks.length, 2);
	assert.equal(f.commands.every(({ args, env }) => args.at(-1) === "github.com" && env.GH_TOKEN === "GITHUB-ONLY" && !("GH_ENTERPRISE_TOKEN" in env)), true);
	assert.equal(f.commands.every(({ args }) => args[2] === "graphql" && args.includes(`sha=${SHA}`)), true);
	assert.equal(f.requests.length, 1);
});
await check("GitHub auth checks only the active account, strips tokens, and verifies CI access", async () => {
	const f = fixture({ auth: true, routes: { [`/repos/owner/repo/commits/${SHA}/check-runs`]: { check_runs: [] } } });
	const result = await inspectCI(f.deps);
	assert.equal(result.kind, "ready"); assert.equal(result.login, "Fixture"); assert.equal(result.access, "ci-readable");
	assert.equal(JSON.stringify(result).includes("NEVER-RETURN-THIS"), false);
	assert.equal(f.commands[0].args.includes("--active"), true); assert.equal(f.commands[0].args.includes("--show-token"), false);
});

const actionsRun = (id = 7, extra = {}) => ({ id, name: "build", head_sha: SHA, status: "completed", conclusion: "success", app: { slug: "github-actions" }, details_url: `https://github.com/owner/repo/actions/runs/1/job/${id}`, ...extra });
const actionsJob = (id = 7, extra = {}) => ({ id, head_sha: SHA, status: "completed", check_run_url: `https://api.github.com/repos/owner/repo/check-runs/${id}`, steps: [], ...extra });
const actionsRoutes = (runs, jobs = {}) => ({
	[`/repos/owner/repo/commits/${SHA}/check-runs`]: { total_count: runs.length, check_runs: runs },
	[`/repos/owner/repo/commits/${SHA}/statuses`]: [], ...jobs
});
await check("GitHub Actions phases keep execution order, current state and completed durations", async () => {
	const f = fixture({ routes: actionsRoutes([actionsRun(7, { status: "in_progress" })], {
		"/repos/owner/repo/actions/jobs/7": actionsJob(7, { steps: [
			{ number: 4, name: "Package", status: "queued" },
			{ number: 2, name: "Syntax", status: "completed", conclusion: "failure", started_at: "2026-10-11T06:00:00Z", completed_at: "2026-10-11T06:00:03Z", token: "SECRET" },
			{ number: 1, name: "Checkout", status: "completed", conclusion: "success" },
			{ number: 3, name: "Tests", status: "in_progress" },
			{ number: 5, name: "Optional", status: "completed", conclusion: "skipped" }
		] })
	}) });
	const result = await inspectCI(f.deps);
	assert.equal(result.state, "running");
	assert.deepEqual(result.checks[0].steps.map(({ number, state }) => [number, state]), [[1, "success"], [2, "failure"], [3, "running"], [4, "not-started"], [5, "skipped"]]);
	assert.equal(result.checks[0].steps[1].durationSeconds, 3); assert.equal(result.checks[0].steps[0].durationSeconds, null);
	assert.equal(JSON.stringify(result).includes("SECRET"), false);
});
await check("unavailable Actions permissions preserve check results without exposing errors", async () => {
	const f = fixture({ routes: actionsRoutes([actionsRun()], { "/repos/owner/repo/actions/jobs/7": () => { throw Object.assign(new Error("PRIVATE-ERROR-TOKEN"), { code: "forbidden" }); } }) });
	const result = await inspectCI(f.deps);
	assert.equal(result.kind, "ready"); assert.equal(result.state, "success"); assert.equal(result.checks[0].stepsError, "forbidden");
	assert.equal(JSON.stringify(result).includes("PRIVATE"), false); assert.equal(result.checks[0].steps, undefined);
});
await check("Actions details must match HEAD and the exact check, with valid step numbers", async () => {
	for (const job of [actionsJob(7, { head_sha: OTHER }), actionsJob(8), actionsJob(7, { check_run_url: "https://api.github.com/repos/owner/repo/check-runs/6" }), actionsJob(7, { steps: [{ number: 1 }, { number: 1 }] }), actionsJob(7, { steps: [{ number: -1 }] }), actionsJob(7, { steps: null })]) {
		const f = fixture({ routes: actionsRoutes([actionsRun()], { "/repos/owner/repo/actions/jobs/7": job }) });
		const result = await inspectCI(f.deps);
		assert.equal(result.checks[0].stepsError, "invalid-response"); assert.equal(result.checks[0].steps, undefined);
	}
});
await check("Actions links cannot select another host/repository, and external checks need no job API", async () => {
	for (const link of ["https://evil.test/owner/repo/actions/runs/1/job/7", "https://github.com/other/repo/actions/runs/1/job/7", "https://token@github.com/owner/repo/actions/runs/1/job/7", "https://github.com/owner/repo/actions/runs/1/job/../7"]) {
		const f = fixture({ routes: actionsRoutes([actionsRun(7, { details_url: link })]) });
		assert.equal((await inspectCI(f.deps)).checks[0].stepsError, "unavailable"); assert.equal(f.requests.length, 1);
	}
	for (const link of ["https://github.com/owner/repo/runs/7", "https://github.com/owner/repo/runs/1/jobs/7"]) {
		const f = fixture({ routes: actionsRoutes([actionsRun(7, { details_url: link })], { "/repos/owner/repo/actions/jobs/7": actionsJob() }) });
		assert.deepEqual((await inspectCI(f.deps)).checks[0].steps, []);
	}
	const external = fixture({ routes: actionsRoutes([actionsRun(7, { app: { slug: "other-ci" } })]) });
	assert.equal((await inspectCI(external.deps)).checks[0].steps, undefined); assert.equal(external.requests.length, 1);
});
await check("Actions detail reads and step lists are bounded with an explicit limit marker", async () => {
	const runs = Array.from({ length: 11 }, (_, i) => actionsRun(i + 1));
	const jobs = Object.fromEntries(runs.map((run) => [`/repos/owner/repo/actions/jobs/${run.id}`, actionsJob(run.id, { steps: Array.from({ length: 101 }, (_, i) => ({ number: i + 1, name: "step", status: "completed", conclusion: "success" })) })]));
	const f = fixture({ routes: actionsRoutes(runs, jobs) });
	const result = await inspectCI(f.deps);
	assert.equal(f.requests.length, 11); assert.equal(result.checks[0].steps.length, 100); assert.equal(result.checks[0].stepsError, "limit");
	assert.equal(result.checks[10].steps, undefined); assert.equal(result.checks[10].stepsError, "limit");
});
await check("cancellation during Actions detail loading cannot return a stale successful response", async () => {
	const controller = new AbortController();
	const f = fixture({ signal: controller.signal, routes: actionsRoutes([actionsRun()], { "/repos/owner/repo/actions/jobs/7": () => { controller.abort(); return actionsJob(); } }) });
	assert.equal((await inspectCI(f.deps)).kind, "failed");
});
await check("gh JSON exit zero with failed authentication is not success", async () => {
	const f = fixture({ auth: true, authStatus: { hosts: { "github.com": [{ active: true, state: "error", login: "Fixture", error: "SECRET-ERROR" }] } } });
	const result = await inspectCI(f.deps);
	assert.equal(result.kind, "auth-invalid"); assert.equal(f.requests.length, 0); assert.equal(JSON.stringify(result).includes("SECRET"), false);
	const empty = fixture({ auth: true, authStatus: { hosts: {} } });
	assert.equal((await inspectCI(empty.deps)).kind, "auth-required");
});
await check("valid gh login is distinct from denied repository access", async () => {
	const f = fixture({ auth: true, commandError: { exitCode: 1, stdout: "", stderr: "HTTP 403 SECRET" } });
	const result = await inspectCI(f.deps);
	assert.equal(result.kind, "failed"); assert.equal(result.code, "forbidden"); assert.equal(result.login, "Fixture"); assert.equal(JSON.stringify(result).includes("SECRET"), false);
});
await check("missing gh allows anonymous public reads but explains the unavailable auth check", async () => {
	const f = fixture({ noGH: true, auth: true });
	assert.equal((await inspectCI(f.deps)).kind, "cli-missing");
	const publicRepo = fixture({ noGH: true, routes: {
		[`/repos/owner/repo/commits/${SHA}/check-runs`]: { total_count: 0, check_runs: [] }, [`/repos/owner/repo/commits/${SHA}/statuses`]: []
	} });
	assert.equal((await inspectCI(publicRepo.deps)).state, "none");
	assert.equal(publicRepo.requests.every(({ url, init }) => url.startsWith("https://api.github.com/") && !init.headers.Authorization && init.redirect === "error"), true);
});
await check("bounded GitHub pagination never reports a truncated all-green list as passed", async () => {
	const f = fixture({ routes: {
		[`/repos/owner/repo/commits/${SHA}/check-runs`]: { total_count: 400, check_runs: Array.from({ length: 100 }, (_, n) => ({ name: `test ${n}`, head_sha: SHA, status: "completed", conclusion: "success" })) },
		[`/repos/owner/repo/commits/${SHA}/statuses`]: []
	} });
	const result = await inspectCI(f.deps);
	assert.equal(result.partial, true); assert.equal(result.state, "unknown"); assert.equal(result.checks.length, 300);
});
await check("GraphQL follows opaque cursors and reads statuses on branches without a PR", async () => {
	let calls = 0;
	const f = fixture({ graphql: (args) => {
		assert.equal(args.includes("owner=owner"), true); assert.equal(args.includes("name=repo"), true);
		assert.equal(args.includes(`sha=${SHA}`), true); assert.equal(args.some((arg) => arg.includes("pullRequest(")), false);
		const data = graphqlSnapshot([{ __typename: "StatusContext", context: `external-${++calls}`, state: calls === 1 ? "SUCCESS" : "PENDING", targetUrl: "https://ci.example/log" }]);
		if (calls === 1) data.data.repository.object.statusCheckRollup.contexts.pageInfo = { hasNextPage: true, endCursor: "opaque+/=cursor" };
		else assert.equal(args.includes("cursor=opaque+/=cursor"), true);
		return data;
	} });
	const result = await inspectCI(f.deps);
	assert.equal(result.state, "pending"); assert.equal(result.checks.length, 2); assert.equal(result.partial, false); assert.equal(calls, 2);
	const empty = graphqlSnapshot(); empty.data.repository.object.statusCheckRollup = null;
	assert.equal((await inspectCI(fixture({ graphql: empty }).deps)).state, "none");
});
await check("GraphQL errors fail closed without leaking private messages, including nonzero gh exits", async () => {
	for (const [type, code] of [["FORBIDDEN", "forbidden"], ["NOT_FOUND", "not-found"], ["RATE_LIMITED", "rate-limit"], ["UNAUTHORIZED", "auth-required"], ["OTHER", "invalid-response"]]) {
		for (const exitCode of [0, 1]) {
			const data = graphqlSnapshot([], { errors: [{ type, message: "SECRET-PRIVATE" }] });
			const f = fixture({ commandError: { ...asJSON(data), exitCode } });
			const result = await inspectCI(f.deps);
			assert.equal(result.kind, "failed"); assert.equal(result.code, code); assert.equal(JSON.stringify(result).includes("SECRET"), false);
		}
	}
});
await check("malformed GraphQL responses, foreign HEADs and repeated cursors cannot produce false success", async () => {
	const mutations = [
		(data) => { data.data.repository.object.oid = OTHER; },
		(data) => { delete data.data.viewer; },
		(data) => { data.data.repository.object.statusCheckRollup.contexts.nodes = [null]; },
		(data) => { data.data.repository.object.statusCheckRollup.contexts.nodes = [{ __typename: "Other", state: "SUCCESS" }]; },
		(data) => { data.data.repository.object.statusCheckRollup.contexts.nodes = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: {} }]; },
		(data) => { data.data.repository.object.statusCheckRollup.contexts.pageInfo = { hasNextPage: true, endCursor: null }; },
		(data) => { data.data.repository.object.statusCheckRollup.contexts.pageInfo.hasNextPage = "false"; },
		(data) => { delete data.data.repository; }
	];
	for (const mutate of mutations) {
		const data = graphqlSnapshot(); mutate(data);
		assert.equal((await inspectCI(fixture({ graphql: data }).deps)).code, "invalid-response");
	}
	const repeated = graphqlSnapshot(); repeated.data.repository.object.statusCheckRollup.contexts.pageInfo = { hasNextPage: true, endCursor: "same" };
	assert.equal((await inspectCI(fixture({ graphql: repeated }).deps)).code, "invalid-response");
	const missing = graphqlSnapshot(); missing.data.repository.object = null;
	assert.equal((await inspectCI(fixture({ graphql: missing }).deps)).code, "not-found");
});
await check("completed Actions phases are shared only after a fresh authorized summary for the same account and check", async () => {
	const ciCache = new Map();
	const run = actionsRun(7, { completed_at: "2026-10-11T06:00:00Z" });
	const routes = actionsRoutes([run], { "/repos/owner/repo/actions/jobs/7": actionsJob(7, { steps: [{ number: 1, name: "Done", status: "completed", conclusion: "success" }] }) });
	const first = fixture({ ciCache, routes }); assert.equal((await inspectCI(first.deps)).checks[0].steps[0].name, "Done");
	assert.equal(first.requests.length, 2); assert.equal(ciCache.size, 1);
	const second = fixture({ ciCache, routes }); assert.equal((await inspectCI(second.deps)).checks[0].steps[0].name, "Done");
	assert.deepEqual(second.requests, ["graphql"]);
	const account = graphqlSnapshot([graphqlRun(run)]); account.data.viewer.id = "account-2";
	const switched = fixture({ ciCache, routes, graphql: account }); await inspectCI(switched.deps); assert.equal(switched.requests.length, 2);
	const denied = fixture({ ciCache, graphql: graphqlSnapshot([], { errors: [{ type: "FORBIDDEN" }] }) });
	assert.equal((await inspectCI(denied.deps)).kind, "failed"); assert.deepEqual(denied.requests, ["graphql"]);
	const rerun = fixture({ ciCache, routes: actionsRoutes([{ ...run, completed_at: "2026-10-11T06:01:00Z" }], { "/repos/owner/repo/actions/jobs/7": actionsJob() }) });
	await inspectCI(rerun.deps); assert.equal(rerun.requests.length, 2);
});
await check("running, canceled reads and failed phase requests are never cached", async () => {
	for (const variant of ["running", "aborted", "denied", "job-running"]) {
		const ciCache = new Map(), controller = new AbortController();
		const run = actionsRun(7, { status: variant === "running" ? "in_progress" : "completed", completed_at: "2026-10-11T06:00:00Z" });
		const f = fixture({ ciCache, signal: controller.signal, routes: actionsRoutes([run], { "/repos/owner/repo/actions/jobs/7": () => {
			if (variant === "aborted") controller.abort();
			if (variant === "denied") throw Object.assign(new Error("SECRET"), { code: "forbidden" });
			return actionsJob(7, { status: variant === "job-running" ? "in_progress" : "completed" });
		} }) });
		await inspectCI(f.deps); assert.equal(ciCache.size, 0, variant);
	}
});
await check("phase reuse expires and stays bounded, and incomplete step lists retain their marker", async () => {
	const ciCache = new Map(Array.from({ length: 200 }, (_, i) => [`old-${i}`, { expires: Date.now() + 60000, details: {} }]));
	const run = actionsRun(7, { completed_at: "2026-10-11T06:00:00Z" });
	const routes = actionsRoutes([run], { "/repos/owner/repo/actions/jobs/7": actionsJob(7, { steps: Array.from({ length: 101 }, (_, i) => ({ number: i + 1, status: "completed", conclusion: "success" })) }) });
	const f = fixture({ ciCache, routes }); await inspectCI(f.deps); assert.equal(ciCache.size, 200); assert.equal(ciCache.has("old-0"), false);
	const cached = fixture({ ciCache, routes }); const result = await inspectCI(cached.deps);
	assert.equal(result.checks[0].stepsError, "limit"); assert.equal(cached.requests.length, 1);
	for (const entry of ciCache.values()) entry.expires = 0;
	const expired = fixture({ ciCache, routes }); await inspectCI(expired.deps);
	assert.equal(expired.requests.length, 2); assert.equal(ciCache.size, 1);
});
await check("GitLab selects HEAD pipelines and latest attempts, with job/log links", async () => {
	const f = fixture({ url: "git@gitlab.com:group/sub/repo.git", env: { GITLAB_TOKEN: "GITLAB-ONLY", GITEA_TOKEN: "OTHER" }, routes: {
		"/api/v4/projects/group%2Fsub%2Frepo/pipelines": (url) => { assert.equal(url.searchParams.get("sha"), SHA); return [{ id: 2, sha: SHA, ref: "main", status: "success", web_url: "https://gitlab.com/group/sub/repo/-/pipelines/2" }, { id: 1, sha: SHA, ref: "main", status: "failed" }, { id: 3, sha: OTHER, ref: "other", status: "failed" }]; },
		[`/api/v4/projects/group%2Fsub%2Frepo/repository/commits/${SHA}/statuses`]: [{ name: "old", status: "failed", pipeline_id: 1 }, { name: "optional", status: "failed", pipeline_id: 2 }],
		"/api/v4/projects/group%2Fsub%2Frepo/pipelines/2/jobs": [{ name: "optional", stage: "test", status: "failed", allow_failure: true, web_url: "https://gitlab.com/group/sub/repo/-/jobs/3" }]
	} });
	const result = await inspectCI(f.deps);
	assert.equal(result.kind, "ready"); assert.equal(result.state, "success"); assert.equal(result.checks.some(({ name }) => name === "old"), false);
	assert.equal(result.checks.some(({ url }) => url?.endsWith("/jobs/3")), true);
	assert.equal(result.checks.find(({ url }) => url?.endsWith("/jobs/3")).group, "Pipeline #2 · test · allowed failure");
	assert.equal(f.requests.every(({ init }) => init.headers["PRIVATE-TOKEN"] === "GITLAB-ONLY" && !init.headers.Authorization && init.redirect === "error"), true);
});
await check("Gitea normalizes Actions plus external statuses and rejects other SHAs", async () => {
	const f = fixture({ url: "https://gitea.com/owner/repo.git", env: { GITEA_TOKEN: "GITEA-ONLY" }, routes: {
		[`/api/v1/repos/owner/repo/commits/${SHA}/status`]: { total_count: 1, statuses: [{ context: "external", state: "success", target_url: "javascript:alert(1)" }] },
		"/api/v1/repos/owner/repo/actions/runs": (url) => { assert.equal(url.searchParams.get("head_sha"), SHA); return { total_count: 2, workflow_runs: [{ name: "build", path: "build.yaml", head_sha: SHA, status: "in_progress", html_url: "https://gitea.com/owner/repo/actions/runs/1" }, { name: "other", head_sha: OTHER, status: "failure" }] }; }
	} });
	const result = await inspectCI(f.deps);
	assert.equal(result.kind, "ready"); assert.equal(result.state, "running"); assert.equal(result.checks.length, 2); assert.equal(result.checks[1].url, null);
	assert.equal(f.requests.every(({ init }) => init.headers.Authorization === "token GITEA-ONLY"), true);
});
await check("Gitea without an Actions API displays partial results rather than fake success", async () => {
	const f = fixture({ url: "git@gitea.com:owner/repo", routes: {
		[`/api/v1/repos/owner/repo/commits/${SHA}/status`]: { total_count: 1, statuses: [{ context: "external", state: "success" }] },
		"/api/v1/repos/owner/repo/actions/runs": new Response("not found", { status: 404 })
	} });
	const result = await inspectCI(f.deps);
	assert.equal(result.kind, "ready"); assert.equal(result.partial, true); assert.equal(result.state, "unknown");
});
await check("GitLab and Gitea auth verify the account and report the actual access checked", async () => {
	for (const provider of ["gitlab", "gitea"]) {
		const prefix = provider === "gitlab" ? "/api/v4" : "/api/v1";
		const f = fixture({ url: `https://${provider}.com/owner/repo`, auth: true, routes: { [`${prefix}/user`]: { username: "Fixture", login: "Fixture" }, [`${prefix}/${provider === "gitlab" ? "projects/owner%2Frepo/pipelines" : "repos/owner/repo"}`]: [] } });
		const result = await inspectCI(f.deps);
		assert.equal(result.kind, "ready"); assert.equal(result.login, "Fixture"); assert.equal(result.access, provider === "gitlab" ? "ci-readable" : "repo-readable");
	}
});
await check("HTTP auth failures and private response bodies are never confused with no CI", async () => {
	for (const [status, code] of [[401, "auth-required"], [403, "forbidden"], [404, "not-found"], [429, "rate-limit"], [500, "connection-failed"]]) {
		const f = fixture({ url: "https://gitea.com/owner/repo", fetchError: status });
		const result = await inspectCI(f.deps);
		assert.equal(result.kind, "failed"); assert.equal(result.code, code); assert.equal(JSON.stringify(result).includes("PRIVATE-ERROR"), false);
	}
});
await check("oversized/malformed provider output and cancellation fail closed", async () => {
	const f = fixture({ url: "https://gitea.com/owner/repo", routes: { [`/api/v1/repos/owner/repo/commits/${SHA}/status`]: new Response("x".repeat(2 * 1024 * 1024 + 1)) } });
	assert.equal((await inspectCI(f.deps)).code, "response-too-large");
	const bad = fixture({ commandError: { exitCode: 0, stdout: "not json" } });
	assert.equal((await inspectCI(bad.deps)).code, "invalid-response");
	const canceled = fixture({ signal: AbortSignal.abort() });
	assert.equal((await inspectCI(canceled.deps)).kind, "failed"); assert.equal(canceled.gitCalls.length, 0);
});
await check("gh account check works without a remote, without claiming repository CI access", async () => {
	const f = fixture({ remotes: "", auth: true });
	const result = await inspectCI(f.deps);
	assert.equal(result.kind, "ready"); assert.equal(result.access, "account-verified"); assert.equal(result.host, "github.com"); assert.equal(result.login, "Fixture"); assert.equal(f.requests.length, 0);
});
await check("GitHub keeps stale external checks unfinished while separating Actions and retaining timestamps", async () => {
	const started = "2026-07-18T16:14:04Z";
	const routes = actionsRoutes([
		actionsRun(7),
		{ name: "Cloudflare Pages", head_sha: SHA, app: { slug: "cloudflare-workers-and-pages" }, status: "in_progress", started_at: started }
	], { "/repos/owner/repo/actions/jobs/7": actionsJob() });
	for (const noGH of [false, true]) {
		const result = await inspectCI(fixture({ routes, noGH }).deps);
		assert.equal(result.state, "running");
		assert.deepEqual(result.groups, [{ source: "actions", count: 1, state: "success" }, { source: "external", count: 1, state: "running" }]);
		assert.equal(result.checks[1].startedAt, "2026-07-18T16:14:04.000Z");
		assert.equal(result.checks[1].app, "cloudflare-workers-and-pages");
	}
});
await check("commit-status age uses the latest report, and invalid dates never fabricate an old start", async () => {
	const routes = actionsRoutes([{ name: "other", head_sha: SHA, status: "in_progress", started_at: "invalid" }]);
	routes[`/repos/owner/repo/commits/${SHA}/statuses`] = [
		{ context: "deploy", state: "pending", created_at: "2026-10-11T10:00:00Z" },
		{ context: "deploy", state: "pending", created_at: "2026-07-18T10:00:00Z" }
	];
	const result = await inspectCI(fixture({ routes }).deps);
	assert.equal(result.checks[0].startedAt, null);
	assert.equal(result.checks[1].startedAt, "2026-10-11T10:00:00.000Z");
	assert.equal(result.checks.length, 2); assert.equal(result.groups[0].source, "external");
});
console.log(`\nPASS  ${passed} checks`);
