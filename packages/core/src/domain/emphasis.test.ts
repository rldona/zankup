import { describe, expect, it } from 'vitest';

import { emphasis } from './emphasis';

describe('emphasis', () => {
  it('splits the bold runs out', () => {
    expect(emphasis('Effort **235**, far above your **174**.')).toEqual([
      { text: 'Effort ', bold: false },
      { text: '235', bold: true },
      { text: ', far above your ', bold: false },
      { text: '174', bold: true },
      { text: '.', bold: false },
    ]);
  });
  it('leaves plain text and an unpaired asterisk alone', () => {
    expect(emphasis('Plain.')).toEqual([{ text: 'Plain.', bold: false }]);
    expect(emphasis('5 * 3 **min')).toEqual([{ text: '5 * 3 **min', bold: false }]);
    expect(emphasis('')).toEqual([]);
  });
});
