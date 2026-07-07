import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CrmGalleryPicker from './CrmGalleryPicker';

vi.mock('../api', () => ({
  api: {
    crm: {
      folders: vi.fn().mockResolvedValue({
        folders: [{ id: 'f1', name: 'Dell 7420', photoCount: 2 }],
        nextCursor: null,
      }),
      folder: vi.fn().mockResolvedValue({
        id: 'f1',
        name: 'Dell 7420',
        photos: [
          { id: 'p1', url: 'https://cdn/p1.jpg', thumbnailUrl: 'https://cdn/p1_t.webp', angleId: null, sortOrder: 0 },
          { id: 'p2', url: 'https://cdn/p2.jpg', thumbnailUrl: 'https://cdn/p2_t.webp', angleId: null, sortOrder: 1 },
        ],
      }),
    },
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  // Matches App.test.tsx: silence React's "not configured for act()" warning
  // for this createRoot-driven test (see src/App.test.tsx for precedent).
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

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

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 350)); // let the 300ms search debounce fire
  });
};

describe('CrmGalleryPicker', () => {
  it('confirms selected photo urls in click order', async () => {
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <CrmGalleryPicker open initialSearch="dell" onConfirm={onConfirm} onCancel={() => {}} />,
      );
    });
    await flush();

    // Open the folder.
    const folderBtn = [...document.body.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Dell 7420'),
    )!;
    await act(async () => folderBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => Promise.resolve());

    // Select both photos (thumbnails are buttons wrapping an <img>).
    const thumbs = [...document.body.querySelectorAll('button')].filter(b => b.querySelector('img'));
    await act(async () => thumbs[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => thumbs[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const confirm = [...document.body.querySelectorAll('button')].find(b =>
      b.textContent?.startsWith('Добавить выбранные'),
    )!;
    await act(async () => confirm.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onConfirm).toHaveBeenCalledWith(['https://cdn/p2.jpg', 'https://cdn/p1.jpg']);
  });

  it('renders nothing when closed', async () => {
    await act(async () => {
      root.render(<CrmGalleryPicker open={false} onConfirm={() => {}} onCancel={() => {}} />);
    });
    expect(document.body.textContent).not.toContain('Галерея CRM');
  });
});
