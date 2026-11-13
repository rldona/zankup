import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { musclesFromExercises } from '@zankup/core';

import { BodyThumb, MuscleCover } from './detail/BodyMap';
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
    // The totals in large figures and the session's flow: each set in its exercise's colour.
    const figure = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(figure('Volume')).toHaveTextContent('900 kg');
    expect(figure('Work')).toHaveTextContent('2:15');
    expect(figure('Rest')).toHaveTextContent('1:30');
    expect(document.querySelectorAll('.sflowbar .active')).toHaveLength(3);
    expect(document.querySelectorAll('.sflowbar .rest')).toHaveLength(1);
  });

  it('leaves the body map out of the panel when it is the cover', () => {
    render(<Strength sets={[set('squat', 8, 60)]} cover />);
    expect(screen.getByRole('heading', { name: 'Squat' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('draws the cover and the feed tile from the sets per exercise', () => {
    const worked = musclesFromExercises({ row: 2, curl: 1 });
    render(<MuscleCover worked={worked} />);
    expect(screen.getByRole('region', { name: 'Muscles worked' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Back: Trapezius, Back' })).toBeInTheDocument();
    const { container } = render(<BodyThumb worked={worked} />);
    expect(container.querySelectorAll('.bodythumb .muscle.on').length).toBeGreaterThan(3);
  });

  it('leaves the muscles out when the watch did not record the exercises', () => {
    render(<Strength sets={[set(null, 20, null)]} />);
    expect(screen.getByRole('heading', { name: 'Sets' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Muscles worked' })).not.toBeInTheDocument();
  });
});
