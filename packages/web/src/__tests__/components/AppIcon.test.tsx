import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppIcon } from '../../components/ui/AppIcon';

describe('AppIcon', () => {
  it('renders an emoji glyph when given an emoji', () => {
    render(<AppIcon name="Gitea" emoji="🍵" />);
    expect(screen.getByText('🍵')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('falls back to a monogram when no icon is given', () => {
    const { container } = render(<AppIcon name="Gitea" />);
    expect(container.textContent).toBe('gi');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders an <img> for an http(s) URL icon', () => {
    render(<AppIcon name="Gitea" emoji="https://cdn.example.com/gitea.png" />);
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe('https://cdn.example.com/gitea.png');
    expect(img).toHaveAttribute('alt', 'Gitea icon');
  });

  it('renders an <img> for a data-URI icon', () => {
    const dataUri = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    render(<AppIcon name="App" emoji={dataUri} />);
    expect((screen.getByRole('img') as HTMLImageElement).src).toBe(dataUri);
  });

  it('falls back to the monogram tile when the image fails to load', () => {
    render(<AppIcon name="Gitea" emoji="https://cdn.example.com/broken.png" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('gi')).toBeInTheDocument();
  });
});
