import { createBackgroundHandler } from './background-handler';
browser.runtime.onMessage.addListener(createBackgroundHandler(browser));
