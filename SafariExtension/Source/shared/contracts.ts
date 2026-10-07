/** Native wire format matches FormFillBridge. Page values never belong in FormField. */
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
export type AddressComponent = 'prefecture' | 'municipality' | 'locality' | 'street' | 'building';
export interface FillItem {
    id: string;
    kind?: string;
    components?: AddressComponent[];
    value: string;
    label: string;
    displayValue: string;
    overwritesExisting?: boolean;
    source?: string;
}
export const skipReasonCodes = ['empty_profile', 'value_too_long', 'unclassified', 'no_matching_option',
    'pattern_constraint', 'length_constraint', 'number_constraint', 'group_overlap', 'address_overlap'] as const;
export type SkipReason = typeof skipReasonCodes[number];
export interface SkippedField {
    id: string;
    label: string;
    reason: string; // Display text retained for compatibility with older native extensions.
    reasonCode?: SkipReason;
    kind?: string;
    components?: AddressComponent[];
    source?: string;
}
export interface Classification {
    id: string;
    kind: string;
    components: AddressComponent[];
    source: string;
    label: string;
}
export interface Failure {
    version: 1;
    ok: false;
    error: string;
    reason?: string;
}
export interface Success { version: 1; ok: true; error?: never }
export type AnalyzeResponse = Failure | (Success & {
    requestID: string;
    sessionID: string;
    classifications: Classification[];
    expiresInSeconds?: number;
    modelFailed?: boolean;
});
export type PrepareResponse = Failure | (Success & {
    requestID: string;
    sessionID: string;
    items: FillItem[];
    skipped: SkippedField[];
    expiresInSeconds?: number;
    modelFailed?: boolean;
});
export type Acknowledgement = Success | Failure;
export interface SessionScope { tabID: number; origin: string; requestID: string; sessionID: string }
export interface RequestMap {
    analyzeForm: { type: 'analyzeForm'; tabID: number; requestID: string; fields: FormField[]; developerDiagnostics?: boolean };
    prepareFill: { type: 'prepareFill' } & SessionScope;
    commitFill: { type: 'commitFill' } & SessionScope;
    quickFill: { type: 'quickFill' } & SessionScope;
    cancelFill: { type: 'cancelFill' } & SessionScope;
    consumeInlineStart: { type: 'consumeInlineStart' };
    openFillPopup: { type: 'openFillPopup' };
    health: { type: 'health' };
    modelProbe: { type: 'modelProbe' };
    saveDeveloperReport: { type: 'saveDeveloperReport'; report: string };
}
export interface ResponseMap {
    analyzeForm: AnalyzeResponse;
    prepareFill: PrepareResponse;
    commitFill: FillResponse;
    quickFill: FillResponse;
    cancelFill: Acknowledgement;
    consumeInlineStart: Failure | (Success & { tabID?: number; url?: string });
    openFillPopup: Acknowledgement;
    health: Acknowledgement;
    modelProbe: Failure | (Success & { available?: boolean; reason?: string; process?: string; result?: string });
    saveDeveloperReport: Acknowledgement;
}
export type ExtensionRequest = RequestMap[keyof RequestMap];
export interface Extraction {
    version: number;
    requestID: string;
    fields: FormField[];
    truncated: boolean;
    groups?: { id: string; label: string; fields: string[] }[];
}
export interface FillRequest {
    type: 'applyFill';
    requestID: string;
    items: Pick<FillItem, 'id' | 'kind' | 'value'>[];
}
export type FillResponse = Failure | (Success & {
    results: { id: string; status: 'filled' | 'changed_by_page' | 'failed' }[];
});
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
export interface PageResponseMap {
    extract: Extraction;
    applyFill: FillResponse;
    validateSnapshot: { version: 1; ok: boolean };
    discardSnapshot: { version: 1; ok: boolean };
    inspect: { version: 1; fieldCount: number };
    saveDeveloperAnalysis: { ok: boolean };
}
// Diagnostics keep arbitrary raw DOM/native records only in an explicit development capture.
// The safe report reconstructs allowlisted fields before export.
export type DiagnosticRecord = Record<string, any>;
