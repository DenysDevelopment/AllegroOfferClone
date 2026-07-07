import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type CrmFolderDetail, type CrmFolderSummary, type CrmPhoto } from '../api';
import { togglePhoto } from './crmSelection';

interface Props {
  open: boolean;
  initialSearch?: string;
  onConfirm: (urls: string[]) => void;
  onCancel: () => void;
}

export default function CrmGalleryPicker({ open, initialSearch, onConfirm, onCancel }: Props) {
  const [search, setSearch] = useState(initialSearch ?? '');
  const [folders, setFolders] = useState<CrmFolderSummary[]>([]);
  const [detail, setDetail] = useState<CrmFolderDetail | null>(null);
  // The clicked top-level model folder (drives the left highlight + channel bar).
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  // What's actually loaded in the grid — a model id or one of its channel ids.
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<CrmPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    setSearch(initialSearch ?? '');
    setDetail(null);
    setActiveModelId(null);
    setActiveFolderId(null);
    setSelected([]);
    setError(null);
  }, [open, initialSearch]);

  // Debounced folder search while open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.crm.folders({ search: search.trim() || undefined });
        if (!cancelled) setFolders(res.folders);
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, search]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const loadSeq = useRef(0);
  const loadFolder = useCallback(async (id: string) => {
    const seq = ++loadSeq.current;
    setActiveFolderId(id);
    setLoading(true);
    setError(null);
    try {
      const res = await api.crm.folder(id);
      if (seq === loadSeq.current) setDetail(res);
    } catch (e) {
      if (seq === loadSeq.current) setError(errMsg(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  // Photos live in the channel sub-folders (the model folder itself is usually
  // empty), and the CRM's /folders/{id}/photos response carries only `photos` —
  // no channels. So we take channels from the folder-list summary and, on
  // clicking a model, jump straight into its first channel.
  const openModel = useCallback(
    (f: CrmFolderSummary) => {
      setActiveModelId(f.id);
      const channels = f.channels ?? [];
      if (f.photoCount > 0 || channels.length === 0) {
        loadFolder(f.id);
      } else {
        loadFolder(channels[0].id);
      }
    },
    [loadFolder],
  );

  if (!open) return null;

  const photos = detail?.photos ?? [];
  const activeModel = folders.find(f => f.id === activeModelId) ?? null;
  const channels = activeModel?.channels ?? [];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onCancel();
      }}>
      <div className="panel flex h-[80vh] w-[min(1100px,95vw)] flex-col overflow-hidden shadow-lg">
        <header className="flex h-12 items-center justify-between gap-3 border-b border-border px-4">
          <span className="label">Галерея CRM</span>
          <input
            className="input h-8 max-w-xs flex-1 text-[13px]"
            placeholder="поиск модели…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button type="button" onClick={onCancel} className="btn btn-ghost h-8 w-8 px-0" title="Закрыть">
            ✕
          </button>
        </header>

        {error && (
          <div className="px-4 pt-2">
            <div className="rounded-md border border-bad/30 bg-badTint px-2 py-1.5 text-[12px] text-bad">
              {error}
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <aside className="w-64 shrink-0 overflow-auto border-r border-border p-2">
            {folders.length === 0 && !loading ? (
              <p className="p-2 text-[13px] text-ink-muted">Ничего не найдено.</p>
            ) : (
              folders.map(f => {
                const total = (f.channels ?? []).reduce(
                  (n, ch) => n + (ch.photoCount ?? 0),
                  f.photoCount ?? 0,
                );
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => openModel(f)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[13px] ${
                      activeModelId === f.id
                        ? 'border-flame-ring bg-soft'
                        : 'border-transparent hover:border-border'
                    }`}>
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-[11px] text-ink-muted">{total}</span>
                  </button>
                );
              })
            )}
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            {channels.length > 0 && (
              <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
                {activeModel && activeModel.photoCount > 0 && (
                  <button
                    type="button"
                    onClick={() => loadFolder(activeModel.id)}
                    className={`btn btn-ghost h-7 px-2 text-[12px] ${
                      activeFolderId === activeModel.id ? 'border border-flame-ring' : ''
                    }`}>
                    Все · {activeModel.photoCount}
                  </button>
                )}
                {channels.map(ch => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => loadFolder(ch.id)}
                    className={`btn btn-ghost h-7 px-2 text-[12px] ${
                      activeFolderId === ch.id ? 'border border-flame-ring' : ''
                    }`}>
                    {ch.name} · {ch.photoCount}
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {!detail ? (
                <p className="text-[13px] text-ink-muted">Выберите папку слева.</p>
              ) : photos.length === 0 ? (
                <p className="text-[13px] text-ink-muted">В этой папке нет фото.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                  {photos.map(ph => {
                    const isSel = selected.some(s => s.id === ph.id);
                    return (
                      <button
                        key={ph.id}
                        type="button"
                        onClick={() => setSelected(s => togglePhoto(s, ph))}
                        className={`relative aspect-square overflow-hidden rounded border bg-soft outline-none ${
                          isSel ? 'border-flame-ring ring-2 ring-flame-ring' : 'border-border hover:border-flame-ring'
                        }`}>
                        <img
                          src={ph.thumbnailUrl || ph.url}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={e => {
                            (e.target as HTMLImageElement).style.opacity = '0.2';
                          }}
                        />
                        {isSel && (
                          <span className="absolute right-1 top-1 rounded bg-flame px-1 text-[10px] font-semibold text-white">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="flex h-12 items-center justify-between border-t border-border px-4">
          <span className="text-[13px] text-ink-muted">Выбрано: {selected.length}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="btn btn-ghost h-8 px-3 text-[13px]">
              Отмена
            </button>
            <button
              type="button"
              onClick={() => onConfirm(selected.map(s => s.url))}
              disabled={selected.length === 0}
              className="btn btn-primary h-8 px-3 text-[13px] disabled:opacity-40">
              Добавить выбранные ({selected.length})
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function errMsg(e: unknown): string {
  const status = (e as { status?: number })?.status;
  if (status === 503) return 'CRM не настроена на сервере.';
  if (status === 401 || status === 403) return 'CRM отклонила ключ доступа.';
  if (status === 429) return 'Слишком много запросов к CRM, попробуйте позже.';
  return (e as Error)?.message ?? 'Ошибка запроса к CRM.';
}
