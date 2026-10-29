import type { Control } from './types';
import { eligible, metadata } from './fields';


// Conservative subset of FillPlanner.rule. No page scan or native call on focus.
export function isRuleTarget(element: Control): boolean {
    if (!eligible(element)) return false;
    const field = metadata(element, 'f0', new Map([[element, 'g0']]), false);
    const label = `${field.label} ${field.ariaLabel}`.replaceAll('必須', '').trim();
    const token = field.autocomplete.toLowerCase().split(/\s+/).at(-1) || '';
    if (field.type === 'search' || /電話|メール|email|e-mail|会社|法人|部署|件名|お問い合わせ|お問合せ|検索/i.test(label)
        || ['email', 'country', 'country-name', 'organization', 'organization-title'].includes(token)
        || token.startsWith('cc-') || token.startsWith('tel') && field.type !== 'tel') return false;
    if (field.tag === 'select' && field.options.filter(option => /^(東京都|北海道|京都府|大阪府|.{2,3}県)$/.test(option.text.trim())).length >= 2) return true;
    if (/^(姓|名|せい|めい|セイ|メイ|氏名|お名前|姓名|フリガナ|ふりがな|町名|町域|番地|丁目・番地・号|住所全体)$/.test(label)
        || /^(姓|名)[（(].*(かな|カナ|ふりがな|フリガナ).*[）)]$/.test(label)
        || /^(お名前|氏名|フリガナ|ふりがな)[（(](姓|名)[）)]$/.test(label)
        || /(市区町村郡|市区町村|市町村)以降|(市区町村|市町村|町名|町域).*番地|都道府県/.test(label)
        || /建物名|マンション名|アパート名|方書/.test(label) && !label.includes('番地')) return true;
    if (label === '市区町村' && !field.placeholder) return true;
    return ['family-name', 'given-name', 'name', 'address-level1', 'address-level2', 'street-address', 'postal-code'].includes(token)
        || label === '郵便番号' || /zip|postal|postcode|郵便番号/i.test(`${field.name} ${field.htmlID}`)
        || /郵便番号/.test(label);
}

export function installInline(onOpen: (target: Control) => void): () => void {
    let target: Control | null = null;
    let host: HTMLDivElement | null = null;
    let button: HTMLButtonElement;
    let frame = 0;
    let generation = 0;
    let busy = false;
    const hide = () => {
        generation++;
        target = null;
        busy = false;
        host?.remove();
        host = null;
        cancelAnimationFrame(frame);
        frame = 0;
    };
    const position = () => {
        frame = 0;
        if (!host || !target) return;
        if (!target.isConnected || !eligible(target)) { hide(); return; }
        const rect = target.getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0;
        const top = viewport?.offsetTop || 0;
        const width = viewport?.width || innerWidth;
        const height = viewport?.height || innerHeight;
        // Stay immediately below the field, inside the area above the keyboard.
        const y = rect.bottom + 2;
        host.style.setProperty('visibility', y + 48 > top + height || rect.bottom < top || rect.top > top + height ? 'hidden' : 'visible', 'important');
        host.style.setProperty('top', `${y + window.scrollY}px`, 'important');
        host.style.setProperty('left', `${Math.max(left + 4, Math.min(rect.left, left + width - 112)) + window.scrollX}px`, 'important');
        host.style.setProperty('width', `${Math.min(Math.max(rect.width, 104), width - 8)}px`, 'important');
    };
    const schedule = () => { if (host && !frame) frame = requestAnimationFrame(position); };
    const focus = () => {
        const element = document.activeElement;
        if (element === target || element === host && host) return;
        hide();
        if (location.protocol !== 'https:') return;
        if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)
            || !isRuleTarget(element)) return;
        target = element;
        host = document.createElement('div');
        host.dataset.formFillInline = '';
        host.style.cssText = 'all:initial;position:absolute!important;z-index:2147483647!important;height:48px!important;display:block!important;';
        const root = host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = ':host{color-scheme:light}button{box-sizing:border-box;width:100%;height:48px;border:1px solid #b7c9e6;border-radius:6px;background:#f3f7ff;color:#174a92;font:600 14px -apple-system,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 10px;touch-action:manipulation}button:disabled{opacity:.7}';
        button = document.createElement('button');
        button.type = 'button';
        button.textContent = '自動入力';
        button.title = '認証して登録した姓名・住所を自動入力（既存値を上書き）';
        // Keep the field and software keyboard focused while tapping.
        button.addEventListener('pointerdown', event => event.preventDefault());
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', async () => {
            if (busy || !target || !isRuleTarget(target)) return;
            onOpen(target);
            busy = true;
            const localButton = button;
            const run = generation;
            localButton.disabled = true;
            localButton.textContent = '開いています…';
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                // This entry point only opens extension-owned UI. Registered values
                // remain behind the popup's authentication and confirmation flow.
                const result = await Promise.race([
                    browser.runtime.sendMessage({ type: 'openFillPopup' }),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 10000); })
                ]);
                if (run !== generation) return;
                if (!result?.ok) throw new Error('popup_unavailable');
                localButton.textContent = '自動入力';
            } catch {
                if (run === generation) localButton.textContent = 'Safariの拡張メニューから開く';
            } finally {
                clearTimeout(timer);
                if (run === generation) { busy = false; localButton.disabled = false; }
            }
        });
        root.append(style, button);
        document.documentElement.append(host);
        position();
    };
    const blur = () => { queueMicrotask(() => { if (document.activeElement !== target && document.activeElement !== host) hide(); }); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    focus();
    return () => {
        hide();
        document.removeEventListener('focusin', focus);
        document.removeEventListener('focusout', blur);
        document.removeEventListener('keydown', key);
        window.removeEventListener('scroll', schedule, true);
        window.removeEventListener('resize', schedule);
        window.visualViewport?.removeEventListener('resize', schedule);
        window.visualViewport?.removeEventListener('scroll', schedule);
    };
}
