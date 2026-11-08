import { themeCss } from '@zankup/core';

/**
 * Design tokens from packages/core as CSS variables (--bg, --fg, --accent…). For now the system theme:
 * light, or dark when the OS asks for it. The picker and the other themes are OS-214.
 */
export function installTheme(doc: Document = document): void {
  const style = doc.createElement('style');
  style.dataset.tokens = '';
  style.textContent =
    themeCss('light', ':root') + '@media (prefers-color-scheme: dark){' + themeCss('dark', ':root') + '}';
  doc.head.prepend(style);
}
