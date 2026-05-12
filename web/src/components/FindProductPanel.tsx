import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DescriptionSections, type ProductSearchHit } from '../api';

const DEFAULT_CATEGORY_ID = '491';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EnrichedProduct = ProductSearchHit & {
	description?: DescriptionSections;
	isDraft?: boolean;
	language?: string;
};

function imageUrl(item: { url: string } | string): string {
	return typeof item === 'string' ? item : item.url;
}

export interface SelectedTargetProduct {
	id: string;
	name: string;
}

export function FindProductPanel({
	onPick,
	pickedId,
}: {
	onPick?: (p: SelectedTargetProduct) => void;
	pickedId?: string | null;
} = {}) {
	const [query, setQuery] = useState('');
	const [categoryId, setCategoryId] = useState(DEFAULT_CATEGORY_ID);
	const [results, setResults] = useState<ProductSearchHit[]>([]);
	const [nextPageId, setNextPageId] = useState<string | undefined>(undefined);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<ProductSearchHit | null>(null);

	const seqRef = useRef(0);
	const sentinelRef = useRef<HTMLDivElement | null>(null);

	// Debounced first-page fetch. Resets the result list whenever the query or
	// the category-id filter changes — pagination is cursor-based so any change
	// invalidates the cursor.
	useEffect(() => {
		const q = query.trim();
		if (q.length < 2) {
			setResults([]);
			setNextPageId(undefined);
			setError(null);
			return;
		}
		const seq = ++seqRef.current;
		setLoading(true);
		setError(null);
		setResults([]);
		setNextPageId(undefined);

		const t = setTimeout(async () => {
			try {
				if (UUID_RE.test(q)) {
					const product = await api.getProduct(q);
					if (seqRef.current === seq) {
						setResults([product]);
						setNextPageId(undefined);
					}
				} else {
					const r = await api.searchProducts({
						phrase: q,
						categoryId: categoryId.trim() || undefined,
					});
					if (seqRef.current === seq) {
						setResults(r.products ?? []);
						setNextPageId(r.nextPageId);
					}
				}
			} catch (e) {
				if (seqRef.current === seq) {
					setResults([]);
					setError((e as Error).message);
				}
			} finally {
				if (seqRef.current === seq) setLoading(false);
			}
		}, 300);
		return () => clearTimeout(t);
	}, [query, categoryId]);

	const loadMore = useCallback(async () => {
		if (loadingMore || loading) return;
		if (!nextPageId) return;
		const q = query.trim();
		if (q.length < 2 || UUID_RE.test(q)) return;
		const seq = seqRef.current;
		setLoadingMore(true);
		try {
			const r = await api.searchProducts({
				phrase: q,
				categoryId: categoryId.trim() || undefined,
				pageId: nextPageId,
			});
			if (seqRef.current === seq) {
				setResults(prev => [...prev, ...(r.products ?? [])]);
				setNextPageId(r.nextPageId);
			}
		} catch (e) {
			if (seqRef.current === seq) setError((e as Error).message);
		} finally {
			if (seqRef.current === seq) setLoadingMore(false);
		}
	}, [loading, loadingMore, nextPageId, query, categoryId]);

	// Infinite scroll. Watch a sentinel under the results list; once visible (or
	// near-visible via rootMargin), pull the next page.
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el) return;
		if (!nextPageId) return;
		const io = new IntersectionObserver(
			entries => {
				for (const e of entries) if (e.isIntersecting) loadMore();
			},
			{ root: null, rootMargin: '200px', threshold: 0 },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [nextPageId, loadMore]);

	return (
		<div className='space-y-4'>
			<section className='panel'>
				<header className='px-4 h-11 flex items-center border-b border-border'>
					<span className='label'>Поиск товара в каталоге Allegro</span>
				</header>
				<div className='p-4 space-y-3'>
					<div className='grid grid-cols-1 md:grid-cols-[160px_1fr] gap-3 items-end'>
						<label className='block'>
							<span className='label block mb-1.5'>Category ID</span>
							<input
								className='input'
								value={categoryId}
								onChange={e => setCategoryId(e.target.value.replace(/\D/g, ''))}
								placeholder='491'
							/>
						</label>
						<label className='block'>
							<span className='label block mb-1.5'>
								запрос
								{loading && (
									<span className='text-ink-faint normal-case font-normal'>
										{' '}
										· · ·
									</span>
								)}
							</span>
							<input
								className='input'
								value={query}
								onChange={e => setQuery(e.target.value)}
								placeholder='название или productId (UUID)'
								autoFocus
							/>
						</label>
					</div>
					{error && (
						<div className='text-[13px] text-bad border border-bad/30 bg-badTint rounded-md px-3 py-2'>
							{error}
						</div>
					)}
				</div>
			</section>

			{results.length > 0 && !selected && (
				<section className='panel'>
					<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
						<span className='label'>
							Найдено
							<span className='text-[11px] font-medium text-ink-muted normal-case tracking-normal ml-2'>
								· {results.length}
								{nextPageId ? '+' : ''}
							</span>
						</span>
						{loadingMore && (
							<span className='text-[11px] text-ink-faint'>догружаю · · ·</span>
						)}
					</header>
					<div className='divide-y divide-border-muted'>
						{results.map(p => {
							const img =
								p.images && p.images.length > 0 ? imageUrl(p.images[0]) : null;
							return (
								<button
									key={p.id}
									type='button'
									onClick={() => setSelected(p)}
									className='w-full text-left p-3 flex items-start gap-3 hover:bg-soft transition'>
									<div className='aspect-square w-14 h-14 border border-border rounded-md overflow-hidden bg-soft flex items-center justify-center shrink-0'>
										{img ? (
											<img
												src={img}
												alt=''
												loading='lazy'
												className='w-full h-full object-contain'
												onError={e => {
													(e.target as HTMLImageElement).style.opacity = '0.2';
												}}
											/>
										) : (
											<span className='text-ink-faint text-[10px]'>—</span>
										)}
									</div>
									<div className='min-w-0 flex-1'>
										<div className='text-ink text-[13px] truncate'>{p.name}</div>
										<div className='text-ink-faint font-mono text-[11px] truncate'>
											{p.id}
										</div>
										{p.parameters && p.parameters.length > 0 && (
											<div className='text-ink-muted text-[11px] mt-0.5 truncate'>
												{p.parameters
													.slice(0, 4)
													.map(
														par =>
															`${par.name}: ${par.valuesLabels?.[0] ?? par.values?.[0] ?? '—'}`,
													)
													.join(' · ')}
											</div>
										)}
									</div>
								</button>
							);
						})}
						{/* Sentinel for IntersectionObserver — keeps a foothold even when there's
						    no next page so the layout doesn't jump. */}
						<div ref={sentinelRef} className='h-1' />
					</div>
					{!nextPageId && results.length > 0 && (
						<div className='px-4 py-2 text-[11px] text-ink-faint text-center border-t border-border-muted'>
							конец списка
						</div>
					)}
				</section>
			)}

			{selected && (
				<SelectedProduct
					product={selected}
					onBack={() => setSelected(null)}
					onPick={onPick}
					isPicked={pickedId === selected.id}
				/>
			)}
		</div>
	);
}

function SelectedProduct({
	product: initial,
	onBack,
	onPick,
	isPicked,
}: {
	product: ProductSearchHit;
	onBack: () => void;
	onPick?: (p: SelectedTargetProduct) => void;
	isPicked?: boolean;
}) {
	const [product, setProduct] = useState<EnrichedProduct>(initial);
	const [fetching, setFetching] = useState(true);
	const [fetchError, setFetchError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setProduct(initial);
		setFetching(true);
		setFetchError(null);
		api
			.getProduct(initial.id)
			.then(p => {
				if (!cancelled) setProduct(p as EnrichedProduct);
			})
			.catch(e => {
				if (!cancelled) setFetchError((e as Error).message);
			})
			.finally(() => {
				if (!cancelled) setFetching(false);
			});
		return () => {
			cancelled = true;
		};
	}, [initial.id]);

	const copy = () => {
		navigator.clipboard?.writeText(product.id).catch(() => {});
	};

	const descSummary = product.description
		? describeDescription(product.description)
		: null;

	return (
		<section className='panel border-ok/30'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-ok/30 bg-okTint'>
				<span className='label text-ok'>
					Выбран товар
					{fetching && (
						<span className='text-[11px] font-normal normal-case tracking-normal text-ink-faint ml-2'>
							· догружаю карточку
						</span>
					)}
				</span>
				<button
					type='button'
					onClick={onBack}
					className='btn btn-ghost h-7 px-2 text-[11px]'>
					← к списку
				</button>
			</header>
			<div className='p-4 space-y-3 text-[13px]'>
				<div className='flex items-center gap-2 flex-wrap'>
					<span className='text-ink-muted'>productId:</span>
					<span className='font-mono text-ink break-all'>{product.id}</span>
					<button
						type='button'
						onClick={copy}
						className='btn btn-ghost h-7 px-2 text-[11px]'>
						копировать
					</button>
					{product.isDraft && (
						<span className='chip border-warn/30 bg-warnTint text-warn normal-case tracking-normal text-[11px] font-medium'>
							draft
						</span>
					)}
					{product.language && (
						<span className='chip border-border bg-soft text-ink-muted normal-case tracking-normal text-[11px] font-mono'>
							{product.language}
						</span>
					)}
				</div>
				<div className='text-ink'>{product.name}</div>
				{product.category?.id && (
					<div className='text-ink-muted text-[12px]'>
						категория {product.category.id}
					</div>
				)}
				{fetchError && (
					<div className='text-[12px] text-bad'>
						Не удалось догрузить карточку: {fetchError}
					</div>
				)}
				{product.images && product.images.length > 0 && (
					<div className='border-t border-border-muted pt-2'>
						<div className='label mb-2'>
							Картинки ({product.images.length})
						</div>
						<div className='grid grid-cols-6 gap-2'>
							{product.images.map((img, i) => (
								<a
									key={i}
									href={imageUrl(img)}
									target='_blank'
									rel='noreferrer'
									className='aspect-square border border-border rounded-md overflow-hidden bg-soft'>
									<img
										src={imageUrl(img)}
										alt=''
										loading='lazy'
										className='w-full h-full object-contain'
									/>
								</a>
							))}
						</div>
					</div>
				)}
				{product.parameters && product.parameters.length > 0 && (
					<div className='border-t border-border-muted pt-2'>
						<div className='label mb-2'>
							Параметры ({product.parameters.length})
						</div>
						<div className='grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-[12px]'>
							{product.parameters.map(p => {
								const labels = p.valuesLabels ?? [];
								const vals = p.values ?? [];
								const display =
									labels.length > 0
										? labels.join(', ')
										: vals.length > 0
											? vals.join(', ')
											: '—';
								return (
									<div
										key={p.id}
										className='flex justify-between gap-4 border-b border-border-muted py-1 last:border-b-0'>
										<span className='text-ink-muted truncate'>
											{p.name ?? p.id}
											{p.unit ? ` [${p.unit}]` : ''}
										</span>
										<span className='text-ink text-right break-words'>
											{display}
										</span>
									</div>
								);
							})}
						</div>
					</div>
				)}
				{descSummary && (
					<div className='border-t border-border-muted pt-2'>
						<div className='label mb-2'>Описание</div>
						<div className='text-[11px] text-ink-faint mb-1.5'>
							{descSummary.sections} секц. · {descSummary.textBlocks} текст ·{' '}
							{descSummary.images} картинок
						</div>
						{descSummary.preview && (
							<details className='text-[12px] text-ink-muted'>
								<summary className='cursor-pointer hover:text-ink'>
									показать текст ({descSummary.totalChars.toLocaleString()}{' '}
									симв.)
								</summary>
								<div className='mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap leading-snug bg-soft/40 rounded-md p-2'>
									{descSummary.preview}
									{descSummary.truncated ? '…' : ''}
								</div>
							</details>
						)}
					</div>
				)}
				{onPick && (
					<div className='pt-2 border-t border-border-muted'>
						<button
							type='button'
							onClick={() => onPick({ id: product.id, name: product.name })}
							className={`btn h-8 px-3 text-[12px] ${
								isPicked ? 'btn-primary' : ''
							}`}>
							{isPicked ? '✓ привязано к клону' : 'Использовать в клоне →'}
						</button>
					</div>
				)}
			</div>
		</section>
	);
}

function describeDescription(desc: DescriptionSections): {
	sections: number;
	textBlocks: number;
	images: number;
	preview: string;
	totalChars: number;
	truncated: boolean;
} {
	let textBlocks = 0;
	let images = 0;
	const texts: string[] = [];
	for (const s of desc.sections) {
		for (const it of s.items) {
			if (it.type === 'TEXT') {
				textBlocks++;
				const plain = it.content
					.replace(/<[^>]+>/g, ' ')
					.replace(/&nbsp;/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();
				if (plain) texts.push(plain);
			} else {
				images++;
			}
		}
	}
	const joined = texts.join('\n\n');
	const MAX = 2000;
	return {
		sections: desc.sections.length,
		textBlocks,
		images,
		preview: joined.slice(0, MAX),
		totalChars: joined.length,
		truncated: joined.length > MAX,
	};
}
