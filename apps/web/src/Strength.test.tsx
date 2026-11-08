import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Strength } from './detail/Strength';

const set = (category: string | null, reps: number, weight: number | null, kind = 'active') => ({
  start_s: 0,
  duration_s: kind === 'rest' ? 90 : 45,
  kind,
  reps,
  weight_kg: weight,
  category,
});

describe('strength detail', () => {
  it('groups sets by exercise and marks the muscles worked', () => {
    render(
      <Strength
        sets={[
          set('squat', 8, 60),
          set(null, 0, null, 'rest'),
          set('squat', 6, 70),
          set('push_up', 15, null),
        ]}
      />,
    );
    expect(screen.getByText('3 sets · 29 reps · 900 kg lifted')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Squat' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Push-up' })).toBeInTheDocument();
    expect(screen.getAllByRole('row', { name: /^1 8 60 kg 0:45 1:30$/ })).toHaveLength(1);
    expect(screen.getByRole('row', { name: /^1 15 Body weight 0:45 —$/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Front: .*Quadriceps/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Back: .*Glutes/ })).toBeInTheDocument();
    expect(document.querySelectorAll('.muscle.on').length).toBeGreaterThan(5);
  });
});
