import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
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

  it('should support @testing-library/react render function', async () => {
    const { container } = render(<TestComponent />);
    
    // React 18 async rendering - wait for content
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });
    
    // Debug logging
    console.log('Working test - container HTML:', container.innerHTML);
    console.log('Working test - container firstChild:', container.firstChild);
    
    // Verify that render function works without throwing errors
    expect(container).toBeDefined();
    expect(container.firstChild).toBeDefined();
  });

  it('should support jest-dom matchers', async () => {
    render(<TestComponent />);
    
    // React 18 async rendering - wait for content 
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });
    
    // Test that jest-dom matchers are available
    const container = document.body.firstChild;
    expect(container).toBeInTheDocument();
  });
});