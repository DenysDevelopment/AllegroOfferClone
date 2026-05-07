import type { OfferPreview } from '../api';

interface Props {
	offerId: string;
	onOfferIdChange: (v: string) => void;
	preview: OfferPreview | null;
	loading: boolean;
	error: string | null;
	onLoad: () => void;
}

export function SourcePanel({
	offerId,
	onOfferIdChange,
	preview,
	loading,
	error,
	onLoad,
}: Props) {
	const params = preview?.parameters ?? [];

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center border-b border-border'>
				<span className='label'>Оферта</span>
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
											{p.values?.join(', ') ?? '—'}
										</span>
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
