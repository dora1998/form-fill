/** Native wire format mirrors Shared/FillPlan.swift. Page values never belong in FormField. */
export type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export interface FormField {
    id: string;
    groupID?: string;
    tag: string;
    type: string;
    label: string;
    ariaLabel: string;
    name: string;
    htmlID: string;
    placeholder: string;
    autocomplete: string;
    context: string;
    maxLength: number;
    pattern: string;
    occupied: boolean;
    options: {
        value: string;
        text: string;
        disabled: boolean;
    }[];
}
export interface FillItem {
    id: string;
    kind?: string;
    value: string;
    label: string;
    displayValue: string;
    overwritesExisting?: boolean;
    source?: string;
}
export interface AnalysisResult {
    version: number;
    ok: boolean;
    requestID: string;
    items: FillItem[];
    sessionID?: string;
    expiresInSeconds?: number;
    classifications?: { id: string; kind: string; source: string; label: string }[];
    skipped: {
        id: string;
        label: string;
        reason: string;
    }[];
    error?: string;
    reason?: string;
    modelFailed?: boolean;
}
export interface Extraction {
    version: number;
    requestID: string;
    fields: FormField[];
    truncated: boolean;
    groups?: { id: string; label: string; fields: string[] }[];
}
export interface Entry {
    element: Control;
    field: FormField;
    initialValue: string;
}
export interface Snapshot {
    requestID: string;
    entries: Entry[];
    all: Control[];
    url: string;
}
export interface FillRequest {
    type: 'applyFill';
    requestID: string;
    items: Pick<FillItem, 'id' | 'kind' | 'value'>[];
}
export interface FillResponse {
    version: number;
    ok: boolean;
    error?: string;
    results?: {
        id: string;
        status: string;
    }[];
}
export interface Sender {
    id?: string;
    tab?: {
        id?: number;
        url?: string;
    };
    frameId?: number;
    url?: string;
}
export type PageRequest = FillRequest | { type: 'validateSnapshot' | 'discardSnapshot'; requestID: string } | {
    type: 'extract';
    groupID?: string;
    selectionRequestID?: string;
    inlineTarget?: boolean;
    developerDiagnostics?: boolean;
} | {
    type: 'inspect';
} | {
    type: 'saveDeveloperAnalysis';
    requestID: string;
    analysis: Record<string, unknown>;
    page?: unknown;
};
// Diagnostics keep arbitrary raw DOM/native records only in an explicit development capture.
// The safe report reconstructs allowlisted fields before export.
export type DiagnosticRecord = Record<string, any>;
