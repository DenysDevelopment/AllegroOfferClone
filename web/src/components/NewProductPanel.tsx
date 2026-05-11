import { useEffect, useMemo, useRef, useState } from 'react';
import {
	api,
	type CategoryParameter,
	type DescriptionSections,
	type MatchingCategory,
	type ProductParameterValue,
	type ProposedProduct,
} from '../api';
import { Combobox } from './Combobox';
import { DescriptionEditor } from './DescriptionEditor';
import { ImagesEditor } from './ImagesEditor';

const DEFAULT_CATEGORY_ID = '491'; // Laptopy → Komputery → Elektronika

// Allegro's standardized description accepts only a strict HTML subset.
// Anything outside this set triggers 422 VALIDATION_ERROR "Nieprawidłowy podzbiór HTML".
const ALLEGRO_ALLOWED_TAGS = new Set([
	'p',
	'h1',
	'h2',
	'h3',
	'ul',
	'ol',
	'li',
	'strong',
	'b',
]);

function sanitizeAllegroHtml(html: string): string {
	let s = html;
	// drop <script>/<style>/<iframe> with their content
	s = s.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
	// drop HTML comments
	s = s.replace(/<!--[\s\S]*?-->/g, '');
	// rewrite every remaining tag: strip attributes; drop tag entirely if not whitelisted
	s = s.replace(/<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_m, slash, tag) => {
		const t = (tag as string).toLowerCase();
		if (!ALLEGRO_ALLOWED_TAGS.has(t)) return '';
		return `<${slash}${t}>`;
	});
	return s.trim();
}

type CreateState =
	| { kind: 'idle' }
	| { kind: 'working' }
	| { kind: 'ok'; product: ProposedProduct }
	| { kind: 'exists'; location?: string }
	| { kind: 'err'; message: string; body?: unknown };

export function NewProductPanel({ env }: { env: 'sandbox' | 'production' }) {
	const [categoryId, setCategoryId] = useState(DEFAULT_CATEGORY_ID);
	const [categoryQuery, setCategoryQuery] = useState('');
	const [matches, setMatches] = useState<MatchingCategory[]>([]);
	const [searching, setSearching] = useState(false);

	const [params, setParams] = useState<CategoryParameter[]>([]);
	const [paramsLoading, setParamsLoading] = useState(false);
	const [paramsError, setParamsError] = useState<string | null>(null);

	// Map paramId → { values?, valuesIds? } — what user picked/typed
	const [values, setValues] = useState<Record<string, ProductParameterValue>>(
		{},
	);

	const [name, setName] = useState('');
	const [language] = useState('pl-PL');
	const [images, setImages] = useState<string[]>([]);
	const [description, setDescription] = useState<DescriptionSections>({
		sections: [],
	});

	const [preview, setPreview] = useState<unknown>(null);
	const [state, setState] = useState<CreateState>({ kind: 'idle' });

	// --- categories search (debounced) ---
	const searchSeqRef = useRef(0);
	useEffect(() => {
		const q = categoryQuery.trim();
		if (q.length < 2) {
			setMatches([]);
			return;
		}
		const seq = ++searchSeqRef.current;
		setSearching(true);
		const t = setTimeout(() => {
			api
				.matchCategories(q)
				.then(r => {
					if (searchSeqRef.current === seq)
						setMatches(r.matchingCategories ?? []);
				})
				.catch(() => {
					if (searchSeqRef.current === seq) setMatches([]);
				})
				.finally(() => {
					if (searchSeqRef.current === seq) setSearching(false);
				});
		}, 300);
		return () => clearTimeout(t);
	}, [categoryQuery]);

	// --- load category parameters whenever categoryId changes ---
	const paramsSeqRef = useRef(0);
	useEffect(() => {
		if (!categoryId.trim()) {
			setParams([]);
			return;
		}
		const seq = ++paramsSeqRef.current;
		setParamsLoading(true);
		setParamsError(null);
		api
			.categoryParameters(categoryId.trim())
			.then(r => {
				if (paramsSeqRef.current !== seq) return;
				setParams(r.parameters ?? []);
			})
			.catch(e => {
				if (paramsSeqRef.current !== seq) return;
				setParamsError((e as Error).message);
				setParams([]);
			})
			.finally(() => {
				if (paramsSeqRef.current === seq) setParamsLoading(false);
			});
	}, [categoryId]);

	const required = useMemo(() => params.filter(p => p.required), [params]);
	const optional = useMemo(() => params.filter(p => !p.required), [params]);

	const setParamValue = (
		p: CategoryParameter,
		raw: { text?: string; dictId?: string },
	) => {
		setValues(prev => {
			const next = { ...prev };
			if (!raw.text && !raw.dictId) {
				delete next[p.id];
				return next;
			}
			if (raw.dictId) {
				next[p.id] = { id: p.id, valuesIds: [raw.dictId] };
			} else if (raw.text !== undefined) {
				next[p.id] = { id: p.id, values: [raw.text] };
			}
			return next;
		});
	};

	const buildPayload = () => {
		const parameters: ProductParameterValue[] = Object.values(values).filter(
			v =>
				(v.values && v.values.some(s => s.trim().length > 0)) ||
				(v.valuesIds && v.valuesIds.length > 0),
		);
		const cleanedDescription = (() => {
			const cleaned = description.sections
				.map(s => ({
					items: s.items
						.map(it =>
							it.type === 'TEXT'
								? { type: 'TEXT' as const, content: sanitizeAllegroHtml(it.content) }
								: it,
						)
						.filter(it =>
							it.type === 'TEXT' ? it.content.trim() : it.url.trim(),
						),
				}))
				.filter(s => s.items.length > 0);
			return cleaned.length ? { sections: cleaned } : undefined;
		})();
		return {
			name: name.trim(),
			category: { id: categoryId.trim() },
			language,
			images: images.map(u => u.trim()).filter(Boolean),
			parameters,
			...(cleanedDescription ? { description: cleanedDescription } : {}),
		};
	};

	const runDryRun = async () => {
		setPreview(null);
		setState({ kind: 'idle' });
		try {
			const r = await api.proposeProductPreview(buildPayload());
			setPreview(r.body);
		} catch (e) {
			setState({
				kind: 'err',
				message: (e as Error).message,
				body: (e as { data?: unknown })?.data,
			});
		}
	};

	const runCreate = async () => {
		if (
			!window.confirm(
				`Создать товар «${name.trim() || '?'}» в каталоге Allegro?`,
			)
		)
			return;
		setState({ kind: 'working' });
		setPreview(null);
		try {
			const product = await api.proposeProduct(buildPayload());
			setState({ kind: 'ok', product });
		} catch (e) {
			const err = e as {
				status?: number;
				data?: { existingLocation?: string; message?: string };
			};
			if (err.status === 409) {
				setState({ kind: 'exists', location: err.data?.existingLocation });
			} else {
				setState({
					kind: 'err',
					message: err.data?.message ?? (e as Error).message,
					body: err.data,
				});
			}
		}
	};

	const onUploadFile = async (file: File): Promise<string> => {
		const r = await api.uploadImageBinary(file);
		return r.location;
	};

	const onUploadByUrl = async (url: string): Promise<string> => {
		const r = await api.uploadImageByUrl(url);
		return r.location;
	};

	const canSubmit =
		!!name.trim() &&
		!!categoryId.trim() &&
		images.filter(u => u.trim()).length > 0 &&
		Object.keys(values).length > 0 &&
		state.kind !== 'working';

	return (
		<div className='space-y-4'>
			<section className='panel'>
				<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
					<span className='label'>01 · Категория</span>
					<span className='text-[11px] text-ink-faint'>
						{env === 'sandbox' ? 'sandbox' : 'production'}
					</span>
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
								поиск по имени
								{searching && (
									<span className='text-ink-faint normal-case font-normal'>
										{' '}
										· · ·
									</span>
								)}
							</span>
							<input
								className='input'
								value={categoryQuery}
								onChange={e => setCategoryQuery(e.target.value)}
								placeholder='например, laptopy'
							/>
						</label>
					</div>
					{matches.length > 0 && (
						<div className='border border-border-muted rounded-md max-h-48 overflow-y-auto'>
							{matches.map(m => (
								<button
									key={m.id}
									type='button'
									onClick={() => {
										setCategoryId(m.id);
										setMatches([]);
										setCategoryQuery('');
									}}
									className='w-full text-left px-3 py-2 text-[13px] flex items-center justify-between gap-3 hover:bg-soft border-b border-border-muted last:border-b-0'>
									<span className='truncate'>{m.name}</span>
									<span className='text-ink-faint font-mono text-[11px] shrink-0'>
										{m.id}
										{m.leaf === false && ' · не leaf'}
									</span>
								</button>
							))}
						</div>
					)}
				</div>
			</section>

			<section className='panel'>
				<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
					<span className='label'>
						02 · Параметры
						<span className='text-[11px] font-medium text-ink-muted normal-case tracking-normal ml-2'>
							· обяз. {required.length} / всего {params.length}
						</span>
					</span>
				</header>
				<div className='p-4 space-y-3'>
					{paramsLoading && (
						<p className='text-[13px] text-ink-muted'>загрузка параметров…</p>
					)}
					{paramsError && <p className='text-[13px] text-bad'>{paramsError}</p>}
					{!paramsLoading && !paramsError && params.length === 0 && (
						<p className='text-[13px] text-ink-muted'>Введи Category ID.</p>
					)}
					{required.length > 0 && (
						<div className='space-y-2'>
							<div className='text-[11px] text-flame uppercase tracking-wide font-semibold'>
								Обязательные
							</div>
							{required.map(p => (
								<ParamRow
									key={p.id}
									param={p}
									value={values[p.id]}
									onChange={raw => setParamValue(p, raw)}
								/>
							))}
						</div>
					)}
					{optional.length > 0 && (
						<details className='border-t border-border-muted pt-3'>
							<summary className='text-[12px] text-ink-muted cursor-pointer hover:text-ink'>
								Необязательные ({optional.length})
							</summary>
							<div className='space-y-2 pt-2'>
								{optional.map(p => (
									<ParamRow
										key={p.id}
										param={p}
										value={values[p.id]}
										onChange={raw => setParamValue(p, raw)}
									/>
								))}
							</div>
						</details>
					)}
				</div>
			</section>

			<section className='panel'>
				<header className='px-4 h-11 flex items-center border-b border-border'>
					<span className='label'>03 · Название</span>
				</header>
				<div className='p-4'>
					<input
						className='input'
						value={name}
						onChange={e => setName(e.target.value)}
						placeholder='Например, "Lenovo IdeaPad 5 16GB 512GB SSD"'
						maxLength={75}
					/>
					<div className='text-[11px] text-ink-faint mt-1.5'>
						{name.trim().length}/75 символов
					</div>
				</div>
			</section>

			<ImagesEditor
				urls={images}
				onChange={setImages}
				onUploadFile={onUploadFile}
				onUploadByUrl={onUploadByUrl}
			/>

			<DescriptionEditor
				value={description}
				onChange={setDescription}
				dirty={false}
				onReset={() => setDescription({ sections: [] })}
			/>
			<div className='text-[11px] text-ink-faint -mt-2 px-1'>
				Allegro принимает только: <code>&lt;p&gt;</code>{' '}
				<code>&lt;h1&gt;</code> <code>&lt;h2&gt;</code> <code>&lt;h3&gt;</code>{' '}
				<code>&lt;ul&gt;</code> <code>&lt;ol&gt;</code> <code>&lt;li&gt;</code>{' '}
				<code>&lt;strong&gt;</code> <code>&lt;b&gt;</code>. Атрибуты не
				разрешены, всё остальное автоматически вырежется при отправке.
			</div>

			<div className='flex gap-2 sticky bottom-4'>
				<button
					type='button'
					className='btn flex-1'
					disabled={!canSubmit}
					onClick={runDryRun}>
					Dry run
				</button>
				<button
					type='button'
					className='btn btn-primary flex-1'
					disabled={!canSubmit}
					onClick={runCreate}>
					{state.kind === 'working' ? 'создаю · · ·' : 'Создать товар'}
				</button>
			</div>

			{preview != null && state.kind === 'idle' && (
				<section className='panel'>
					<header className='px-4 h-11 flex items-center border-b border-border'>
						<span className='label'>Превью тела запроса</span>
					</header>
					<pre className='p-4 text-[11px] leading-snug font-mono overflow-x-auto max-h-96 text-ink-muted'>
						{JSON.stringify(preview, null, 2)}
					</pre>
				</section>
			)}

			{state.kind === 'ok' && <CreatedResult product={state.product} />}
			{state.kind === 'exists' && (
				<section className='panel border-warn/30'>
					<div className='p-4 text-[13px] text-warn space-y-2'>
						<div className='font-semibold'>Товар уже есть в каталоге</div>
						{state.location && (
							<a
								className='text-flame underline break-all'
								href={state.location}
								target='_blank'
								rel='noreferrer'>
								{state.location}
							</a>
						)}
					</div>
				</section>
			)}
			{state.kind === 'err' && (
				<section className='panel border-bad/30'>
					<div className='p-4 text-[13px] space-y-2'>
						<div className='text-bad font-semibold'>{state.message}</div>
						{state.body != null && (
							<pre className='text-[11px] leading-snug font-mono overflow-x-auto max-h-72 text-ink-muted'>
								{JSON.stringify(state.body, null, 2)}
							</pre>
						)}
					</div>
				</section>
			)}
		</div>
	);
}

function ParamRow({
	param,
	value,
	onChange,
}: {
	param: CategoryParameter;
	value: ProductParameterValue | undefined;
	onChange: (raw: { text?: string; dictId?: string }) => void;
}) {
	const isDict =
		param.type === 'dictionary' && (param.dictionary?.length ?? 0) > 0;
	const dictMap = useMemo(() => {
		const m = new Map<string, string>(); // value text → id
		for (const d of param.dictionary ?? []) {
			if (d.id) m.set(d.value, d.id);
		}
		return m;
	}, [param.dictionary]);

	const currentText =
		value?.values?.[0] ??
		(() => {
			const id = value?.valuesIds?.[0];
			if (!id) return '';
			const found = param.dictionary?.find(d => d.id === id);
			return found?.value ?? '';
		})();

	return (
		<div className='grid grid-cols-1 sm:grid-cols-[1fr_1.4fr] gap-2 items-start'>
			<div className='pt-2 text-[13px] flex items-baseline gap-2 flex-wrap'>
				<span className={param.required ? 'text-ink' : 'text-ink-muted'}>
					{param.name}
				</span>
				{param.unit && (
					<span className='text-[11px] text-ink-faint'>[{param.unit}]</span>
				)}
				<span className='text-[11px] text-ink-faint font-mono'>
					{param.type}
				</span>
			</div>
			{isDict ? (
				<Combobox
					value={currentText}
					onChange={v => {
						const id = dictMap.get(v);
						if (id) onChange({ dictId: id });
						else onChange({ text: v });
					}}
					options={(param.dictionary ?? []).map(d => d.value)}
					placeholder='Выбери из словаря'
				/>
			) : (
				<input
					className='input'
					value={currentText}
					onChange={e => onChange({ text: e.target.value })}
					placeholder={
						param.type === 'integer' || param.type === 'float'
							? 'число'
							: 'текст'
					}
					inputMode={
						param.type === 'integer' || param.type === 'float'
							? 'decimal'
							: 'text'
					}
				/>
			)}
		</div>
	);
}

function CreatedResult({ product }: { product: ProposedProduct }) {
	const copy = () => {
		navigator.clipboard?.writeText(product.id).catch(() => {});
	};
	return (
		<section className='panel border-ok/30'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-ok/30 bg-okTint'>
				<span className='label text-ok'>
					Товар {product.publication?.status ?? 'создан'}
				</span>
			</header>
			<div className='p-4 space-y-2 text-[13px]'>
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
				<div className='text-[12px] text-ink-faint pt-2 border-t border-border-muted'>
					Дальше: открой Allegro UI и нажми «Wystaw» на этом товаре, чтобы
					создать оферту.
				</div>
			</div>
		</section>
	);
}
