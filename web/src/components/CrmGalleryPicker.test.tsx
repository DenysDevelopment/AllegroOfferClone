import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CrmGalleryPicker from './CrmGalleryPicker';

// Shared, controllable `api.crm.folder` mock. Declared via `vi.hoisted` so the
// `vi.mock` factory below (which Vitest hoists above these imports) can close
// over it safely.
const crmFolderControl = vi.hoisted(() => {
  const pending = new Map<string, Array<() => void>>();
  let deferred = false;

  const detailFor = (id: string) =>
    id === 'f2'
      ? {
          id: 'f2',
          name: 'HP EliteBook',
          photos: [
            { id: 'q1', url: 'https://cdn/q1.jpg', thumbnailUrl: 'https://cdn/q1_t.webp', angleId: null, sortOrder: 0 },
          ],
        }
      : {
          id: 'f1',
          name: 'Dell 7420',
          photos: [
            { id: 'p1', url: 'https://cdn/p1.jpg', thumbnailUrl: 'https://cdn/p1_t.webp', angleId: null, sortOrder: 0 },
            { id: 'p2', url: 'https://cdn/p2.jpg', thumbnailUrl: 'https://cdn/p2_t.webp', angleId: null, sortOrder: 1 },
          ],
        };

  const folder = vi.fn((id: string) => {
    if (!deferred) return Promise.resolve(detailFor(id));
    return new Promise(resolve => {
      const queue = pending.get(id) ?? [];
      queue.push(() => resolve(detailFor(id)));
      pending.set(id, queue);
    });
  });

  return {
    folder,
    armDeferred: () => {
      deferred = true;
    },
    resolveOne: (id: string) => {
      const queue = pending.get(id);
      const next = queue?.shift();
      if (!next) throw new Error(`no pending api.crm.folder('${id}') call to resolve`);
      next();
    },
    reset: () => {
      deferred = false;
      pending.clear();
    },
  };
});

vi.mock('../api', () => ({
  api: {
    crm: {
      folders: vi.fn().mockResolvedValue({
        folders: [
          { id: 'f1', name: 'Dell 7420', photoCount: 2 },
          { id: 'f2', name: 'HP EliteBook', photoCount: 1 },
        ],
        nextCursor: null,
      }),
      folder: crmFolderControl.folder,
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
  crmFolderControl.reset();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 350)); // let the 300ms search debounce fire
  });
};

const findButtonByText = (text: string) =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;

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
    const folderBtn = findButtonByText('Dell 7420');
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

  it('ignores a stale folder response that resolves after a newer folder load', async () => {
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(<CrmGalleryPicker open onConfirm={onConfirm} onCancel={() => {}} />);
    });
    await flush();

    // From here on, api.crm.folder() returns promises we control by hand.
    crmFolderControl.armDeferred();

    // Click folder f1, then — before it resolves — click folder f2. Both
    // loadFolder() calls are now in flight simultaneously.
    const f1Btn = findButtonByText('Dell 7420');
    const f2Btn = findButtonByText('HP EliteBook');
    await act(async () => f1Btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => f2Btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Resolve OUT OF ORDER: the newer click (f2) settles first, then the
    // stale, older click (f1) settles last.
    await act(async () => {
      crmFolderControl.resolveOne('f2');
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      crmFolderControl.resolveOne('f1');
      await Promise.resolve();
      await Promise.resolve();
    });

    // The grid must reflect the last-clicked folder (f2: one HP photo), not
    // the stale, late-arriving response from the first click (f1: two Dell
    // photos). Without a stale-response guard, f1's late response overwrites
    // f2's already-rendered detail and this assertion fails.
    const thumbs = [...document.body.querySelectorAll('button')].filter(b => b.querySelector('img'));
    expect(thumbs).toHaveLength(1);
    const img = thumbs[0].querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://cdn/q1_t.webp');
  });
});
