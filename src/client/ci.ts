// @ts-nocheck -- moved verbatim from the hand-written bundle; type it when it is next changed.
import { primitives, h } from "./deps";
import { ciActive, ciDisplayState, ciOverdue } from "./data";
import { placeholder } from "./chrome";

export const CI_TONES = { success: "gt_success", failure: "gt_danger", running: "gt_info", pending: "gt_info", blocked: "gt_warning", overdue: "gt_warning" };
export function ciSummary(value, t) {
	return value.groups?.length ? value.groups.map((group) => h("span", { key: group.source, className: "gt_ciState" },
		t(`ci.source.${group.source}`), ciStatus(ciDisplayState(group.state, value.checks.filter((check) => check.source === group.source)), t)))
		: ciStatus(ciDisplayState(value.state, value.checks ?? []), t);
}
export function ciStatus(state, t) {
	return h("span", { className: "gt_ciState " + (CI_TONES[state] ?? "gt_neutral") },
		["running", "pending"].includes(state) ? h("span", { className: "gt_ciSpinner", "aria-hidden": true })
			: h("svg", { className: "gt_ciStatusIcon", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true, focusable: "false" },
				h("circle", { cx: 8, cy: 8, r: 6.25 }),
				h("path", { d: state === "success" ? "M4.5 8 7 10.5 11.5 5.5" : state === "failure" ? "m5.5 5.5 5 5m0-5-5 5" : state === "blocked" ? "M6 5v6m4-6v6" : state === "canceled" ? "m4 12 8-8" : "M5 8h6", strokeLinecap: "round", strokeLinejoin: "round" })),
		t(`ci.state.${state}`));
}
export function connectionMessage(value, t) {
	return value.kind === "failed" ? t(`ci.error.${value.code ?? "connection-failed"}`) : t(`ci.kind.${value.kind}`);
}

export function CISteps({ check, t, expanded, onToggle, onAsk }) {
	const steps = check.steps;
	const finished = steps?.filter((step) => ["success", "failure", "skipped", "canceled", "neutral"].includes(step.state)).length ?? 0;
	return h("div", null,
		steps ? h("details", { className: "gt_ciSteps", open: expanded, onToggle: (event) => { if (event.currentTarget.open !== expanded) onToggle(event.currentTarget.open); } },
			h("summary", null,
				h("span", { className: "gt_disclosure", "aria-hidden": true }, h("svg", { viewBox: "0 0 12 12", width: 12, height: 12, focusable: "false" }, h("path", { d: "m4 2 4 4-4 4", fill: "none", stroke: "currentColor", strokeWidth: 1.5 }))),
				t("ci.steps"), steps.length ? h("span", { className: "gt_ciStepCount" }, `${finished}/${steps.length} ${t("ci.finished")}`) : null),
			steps.length === 0 ? h("p", { className: "gt_note" }, t("ci.stepsWaiting")) : h("ol", { "aria-label": t("ci.steps") }, steps.map((step) => h("li", { key: step.number, className: "gt_ciStep", "data-state": step.state, "data-step": step.number, tabIndex: -1, "aria-current": step.state === "running" ? "step" : undefined },
				h("span", { className: "gt_ciStepNumber", "aria-hidden": true }, step.number),
				h("span", { className: "gt_subject" }, step.name),
				h("div", { className: "gt_meta gt_ciStepMeta" }, ciStatus(ciOverdue(check) && ciActive(step) ? "overdue" : step.state, t), step.durationSeconds == null ? null : ` · ${step.durationSeconds}s`,
					step.state === "failure" ? h(primitives.Button, { variant: "ghost", size: "sm", title: t("ci.askHint"), onClick: () => onAsk(check, step), children: t("ci.ask") }) : null))))) : null,
		check.stepsError ? h("p", { className: "gt_note gt_warning" }, t(check.stepsError === "limit" ? "ci.stepsLimit" : "ci.stepsUnavailable"),
			!["limit", "unavailable"].includes(check.stepsError) ? ` ${t(`ci.error.${check.stepsError}`)}` : "") : null);
}

export function CIView({ state, auth, authRequested, onAuth, remote, onRemote, t, expanded = {}, onExpand, onAsk }) {
	const explanation = placeholder(state, t);
	const value = state.value;
	const canCheck = value?.kind === "no-remote" || (value?.provider && !["unsupported-remote", "unsupported-host"].includes(value.kind));
	const authValue = auth.value;
	const checks = value?.checks ?? [];
	return h("div", { className: "gt_body gt_ciView", key: "ci" },
		h("div", { className: "gt_ciHead" },
			(value?.remotes?.length ?? 0) > 0 ? h("label", { className: "gt_meta" }, t("ci.remote"),
				h("select", { className: "gt_input", value: remote || value.remote, onChange: (event) => onRemote(event.target.value), "aria-label": t("ci.remote") },
					value.remotes.map((name) => h("option", { key: name, value: name }, name)))) : null,
			canCheck ? h(primitives.Button, { variant: "ghost", size: "sm", disabled: authRequested && auth.phase === "loading", onClick: onAuth,
				title: `${t("ci.authHint")}${authRequested ? "" : ` ${t("ci.authIdle")}`}`, children: t(value.provider === "github" || value.kind === "no-remote" ? "ci.ghAuth" : "ci.auth") }) : null),
		value ? h("section", { className: "gt_ciOverview", "aria-label": t("ci.overview") },
			h("div", { className: "gt_ciOverviewHead", role: value.kind === "ready" ? "status" : undefined },
				h("div", { className: "gt_ciIdentity" }, h("strong", null, value.repository || t("view.ci")),
					value.provider ? h("div", { className: "gt_meta" }, `${value.provider} · ${value.host}`) : null),
				value.kind === "ready" ? ciSummary(value, t) : null),
			h("div", { className: "gt_ciContext" },
				value.sha ? h("code", { className: "gt_sha", title: value.sha }, `HEAD ${value.sha.slice(0, 12)}`) : null,
				value.kind === "ready" ? h("span", null, t("ci.checkCount").replace("{n}", String(checks.length))) : null,
				h("span", { className: "gt_ciPoll", title: t("ci.live") }, state.refreshing ? h("span", { className: "gt_ciSpinner", "aria-hidden": true }) : null,
					state.refreshing ? t("ci.refreshing") : t("ci.auto")),
				state.updatedAt ? h("span", null, t("lastChecked").replace("{time}", new Date(state.updatedAt).toLocaleTimeString())) : null)) : null,
		state.pollError ? h("p", { className: "gt_note gt_warning", role: "status" }, t("ci.stale")) : null,
		explanation !== null ? h("p", { className: "gt_statusLine" }, explanation) : value?.kind !== "ready" ? h("p", { className: "gt_statusLine" }, connectionMessage(value, t)) : h("div", { className: "gt_ciJobs" },
			value.partial ? h("p", { className: "gt_note gt_warning" }, t("ci.partial")) : null,
			checks.map((check) => {
				const key = JSON.stringify([value.host, value.repository, value.sha, check.url, check.group, check.name]);
				const target = check.steps?.find((step) => step.state === "failure") ?? check.steps?.find((step) => step.state === "running");
				return h("article", { key, className: "gt_ciRow" },
				h("div", { className: "gt_ciJobHead" },
					h("div", { className: "gt_stack" },
						check.url && /^https:\/\//.test(check.url) ? h("a", { className: "gt_subject", href: check.url, target: "_blank", rel: "noopener noreferrer" }, check.name) : h("span", { className: "gt_subject" }, check.name),
						check.source ? h("div", { className: "gt_meta" }, t(`ci.source.${check.source}`), check.app ? ` · ${check.app}` : "") : check.group ? h("div", { className: "gt_meta" }, check.group) : null),
					ciStatus(ciOverdue(check) ? "overdue" : check.state, t)),
				ciOverdue(check) ? h("p", { className: "gt_note gt_warning", title: check.startedAt }, t("ci.overdue").replace("{hours}", String(Math.floor((Date.now() - Date.parse(check.startedAt)) / 3600000)))) : null,
				h("div", { className: "gt_commitRow" },
					h(primitives.Button, { variant: "ghost", size: "sm", title: t("ci.askHint"), onClick: () => onAsk(check), children: t("ci.ask") }),
					target ? h(primitives.Button, { variant: "ghost", size: "sm", onClick: (event) => {
						onExpand(key, true);
						const row = event.currentTarget.closest(".gt_ciRow");
						row.querySelector("details").open = true;
						const step = [...row.querySelectorAll("[data-step]")].find((node) => node.dataset.step === String(target.number));
						step?.scrollIntoView({ block: "nearest" }); step?.focus({ preventScroll: true });
					}, children: t("ci.jump") }) : null),
				h(CISteps, { check, t, expanded: expanded[key] ?? (!ciOverdue(check) && ["failure", "running", "pending", "blocked"].includes(check.state)), onToggle: (open) => onExpand(key, open), onAsk })); })),
		canCheck && authRequested ? h("details", { className: "gt_connection", open: true, "aria-label": t("ci.accountDetails") },
			h("summary", null, t("ci.accountDetails")),
			h("div", { "aria-live": "polite" }, placeholder(auth, t) ?? (authValue?.kind === "ready" ? h("div", null,
				h("div", { className: "gt_success" }, t(`ci.access.${authValue.access}`)),
				h("div", null, `${t("ci.account")}: ${authValue.login}`),
				h("div", null, `${t("ci.source")}: ${authValue.source || "—"}`),
				h("div", null, `${t("ci.scopes")}: ${authValue.scopes || t("ci.noScopes")}`)) : h("div", null,
				connectionMessage(authValue ?? { kind: "failed" }, t),
				authValue?.login ? h("div", null, `${t("ci.account")}: ${authValue.login}`) : null,
					authValue?.command ? h("code", null, authValue.command) : null)))) : null);
}
