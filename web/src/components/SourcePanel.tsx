import type { AccountSummary, OfferParameter, OfferPreview } from '../api';

interface Props {
	offerId: string;
	onOfferIdChange: (v: string) => void;
	preview: OfferPreview | null;
	loading: boolean;
	error: string | null;
	onLoad: () => void;
	accounts: AccountSummary[];
	sourceAccountId: string;
	onSourceAccountChange: (id: string) => void;
}

function imageUrl(item: { url: string } | string): string {
	return typeof item === 'string' ? item : item.url;
}

// Allegro returns dictionary params with the human label in `valuesLabels` and
// `values: null`; numeric/string params put the raw number in `values` plus a `unit`.
// Prefer the label when present; otherwise compose `value [unit]`.
export function paramDisplayValue(p: OfferParameter): string {
	const labels = (p.valuesLabels ?? []).filter(Boolean);
	if (labels.length) return labels.join(', ');
	const vals = (p.values ?? []).filter(Boolean);
	if (!vals.length) return '—';
	const joined = vals.join(', ');
	return p.unit ? `${joined} ${p.unit}` : joined;
}

export function SourcePanel({
	offerId,
	onOfferIdChange,
	preview,
	loading,
	error,
	onLoad,
	accounts,
	sourceAccountId,
	onSourceAccountChange,
}: Props) {
	const params = preview?.parameters ?? [];
	const offerImages = preview?.images ?? [];
	const productImages = preview?.product?.images ?? [];
	const galleryImages = offerImages.length ? offerImages : productImages;
	const descriptionSections = preview?.description?.sections ?? [];

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>Оферта</span>
				{accounts.length > 1 && (
					<label className='flex items-center gap-2 text-[12px]'>
						<span className='text-ink-faint'>читать через</span>
						<select
							className='bg-transparent text-ink outline-none cursor-pointer border border-border rounded px-2 py-1'
							value={sourceAccountId}
							onChange={e => onSourceAccountChange(e.target.value)}>
							{accounts.map(a => (
								<option
									key={a.id}
									value={a.id}
									disabled={!a.hasCredentials || !a.connected}>
									{a.label}
									{!a.hasCredentials
										? ' — нет creds'
										: !a.connected
											? ' — не подключён'
											: ''}
								</option>
							))}
						</select>
					</label>
				)}
			</header>
			<div className='p-4 grid grid-cols-[1fr_auto] gap-2'>
				<input
					className='input'
					placeholder='ID оферты'
					value={offerId}
					onChange={e => onOfferIdChange(e.target.value.trim())}
					onKeyDown={e => {
						if (e.key === 'Enter') onLoad();
					}}
				/>
				<button
					type='button'
					className='btn'
					disabled={!offerId || loading}
					onClick={onLoad}>
					{loading ? '· · ·' : 'Загрузить'}
				</button>
			</div>

			{error && (
				<div className='px-4 pb-4'>
					<div className='text-[13px] text-bad border border-bad/30 bg-badTint rounded-md px-3 py-2'>
						{error}
					</div>
				</div>
			)}

			{preview && (
				<div className='border-t border-border px-4 py-4 space-y-3'>
					<div className='flex items-baseline gap-3'>
						<h3 className='text-ink text-[15px] font-semibold flex-1 min-w-0 break-words leading-snug'>
							{preview.name}
						</h3>
						{preview.publication?.status === 'ACTIVE' ? (
							<span className='chip border-ok/30 bg-okTint text-ok'>
								активна
							</span>
						) : (
							<span className='chip'>{preview.publication?.status ?? '—'}</span>
						)}
					</div>

					<div className='flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-muted'>
						<span>
							цена{' '}
							<span className='text-ink font-medium'>
								{preview.sellingMode?.price
									? `${preview.sellingMode.price.amount} ${preview.sellingMode.price.currency}`
									: '—'}
							</span>
						</span>
						<span>
							остаток{' '}
							<span className='text-ink font-medium'>
								{preview.stock?.available ?? '—'}
							</span>
						</span>
						<span className='text-ink-faint'>·</span>
						<span className='font-mono text-[12px]'>
							{preview.product?.id ? `${preview.product.id.slice(0, 8)}…` : '—'}
						</span>
					</div>

					{galleryImages.length > 0 && (
						<div className='border-t border-border-muted pt-3'>
							<div className='label mb-2'>
								Картинки оферты ({galleryImages.length})
							</div>
							<div className='grid grid-cols-4 sm:grid-cols-6 gap-2'>
								{galleryImages.map((img, i) => {
									const url = imageUrl(img);
									return (
										<a
											key={`${url}-${i}`}
											href={url}
											target='_blank'
											rel='noreferrer'
											className='block aspect-square border border-border rounded-md overflow-hidden bg-soft hover:border-flame transition'
											title={url}>
											<img
												src={url}
												alt={`img-${i}`}
												loading='lazy'
												className='w-full h-full object-contain'
											/>
										</a>
									);
								})}
							</div>
						</div>
					)}

					{params.length > 0 && (
						<div className='border-t border-border-muted pt-3'>
							<div className='label mb-2'>Параметры ({params.length})</div>
							<div className='grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0 text-[13px]'>
								{params.map(p => (
									<div
										key={p.id}
										className='flex justify-between gap-4 border-b border-border-muted py-1.5 last:border-b-0'>
										<span className='text-ink-muted truncate'>
											{p.name ?? p.id}
										</span>
										<span className='text-ink text-right'>
											{paramDisplayValue(p)}
										</span>
									</div>
								))}
							</div>
						</div>
					)}

					{descriptionSections.length > 0 && (
						<div className='border-t border-border-muted pt-3'>
							<div className='label mb-2'>
								Описание ({descriptionSections.length} секц.)
							</div>
							<div className='space-y-2 max-h-72 overflow-y-auto pr-1 text-[13px]'>
								{descriptionSections.map((s, i) => (
									<div
										key={i}
										className='border border-border-muted rounded-md p-2 bg-soft/40'>
										{s.items.map((it, j) =>
											it.type === 'TEXT' ? (
												<div
													key={j}
													className='text-ink leading-snug [&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_b]:font-semibold [&_p]:my-1'
													dangerouslySetInnerHTML={{ __html: it.content }}
												/>
											) : (
												<a
													key={j}
													href={it.url}
													target='_blank'
													rel='noreferrer'
													className='block mt-1 text-flame text-[12px] truncate'>
													IMG: {it.url}
												</a>
											),
										)}
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
