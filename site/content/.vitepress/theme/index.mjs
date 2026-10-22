import DefaultTheme from 'vitepress/theme-without-fonts';
import { inBrowser, onContentUpdated } from 'vitepress';
import './custom.css';
import { startMotion } from './motion.mjs';

export default {
  extends: DefaultTheme,
  setup() {
    // Runs after every page content update, including the first load and
    // client-side navigation. startMotion is idempotent.
    if (inBrowser) {
      onContentUpdated(() => {
        startMotion();
      });
    }
  },
};
