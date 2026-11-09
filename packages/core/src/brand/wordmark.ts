/**
 * The Zankup wordmark (docs/brand/README.md, section 3): ZANKUP set in Momo Trust Display (SIL OFL), with the
 * N drawn as the U turned 180° so the two letters share one arch, one open upwards and one downwards. One path,
 * one colour, so it needs no web font. The header and the sign-in panel show it alone; the mark (mark.ts) is for
 * icons, splash screens and social images.
 *
 * Kept identical to docs/brand/assets/wordmark.svg by a test.
 */

/** Tight ink bounds: the baseline is 765 units down, the cap height 750 above it (the A overshoots to 0). */
export const WORDMARK_VIEWBOX = { width: 4289, height: 780, baseline: 765, capHeight: 750 } as const;

export const WORDMARK_PATH =
  'M110 765Q59 765 30 736Q0 708 0 661Q0 591 64 518L375 170Q380 164 373 164H28V15H460Q525 15 556 42Q587 68 587 115Q587 149 576 176Q566 204 546 227L215 609Q211 615 218 615H569V765ZM635 765 851 153Q868 104 886 70Q903 36 930 18Q956 0 998 0Q1041 0 1068 18Q1095 36 1114 70Q1132 103 1148 151L1358 765H1180L1131 606H862L811 765ZM996 193 910 458H1084L1002 193Q1001 189 999 189Q997 189 996 193ZM1753 0Q1849 0 1922 38Q1994 75 2034 144Q2075 212 2075 305V765H1899V305Q1899 234 1860 192Q1821 150 1755 150Q1687 150 1648 192Q1609 234 1609 305V765H1433V305Q1433 212 1474 144Q1514 75 1586 38Q1658 0 1753 0ZM2213 765V15H2388V318L2613 15H2828L2608 292L2847 765H2634L2488 443L2388 569V765ZM3240 780Q3144 780 3072 742Q2999 705 2958 636Q2918 568 2918 475V15H3094V475Q3094 546 3133 588Q3172 630 3238 630Q3306 630 3345 588Q3384 546 3384 475V15H3560V475Q3560 568 3520 636Q3479 705 3407 742Q3335 780 3240 780ZM3701 765V15H3989Q4129 15 4209 78Q4289 142 4289 259Q4289 376 4209 440Q4129 503 3989 503H3875V765ZM3875 356H3989Q4042 356 4076 332Q4109 308 4109 259Q4109 209 4076 186Q4042 162 3989 162H3875Z';

/** The wordmark as an SVG document in one colour (default `currentColor`). */
export function wordmarkSvg(color = 'currentColor', label = 'Zankup'): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}"` +
    ` role="img" aria-label="${label}">` +
    `<path d="${WORDMARK_PATH}" fill="${color}"/>` +
    `</svg>`
  );
}
