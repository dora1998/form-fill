import type { DiagnosticRecord } from '../shared/contracts';
/* Clipboard boundary: rebuild metadata from allowed codes, numbers and booleans.
 * URLs are separately minimized. Never spread page/native objects here. */
export const debugUtilities = (() => {
    const code = (value: unknown, allowed: readonly string[]): string => typeof value === 'string' && allowed.includes(value) ? value : 'unknown';
    const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, 100000) : 0;
    const fieldID = (value: unknown) => typeof value === 'string' && /^f(?:[0-9]|[1-3][0-9])$/.test(value) ? value : null;
    // Unknown path segments may be names or account IDs. Keep only conventional
    // route words, rather than trusting a detector to recognize every kind of PII.
    const routeWords = new Set(['id', 'user', 'users', 'userinfo', 'cinfo', 'account', 'accounts', 'profile',
        'address', 'addresses', 'contact', 'contacts', 'form', 'forms', 'input', 'edit', 'new', 'create',
        'set', 'update', 'confirm', 'confirmation', 'complete', 'index', 'default', 'settings', 'register',
        'registration', 'checkout', 'shipping', 'billing', 'customer', 'customers', 'member', 'members',
        'mypage', 'my', 'page', 'personal', 'info', 'information', 'details', 'order', 'orders', 'delivery',
        'inquiry', 'inquiries', 'support', 'help', 'us', 'en', 'ja', 'jp', 'shop', 'store', 'web', 'app']);
    const pageURL = (value: unknown) => {
        try {
            if (typeof value !== 'string' || value.length > 16384)
                return { url: null, pathRedacted: false };
            const parsed = new URL(value);
            if (!['http:', 'https:'].includes(parsed.protocol))
                return { url: null, pathRedacted: false };
            let pathRedacted = false;
            const segments = parsed.pathname.split('/').slice(0, 50).map(segment => {
                if (!segment)
                    return '';
                let decoded;
                try {
                    decoded = decodeURIComponent(segment);
                }
                catch {
                    decoded = '';
                }
                // Matrix parameters can contain session IDs. Strip them like query strings.
                const route = decoded.split(';')[0];
                if (route !== decoded)
                    pathRedacted = true;
                const stem = route.replace(/\.(?:html?|php|aspx?)$/i, '');
                if (/^[a-z_-]+$/i.test(stem) && stem.split(/[_-]/).every(word => routeWords.has(word.toLowerCase())))
                    return route;
                pathRedacted = true;
                return '[redacted]';
            });
            if (parsed.pathname.split('/').length > 50) {
                segments.push('[redacted]');
                pathRedacted = true;
            }
            // Building from protocol/host/path also drops username, password, query and hash.
            return { url: `${parsed.protocol}//${parsed.host}${segments.join('/')}`, pathRedacted };
        }
        catch {
            return { url: null, pathRedacted: false };
        }
    };
    const kinds = ['family', 'given', 'fullName', 'familyKana', 'givenKana', 'fullKana', 'postal', 'postalFirst3', 'postalLast4', 'prefecture', 'prefectureMunicipality', 'municipality', 'locality', 'street', 'building', 'localityStreet', 'municipalityLocality', 'municipalityLocalityStreet', 'addressWithoutPrefecture', 'fullAddress', 'prefectureMunicipalityLocalityStreet', 'unknown'];
    const hintRules: Record<string, RegExp> = {
        family: /姓|family|surname/i, given: /(?:^|[（(\s])名(?:$|[）)\s])|given|first.?name/i,
        full_name: /氏名|お名前|姓名|full.?name/i, kana: /カナ|かな|フリガナ|ふりがな|kana/i,
        postal: /郵便|postal|postcode|zip/i, prefecture: /都道府県|prefecture/i,
        municipality: /市区町村|市町村|municipality|city/i, locality: /町名|町域|locality/i,
        street: /番地|丁目|street/i, building: /建物|部屋|マンション|ビル|building|apartment/i,
        address: /住所|address/i, address_line1: /住所\s*[1１]|address.?line.?1/i,
        address_line2: /住所\s*[2２]|address.?line.?2/i,
        address_line3: /住所\s*[3３]|address.?line.?3/i,
        postal_digits7: /(?:数字|半角)?7(?:桁|ケタ|けた)/i,
        example_prefecture: /東京都|北海道|京都府|大阪府|[\p{Script=Han}]{2,3}県/u,
        example_city_ward: /[\p{Script=Han}]+[市区郡]/u,
        example_town: /[\p{Script=Han}]+(?:町|村)|丁目/u,
        example_number: /\d+\s*[-－−ー]\s*\d+|\d+丁目|\d+番/u,
        unrelated: /電話|メール|email|e-mail|会社|法人|部署|件名|お問い合わせ|検索/i
    };
    const hints = (value: unknown) => typeof value === 'string' ? Object.keys(hintRules).filter(key => hintRules[key].test(value)) : [];
    const safeHints = (value: unknown) => Array.isArray(value) ? Object.keys(hintRules).filter(key => value.includes(key)) : [];
    const autocompleteCodes = ['name', 'family-name', 'given-name', 'postal-code', 'address-level1', 'address-level2', 'address-level3', 'address-level4', 'street-address', 'address-line1', 'address-line2', 'address-line3', 'on', 'off'];
    // Derive fixed semantic hints on-device. No substrings of the supplied text survive.
    const fieldMetadata = (fields: unknown) => (Array.isArray(fields) ? fields : []).slice(0, 40).map((field: DiagnosticRecord) => {
        const result: DiagnosticRecord = { id: fieldID(field?.id), tag: code(field?.tag, ['input', 'select', 'textarea']),
            type: code(field?.type, ['text', 'number', 'search', 'select-one', 'textarea', 'tel']),
            occupied: field?.occupied === true, maxLength: count(field?.maxLength), hasPattern: Boolean(field?.pattern),
            optionCount: count(field?.options?.length),
            autocomplete: code(typeof field?.autocomplete === 'string' ? field.autocomplete.toLowerCase().trim().split(/\s+/).at(-1) : null, autocompleteCodes) };
        for (const key of ['label', 'ariaLabel', 'name', 'htmlID', 'placeholder', 'context']) {
            result[key] = { present: typeof field?.[key] === 'string' && field[key].length > 0, hints: hints(field?.[key]) };
        }
        return result;
    });
    const safeMetadata = (fields: unknown) => (Array.isArray(fields) ? fields : []).slice(0, 40).map((field: DiagnosticRecord) => {
        const result: DiagnosticRecord = { id: fieldID(field?.id), tag: code(field?.tag, ['input', 'select', 'textarea']),
            type: code(field?.type, ['text', 'number', 'search', 'select-one', 'textarea', 'tel']),
            occupied: field?.occupied === true, maxLength: count(field?.maxLength), hasPattern: field?.hasPattern === true,
            optionCount: count(field?.optionCount), autocomplete: code(field?.autocomplete, autocompleteCodes) };
        for (const key of ['label', 'ariaLabel', 'name', 'htmlID', 'placeholder', 'context'])
            result[key] = {
                present: field?.[key]?.present === true, hints: safeHints(field?.[key]?.hints)
            };
        return result;
    });
    const reasons: Record<string, string> = {
        '住所欄の構成が重複しています': 'address_overlap', 'グループ内の入力内容が重複しています': 'group_overlap', '既存の入力を保持': 'existing_input', '項目を判定できません': 'unclassified',
        '一致する選択肢がありません': 'no_matching_option', '文字数制限に合いません': 'length_constraint',
        '入力形式の制約に合いません': 'pattern_constraint', '数値欄の制約に合いません': 'number_constraint'
    };
    const modelFailureDescriptions = {
        context_limit: 'モデルのコンテキスト上限超過', assets_unavailable: 'モデル資源を利用できない',
        guardrail_violation: 'モデルの安全制約', unsupported_guide: '構造化生成の制約が未対応',
        unsupported_locale: '言語・地域が未対応', decoding_failure: '構造化出力の復元失敗',
        rate_limited: 'モデルの呼び出し制限', concurrent_requests: 'モデルへの要求が競合', refusal: 'モデルが生成を拒否',
        generation_timeout: 'モデル生成のタイムアウト', unsupported_capability: 'モデルの機能または入力形式が未対応',
        session_mutated: '生成中にモデルの会話状態が変更された',
        overlapping_address_components: '分割住所欄の住所要素が重複',
        invalid_model_output: 'モデル出力の項目IDや分類が不正・欠落', deadline_exceeded: '解析全体の待機時間上限', unknown: '原因不明'
    };
    const modelDiagnostics = (value: DiagnosticRecord | undefined) => ({
        available: value?.available === true,
        requestedFields: count(value?.requestedFields), attemptedBatches: count(value?.attemptedBatches),
        failures: (Array.isArray(value?.failures) ? value.failures : []).slice(0, 11).map((failure: DiagnosticRecord) => ({
            fieldIDs: (Array.isArray(failure?.fieldIDs) ? failure.fieldIDs : []).slice(0, 40).map(fieldID).filter(Boolean),
            reason: code(failure?.reason, Object.keys(modelFailureDescriptions)),
            validationCodes: Array.isArray(failure?.validationCodes)
                ? ['count_mismatch', 'duplicate_ids', 'unexpected_ids', 'missing_ids', 'invalid_kind'].filter(value => failure.validationCodes.includes(value)) : []
        }))
    });
    const analysis = (status: unknown, result: DiagnosticRecord = {}) => ({
        status: code(status, ['not_run', 'running', 'no_fields', 'success', 'model_unavailable', 'timeout', 'failed']),
        reason: code(result.reason, ['apple_intelligence_not_enabled', 'device_not_eligible', 'model_not_ready']),
        modelFailed: result.modelFailed === true,
        classifierVersion: count(result.classifierVersion),
        modelDiagnostics: modelDiagnostics(result.modelDiagnostics),
        items: (Array.isArray(result.items) ? result.items : []).slice(0, 40).map((item: DiagnosticRecord) => ({
            id: fieldID(item?.id), kind: code(item?.kind, kinds), source: code(item?.source, ['rule', 'model']),
            overwritesExisting: item?.overwritesExisting === true
        })),
        skipped: (Array.isArray(result.skipped) ? result.skipped : []).slice(0, 40).map((item: DiagnosticRecord) => ({
            id: fieldID(item?.id), kind: code(item?.kind, kinds),
            source: code(item?.source, ['rule', 'model', 'not_classified_existing_input', 'unclassified']),
            reason: Object.hasOwn(reasons, item?.reason) ? reasons[item.reason] : 'unknown'
        }))
    });
    const summary = (result: ReturnType<typeof analysis>, captureStatus: string) => ({
        analysis: ({ not_run: '未解析', running: '解析中', no_fields: '対象欄なし', success: '解析完了',
            model_unavailable: 'モデル利用不可', timeout: '解析タイムアウト', failed: '解析失敗' } as Record<string, string>)[result.status] ?? '不明',
        plannedFields: result.items.length, skippedFields: result.skipped.length,
        overwriteFields: result.items.filter(item => item.overwritesExisting).length,
        preservedExistingFields: result.skipped.filter(item => item.reason === 'existing_input').length,
        unclassifiedFields: result.skipped.filter(item => item.reason === 'unclassified').length,
        modelFailureCount: result.modelDiagnostics.failures.length,
        currentPageCapture: ({ success: '取得成功', no_tab: 'タブを取得できない', injection_failed: 'スクリプト注入失敗',
            message_failed: 'ページとの通信失敗', invalid_response: '未対応または不正な応答' } as Record<string, string>)[captureStatus] ?? '不明'
    });
    const kindDescriptions = {
        family: '姓', given: '名', fullName: '姓名全体', familyKana: '姓のカナ', givenKana: '名のカナ', fullKana: '姓名全体のカナ',
        postal: '郵便番号全体', postalFirst3: '郵便番号の先頭3桁', postalLast4: '郵便番号の末尾4桁',
        prefecture: '都道府県', prefectureMunicipality: '都道府県＋市区町村', municipality: '市区町村', locality: '町名・町域', street: '番地', building: '建物名・部屋番号',
        localityStreet: '町名＋番地', municipalityLocality: '市区町村＋町名', municipalityLocalityStreet: '市区町村＋町名＋番地',
        addressWithoutPrefecture: '都道府県以降の住所全体', fullAddress: '都道府県からの住所全体', prefectureMunicipalityLocalityStreet: '都道府県・市区町村・町名・番地', unknown: '不明'
    };
    const hintDescriptions = {
        family: '姓の手がかり', given: '名の手がかり', full_name: '姓名全体の手がかり', kana: 'カナの手がかり',
        postal: '郵便番号の手がかり', prefecture: '都道府県の手がかり', municipality: '市区町村の手がかり',
        locality: '町名・町域の手がかり', street: '番地の手がかり', building: '建物名・部屋番号の手がかり',
        address: '住所の手がかり', address_line1: '住所1の手がかり', address_line2: '住所2の手がかり', address_line3: '住所3の手がかり',
        postal_digits7: '数字7桁の形式の手がかり',
        example_prefecture: '都道府県を含む例', example_city_ward: '市区郡を含む例', example_town: '町村・丁目を含む例',
        example_number: '番地形式を含む例', unrelated: '電話・メール・会社・問い合わせ等の対象外の手がかり'
    };
    const legend = (fields: DiagnosticRecord[], result: ReturnType<typeof analysis>) => {
        const usedHints = new Set(fields.flatMap(field => ['label', 'ariaLabel', 'name', 'htmlID', 'placeholder', 'context'].flatMap(key => field[key].hints)));
        const usedKinds = new Set([...result.items, ...result.skipped].map((item: DiagnosticRecord) => item.kind));
        return {
            kinds: Object.fromEntries(Object.entries(kindDescriptions).filter(([key]) => usedKinds.has(key))),
            hints: Object.fromEntries(Object.entries(hintDescriptions).filter(([key]) => usedHints.has(key))),
            modelFailures: Object.fromEntries(Object.entries(modelFailureDescriptions).filter(([key]) => result.modelDiagnostics.failures.some(failure => failure.reason === key)))
        };
    };
    const report = (page: DiagnosticRecord | undefined, lastAnalysis: DiagnosticRecord | undefined, extensionVersion: unknown, extractedFields: unknown[] = [], captureStatus = 'unknown', urls: DiagnosticRecord = {}, captureDiagnostics: DiagnosticRecord = {}) => ({
        schemaVersion: 3,
        product: 'Form Fill',
        extensionVersion: typeof extensionVersion === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(extensionVersion) ? extensionVersion : 'unknown',
        analysisURL: pageURL(urls.analysis),
        currentPageURL: pageURL(urls.current),
        summary: summary(analysis(lastAnalysis?.status, lastAnalysis), captureStatus),
        legend: legend(safeMetadata(extractedFields), analysis(lastAnalysis?.status, lastAnalysis)),
        readingGuide: {
            analysisFields: '解析時点の欄。idでlastAnalysisの分類・保留結果と対応する。',
            page: 'コピー時点の欄構造。unavailableでも解析時点の情報は残る。',
            hints: 'ラベルや入力例の原文から固定の意味コードを抽出。原文や入力値は含まない。',
            overwrite: 'プレビューにある姓名・住所欄は既存値も上書きする。overwritesExistingは上書き対象。',
            numberedAddressDefault: '説明のない住所1〜3だけの組は、都道府県＋市区町村／町名＋番地／建物名の順に分割。明示的な説明を優先。',
            existing_input: '旧版では既存入力を保持していた。旧版のnot_classified_existing_inputはモデル分類を実行していない。',
            source: 'ruleはルール分類、modelはオンデバイスモデル分類。unclassifiedは未判定。',
            modelDiagnostics: 'モデル分類の要求欄数・実行バッチ数・失敗した欄IDと原因コード。例外の原文は含まない。availableがfalseなら診断未取得。',
            versions: 'classifierVersionはネイティブ分類処理、contentVersionは解析用ページ処理、collectorVersionはデバッグ収集処理の版。0は不明または未取得。',
            url: 'クエリ・フラグメント・認証情報・パスの任意識別子を除去。解析先と現在のページを分けて記録。',
            limitations: 'トップ文書の標準欄だけを対象とする。原文を含まないため、この情報だけで完全再現はできない。'
        },
        scope: 'top_document_only',
        captureStatus: code(captureStatus, ['success', 'no_tab', 'injection_failed', 'message_failed', 'invalid_response', 'unknown']),
        captureDiagnostics: {
            resultCount: count(captureDiagnostics.resultCount),
            resultType: code(captureDiagnostics.resultType, ['undefined', 'null', 'object', 'array', 'string', 'number', 'boolean']),
            hasInjectionError: captureDiagnostics.hasInjectionError === true,
            collectorError: code(captureDiagnostics.collectorError, ['query_controls', 'filter_candidates', 'field_metadata', 'snapshot_match'])
        },
        analysisFields: safeMetadata(extractedFields),
        page: page?.version === 1 ? {
            collectorVersion: count(page.collectorVersion), contentVersion: count(page.contentVersion),
            controlCount: count(page.controlCount), eligibleCount: count(page.eligibleCount), iframeCount: count(page.iframeCount),
            truncated: page.truncated === true, analysisMatchesPage: page.analysisMatchesPage === true,
            fields: (Array.isArray(page.fields) ? page.fields : []).slice(0, 200).map((field: DiagnosticRecord) => {
                const safe: DiagnosticRecord = { index: count(field?.index), fieldID: fieldID(field?.fieldID),
                    tag: code(field?.tag, ['input', 'select', 'textarea']),
                    type: code(field?.type, ['text', 'number', 'search', 'select-one', 'select-multiple', 'textarea', 'tel', 'email', 'password', 'hidden', 'checkbox', 'radio', 'file', 'submit', 'button', 'date', 'time', 'url', 'other']),
                    maxLength: count(field?.maxLength), optionCount: count(field?.optionCount) };
                for (const key of ['eligible', 'disabled', 'readOnly', 'visible', 'postalControl', 'hasLabel', 'hasNearbyLabel', 'hasAriaLabel', 'hasName', 'hasID', 'hasPlaceholder', 'hasAutocomplete', 'hasContext', 'hasPattern'])
                    safe[key] = field?.[key] === true;
                return safe;
            })
        } : { status: 'unavailable' },
        // Last analysis belongs to this popup session; structure is captured at copy time.
        lastAnalysis: analysis(lastAnalysis?.status, lastAnalysis)
    });
    // analysis() already converts localized reasons; allow its safe codes on rebuilding.
    for (const value of Object.values(reasons))
        reasons[value] = value;
    return { analysis, report, fieldMetadata, pageURL };
})();
globalThis.FormFillDebug = debugUtilities;
