import { useRef, useState } from 'react';

interface Props {
	urls: string[];
	onChange: (next: string[]) => void;
	dirty?: boolean;
	onReset?: () => void;
	/** When provided, shows an "Upload file" button that picks a local file and resolves to an Allegro CDN URL. */
	onUploadFile?: (file: File) => Promise<string>;
	/** When provided, shows an "Upload by URL" button that re-hosts an arbitrary URL to Allegro CDN. */
	onUploadByUrl?: (url: string) => Promise<string>;
}

export function ImagesEditor({ urls, onChange, dirty, onReset, onUploadFile, onUploadByUrl }: Props) {
	const fileRef = useRef<HTMLInputElement | null>(null);
	const [uploading, setUploading] = useState<'idle' | 'file' | 'url'>('idle');
	const [error, setError] = useState<string | null>(null);
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

	const pickFile = () => fileRef.current?.click();

	const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file || !onUploadFile) return;
		setError(null);
		setUploading('file');
		try {
			const cdnUrl = await onUploadFile(file);
			if (cdnUrl) onChange([...urls, cdnUrl]);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setUploading('idle');
			// reset so the same file can be re-selected
			if (fileRef.current) fileRef.current.value = '';
		}
	};

	const rehostByUrl = async () => {
		if (!onUploadByUrl) return;
		const url = window.prompt('URL картинки для перезаливки в Allegro CDN:')?.trim();
		if (!url) return;
		setError(null);
		setUploading('url');
		try {
			const cdnUrl = await onUploadByUrl(url);
			if (cdnUrl) onChange([...urls, cdnUrl]);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setUploading('idle');
		}
	};

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
					{dirty && onReset && (
						<button
							type='button'
							onClick={onReset}
							className='btn btn-ghost h-7 px-2 text-[12px]'
							title='Вернуть исходные'>
							сбросить
						</button>
					)}
					{onUploadByUrl && (
						<button
							type='button'
							onClick={rehostByUrl}
							disabled={uploading !== 'idle'}
							className='btn btn-ghost h-7 px-2 text-[12px]'
							title='Перезалить URL в Allegro CDN'>
							{uploading === 'url' ? '· · ·' : '+ URL'}
						</button>
					)}
					{onUploadFile && (
						<>
							<button
								type='button'
								onClick={pickFile}
								disabled={uploading !== 'idle'}
								className='btn btn-ghost h-7 px-2 text-[12px]'
								title='Загрузить файл с диска'>
								{uploading === 'file' ? '· · ·' : '+ файл'}
							</button>
							<input
								ref={fileRef}
								type='file'
								accept='image/jpeg,image/png,image/webp'
								className='hidden'
								onChange={handleFile}
							/>
						</>
					)}
					<button
						type='button'
						onClick={add}
						className='btn btn-ghost h-7 px-2 text-[12px]'>
						+ пусто
					</button>
				</div>
			</header>
			{error && (
				<div className='px-4 pt-2'>
					<div className='text-[12px] text-bad border border-bad/30 bg-badTint rounded-md px-2 py-1.5'>
						{error}
					</div>
				</div>
			)}
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
