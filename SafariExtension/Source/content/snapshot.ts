import { candidates, eligible, groupIDs, metadata } from './fields';
import type { Control, Entry, Snapshot } from './types';

/** A scan is scoped to one validation, never reused across page event dispatch. */
export const scanDocument = () => {
    const all = candidates();
    return { all, groups: groupIDs(all) };
};
export const unchanged = (entry: Entry, groups: Map<Control, string>) => entry.element.isConnected && eligible(entry.element)
    && JSON.stringify(metadata(entry.element, entry.field.id, groups)) === JSON.stringify(entry.field);
export function snapshotUnchanged(snapshot: Snapshot) {
    const { all, groups } = scanDocument();
    return all.length === snapshot.all.length && all.every((element, index) => element === snapshot.all[index])
        && snapshot.entries.every(entry => unchanged(entry, groups) && entry.element.value === entry.initialValue);
}
export function createSnapshotSession(environment: {
    url(): string; visible(): boolean; now(): number;
    validate(snapshot: Snapshot): boolean;
}) {
    let current: Snapshot | undefined;
    let expires = 0;
    const clear = () => { current = undefined; expires = 0; };
    const matches = (id: string) => Boolean(current && current.requestID === id && current.url === environment.url()
        && environment.visible() && environment.now() < expires && environment.validate(current));
    return {
        create(snapshot: Snapshot, lifetime = 180_000) { current = snapshot; expires = environment.now() + lifetime; },
        matches,
        discard(id?: string) { if (!id || current?.requestID === id) clear(); },
        take() { const saved = current && matches(current.requestID) ? current : undefined; clear(); return saved; },
        fieldID(id: string, element: Control) {
            return current?.requestID === id && current.url === environment.url()
                ? current.entries.find(entry => entry.element === element)?.field.id ?? null : null;
        }
    };
}
