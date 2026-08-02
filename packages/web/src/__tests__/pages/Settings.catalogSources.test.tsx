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

const PREVIEW = {
  appCount: 4,
  appsWithoutRefs: 1,
  registries: [
    { glob: 'ghcr.io/pofallon/*', appCount: 2, covered: false },
    { glob: 'ghcr.io/try-hola/*', appCount: 1, covered: true },
  ],
};

const catalogSources = {
  list: vi.fn(async () => ({ items: SOURCES })),
  add: vi.fn(async () => SOURCES[1]),
  update: vi.fn(async () => SOURCES[1]),
  remove: vi.fn(async () => ({ success: true })),
  preview: vi.fn(async () => PREVIEW),
};

const registryCredentials = {
  list: vi.fn(async () => ({ items: [{ id: 'acme-bot', registry: 'ghcr.io', username: 'bot' }] })),
};

vi.mock('../../utils/api-hybrid', () => ({ api: { catalogSources, registryCredentials } }));

const { CatalogSourcesCard } = await import('../../pages/Settings');

const renderCard = () => render(<CatalogSourcesCard inputClass="input" labelClass="label" />);

beforeEach(() => {
  vi.clearAllMocks();
  catalogSources.preview.mockResolvedValue(PREVIEW);
});
afterEach(() => cleanup());

/** Fill the URL field and wait out the preview debounce. */
async function typeUrlAndPreview(url = 'https://example.test/catalog.json') {
  fireEvent.change(screen.getByPlaceholderText(/raw\.githubusercontent\.com/), { target: { value: url } });
  await waitFor(() => expect(catalogSources.preview).toHaveBeenCalledWith(url), { timeout: 2000 });
}

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

  it('probes the URL and grants only the registries the operator ticks', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('pofallon')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));

    // Nothing is probed until the URL looks like one — no request per keystroke.
    fireEvent.change(screen.getByPlaceholderText(/raw\.githubusercontent\.com/), { target: { value: 'not-a-url' } });
    expect(catalogSources.preview).not.toHaveBeenCalled();

    await typeUrlAndPreview();

    // The catalog's own contents, with app counts for context.
    await waitFor(() => expect(screen.getByText(/4 apps/)).toBeInTheDocument());
    expect(screen.getByText('ghcr.io/pofallon/*')).toBeInTheDocument();
    expect(screen.getByText(/1 app list(s)? no installable package/)).toBeInTheDocument();

    // Consent is opt-IN: discovered registries start unticked, so nothing is
    // granted by merely pasting a URL.
    const grantable = screen.getByLabelText('Allow ghcr.io/pofallon/*') as HTMLInputElement;
    expect(grantable.checked).toBe(false);
    // A registry the server baseline already covers is shown, not asked for.
    const covered = screen.getByLabelText('Allow ghcr.io/try-hola/*') as HTMLInputElement;
    expect(covered.checked).toBe(true);
    expect(covered.disabled).toBe(true);

    fireEvent.click(grantable);
    expect((screen.getByPlaceholderText('ghcr.io/myorg/*') as HTMLInputElement).value).toBe('ghcr.io/pofallon/*');

    fireEvent.change(screen.getByPlaceholderText('acme'), { target: { value: 'acme' } });
    fireEvent.click(screen.getByRole('button', { name: /^add source$/i }));

    await waitFor(() => expect(catalogSources.add).toHaveBeenCalled());
    // Only the ticked one — never the already-covered baseline registry.
    expect(catalogSources.add.mock.calls[0][0]).toMatchObject({ allowRegistries: ['ghcr.io/pofallon/*'] });
  });

  it('unticking a registry withdraws it from the grant', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('pofallon')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await typeUrlAndPreview();

    const box = await screen.findByLabelText('Allow ghcr.io/pofallon/*');
    fireEvent.click(box);
    fireEvent.click(box);
    expect((screen.getByPlaceholderText('ghcr.io/myorg/*') as HTMLInputElement).value).toBe('');
  });

  it('reports a URL that is not a usable catalog instead of silently adding it', async () => {
    catalogSources.preview.mockRejectedValue(new Error('CATALOG_MALFORMED: did not return a catalog.json (no "apps" array).'));
    renderCard();
    await waitFor(() => expect(screen.getByText('pofallon')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await typeUrlAndPreview('https://example.test/README.md');

    await waitFor(() => expect(screen.getByText(/did not return a catalog\.json/)).toBeInTheDocument());
    // Advisory, not a gate: adding is still allowed (a catalog may be published later).
    expect(screen.getByRole('button', { name: /^add source$/i })).not.toBeDisabled();
  });

  it('previews on edit too, so an existing source can be checked against its catalog', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('pofallon')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Edit pofallon'));
    await waitFor(() => expect(catalogSources.preview).toHaveBeenCalledWith('https://example.test/catalog.json'), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText('ghcr.io/pofallon/*')).toBeInTheDocument());
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
