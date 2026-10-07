import type { Control } from '../content/types';
import type { PageRequest, Sender, DiagnosticRecord, RequestMap, ResponseMap, PageResponseMap } from './contracts';
declare global {
    const browser: {
        action: { openPopup(): Promise<void> };
        runtime: {
            id: string;
            getURL(path: string): string;
            onMessage: {
                addListener<T>(listener: (message: T, sender: Sender) => unknown): void;
                removeListener<T>(listener: (message: T, sender: Sender) => unknown): void;
            };
            sendMessage<R extends RequestMap[keyof RequestMap]>(message: R): Promise<ResponseMap[R['type']]>;
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
            sendMessage<R extends PageRequest>(tabID: number, message: R): Promise<PageResponseMap[R['type']]>;
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
        dispose?: () => void;
        fieldID?(requestID: string, element: Control): string | null;
        developerFieldID(element: Control): string | null;
        developerRecord(): DiagnosticRecord | null;
        matchesSnapshot(requestID: string): boolean;
    } | undefined;
    var FormFillDebug: typeof import('../diagnostics/report').debugUtilities;
    var FormFillCapturePage: typeof import('../diagnostics/page').capturePage;
    var FormFillCaptureDeveloperPage: typeof import('../diagnostics/developer-page').captureDeveloperPage;
}
export {};
