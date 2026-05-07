import { useState } from 'react';
import type { DescriptionItem, DescriptionSections } from '../api';

interface Props {
	value: DescriptionSections;
	onChange: (next: DescriptionSections) => void;
	dirty: boolean;
	onReset: () => void;
}

const RENDERED_HTML_CLASS =
	'text-ink leading-snug text-[13px] [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:my-2 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_b]:font-semibold [&_strong]:font-semibold [&_p]:my-1 [&_li]:my-0.5';

export function DescriptionEditor({
	value,
	onChange,
	dirty,
	onReset,
}: Props) {
	const sections = value.sections;
	const [preview, setPreview] = useState<Set<string>>(new Set());

	const togglePreview = (key: string) =>
		setPreview(prev => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	const setSections = (next: Array<{ items: DescriptionItem[] }>) =>
		onChange({ sections: next });

	const updateItem = (
		sIdx: number,
		iIdx: number,
		patch: Partial<DescriptionItem>,
	) => {
		const next = sections.map((s, i) => {
			if (i !== sIdx) return s;
			return {
				items: s.items.map((it, j) =>
					j === iIdx ? ({ ...it, ...patch } as DescriptionItem) : it,
				),
			};
		});
		setSections(next);
	};

	const removeItem = (sIdx: number, iIdx: number) => {
		const next = sections
			.map((s, i) =>
				i === sIdx ? { items: s.items.filter((_, j) => j !== iIdx) } : s,
			)
			.filter(s => s.items.length > 0);
		setSections(next);
	};

	const addItem = (sIdx: number, kind: 'TEXT' | 'IMAGE') => {
		const item: DescriptionItem =
			kind === 'TEXT'
				? { type: 'TEXT', content: '' }
				: { type: 'IMAGE', url: '' };
		const next = sections.map((s, i) =>
			i === sIdx ? { items: [...s.items, item] } : s,
		);
		setSections(next);
	};

	const addSection = (kind: 'TEXT' | 'IMAGE') => {
		const item: DescriptionItem =
			kind === 'TEXT'
				? { type: 'TEXT', content: '' }
				: { type: 'IMAGE', url: '' };
		setSections([...sections, { items: [item] }]);
	};

	const removeSection = (sIdx: number) =>
		setSections(sections.filter((_, i) => i !== sIdx));

	const moveSection = (sIdx: number, dir: -1 | 1) => {
		const j = sIdx + dir;
		if (j < 0 || j >= sections.length) return;
		const next = sections.slice();
		[next[sIdx], next[j]] = [next[j], next[sIdx]];
		setSections(next);
	};

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label flex items-center gap-2'>
					Описание
					<span className='text-[11px] font-medium text-ink-muted normal-case tracking-normal'>
						· {sections.length} секц.
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
						onClick={() => addSection('TEXT')}
						className='btn btn-ghost h-7 px-2 text-[12px]'>
						+ текст
					</button>
					<button
						type='button'
						onClick={() => addSection('IMAGE')}
						className='btn btn-ghost h-7 px-2 text-[12px]'>
						+ картинка
					</button>
				</div>
			</header>

			<div className='p-4 space-y-3'>
				{sections.length === 0 ? (
					<p className='text-[13px] text-ink-muted'>Описание пусто.</p>
				) : (
					sections.map((s, sIdx) => (
						<div
							key={sIdx}
							className='border border-border-muted rounded-md p-3 space-y-2 bg-soft/30'>
							<div className='flex items-center justify-between'>
								<span className='label'>Секция {sIdx + 1}</span>
								<div className='flex'>
									<button
										type='button'
										onClick={() => moveSection(sIdx, -1)}
										disabled={sIdx === 0}
										className='btn btn-ghost h-7 w-7 px-0 text-ink-faint disabled:opacity-30'
										title='вверх'>
										↑
									</button>
									<button
										type='button'
										onClick={() => moveSection(sIdx, 1)}
										disabled={sIdx === sections.length - 1}
										className='btn btn-ghost h-7 w-7 px-0 text-ink-faint disabled:opacity-30'
										title='вниз'>
										↓
									</button>
									<button
										type='button'
										onClick={() => removeSection(sIdx)}
										className='btn btn-ghost h-7 w-7 px-0 text-ink-faint hover:text-bad'
										title='удалить секцию'>
										✕
									</button>
								</div>
							</div>

							{s.items.map((it, iIdx) => {
								const itemKey = `${sIdx}-${iIdx}`;
								const isPreview = preview.has(itemKey);
								return (
								<div
									key={iIdx}
									className='grid grid-cols-[1fr_auto] gap-2 items-start'>
									{it.type === 'TEXT' ? (
										<div className='space-y-1'>
											<div className='flex border border-border rounded-md overflow-hidden w-fit'>
												{(['code', 'preview'] as const).map((mode, k) => {
													const active =
														(mode === 'preview') === isPreview;
													return (
														<button
															key={mode}
															type='button'
															onClick={() => {
																if (active) return;
																togglePreview(itemKey);
															}}
															className={`px-2 h-6 text-[11px] font-medium transition ${
																active
																	? 'bg-soft text-ink'
																	: 'bg-card text-ink-muted hover:text-ink'
															} ${k === 0 ? 'border-r border-border' : ''}`}>
															{mode === 'code' ? 'код' : 'превью'}
														</button>
													);
												})}
											</div>
											{isPreview ? (
												<div
													className={`border border-border-muted rounded-md p-3 bg-card min-h-[120px] ${RENDERED_HTML_CLASS}`}
													dangerouslySetInnerHTML={{ __html: it.content }}
												/>
											) : (
												<textarea
													className='input font-mono text-[12px] min-h-[120px]'
													placeholder='HTML контент…'
													value={it.content}
													onChange={e =>
														updateItem(sIdx, iIdx, { content: e.target.value })
													}
												/>
											)}
										</div>
									) : (
										<div className='grid grid-cols-[56px_1fr] gap-2'>
											<div className='aspect-square w-14 h-14 border border-border rounded-md overflow-hidden bg-soft flex items-center justify-center'>
												{it.url ? (
													<img
														src={it.url}
														alt=''
														loading='lazy'
														className='w-full h-full object-contain'
														onError={e => {
															(e.target as HTMLImageElement).style.opacity =
																'0.2';
														}}
													/>
												) : (
													<span className='text-ink-faint text-[10px]'>—</span>
												)}
											</div>
											<input
												className='input font-mono text-[12px]'
												placeholder='https://…'
												value={it.url}
												onChange={e =>
													updateItem(sIdx, iIdx, { url: e.target.value })
												}
											/>
										</div>
									)}
									<button
										type='button'
										onClick={() => removeItem(sIdx, iIdx)}
										className='btn btn-ghost h-10 w-10 px-0 text-ink-faint hover:text-bad'
										title='убрать элемент'>
										✕
									</button>
								</div>
								);
							})}

							<div className='flex gap-1 pt-1'>
								<button
									type='button'
									onClick={() => addItem(sIdx, 'TEXT')}
									className='btn btn-ghost h-7 px-2 text-[12px]'>
									+ текст
								</button>
								<button
									type='button'
									onClick={() => addItem(sIdx, 'IMAGE')}
									className='btn btn-ghost h-7 px-2 text-[12px]'>
									+ картинка
								</button>
							</div>
						</div>
					))
				)}
			</div>
		</section>
	);
}
