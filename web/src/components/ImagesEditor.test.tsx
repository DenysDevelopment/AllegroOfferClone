import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ImagesEditor } from './ImagesEditor';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const clickByText = async (text: string) => {
  const btn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
  await act(async () => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

describe('ImagesEditor CRM import', () => {
  it('hides the CRM button when onImportFromCrm is absent', async () => {
    await act(async () => {
      root.render(<ImagesEditor urls={[]} onChange={() => {}} />);
    });
    expect(container.textContent).not.toContain('Из галереи CRM');
  });

  it('re-hosts each imported url via onUploadByUrl and appends them', async () => {
    const onChange = vi.fn();
    const onUploadByUrl = vi
      .fn()
      .mockImplementation(async (u: string) => u.replace('cdn', 'allegro'));
    const onImportFromCrm = vi
      .fn()
      .mockResolvedValue(['https://cdn/a.jpg', 'https://cdn/b.jpg']);

    await act(async () => {
      root.render(
        <ImagesEditor
          urls={['https://existing/0.jpg']}
          onChange={onChange}
          onUploadByUrl={onUploadByUrl}
          onImportFromCrm={onImportFromCrm}
        />,
      );
    });

    await clickByText('Из галереи CRM');
    await act(async () => Promise.resolve());

    expect(onUploadByUrl).toHaveBeenCalledTimes(2);
    // Last onChange call carries both re-hosted urls appended to the original.
    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toEqual([
      'https://existing/0.jpg',
      'https://allegro/a.jpg',
      'https://allegro/b.jpg',
    ]);
  });

  it('one failed re-host does not stop the others', async () => {
    const onChange = vi.fn();
    const onUploadByUrl = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('https://allegro/b.jpg');
    const onImportFromCrm = vi.fn().mockResolvedValue(['https://cdn/a.jpg', 'https://cdn/b.jpg']);

    await act(async () => {
      root.render(
        <ImagesEditor
          urls={[]}
          onChange={onChange}
          onUploadByUrl={onUploadByUrl}
          onImportFromCrm={onImportFromCrm}
        />,
      );
    });

    await clickByText('Из галереи CRM');
    await act(async () => Promise.resolve());

    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toEqual(['https://allegro/b.jpg']);
  });
});
