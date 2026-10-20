/**
 * Where Git appears: the right sidebar, a conversation tab, or both.
 *
 * The choice is kept in this browser's storage. ponytail: per-browser, not per
 * Host; move it to a Host settings namespace (`ctx.configForms`) when this
 * package ships inside DSH, so every client of one Host agrees.
 */
import { h, primitives, react } from "./deps";
import type { Translate } from "./types";

export type Placement = "both" | "sidebar" | "conversation";
export const PLACEMENTS: readonly Placement[] = ["both", "sidebar", "conversation"];
const PLACEMENT_KEY = "dsh-gitview.placement";

export interface PlacementStore {
	get(): Placement;
	set(value: Placement): void;
	subscribe(listener: () => void): () => void;
}

export function placementStore(): PlacementStore {
	const listeners = new Set<() => void>();
	let value: Placement = "both";
	try {
		const saved = window.localStorage?.getItem(PLACEMENT_KEY);
		if (PLACEMENTS.includes(saved as Placement)) value = saved as Placement;
	} catch {
		// Browser policy may disable storage; the default stands.
	}
	return {
		get: () => value,
		set(next) {
			if (next === value) return;
			value = next;
			try {
				window.localStorage?.setItem(PLACEMENT_KEY, next);
			} catch {
				// The choice still applies for this page.
			}
			for (const listener of [...listeners]) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}

/** One General Settings row, drawn like the shell's own selector rows. */
export function PlacementRow({ placement, t }: { placement: PlacementStore; t: Translate }) {
	const [value, setValue] = react.useState(placement.get);
	const [open, setOpen] = react.useState(false);
	react.useEffect(() => placement.subscribe(() => setValue(placement.get())), [placement]);
	return (
		<div className="gt_setRow">
			<div className="gt_setText">
				<div className="gt_setTitle">{t("settings.placement.title")}</div>
				<div className="gt_setDesc">{t("settings.placement.description")}</div>
			</div>
			<primitives.Menu
				open={open}
				onClose={() => setOpen(false)}
				items={PLACEMENTS.map((id) => ({ id, label: t(`placement.${id}`) }))}
				selectedId={value}
				onSelect={(id: string) => {
					setOpen(false);
					placement.set(id as Placement);
				}}
				align="end"
				portal
				anchor={
					<button type="button" className="gt_setSelector" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
						{t(`placement.${value}`)}
						<primitives.IconChevronDownOutlineRegular className="gt_icon" />
					</button>
				}
			/>
		</div>
	);
}
