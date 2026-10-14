// @ts-nocheck -- moved verbatim from the hand-written bundle; type it when it is next changed.
import { react, primitives, h } from "./deps";
import { en } from "./locales";

/**
 * The explanation to show in place of a view, or null when there is content.
 *
 * `no-workspace` and `no-repository` are answers about the session rather than
 * failures, and the tab says so in its own words.
 */
export function placeholder(state, t) {
	// `idle` is load-bearing: a view renders once BEFORE its effect has run, so
	// on the pass where a view first becomes active its resource is still idle.
	// Treating that as "no content" would dereference an absent payload.
	if (state.phase === "idle" || state.phase === "loading") return t("loading");
	if (state.phase === "no-workspace") return t("noWorkspace");
	if (state.phase === "error") return t("error").replace("{message}", state.message);
	if (state.value?.kind === "no-workspace") return t("noWorkspace");
	if (state.value?.kind === "no-repository") return t("noRepository");
	return null;
}

/** One row of the view switcher. */
export function viewTab(id, active, onSelect, t) {
	return h(
		primitives.Button,
		{
			key: id,
			variant: "ghost",
			className: "gt_view",
			"aria-pressed": active,
			size: "sm",
			onClick: () => onSelect(id),
			children: t(`view.${id}`)
		}
	);
}

/**
 * The banner that reports an operation git is in the middle of.
 *
 * A rebase is the reason this exists: the repository is in a state no ordinary
 * status conveys, and it must be visible from every view, not just Branches.
 * Nothing here changes that state — finishing or aborting belongs to the
 * terminal — so the banner reports and says where to act.
 */
export function operationBanner(state, t) {
	// `undefined` is guarded alongside `null` because the two halves can
	// legitimately disagree: the Host half is frozen when the server starts,
	// while this bundle is re-read live, so a field added here may be absent
	// on the wire for one server generation. Announcing nothing is the right
	// degradation — dereferencing it blanked the whole pane.
	if (state === null || state === undefined || state.kind === null) return null;
	const detail = [];
	if (state.branch !== null) detail.push(t("op.branch").replace("{branch}", state.branch));
	if (state.onto !== null) detail.push(t("op.onto").replace("{onto}", state.onto));
	if (state.commit !== null) detail.push(t("op.commit").replace("{commit}", state.commit));
	if (state.step !== null && state.total !== null) {
		detail.push(t("op.step").replace("{step}", String(state.step)).replace("{total}", String(state.total)));
	}

	return h(
		"div",
		{ key: "operation", className: "gt_banner" },
		h(
			"div",
			{ className: "gt_bannerTop" },
			h(primitives.Tag, { tone: "warning" }, t(`op.${state.kind}`)),
			h("span", { className: "gt_name" }, detail.join(" "))
		),
		h("div", { className: "gt_bannerDetail" }, t("op.hint"))
	);
}

export function patchParts(text, fallbackPath = "") {
	const parts = [];
	let path = fallbackPath;
	let hunk = null;
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	for (const line of lines) {
		if (line.startsWith("diff --git ")) { hunk = null; path = fallbackPath; }
		const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (header !== null) {
			hunk = { path, header: line, oldStart: Number(header[1]), newStart: Number(header[2]), lines: [] };
			parts.push(hunk);
		} else if (hunk !== null && /^[ +\-\\]/.test(line)) {
			hunk.lines.push(line);
		} else {
			hunk = null;
			if (/^(---|\+\+\+) /.test(line) && !line.endsWith("/dev/null")) {
				path = line.slice(4).replace(/^"|"$/g, "").replace(/^[ab]\//, "");
			}
			parts.push(line);
		}
	}
	return parts;
}

/** Pair a contiguous edit block by position; blank cells preserve unequal line counts. */
export function splitHunk(hunk) {
	const rows = [];
	let left = [], right = [], oldIndex = 0, newIndex = 0, previous = [];
	const flush = () => {
		for (let i = 0; i < Math.max(left.length, right.length); i++) rows.push([left[i] ?? null, right[i] ?? null]);
		left = []; right = [];
	};
	for (const line of hunk.lines) {
		const sign = line[0];
		const cell = (index, number) => ({ sign, text: line.slice(1), index, number });
		if (sign === " ") {
			flush();
			previous = [cell(oldIndex, hunk.oldStart + oldIndex++), cell(newIndex, hunk.newStart + newIndex++)];
			rows.push(previous);
		} else if (sign === "-") {
			previous = [cell(oldIndex, hunk.oldStart + oldIndex++)]; left.push(previous[0]);
		} else if (sign === "+") {
			previous = [cell(newIndex, hunk.newStart + newIndex++)]; right.push(previous[0]);
		} else if (sign === "\\") {
			for (const item of previous) item.note = line;
		}
	}
	flush();
	return rows;
}

export function PatchHunk({ hunk, side = null, t = (key) => en[key] }) {
	const highlight = primitives.useCodeHighlighter(primitives.languageForPath(hunk.path));
	// shortcut: syntax context starts at each hunk, fetch full files if cross-hunk grammar state is needed.
	const oldLines = hunk.lines.filter((line) => /^[ -]/.test(line)).map((line) => line.slice(1));
	const newLines = hunk.lines.filter((line) => /^[ +]/.test(line)).map((line) => line.slice(1));
	const oldTokens = side === 1 ? undefined : highlight(oldLines.join("\n"));
	const newTokens = side === 0 ? undefined : highlight(newLines.join("\n"));
	const numberWidth = `${Math.max(4, String(hunk.oldStart + oldLines.length).length, String(hunk.newStart + newLines.length).length)}ch`;
	let oldIndex = 0;
	let newIndex = 0;
	const paint = (tokens, text) => tokens === undefined ? text : tokens.map((token, i) => h("span", { key: i, style: token.style }, token.text));
	const header = h("span", { className: "gt_patchLine gt_patchMeta", "data-hunk": side !== 1 ? true : undefined, tabIndex: -1 }, hunk.header);
	if (side !== null) return h(react.Fragment, null, header,
		splitHunk(hunk).map((row, index) => { const cell = row[side]; return h("span", { key: index, className: cell?.sign === "+" ? "gt_patchLine gt_patchAdd" : cell?.sign === "-" ? "gt_patchLine gt_patchDelete" : "gt_patchLine", "data-empty": cell === null, "aria-hidden": cell === null ? true : undefined },
				cell === null ? null : h(react.Fragment, null,
					h("span", { className: "gt_patchNumber", "aria-label": t(side === 0 ? "oldLine" : "newLine").replace("{n}", String(cell.number)), style: { width: numberWidth } }, cell.number),
					h("span", { className: "gt_patchSign" }, cell.sign),
					h("span", { className: "gt_patchCode" }, paint((side === 0 ? oldTokens : newTokens)?.[cell.index], cell.text), cell.note ? h("span", { className: "gt_patchNote" }, cell.note) : null))); }));
	return h(react.Fragment, null,
		header,
		hunk.lines.map((line, index) => {
			const sign = line[0];
			const oldLine = sign === " " || sign === "-" ? oldIndex++ : null;
			const newLine = sign === " " || sign === "+" ? newIndex++ : null;
			const tokens = sign === "-" ? oldTokens?.[oldLine] : newLine === null ? undefined : newTokens?.[newLine];
			return h("span", {
				key: index,
				className: sign === "+" ? "gt_patchLine gt_patchAdd" : sign === "-" ? "gt_patchLine gt_patchDelete" : "gt_patchLine",
				title: `${oldLine === null ? "—" : hunk.oldStart + oldLine} → ${newLine === null ? "—" : hunk.newStart + newLine}`
			}, h("span", { className: "gt_patchNumber", "aria-hidden": "true", style: { width: numberWidth }, title: oldLine === null ? undefined : t("oldLine").replace("{n}", String(hunk.oldStart + oldLine)) }, oldLine === null ? "" : hunk.oldStart + oldLine),
				h("span", { className: "gt_patchNumber", "aria-hidden": "true", style: { width: numberWidth }, title: newLine === null ? undefined : t("newLine").replace("{n}", String(hunk.newStart + newLine)) }, newLine === null ? "" : hunk.newStart + newLine),
				h("span", { className: "gt_patchSign" }, sign),
				h("span", { className: "gt_patchCode" }, paint(tokens, line.slice(1))));
		})
	);
}

/** What a patch resource says instead of a patch, or null when there is one to draw. */
export function patchState(detail, t) {
	if (detail.phase === "loading" || detail.phase === "idle") return t("loading");
	if (detail.phase === "error") return t("error").replace("{message}", detail.message);
	if (detail.value?.kind === "no-workspace") return t("noWorkspace");
	if (detail.value?.kind === "no-repository") return t("noRepository");
	if (detail.value?.kind === "rejected") return t("rejected.generic");
	if (detail.value?.binary === true) return t("diffBinary");
	if (!detail.value?.text) return t("diffNone");
	return null;
}

/** Draw parsed patch parts unified, or as two scroll-linked sides. */
export function patchBody(parts, t, { split = false, wrapped = false } = {}) {
	const renderParts = (side) => parts.map((part, index) => typeof part === "string"
			? h("span", { key: index, className: "gt_patchLine gt_patchMeta" }, part)
			: h(PatchHunk, { key: index, hunk: part, t, side }));
	if (!split) return h("pre", { className: "gt_patch", "data-wrap": wrapped, "data-layout": "unified" }, renderParts(null));
	const rows = 1 + parts.reduce((count, part) => count + (typeof part === "string" ? 1 : 1 + splitHunk(part).length), 0);
	return h("div", { className: "gt_patch", "data-wrap": wrapped, "data-layout": "split" }, [0, 1].map((side) =>
		h("pre", { key: side, className: "gt_splitSide", style: { gridColumn: side + 1, gridRow: `1 / span ${rows}` }, "aria-label": t(side === 0 ? "diff.before" : "diff.after"),
			onScroll: (event) => {
				const source = event.currentTarget;
				if (source.dataset.syncedScroll === String(source.scrollLeft)) return;
				for (const target of source.parentElement.children) if (target !== source) {
					const offset = Math.min(source.scrollLeft, target.scrollWidth - target.clientWidth);
					target.dataset.syncedScroll = String(offset); target.scrollLeft = offset;
				}
			} },
			h("span", { className: "gt_patchLine gt_patchMeta" }, t(side === 0 ? "diff.before" : "diff.after")), renderParts(side))));
}

export function diffPane(detail, t, close, onBlame, { wrapped = false, onWrap, copied = false, onCopy, height = 55, onResize, hunk = -1, onHunk, layout = "auto", wide = false, onLayout, paneRef } = {}) {
	const split = layout === "split" || (layout === "auto" && wide);
	const parts = patchParts(detail.value?.text ?? "", detail.path);
	const hunkCount = parts.filter((part) => typeof part !== "string").length;
	const resize = (value) => onResize?.(Math.min(80, Math.max(20, value)));
	const navigate = (event, direction) => {
		const targets = event.currentTarget.closest(".gt_pane").querySelectorAll("[data-hunk]");
		const next = Math.min(targets.length - 1, Math.max(0, hunk + direction));
		if (!targets[next]) return;
		targets[next].scrollIntoView({ block: "start", inline: "nearest" });
		targets[next].focus({ preventScroll: true });
		onHunk?.(next);
	};
	const content = patchState(detail, t) ?? patchBody(parts, t, { split, wrapped });

	const scopeKey = `scope.${detail.scope ?? "head"}`;
	return h(
		"div",
		{ key: "diff", className: "gt_pane", ref: paneRef, style: { flexBasis: `${height}%` } },
		h("div", { className: "gt_resize", role: "separator", tabIndex: 0, "aria-label": t("resizeDiff"), title: t("resizeDiff"), "aria-orientation": "horizontal", "aria-valuemin": 20, "aria-valuemax": 80, "aria-valuenow": Math.round(height),
			onPointerDown: (event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); },
			onPointerMove: (event) => {
				if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
				const rect = event.currentTarget.closest(".gt_root").getBoundingClientRect();
				if (rect.height > 0) resize((rect.bottom - event.clientY) / rect.height * 100);
			},
			onPointerUp: (event) => event.currentTarget.releasePointerCapture(event.pointerId),
			onKeyDown: (event) => {
				const value = { ArrowUp: height + 5, ArrowDown: height - 5, Home: 20, End: 80 }[event.key];
				if (value === undefined) return;
				event.preventDefault(); resize(value);
			} }),
		h(
			"div",
			{ className: "gt_paneHead" },
			h("div", { className: "gt_paneTitle" },
				h("span", { className: "gt_paneLabel", title: detail.label }, detail.label ?? t("diffTitle")),
				h(primitives.Button, { key: "close", variant: "ghost", size: "sm", onClick: close, children: t("diffClose") })),
			h(primitives.Tag, { tone: "neutral" }, t(scopeKey)),
			h("div", { className: "gt_diffLayout", role: "group", "aria-label": t("diff.layout") }, ["auto", "split", "unified"].map((mode) =>
				h(primitives.Button, { key: mode, variant: "ghost", size: "sm", "aria-pressed": layout === mode, onClick: () => onLayout?.(mode), children: t(`diff.${mode}`) }))),
			detail.path
				? h(primitives.Button, {
						key: "blame",
						variant: "ghost",
						size: "sm",
						title: t("blameHint"),
						onClick: () => onBlame(detail.path),
						children: t("blameShow")
					})
				: null,
			h(primitives.Button, { variant: "ghost", size: "sm", "aria-pressed": wrapped, onClick: onWrap, children: t(wrapped ? "unwrap" : "wrap") }),
			h(primitives.Button, { variant: "ghost", size: "sm", disabled: !detail.value?.text, onClick: () => onCopy?.(detail.value.text), children: t(copied ? "copied" : "copy") }),
			hunkCount > 0 ? h("div", { className: "gt_meta" },
				h(primitives.Button, { variant: "ghost", size: "sm", title: t("previousHunk"), "aria-label": t("previousHunk"), disabled: hunk <= 0, onClick: (event) => navigate(event, -1), children: "↑" }),
				h("span", { "aria-live": "polite" }, `${Math.min(hunk + 1, hunkCount)}/${hunkCount}`),
				h(primitives.Button, { variant: "ghost", size: "sm", title: t("nextHunk"), "aria-label": t("nextHunk"), disabled: hunk >= hunkCount - 1, onClick: (event) => navigate(event, 1), children: "↓" })) : null
		),
		h("div", { className: "gt_paneBody" }, content),
		detail.pollError ? h("span", { className: "gt_note gt_warning", role: "status" }, t("diff.stale")) : null,
		detail.value?.truncated === true ? h("span", { className: "gt_note" }, t("diffTruncated")) : null
	);
}
