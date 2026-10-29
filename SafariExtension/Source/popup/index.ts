import { installDebug } from './debug';
import { installDeveloper } from './developer';
import { installHealth } from './health';
import { createFillWorkflow } from './workflow';
import { createPopupPorts } from './browser-ports';
import { createPopupView } from './view';

// Composition root: importing the workflow or view never installs listeners.
const view = createPopupView(document);
const connection = createPopupPorts(browser, () => window.close());
const workflow = createFillWorkflow(connection.ports, view.render);
view.bind(workflow);
installHealth(document, browser);
installDebug(connection.debug);
installDeveloper(document, browser, () => workflow.analyze({ detailed: true }));
window.addEventListener('pagehide', workflow.cancel);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') workflow.cancel(); });
void browser.runtime.sendMessage({ type: 'consumeInlineStart' }).then(start => {
    if (start?.ok && start.tabID != null && start.url)
        return workflow.analyze({ quickStart: { tabID: start.tabID, url: start.url } });
}).catch(() => {}).finally(view.finishOpening);
