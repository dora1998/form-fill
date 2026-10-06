import type { PageRequest, Sender, Control, DiagnosticRecord, Extraction, FillRequest, FillResponse, AnalysisResult, FormField } from './contracts';
declare global {
    const browser: {
        runtime: {
            id: string;
            onMessage: {
                addListener<T>(listener: (message: T, sender: Sender) => unknown): void;
                removeListener<T>(listener: (message: T, sender: Sender) => unknown): void;
            };
            sendMessage(message: {
                type: 'analyzeForm' | 'analyzeInline';
                requestID: string;
                fields: FormField[];
                developerDiagnostics?: boolean;
            }): Promise<AnalysisResult>;
            sendMessage(message: {
                type: 'health' | 'modelProbe' | 'saveDeveloperReport';
                report?: string;
            }): Promise<{
                version: number;
                ok: boolean;
                error?: string;
                available?: boolean;
                reason?: string;
                process?: string;
                result?: string;
            }>;
            sendNativeMessage(app: string, message: unknown): Promise<unknown>;
            getManifest(): {
                version: string;
            };
        };
        tabs: {
            query(query: {
                active: boolean;
                currentWindow: boolean;
            }): Promise<{
                id?: number;
                url?: string;
            }[]>;
            sendMessage(tabID: number, message: {
                type: 'extract';
                developerDiagnostics?: boolean;
            }): Promise<Extraction>;
            sendMessage(tabID: number, message: FillRequest): Promise<FillResponse>;
            sendMessage(tabID: number, message: {
                type: 'inspect';
            }): Promise<{
                version: number;
                fieldCount: number;
            }>;
            sendMessage(tabID: number, message: Extract<PageRequest, {
                type: 'saveDeveloperAnalysis';
            }>): Promise<{
                ok: boolean;
            }>;
        };
        scripting: {
            executeScript(options: {
                target: {
                    tabId: number;
                };
                files?: string[];
                func?: Function;
                args?: unknown[];
            }): Promise<any[]>;
        };
    };
    var __formFillDiagnosticsInstalled: boolean | undefined;
    var __formFillContentHandler: {
        version: number;
        listener: (message: PageRequest, sender: Sender) => unknown;
        disposeInline?: () => void;
        developerFieldID(element: Control): string | null;
        developerRecord(): DiagnosticRecord | null;
        matchesSnapshot(requestID: string, all: Control[]): boolean;
    } | undefined;
    var FormFillDebug: typeof import('../diagnostics/report').debugUtilities;
    var FormFillCapturePage: typeof import('../diagnostics/page').capturePage;
    var FormFillCaptureDeveloperPage: typeof import('../diagnostics/developer-page').captureDeveloperPage;
}
export {};
