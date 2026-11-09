import { describe, expect, it } from 'vitest';

import { blocks, pieces, readEvents, splitEvents } from './coach';

describe('coach', () => {
  it('keeps a half-received line for the next chunk', () => {
    const { events, rest } = splitEvents('{"type":"text","text":"Hi"}\n\n{"type":"to');
    expect(events).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(rest).toBe('{"type":"to');
  });

  it('reads a stream split anywhere', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      '{"type":"tool","name":"records","sta',
      'tus":"running"}\n{"type":"text",',
      '"text":"ok"}\n{"type":"done","tools":["records"]}',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const seen = [];
    for await (const event of readEvents(body)) seen.push(event.type);
    expect(seen).toEqual(['tool', 'text', 'done']);
  });

  it('picks out links to activities', () => {
    expect(pieces('Your **best** 10K: /activities/42.')).toEqual([
      { text: 'Your best 10K: ' },
      { activity: 42 },
      { text: '.' },
    ]);
    expect(pieces('Best ([Actividad 155](/activities/155)).')).toEqual([
      { text: 'Best (' },
      { activity: 155 },
      { text: ').' },
    ]);
  });

  it('turns bullet lines into a list', () => {
    expect(blocks('Two things:\n\n- rest\n- sleep')).toEqual([
      { kind: 'paragraph', text: 'Two things:' },
      { kind: 'list', items: ['rest', 'sleep'] },
    ]);
  });
});
