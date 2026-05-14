import { useEffect, useMemo, useRef, useState } from 'react';
import {
	api,
	type AccountSummary,
	type CategoryParameter,
	type DescriptionSections,
	type MatchingCategory,
	type OfferParameter,
	type ProductParameterValue,
	type ProductSearchHit,
	type ProposedProduct,
} from '../api';
import { Combobox } from './Combobox';
import { DescriptionEditor } from './DescriptionEditor';
import { ImagesEditor } from './ImagesEditor';
import { PublishAccountPicker } from './PublishAccountPicker';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CatalogProduct = ProductSearchHit & { description?: DescriptionSections };

const DEFAULT_CATEGORY_ID = '491'; // Laptopy → Komputery → Elektronika

// Имена категорийных параметров Allegro про сертификаты/безопасность/батарею —
// выносим в отдельную видимую секцию, а не прячем в «Необязательные».
const CERT_PARAM_RE = /certyfikat|zgodno|bateri|bezpiecze/i;

// Allegro's standardized description accepts only a strict HTML subset.
// Anything outside this set triggers 422 VALIDATION_ERROR "Nieprawidłowy podzbiór HTML".
// Confirmed allowed: p, h1, h2, ul, ol, li, strong.
// Notes: <b> is rewritten to <strong>, <br> to a paragraph split, <h3>+ are dropped,
// raw text at the top level is wrapped in <p> (Allegro rejects bare text between blocks).
const ALLEGRO_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'ul', 'ol']);
const ALLEGRO_INLINE_TAGS = new Set(['strong']);
const ALLEGRO_LIST_CHILD_TAG = 'li';

function sanitizeAllegroHtml(html: string): string {
	if (!html.trim()) return '';
	const doc = new DOMParser().parseFromString(
		`<!doctype html><html><body>${html}</body></html>`,
		'text/html',
	);
	const out: Node[] = [];
	let inlineBuffer: Node[] = [];

	const flushInline = () => {
		const hasContent = inlineBuffer.some(
			n =>
				(n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim()) ||
				n.nodeType === Node.ELEMENT_NODE,
		);
		if (hasContent) {
			const p = doc.createElement('p');
			for (const n of inlineBuffer) p.appendChild(n);
			out.push(p);
		}
		inlineBuffer = [];
	};

	const rebuild = (el: Element): Node[] => {
		const tag = el.tagName.toLowerCase();
		// <br> turns into paragraph break — render as empty inline marker; outer logic flushes <p>.
		if (tag === 'br') return [doc.createTextNode('\n\n')];
		// <b> → <strong>
		const finalTag = tag === 'b' ? 'strong' : tag;
		const isAllowed =
			ALLEGRO_BLOCK_TAGS.has(finalTag) ||
			ALLEGRO_INLINE_TAGS.has(finalTag) ||
			finalTag === ALLEGRO_LIST_CHILD_TAG;
		// Recurse into children first
		const childNodes: Node[] = [];
		for (const child of Array.from(el.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				childNodes.push(doc.createTextNode(child.textContent ?? ''));
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				childNodes.push(...rebuild(child as Element));
			}
		}
		if (!isAllowed) {
			// unwrap: bubble children up
			return childNodes;
		}
		const fresh = doc.createElement(finalTag);
		for (const c of childNodes) fresh.appendChild(c);
		return [fresh];
	};

	for (const child of Array.from(doc.body.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const t = child.textContent ?? '';
			if (t.includes('\n\n')) {
				// paragraph split coming from <br><br>
				const parts = t.split(/\n\n+/);
				for (let i = 0; i < parts.length; i++) {
					if (parts[i]) inlineBuffer.push(doc.createTextNode(parts[i]));
					if (i < parts.length - 1) flushInline();
				}
			} else if (t.trim()) {
				inlineBuffer.push(doc.createTextNode(t));
			}
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			const built = rebuild(child as Element);
			for (const n of built) {
				if (n.nodeType === Node.TEXT_NODE) {
					inlineBuffer.push(n);
				} else if (
					n.nodeType === Node.ELEMENT_NODE &&
					ALLEGRO_BLOCK_TAGS.has((n as Element).tagName.toLowerCase())
				) {
					flushInline();
					out.push(n);
				} else {
					inlineBuffer.push(n);
				}
			}
		}
	}
	flushInline();

	const container = doc.createElement('div');
	for (const n of out) container.appendChild(n);
	// Drop empty <p></p>
	return container.innerHTML.replace(/<p>\s*<\/p>/g, '').trim();
}

type CreateState =
	| { kind: 'idle' }
	| { kind: 'working' }
	| { kind: 'ok'; product: ProposedProduct }
	| { kind: 'exists'; location?: string }
	| { kind: 'err'; message: string; body?: unknown };

interface NewProductPanelProps {
	env: 'sandbox' | 'production';
	accounts: AccountSummary[];
	publishAccountId: string;
	onPublishAccountChange: (id: string) => void;
}

export function NewProductPanel({
	env,
	accounts,
	publishAccountId,
	onPublishAccountChange,
}: NewProductPanelProps) {
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

	const [state, setState] = useState<CreateState>({ kind: 'idle' });

	// Catalog prefill: when operator picks an existing product, we stash it here
	// and apply parameter values once the category's parameters finish loading
	// (params re-fetch is triggered by setCategoryId). Cleared after applying.
	const [pendingPrefill, setPendingPrefill] = useState<CatalogProduct | null>(null);

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

	// Apply stashed catalog product's parameters to the form once the category's
	// parameter list has loaded. Match by paramId; pick valuesIds[0] for dictionary
	// params, otherwise the first text value. Clears the stash after applying.
	useEffect(() => {
		if (!pendingPrefill) return;
		if (paramsLoading) return;
		if (params.length === 0) return;
		if (pendingPrefill.category?.id && pendingPrefill.category.id !== categoryId)
			return;
		const next: Record<string, ProductParameterValue> = {};
		const paramById = new Map(params.map(p => [p.id, p]));
		for (const src of pendingPrefill.parameters ?? []) {
			const meta = paramById.get(src.id);
			if (!meta) continue;
			const isDict =
				meta.type === 'dictionary' && (meta.dictionary?.length ?? 0) > 0;
			if (isDict && src.valuesIds && src.valuesIds[0]) {
				next[meta.id] = { id: meta.id, valuesIds: [src.valuesIds[0]] };
				continue;
			}
			const text =
				src.values?.[0] ?? src.valuesLabels?.[0] ?? undefined;
			if (text && text.trim()) {
				if (isDict) {
					const hit = meta.dictionary?.find(
						d => d.value.toLowerCase() === text.toLowerCase(),
					);
					if (hit?.id) {
						next[meta.id] = { id: meta.id, valuesIds: [hit.id] };
						continue;
					}
				}
				next[meta.id] = { id: meta.id, values: [text] };
			}
		}
		setValues(next);
		setPendingPrefill(null);
	}, [pendingPrefill, params, paramsLoading, categoryId]);

	const pickFromCatalog = async (hit: ProductSearchHit) => {
		// Fetch the full card to get description + complete parameter list.
		let full: CatalogProduct;
		try {
			full = await api.getProduct(hit.id);
		} catch {
			full = hit;
		}
		const imgs = (full.images ?? []).map(it =>
			typeof it === 'string' ? it : it.url,
		);
		setName(full.name ?? '');
		setImages(imgs);
		setDescription(full.description ?? { sections: [] });
		if (full.category?.id) {
			setCategoryId(full.category.id);
		}
		setPendingPrefill(full);
	};

	const required = useMemo(() => params.filter(p => p.required), [params]);
	const certificates = useMemo(
		() => params.filter(p => !p.required && CERT_PARAM_RE.test(p.name)),
		[params],
	);
	const optional = useMemo(
		() => params.filter(p => !p.required && !CERT_PARAM_RE.test(p.name)),
		[params],
	);

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

	const buildPayload = async () => {
		const parameters: ProductParameterValue[] = Object.values(values).filter(
			v =>
				(v.values && v.values.some(s => s.trim().length > 0)) ||
				(v.valuesIds && v.valuesIds.length > 0),
		);

		// Allegro rejects description IMAGE items whose URLs aren't freshly uploaded
		// for THIS proposal (ConstraintViolationException.DescriptionImageNotAttached).
		// We re-upload each image URL through /api/images/upload-url to get a fresh,
		// attachable upload URL.
		const sections: DescriptionSections['sections'] = [];
		for (const s of description.sections) {
			const items: typeof s.items = [];
			for (const it of s.items) {
				if (it.type === 'TEXT') {
					const cleaned = sanitizeAllegroHtml(it.content);
					if (cleaned.trim()) items.push({ type: 'TEXT', content: cleaned });
				} else {
					const trimmed = it.url.trim();
					if (!trimmed) continue;
					try {
						const r = await api.uploadImageByUrl(trimmed);
						items.push({ type: 'IMAGE', url: r.location });
					} catch (err) {
						throw new Error(
							`Не удалось перезалить картинку описания (${trimmed}): ${
								(err as Error).message
							}`,
						);
					}
				}
			}
			if (items.length > 0) sections.push({ items });
		}
		const cleanedDescription = sections.length > 0 ? { sections } : undefined;

		return {
			name: name.trim(),
			category: { id: categoryId.trim() },
			language,
			images: images.map(u => u.trim()).filter(Boolean),
			parameters,
			...(cleanedDescription ? { description: cleanedDescription } : {}),
			...(publishAccountId ? { accountId: publishAccountId } : {}),
		};
	};

	const runCreate = async () => {
		if (
			!window.confirm(
				`Создать товар «${name.trim() || '?'}» в каталоге Allegro?`,
			)
		)
			return;
		setState({ kind: 'working' });
		try {
			const payload = await buildPayload();
			const product = await api.proposeProduct(payload);
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
			<CatalogPrefillPanel
				categoryIdHint={categoryId}
				onPick={pickFromCatalog}
				busy={!!pendingPrefill}
			/>

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
					{certificates.length > 0 && (
						<div className='space-y-2 border-t border-border-muted pt-3'>
							<div className='text-[11px] text-flame uppercase tracking-wide font-semibold'>
								Сертификаты и безопасность
							</div>
							{certificates.map(p => (
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
								Прочие необязательные ({optional.length})
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

			<div className='sticky bottom-4 space-y-2'>
				<PublishAccountPicker
					accounts={accounts}
					value={publishAccountId}
					onChange={onPublishAccountChange}
				/>
				<button
					type='button'
					className='btn btn-primary w-full'
					disabled={!canSubmit || !publishAccountId}
					onClick={runCreate}>
					{state.kind === 'working' ? 'создаю · · ·' : 'Создать товар'}
				</button>
			</div>

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
	const status = product.publication?.status ?? 'создан';
	const sellerPanelUrl = 'https://allegro.pl/moje-allegro-sprzedaz/asortyment';
	return (
		<section className='panel border-ok/30'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-ok/30 bg-okTint'>
				<span className='label text-ok'>Товар {status}</span>
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
				<div className='pt-2 border-t border-border-muted'>
					<a
						href={sellerPanelUrl}
						target='_blank'
						rel='noreferrer'
						className='btn btn-ghost h-8 px-3 text-[12px]'>
						Мой ассортимент →
					</a>
				</div>
			</div>
		</section>
	);
}

function CatalogPrefillPanel({
	categoryIdHint,
	onPick,
	busy,
}: {
	categoryIdHint: string;
	onPick: (hit: ProductSearchHit) => void | Promise<void>;
	busy: boolean;
}) {
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<ProductSearchHit[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
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
					const product = await api.getProduct(q);
					if (seqRef.current === seq) setResults([product]);
				} else {
					const r = await api.searchProducts({
						phrase: q,
						categoryId: categoryIdHint.trim() || undefined,
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
	}, [query, categoryIdHint]);

	const handlePick = async (hit: ProductSearchHit) => {
		await onPick(hit);
		setQuery('');
		setResults([]);
	};

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>00 · Подтянуть из каталога</span>
				{loading && <span className='text-[11px] text-ink-faint'>· · ·</span>}
			</header>
			<div className='p-4 space-y-3'>
				<input
					className='input'
					value={query}
					onChange={e => setQuery(e.target.value)}
					placeholder='название или productId'
					disabled={busy}
				/>
				{error && (
					<div className='text-[13px] text-bad border border-bad/30 bg-badTint rounded-md px-3 py-2'>
						{error}
					</div>
				)}
				{results.length > 0 && (
					<div className='border border-border-muted rounded-md max-h-72 overflow-y-auto divide-y divide-border-muted'>
						{results.map(p => {
							const imgs = p.images ?? [];
							const first = imgs[0];
							const imgUrl = first
								? typeof first === 'string'
									? first
									: first.url
								: null;
							return (
								<button
									key={p.id}
									type='button'
									onClick={() => handlePick(p)}
									disabled={busy}
									className='w-full text-left p-2.5 flex items-start gap-3 hover:bg-soft transition disabled:opacity-50'>
									<div className='aspect-square w-12 h-12 border border-border rounded-md overflow-hidden bg-soft flex items-center justify-center shrink-0'>
										{imgUrl ? (
											<img
												src={imgUrl}
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
														(par: OfferParameter) =>
															`${par.name}: ${par.valuesLabels?.[0] ?? par.values?.[0] ?? '—'}`,
													)
													.join(' · ')}
											</div>
										)}
									</div>
								</button>
							);
						})}
					</div>
				)}
			</div>
		</section>
	);
}
