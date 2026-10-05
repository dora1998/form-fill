import { eligible, metadata } from './fields';
import type { Entry } from '../shared/contracts';
export const unchanged = (entry: Entry) => entry.element.isConnected && eligible(entry.element)
    && JSON.stringify(metadata(entry.element, entry.field.id)) === JSON.stringify(entry.field);
