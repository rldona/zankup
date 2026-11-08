import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('renders the product name and the claim', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'OpenSport' })).toBeInTheDocument();
    expect(screen.getByText('Your sports data, on another level.')).toBeInTheDocument();
  });
});
