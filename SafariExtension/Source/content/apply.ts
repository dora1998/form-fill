import { candidates } from './fields';
import type { Snapshot, FillRequest, FillResponse, DiagnosticRecord } from '../shared/contracts';
import { unchanged } from './snapshot';
export function createApply(takeSnapshot: () => Snapshot | undefined, getRecord: () => DiagnosticRecord | undefined) {
    async function apply(message: FillRequest): Promise<FillResponse> {
        const saved = takeSnapshot();
        if (!saved || message.requestID !== saved.requestID || saved.url !== location.href
            || !Array.isArray(message.items) || message.items.length > 40
            || saved.entries.some(entry => !unchanged(entry) || entry.element.value !== entry.initialValue)
            || candidates().length !== saved.all.length
            || candidates().some((element, index) => element !== saved.all[index])) {
            return ({ version: 1, ok: false, error: 'stale_plan' });
        }
        const ids = new Set();
        const targets = [];
        for (const item of message.items) {
            const entry = saved.entries.find(entry => entry.field.id === item.id);
            if (!entry || ids.has(item.id) || typeof item.value !== 'string' || item.value.length > 300) {
                return ({ version: 1, ok: false, error: 'invalid_plan' });
            }
            ids.add(item.id);
            if (entry.field.maxLength > 0 && item.value.length > entry.field.maxLength)
                return ({ version: 1, ok: false, error: 'invalid_plan' });
            if (entry.field.pattern) {
                try {
                    if (!new RegExp(`^(?:${entry.field.pattern})$`, 'v').test(item.value))
                        return ({ version: 1, ok: false, error: 'invalid_plan' });
                }
                catch {
                    return ({ version: 1, ok: false, error: 'invalid_plan' });
                }
            }
            if (entry.field.tag === 'select' && !entry.field.options.some(option => !option.disabled && option.value === item.value)) {
                return ({ version: 1, ok: false, error: 'invalid_plan' });
            }
            targets.push({ entry, item });
        }
        const results = [];
        for (const { entry, item } of targets) {
            // Site address completion may have changed another field after an earlier input.
            if (saved.url !== location.href || document.visibilityState === 'hidden' || !unchanged(entry) || entry.element.value !== entry.initialValue) {
                results.push({ id: item.id, status: 'changed_by_page' });
                continue;
            }
            const prototype = entry.field.tag === 'select' ? HTMLSelectElement.prototype
                : entry.field.tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            try {
                Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(entry.element, item.value);
                entry.element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                entry.element.dispatchEvent(new Event('change', { bubbles: true }));
                results.push({ id: item.id, status: 'filled' });
            }
            catch {
                results.push({ id: item.id, status: 'failed' });
            }
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        for (const result of results) {
            const target = targets.find(target => target.item.id === result.id);
            if (result.status === 'filled' && target && (!target.entry.element.isConnected || target.entry.element.value !== target.item.value))
                result.status = 'changed_by_page';
        }
        return ({ version: 1, ok: true, results });
    }
    return apply;
}
