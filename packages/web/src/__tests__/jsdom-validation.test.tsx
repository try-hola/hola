import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

// Simple component to test React rendering
function TestComponent() {
  const handleClick = () => {
    // Button click handler for testing
  };

  return (
    <div>
      <h1>Hello World</h1>
      <p>This is a test component</p>
      <button onClick={handleClick}>Click me</button>
    </div>
  );
}

describe('JSdom & React Testing Library Validation', () => {
  afterEach(() => {
    cleanup();
  });

  it('should have document and window available', () => {
    expect(document).toBeDefined();
    expect(window).toBeDefined();
    expect(document.body).toBeDefined();
    expect(window.location).toBeDefined();
  });

  it('should support @testing-library/react render function', () => {
    const { container } = render(<TestComponent />);
    
    // Verify that render function works without throwing errors
    expect(container).toBeDefined();
    expect(container.firstChild).toBeDefined();
  });

  it('should support jest-dom matchers', () => {
    render(<TestComponent />);
    
    // Test that jest-dom matchers are available
    const container = document.body.firstChild;
    expect(container).toBeInTheDocument();
  });
});