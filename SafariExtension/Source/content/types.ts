import type { FormField } from '../shared/contracts';
export type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export interface Entry { element: Control; field: FormField; initialValue: string }
export interface Snapshot { requestID: string; entries: Entry[]; all: Control[]; url: string }
