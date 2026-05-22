import { useEffect, useRef, useState } from 'react';
import type {
	DescriptionItem,
	DescriptionSections,
	DescriptionTemplate,
} from '../api';
import { chipHtml, chipsHtmlToTokens, tokensToChipsHtml } from './shortcodes';

interface Props {
	value: DescriptionSections;
	onChange: (next: DescriptionSections) => void;
	dirty: boolean;
	onReset: () => void;
	/** key -> resolved value for offer-parameter variables. Optional —
	 *  consumers without variables (e.g. NewProductPanel) may omit it. */
	varMap?: Map<string, string>;
	/** Saved description templates. Optional — consumers without templates
	 *  (e.g. NewProductPanel) omit these and the «Шаблоны» menu is hidden. */
	templates?: DescriptionTemplate[];
	onSaveTemplate?: (name: string) => void;
	onApplyTemplate?: (id: string, mode: 'replace' | 'append') => void;
	onRenameTemplate?: (id: string, name: string) => void;
	onDeleteTemplate?: (id: string) => void;
}

/** Stable empty var map — default for consumers that have no variables. */
const EMPTY_VAR_MAP: Map<string, string> = new Map();

const RENDERED_HTML_CLASS =
	'text-ink leading-snug text-[13px] [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:my-2 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_b]:font-semibold [&_strong]:font-semibold [&_p]:my-1 [&_li]:my-0.5';

export function DescriptionEditor({
	value,
	onChange,
	dirty,
	onReset,
	varMap = EMPTY_VAR_MAP,
	templates,
	onSaveTemplate,
	onApplyTemplate,
	onRenameTemplate,
	onDeleteTemplate,
}: Props) {
	const sections = value.sections;

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
				<div className='flex items-center gap-2'>
					{onSaveTemplate &&
						onApplyTemplate &&
						onRenameTemplate &&
						onDeleteTemplate && (
							<TemplateMenu
								templates={templates ?? []}
								sectionsCount={sections.length}
								onSave={onSaveTemplate}
								onApply={onApplyTemplate}
								onRename={onRenameTemplate}
								onDelete={onDeleteTemplate}
							/>
						)}
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
								return (
								<div
									key={iIdx}
									className='grid grid-cols-[1fr_auto] gap-2 items-start'>
									{it.type === 'TEXT' ? (
										<RichTextarea
											value={it.content}
											onChange={v => updateItem(sIdx, iIdx, { content: v })}
											varMap={varMap}
										/>
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

/**
 * WYSIWYG-редактор: contentEditable + тулбар на execCommand.
 * `value` хранится в токен-форме (`{{ключ}}`); внутри DOM токены рисуются
 * как неделимые чип-спаны со значением переменной. При emit чипы
 * сериализуются обратно в токены, наружу компонент всегда отдаёт токен-форму.
 */
function RichTextarea({
	value,
	onChange,
	varMap,
}: {
	value: string;
	onChange: (next: string) => void;
	varMap: Map<string, string>;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const lastEmittedRef = useRef<string>(value);
	const [varMenuOpen, setVarMenuOpen] = useState(false);
	const pickerRef = useRef<HTMLDivElement | null>(null);

	// Initial mount: configure execCommand, then render the initial
	// token-form value as chips. Deps are intentionally empty — this
	// captures the mount-time value/varMap on purpose.
	useEffect(() => {
		try {
			document.execCommand('styleWithCSS', false, 'false');
			document.execCommand('defaultParagraphSeparator', false, 'p');
		} catch {
			/* legacy API; ignored if unsupported */
		}
		if (ref.current) {
			ref.current.innerHTML = tokensToChipsHtml(value, varMap);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Close the variable picker when clicking outside it.
	useEffect(() => {
		if (!varMenuOpen) return;
		const onDocMouseDown = (e: MouseEvent) => {
			if (!pickerRef.current?.contains(e.target as Node)) {
				setVarMenuOpen(false);
			}
		};
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	}, [varMenuOpen]);

	// External value change (reset / template apply): render tokens as chips.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (value !== lastEmittedRef.current) {
			el.innerHTML = tokensToChipsHtml(value, varMap);
			lastEmittedRef.current = value;
		}
	}, [value, varMap]);

	// varMap changed (e.g. an override edited): refresh chip labels in place
	// without rewriting innerHTML, so the caret is not disturbed.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		for (const chip of Array.from(el.querySelectorAll('[data-var-key]'))) {
			const key = chip.getAttribute('data-var-key') ?? '';
			const tmp = document.createElement('div');
			tmp.innerHTML = chipHtml(key, varMap);
			const fresh = tmp.firstElementChild;
			if (fresh) {
				chip.className = fresh.className;
				chip.textContent = fresh.textContent;
			}
		}
	}, [varMap]);

	const emit = () => {
		const el = ref.current;
		if (!el) return;
		const tokenHtml = chipsHtmlToTokens(el.innerHTML);
		lastEmittedRef.current = tokenHtml;
		onChange(tokenHtml);
	};

	// On blur, additionally convert any manually typed {{...}} into chips.
	const emitAndRenderChips = () => {
		const el = ref.current;
		if (!el) return;
		const tokenHtml = chipsHtmlToTokens(el.innerHTML);
		lastEmittedRef.current = tokenHtml;
		el.innerHTML = tokensToChipsHtml(tokenHtml, varMap);
		onChange(tokenHtml);
	};

	const exec = (cmd: string, arg?: string) => {
		ref.current?.focus();
		try {
			document.execCommand(cmd, false, arg);
		} catch {
			/* unsupported in some browsers; ignored */
		}
		emit();
	};

	const insertVariable = (key: string) => {
		const el = ref.current;
		if (!el) return;
		el.focus();
		try {
			document.execCommand('insertHTML', false, chipHtml(key, varMap) + '&nbsp;');
		} catch {
			/* ignored */
		}
		setVarMenuOpen(false);
		emit();
	};

	const Btn = ({
		label,
		title,
		onClick,
	}: {
		label: React.ReactNode;
		title: string;
		onClick: () => void;
	}) => (
		<button
			type='button'
			onMouseDown={e => e.preventDefault()}
			onClick={onClick}
			title={title}
			className='h-7 px-2 text-[11px] font-medium border-r border-border last:border-r-0 bg-card text-ink-muted hover:text-ink hover:bg-soft transition'>
			{label}
		</button>
	);

	const varKeys = Array.from(varMap.keys());

	return (
		<div className='space-y-1.5'>
			<div className='flex items-start gap-1.5'>
				<div className='flex border border-border rounded-md overflow-hidden w-fit'>
					<Btn
						label={<span className='font-bold'>B</span>}
						title='Полужирный (Ctrl+B)'
						onClick={() => exec('bold')}
					/>
					<Btn
						label='H1'
						title='Заголовок 1'
						onClick={() => exec('formatBlock', 'h1')}
					/>
					<Btn
						label='H2'
						title='Заголовок 2'
						onClick={() => exec('formatBlock', 'h2')}
					/>
					<Btn
						label='¶'
						title='Параграф'
						onClick={() => exec('formatBlock', 'p')}
					/>
					<Btn
						label='UL'
						title='Маркированный список'
						onClick={() => exec('insertUnorderedList')}
					/>
					<Btn
						label='OL'
						title='Нумерованный список'
						onClick={() => exec('insertOrderedList')}
					/>
					<Btn
						label='⨯'
						title='Снять форматирование'
						onClick={() => exec('removeFormat')}
					/>
				</div>

				<div className='relative' ref={pickerRef}>
					<button
						type='button'
						onMouseDown={e => e.preventDefault()}
						onClick={() => setVarMenuOpen(o => !o)}
						disabled={varKeys.length === 0}
						title='Вставить переменную'
						className='btn btn-ghost h-7 px-2 text-[11px] border border-border disabled:opacity-40'>
						+ Переменная
					</button>
					{varMenuOpen && varKeys.length > 0 && (
						<div className='absolute z-20 mt-1 max-h-64 w-64 overflow-auto rounded-md border border-border bg-card shadow-lg'>
							{varKeys.map(key => (
								<button
									key={key}
									type='button'
									onMouseDown={e => e.preventDefault()}
									onClick={() => insertVariable(key)}
									className='flex w-full items-center justify-between gap-2 px-2 h-8 text-left text-[12px] hover:bg-soft'>
									<span className='font-medium text-ink truncate'>{key}</span>
									<span className='text-ink-faint truncate'>
										{varMap.get(key) || '—'}
									</span>
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			<div
				ref={ref}
				contentEditable
				suppressContentEditableWarning
				onInput={emit}
				onBlur={emitAndRenderChips}
				onPaste={e => {
					// Paste as plain text to avoid copying disallowed inline styles / scripts.
					e.preventDefault();
					const text = e.clipboardData.getData('text/plain');
					document.execCommand('insertText', false, text);
				}}
				className={`border border-border rounded-md p-3 bg-card min-h-[160px] focus:outline-none focus:ring-1 focus:ring-flame/40 ${RENDERED_HTML_CLASS}`}
				data-placeholder='Текст описания. Выдели часть и кликни кнопку для форматирования.'
			/>
		</div>
	);
}

/**
 * «Шаблоны» — выпадающее меню в шапке описания: сохранить текущее описание
 * как именованный шаблон, применить шаблон (заменить или добавить секции),
 * переименовать и удалить.
 */
function TemplateMenu({
	templates,
	sectionsCount,
	onSave,
	onApply,
	onRename,
	onDelete,
}: {
	templates: DescriptionTemplate[];
	sectionsCount: number;
	onSave: (name: string) => void;
	onApply: (id: string, mode: 'replace' | 'append') => void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement | null>(null);

	// Close the dropdown when clicking outside it.
	useEffect(() => {
		if (!open) return;
		const onDocMouseDown = (e: MouseEvent) => {
			if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	}, [open]);

	const handleSave = () => {
		const name = window.prompt('Название шаблона')?.trim();
		if (name) onSave(name);
		setOpen(false);
	};

	const handleApply = (id: string) => {
		// Non-standard confirm mapping (intentional): OK = replace the whole
		// description, Cancel = append the template's sections. The dialog
		// text spells this out for the operator.
		const replace =
			sectionsCount === 0 ||
			window.confirm(
				'OK — заменить текущее описание шаблоном.\n' +
					'Отмена — добавить секции шаблона в конец.',
			);
		onApply(id, replace ? 'replace' : 'append');
		setOpen(false);
	};

	const handleRename = (t: DescriptionTemplate) => {
		const name = window.prompt('Новое название', t.name)?.trim();
		if (name && name !== t.name) onRename(t.id, name);
		setOpen(false);
	};

	const handleDelete = (t: DescriptionTemplate) => {
		if (window.confirm(`Удалить шаблон «${t.name}»?`)) onDelete(t.id);
		setOpen(false);
	};

	return (
		<div className='relative' ref={menuRef}>
			<button
				type='button'
				onClick={() => setOpen(o => !o)}
				className='btn btn-ghost h-7 px-2 text-[12px]'>
				Шаблоны
			</button>
			{open && (
				<div className='absolute right-0 z-20 mt-1 w-72 rounded-md border border-border bg-card shadow-lg'>
					<button
						type='button'
						onClick={handleSave}
						className='block w-full px-3 h-9 text-left text-[12px] font-medium hover:bg-soft border-b border-border-muted'>
						+ Сохранить как шаблон
					</button>
					{templates.length === 0 ? (
						<p className='px-3 py-3 text-[12px] text-ink-faint'>
							Сохранённых шаблонов нет.
						</p>
					) : (
						<div className='max-h-64 overflow-auto py-1'>
							{templates.map(t => (
								<div
									key={t.id}
									className='flex items-center gap-1 px-2 h-9 hover:bg-soft'>
									<button
										type='button'
										onClick={() => handleApply(t.id)}
										title='Применить шаблон'
										className='flex-1 text-left text-[12px] text-ink truncate'>
										{t.name}
									</button>
									<button
										type='button'
										onClick={() => handleRename(t)}
										title='Переименовать'
										className='btn btn-ghost h-7 w-7 px-0 text-ink-faint'>
										✎
									</button>
									<button
										type='button'
										onClick={() => handleDelete(t)}
										title='Удалить'
										className='btn btn-ghost h-7 w-7 px-0 text-ink-faint hover:text-bad'>
										✕
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
