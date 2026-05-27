import { useEffect, useRef, useState } from 'react';

interface PhotoPickerProps {
	photoUrls: string[];
	/** Called with the 1-based photo index when a thumbnail is picked. */
	onPick: (n: number) => void;
	/** Button label. Defaults to "+ Фото". */
	label?: string;
	/** Override the button's className when a non-default style is needed. */
	buttonClassName?: string;
	/** Tooltip on the toggle button. */
	title?: string;
}

/**
 * Picker button + thumbnail-grid dropdown. Disabled when there are no photos.
 * Closes on outside-click. Designed to be dropped next to other inline actions.
 */
export function PhotoPicker({
	photoUrls,
	onPick,
	label = '+ Фото',
	buttonClassName,
	title = 'Вставить фото',
}: PhotoPickerProps) {
	const [open, setOpen] = useState(false);
	const wrapperRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onDocMouseDown = (e: MouseEvent) => {
			if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	}, [open]);

	return (
		<div className='relative' ref={wrapperRef}>
			<button
				type='button'
				onMouseDown={e => e.preventDefault()}
				onClick={() => setOpen(o => !o)}
				disabled={photoUrls.length === 0}
				title={title}
				className={
					buttonClassName ?? 'btn btn-ghost h-7 px-2 text-[12px] disabled:opacity-40'
				}>
				{label}
			</button>
			{open && photoUrls.length > 0 && (
				<div className='absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-border bg-card shadow-lg p-1'>
					<div className='grid grid-cols-3 gap-1'>
						{photoUrls.map((url, i) => (
							<button
								key={i}
								type='button'
								onMouseDown={e => e.preventDefault()}
								onClick={() => {
									onPick(i + 1);
									setOpen(false);
								}}
								title={`Фото ${i + 1}`}
								className='relative aspect-square overflow-hidden rounded border border-border bg-soft hover:border-flame-ring focus:border-flame-ring outline-none'>
								<img
									src={url}
									alt=''
									loading='lazy'
									className='absolute inset-0 h-full w-full object-cover'
									onError={e => {
										(e.target as HTMLImageElement).style.opacity = '0.2';
									}}
								/>
								<span className='absolute bottom-0.5 left-0.5 rounded bg-card/80 px-1 text-[10px] font-medium text-ink'>
									{i + 1}
								</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
