import { useEffect, useRef, useState } from 'react';
import { api, type ProductSearchHit } from '../api';

const DEFAULT_CATEGORY_ID = '491';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function imageUrl(item: { url: string } | string): string {
	return typeof item === 'string' ? item : item.url;
}

export function FindProductPanel() {
	const [query, setQuery] = useState('');
	const [categoryId, setCategoryId] = useState(DEFAULT_CATEGORY_ID);
	const [results, setResults] = useState<ProductSearchHit[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<ProductSearchHit | null>(null);

	const seqRef = useRef(0);

	useEffect(() => {
		const q = query.trim();
		if (q.length < 2) {
			setResults([]);
			setError(null);
			return;
		}
		const seq = ++seqRef.current;
		setLoading(true);
		setError(null);

		const t = setTimeout(async () => {
			try {
				if (UUID_RE.test(q)) {
					// Looks like a productId — fetch directly.
					const product = await api.getProduct(q);
					if (seqRef.current === seq) setResults([product]);
				} else {
					const r = await api.searchProducts({
						phrase: q,
						categoryId: categoryId.trim() || undefined,
						limit: 30,
					});
					if (seqRef.current === seq) setResults(r.products ?? []);
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
					<header className='px-4 h-11 flex items-center border-b border-border'>
						<span className='label'>
							Найдено
							<span className='text-[11px] font-medium text-ink-muted normal-case tracking-normal ml-2'>
								· {results.length}
							</span>
						</span>
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
													.map(par => `${par.name}: ${par.valuesLabels?.[0] ?? par.values?.[0] ?? '—'}`)
													.join(' · ')}
											</div>
										)}
									</div>
								</button>
							);
						})}
					</div>
				</section>
			)}

			{selected && <SelectedProduct product={selected} onBack={() => setSelected(null)} />}
		</div>
	);
}

function SelectedProduct({
	product,
	onBack,
}: {
	product: ProductSearchHit;
	onBack: () => void;
}) {
	const copy = () => {
		navigator.clipboard?.writeText(product.id).catch(() => {});
	};
	const productUrl = `https://allegro.pl/product/${product.id}`;
	return (
		<section className='panel border-ok/30'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-ok/30 bg-okTint'>
				<span className='label text-ok'>Выбран товар</span>
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
				</div>
				<div className='text-ink'>{product.name}</div>
				{product.category?.id && (
					<div className='text-ink-muted text-[12px]'>
						категория {product.category.id}
					</div>
				)}
				{product.images && product.images.length > 0 && (
					<div className='grid grid-cols-6 gap-2 pt-2 border-t border-border-muted'>
						{product.images.slice(0, 12).map((img, i) => (
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
				)}
				{product.parameters && product.parameters.length > 0 && (
					<div className='border-t border-border-muted pt-2'>
						<div className='label mb-2'>Параметры ({product.parameters.length})</div>
						<div className='grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-[12px]'>
							{product.parameters.map(p => (
								<div
									key={p.id}
									className='flex justify-between gap-4 border-b border-border-muted py-1 last:border-b-0'>
									<span className='text-ink-muted truncate'>{p.name ?? p.id}</span>
									<span className='text-ink text-right'>
										{p.valuesLabels?.[0] ?? p.values?.[0] ?? '—'}
									</span>
								</div>
							))}
						</div>
					</div>
				)}
				<div className='pt-2 border-t border-border-muted'>
					<a
						href={productUrl}
						target='_blank'
						rel='noreferrer'
						className='btn btn-ghost h-8 px-3 text-[12px]'>
						Открыть в Allegro →
					</a>
				</div>
			</div>
		</section>
	);
}
