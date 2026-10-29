import { unavailableReasons } from '../shared/model-status';
import type { WorkflowState } from './workflow';
const errorMessages: Record<string, string> = {
    profile_missing: 'プロフィールが未登録です。Form Fillアプリの設定から登録してください。',
    authentication_failed: '認証できませんでした。Face IDの許可や端末パスコードを確認し、再解析してください。',
    profile_changed: 'プロフィールが変更・削除されました。再解析して確認してください。',
    profile_unreadable: '保存データを読み取れません。Form Fillアプリの設定で確認してください。',
    https_required: '登録情報はHTTPSのページでのみ入力できます。',
    stale_plan: 'ページが変わったか確認の期限が切れました。再解析してください。',
    timeout: '処理が時間内に完了しませんでした。再解析してください。'
};
export function createPopupView(document: Document) {
    const analyze = document.querySelector<HTMLButtonElement>('#analyze')!;
    const unlock = document.querySelector<HTMLButtonElement>('#unlock')!;
    const fill = document.querySelector<HTMLButtonElement>('#fill')!;
    const status = document.querySelector<HTMLElement>('#fill-status')!;
    const cancelQuick = document.querySelector<HTMLButtonElement>('#cancel-quick');
    const targets = document.querySelector<HTMLElement>('#targets')!;
    const group = document.querySelector<HTMLSelectElement>('#target-group')!;
    const fields = document.querySelector<HTMLElement>('#target-fields')!;
    const preview = document.querySelector<HTMLElement>('#preview')!;
    const progress = document.querySelector<HTMLElement>('#progress')!;
    const progressTitle = document.querySelector<HTMLElement>('#progress-title')!;
    const progressDetail = document.querySelector<HTMLElement>('#progress-detail')!;
    let groupOptions: Extract<WorkflowState, { phase: 'selecting' }>['groups'] = [];
    const rows = (selector: string, values: string[]) => {
        const list = document.querySelector<HTMLElement>(selector)!;
        list.replaceChildren(...values.map(value => { const li = document.createElement('li'); li.textContent = value; return li; }));
    };
    const render = (state: WorkflowState) => {
        const busy = ['analyzing', 'preparing', 'committing'].includes(state.phase);
        const quick = 'quick' in state && state.quick;
        document.body.dataset.mode = quick ? 'quick' : 'ready';
        progress.hidden = !quick;
        if (quick) {
            progressTitle.textContent = state.phase === 'committing' ? '認証して入力中' : '入力欄を解析中';
            progressDetail.textContent = state.phase === 'committing' ? 'Face IDまたは端末パスコードで認証してください。' : '解析後、認証して姓名・住所を入力します。';
        }
        analyze.disabled = busy;
        unlock.disabled = state.phase !== 'analyzed';
        unlock.hidden = state.phase === 'prepared' || quick;
        fill.disabled = state.phase !== 'prepared' || !state.items.length;
        fill.hidden = quick;
        if (cancelQuick) cancelQuick.hidden = !quick;
        targets.hidden = state.phase !== 'selecting';
        preview.hidden = !['analyzed', 'preparing', 'prepared', 'committing'].includes(state.phase) && !quick;
        rows('#plan', []); rows('#skipped', []);
        if ('destination' in state && state.destination) document.querySelector<HTMLElement>('#site')!.textContent = `入力先: ${state.destination}`;
        switch (state.phase) {
            case 'idle': status.textContent = state.cancelled ? 'キャンセルしました。' : ''; break;
            case 'analyzing': status.textContent = state.quick ? '' : '入力欄を解析中…'; break;
            case 'selecting':
                groupOptions = state.groups;
                group.replaceChildren(...state.groups.map(value => { const option = document.createElement('option'); option.value = value.id; option.textContent = value.label; return option; }));
                fields.textContent = state.groups[0]?.fields.join('・') ?? '';
                status.textContent = '入力するグループを選んでください。'; break;
            case 'analyzed':
                rows('#plan', state.classifications.map(item => `${item.label}: ${item.kind === 'unknown' ? '判定できません' : '認証後に入力候補を確認'}`));
                status.textContent = '入力先を確認して「登録情報を確認する」を押してください。まだ住所は読み出していません。'; break;
            case 'preparing': status.textContent = '認証して登録情報を読み出しています…'; break;
            case 'prepared':
                rows('#plan', state.items.map(item => `${item.label} → ${item.displayValue}${item.overwritesExisting ? '（既存値を上書き）' : ''}`));
                rows('#skipped', state.skipped.map(item => `${item.label}: ${item.reason}`));
                status.textContent = `${state.items.length}欄を入力予定。入力した瞬間からサイトは値を読み取れます。入力時にも認証します。`; break;
            case 'committing':
                status.textContent = state.quick ? '' : '認証と入力先を再確認しています…'; break;
            case 'completed': status.textContent = `${state.filled}欄に入力しました。${state.total - state.filled}欄は保留しました。ページ上の値を確認してください。フォームは送信していません。`; break;
            case 'diagnostics_collected': status.textContent = '詳細ログ用の解析が完了しました。'; break;
            case 'no_fields': status.textContent = '対象の入力欄がありません。'; break;
            case 'failed': status.textContent = state.error === 'model_unavailable' ? unavailableReasons[state.reason ?? 'unknown'] ?? unavailableReasons.unknown
                : errorMessages[state.error] ?? '処理できませんでした。Safariのサイトアクセス許可を確認して再試行してください。'; break;
        }
    };
    const finishOpening = () => {
        if (document.body.dataset.mode === 'opening') { document.body.dataset.mode = 'ready'; progress.hidden = true; }
    };
    const bind = (workflow: ReturnType<typeof import('./workflow').createFillWorkflow>) => {
        analyze.addEventListener('click', () => workflow.analyze());
        unlock.addEventListener('click', () => workflow.unlock());
        fill.addEventListener('click', () => workflow.fill());
        cancelQuick?.addEventListener('click', workflow.cancel);
        group.addEventListener('change', () => { fields.textContent = groupOptions.find(value => value.id === group.value)?.fields.join('・') ?? ''; });
        document.querySelector('#analyze-target')!.addEventListener('click', () => { void workflow.analyze({ groupID: group.value }); });
    };
    return { render, bind, finishOpening };
}
