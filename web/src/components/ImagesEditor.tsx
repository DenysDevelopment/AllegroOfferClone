interface Props {
	urls: string[];
	onChange: (next: string[]) => void;
	dirty: boolean;
	onReset: () => void;
}

export function ImagesEditor({ urls, onChange, dirty, onReset }: Props) {
	const update = (i: number, value: string) => {
		const next = urls.slice();
		next[i] = value;
		onChange(next);
	};

	const remove = (i: number) => onChange(urls.filter((_, j) => j !== i));

	const move = (i: number, dir: -1 | 1) => {
		const j = i + dir;
		if (j < 0 || j >= urls.length) return;
		const next = urls.slice();
		[next[i], next[j]] = [next[j], next[i]];
		onChange(next);
	};

	const add = () => onChange([...urls, '']);

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label flex items-center gap-2'>
					Картинки
					<span className='text-[11px] font-medium text-ink-muted normal-case tracking-normal'>
						· {urls.length}
					</span>
					{dirty && (
						<span className='text-[11px] font-medium text-flame normal-case tracking-normal'>
							· изменено
						</span>
					)}
				</span>
				<div className='flex items-center gap-1'>
					{dirty && (
						<button
							type='button'
							onClick={onReset}
							className='btn btn-ghost h-7 px-2 text-[12px]'
							title='Вернуть исходные'>
							сбросить
						</button>
					)}
					<button
						type='button'
						onClick={add}
						className='btn btn-ghost h-7 px-2 text-[12px]'>
						+ добавить
					</button>
				</div>
			</header>
			<div className='p-4 space-y-2'>
				{urls.length === 0 ? (
					<p className='text-[13px] text-ink-muted'>Пусто. Добавь URL.</p>
				) : (
					urls.map((url, i) => (
						<div
							key={i}
							className='grid grid-cols-[56px_1fr_auto] gap-2 items-start'>
							<div className='aspect-square w-14 h-14 border border-border rounded-md overflow-hidden bg-soft flex items-center justify-center'>
								{url ? (
									<img
										src={url}
										alt={`img-${i}`}
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
							<input
								className='input font-mono text-[12px]'
								placeholder='https://…'
								value={url}
								onChange={e => update(i, e.target.value)}
							/>
							<div className='flex'>
								<button
									type='button'
									onClick={() => move(i, -1)}
									disabled={i === 0}
									className='btn btn-ghost h-10 w-8 px-0 text-ink-faint disabled:opacity-30'
									title='вверх'>
									↑
								</button>
								<button
									type='button'
									onClick={() => move(i, 1)}
									disabled={i === urls.length - 1}
									className='btn btn-ghost h-10 w-8 px-0 text-ink-faint disabled:opacity-30'
									title='вниз'>
									↓
								</button>
								<button
									type='button'
									onClick={() => remove(i)}
									className='btn btn-ghost h-10 w-10 px-0 text-ink-faint hover:text-bad'
									title='убрать'>
									✕
								</button>
							</div>
						</div>
					))
				)}
			</div>
		</section>
	);
}
