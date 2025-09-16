import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Minimal test to debug React rendering
function MinimalComponent() {
  return React.createElement('div', { 'data-testid': 'test-element' }, 'Hello World');
}

function JSXComponent() {
  return <div data-testid="jsx-element">JSX Hello World</div>;
}

describe('React Rendering Debug', () => {
  it('should render with React.createElement', () => {
    const { container } = render(React.createElement(MinimalComponent));
    console.log('createElement container:', container.innerHTML);
    expect(screen.getByTestId('test-element')).toBeInTheDocument();
  });

  it('should render with JSX', () => {
    const { container } = render(<JSXComponent />);
    console.log('JSX container:', container.innerHTML);
    expect(screen.getByTestId('jsx-element')).toBeInTheDocument();
  });
});