import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { CatalogSourceRecord } from '@hola/shared';

/**
 * A catalog source added without `allowRegistries` blocks every install from it
 * with REF_NOT_ALLOWED. The server has always supported PATCHing one in place;
 * until the edit form existed, the UI's only route was remove-and-re-add — which
 * loses the source's other settings and is a strange thing to ask of an operator
 * following an error message that says "add the registry to this source".
 */
const SOURCES: CatalogSourceRecord[] = [
  { id: 'hola', name: 'hola', type: 'index-url', url: 'https://raw.githubusercontent.com/try-hola/apps/main/catalog.json', trust: 'verified', enabled: true },
  { id: 'pofallon', name: 'Pofallon apps', type: 'index-url', url: 'https://example.test/catalog.json', trust: 'custom', enabled: true },
];

const catalogSources = {
  list: vi.fn(async () => ({ items: SOURCES })),
  add: vi.fn(async () => SOURCES[1]),
  update: vi.fn(async () => SOURCES[1]),
  remove: vi.fn(async () => ({ success: true })),
};

const registryCredentials = {
  list: vi.fn(async () => ({ items: [{ id: 'acme-bot', registry: 'ghcr.io', username: 'bot' }] })),
};

vi.mock('../../utils/api-hybrid', () => ({ api: { catalogSources, registryCredentials } }));

const { CatalogSourcesCard } = await import('../../pages/Settings');

const renderCard = () => render(<CatalogSourcesCard inputClass="input" labelClass="label" />);

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('Settings → Catalog Sources editing', () => {
  it('patches an existing source in place rather than recreating it', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('pofallon')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Edit pofallon'));

    // The form opens prefilled, and the id — the record key — is not editable.
    const idInput = screen.getByPlaceholderText('acme') as HTMLInputElement;
    expect(idInput.value).toBe('pofallon');
    expect(idInput.readOnly).toBe(true);
    expect((screen.getByPlaceholderText(/raw\.githubusercontent\.com/) as HTMLInputElement).value).toBe('https://example.test/catalog.json');

    fireEvent.change(screen.getByPlaceholderText('ghcr.io/myorg/*'), {
      target: { value: 'ghcr.io/pofallon/*, ghcr.io/pofallon-labs/*' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(catalogSources.update).toHaveBeenCalled());
    expect(catalogSources.add).not.toHaveBeenCalled();
    expect(catalogSources.remove).not.toHaveBeenCalled();

    const [id, patch] = catalogSources.update.mock.calls[0] as [string, { allowRegistries: string[]; url: string; name: string }];
    expect(id).toBe('pofallon');
    // Comma-separated input is split and trimmed, matching the server's parser.
    expect(patch.allowRegistries).toEqual(['ghcr.io/pofallon/*', 'ghcr.io/pofallon-labs/*']);
    // Untouched fields are sent as they were, so saving one field can't blank another.
    expect(patch.url).toBe('https://example.test/catalog.json');
    expect(patch.name).toBe('Pofallon apps');
  });

  it('clearing the globs box clears the allowlist (an empty array, not "unchanged")', async () => {
    catalogSources.list.mockResolvedValueOnce({
      items: [{ ...SOURCES[1], allowRegistries: ['ghcr.io/pofallon/*'] }],
    });
    renderCard();
    await waitFor(() => expect(screen.getByText(/allows: ghcr\.io\/pofallon\/\*/)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Edit pofallon'));
    fireEvent.change(screen.getByPlaceholderText('ghcr.io/myorg/*'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(catalogSources.update).toHaveBeenCalled());
    expect((catalogSources.update.mock.calls[0][1] as { allowRegistries: string[] }).allowRegistries).toEqual([]);
  });

  it('offers no edit for the built-in source, which has no stored record to patch', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('hola')).toBeInTheDocument());

    expect(screen.queryByLabelText('Edit hola')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove hola')).not.toBeInTheDocument();
  });

  it('still adds a new source, with the id editable and no source id preselected', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('pofallon')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    const idInput = screen.getByPlaceholderText('acme') as HTMLInputElement;
    expect(idInput.value).toBe('');
    expect(idInput.readOnly).toBe(false);

    fireEvent.change(idInput, { target: { value: 'acme' } });
    fireEvent.change(screen.getByPlaceholderText(/raw\.githubusercontent\.com/), { target: { value: 'https://acme.test/catalog.json' } });
    fireEvent.click(screen.getByRole('button', { name: /^add source$/i }));

    await waitFor(() => expect(catalogSources.add).toHaveBeenCalled());
    expect(catalogSources.update).not.toHaveBeenCalled();
  });
});
