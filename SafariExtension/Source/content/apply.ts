import { candidates } from './fields';
import type { Snapshot, FillRequest, FillResponse, DiagnosticRecord } from '../shared/contracts';
import { unchanged } from './snapshot';
export function createApply(takeSnapshot: () => Snapshot | undefined, getRecord: () => DiagnosticRecord | undefined) {
    async function apply(message: FillRequest): Promise<FillResponse> {
        const saved = takeSnapshot();
        const record = saved && getRecord()?.requestID === message.requestID && getRecord()?.url === location.href ? getRecord() : null;
        const observe = (stage: string, id: string, error?: unknown) => {
            if (!record || !saved)
                return;
            record.fill.events.push({ at: new Date().toISOString(), stage, id,
                error: error ? String(error instanceof Error ? error.stack : error) : undefined,
                values: saved.entries.map(entry => ({ id: entry.field.id, value: entry.element.value, connected: entry.element.isConnected })) });
        };
        const finish = (response: FillResponse): FillResponse => {
            if (record && saved) {
                record.fill.response = response;
                record.fill.after = saved.entries.map(entry => ({ id: entry.field.id, value: entry.element.value, connected: entry.element.isConnected }));
                record.fill.completedAt = new Date().toISOString();
            }
            return response;
        };
        if (record && saved)
            record.fill = { events: [], startedAt: new Date().toISOString(), request: message,
                before: saved.entries.map(entry => ({ id: entry.field.id, value: entry.element.value })) };
        if (!saved || message.requestID !== saved.requestID || saved.url !== location.href
            || !Array.isArray(message.items) || message.items.length > 40
            || saved.entries.some(entry => !unchanged(entry) || entry.element.value !== entry.initialValue)
            || candidates().length !== saved.all.length
            || candidates().some((element, index) => element !== saved.all[index])) {
            return finish({ version: 1, ok: false, error: 'stale_plan' });
        }
        const ids = new Set();
        const targets = [];
        for (const item of message.items) {
            const entry = saved.entries.find(entry => entry.field.id === item.id);
            if (!entry || ids.has(item.id) || typeof item.value !== 'string' || item.value.length > 300) {
                return finish({ version: 1, ok: false, error: 'invalid_plan' });
            }
            ids.add(item.id);
            if (entry.field.maxLength > 0 && item.value.length > entry.field.maxLength)
                return finish({ version: 1, ok: false, error: 'invalid_plan' });
            if (entry.field.pattern) {
                try {
                    if (!new RegExp(`^(?:${entry.field.pattern})$`, 'v').test(item.value))
                        return finish({ version: 1, ok: false, error: 'invalid_plan' });
                }
                catch {
                    return finish({ version: 1, ok: false, error: 'invalid_plan' });
                }
            }
            if (entry.field.tag === 'select' && !entry.field.options.some(option => !option.disabled && option.value === item.value)) {
                return finish({ version: 1, ok: false, error: 'invalid_plan' });
            }
            targets.push({ entry, item });
        }
        const results = [];
        for (const { entry, item } of targets) {
            observe('before_field', item.id);
            // Site address completion may have changed another field after an earlier input.
            if (saved.url !== location.href || document.visibilityState === 'hidden' || !unchanged(entry) || entry.element.value !== entry.initialValue) {
                observe('changed_by_page', item.id);
                results.push({ id: item.id, status: 'changed_by_page' });
                continue;
            }
            const prototype = entry.field.tag === 'select' ? HTMLSelectElement.prototype
                : entry.field.tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            try {
                Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(entry.element, item.value);
                observe('after_setter', item.id);
                entry.element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                observe('after_input_event', item.id);
                entry.element.dispatchEvent(new Event('change', { bubbles: true }));
                observe('after_change_event', item.id);
                results.push({ id: item.id, status: 'filled' });
            }
            catch (error) {
                observe('failed', item.id, error);
                results.push({ id: item.id, status: 'failed' });
            }
            await new Promise(resolve => setTimeout(resolve, 150));
            observe('after_settle_delay', item.id);
        }
        for (const result of results) {
            const target = targets.find(target => target.item.id === result.id);
            if (result.status === 'filled' && target && (!target.entry.element.isConnected || target.entry.element.value !== target.item.value))
                result.status = 'changed_by_page';
        }
        return finish({ version: 1, ok: true, results });
    }
    return apply;
}
