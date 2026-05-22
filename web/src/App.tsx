import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	api,
	setActiveAccountIdGetter,
	type AccountSummary,
	type CloneResult,
	type CloneStep,
	type DescriptionSections,
	type DescriptionTemplate,
	type OfferPreview,
} from './api';
import { AccountSwitcher } from './components/AccountSwitcher';
import { ConnectGate } from './components/ConnectGate';
import { DescriptionEditor } from './components/DescriptionEditor';
import { buildVarMap, flattenVars } from './components/shortcodes';
import {
	FindProductPanel,
	type SelectedTargetProduct,
} from './components/FindProductPanel';
import { ImagesEditor } from './components/ImagesEditor';
import { NewProductPanel } from './components/NewProductPanel';
import {
	OverridesEditor,
	type ParamOverride,
} from './components/OverridesEditor';
import { PublishAccountPicker } from './components/PublishAccountPicker';
import { SourcePanel } from './components/SourcePanel';
import { StepsLog } from './components/StepsLog';
import { ThemeToggle } from './components/ThemeToggle';

const ACTIVE_ACCOUNT_KEY = 'allegro.activeAccountId';

type Mode = 'clone' | 'create';

const MODE_LABELS: Record<Mode, { tab: string; title: string }> = {
	clone: { tab: 'Клон', title: 'Клонирование оферт' },
	create: { tab: 'Создать товар', title: 'Создание товара' },
};

export default function App() {
	const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
	const [defaultAccountId, setDefaultAccountId] = useState<string>('');
	const [activeAccountId, setActiveAccountIdState] = useState<string | null>(() => {
		try {
			return localStorage.getItem(ACTIVE_ACCOUNT_KEY);
		} catch {
			return null;
		}
	});
	const [publishAccountId, setPublishAccountId] = useState<string>('');
	const [sourceAccountId, setSourceAccountId] = useState<string>('');
	const [statusError, setStatusError] = useState<string | null>(null);
	const [mode, setMode] = useState<Mode>('clone');

	// Wire the API layer's X-Account-Id header to our active id (live, no re-import).
	const activeRef = useRef(activeAccountId);
	activeRef.current = activeAccountId;
	useEffect(() => {
		setActiveAccountIdGetter(() => activeRef.current);
	}, []);

	const setActiveAccountId = useCallback((id: string) => {
		setActiveAccountIdState(id);
		try {
			localStorage.setItem(ACTIVE_ACCOUNT_KEY, id);
		} catch {
			/* ignore */
		}
	}, []);

	const [offerId, setOfferId] = useState('');
	const [preview, setPreview] = useState<OfferPreview | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewError, setPreviewError] = useState<string | null>(null);

	const [overrides, setOverrides] = useState<ParamOverride[]>([]);
	const [nameOverride, setNameOverride] = useState('');
	const [priceOverride, setPriceOverride] = useState('');
	const [stockOverride, setStockOverride] = useState('');
	const [nameUserEdited, setNameUserEdited] = useState(false);
	const [priceUserEdited, setPriceUserEdited] = useState(false);
	const [stockUserEdited, setStockUserEdited] = useState(false);
	const [publicationStatus, setPublicationStatus] = useState<
		'ACTIVE' | 'INACTIVE'
	>('INACTIVE');
	const [imageUrls, setImageUrls] = useState<string[]>([]);
	const [imagesUserEdited, setImagesUserEdited] = useState(false);
	const [description, setDescription] = useState<DescriptionSections>({
		sections: [],
	});
	const [descriptionUserEdited, setDescriptionUserEdited] = useState(false);
	const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);

	const [steps, setSteps] = useState<CloneStep[]>([]);
	const [working, setWorking] = useState<'idle' | 'clone'>('idle');
	const [outcome, setOutcome] = useState<CloneResult['outcome']>(undefined);
	const [errorBox, setErrorBox] = useState<CloneResult['error'] | null>(null);
	const [bannerNote, setBannerNote] = useState<string | null>(null);
	const [targetProduct, setTargetProduct] = useState<SelectedTargetProduct | null>(
		null,
	);

	const refreshAccounts = useCallback(async () => {
		try {
			const data = await api.accounts();
			setAccounts(data.accounts);
			setDefaultAccountId(data.defaultAccountId);
			setStatusError(null);
			return data;
		} catch (e) {
			setStatusError((e as Error).message);
			return null;
		}
	}, []);

	useEffect(() => {
		(async () => {
			const data = await refreshAccounts();
			if (!data) return;
			// If the stored active id is unknown or its account got removed,
			// fall back to the first connected one, then the default.
			const known = new Set(data.accounts.map(a => a.id));
			const stored = activeRef.current;
			let chosen: string | null = stored && known.has(stored) ? stored : null;
			if (!chosen) {
				const firstConnected = data.accounts.find(a => a.connected);
				chosen = firstConnected?.id ?? data.defaultAccountId;
			}
			if (chosen) setActiveAccountId(chosen);
		})();

		const params = new URLSearchParams(window.location.search);
		if (params.get('connected') === '1') {
			const acc = params.get('account');
			setBannerNote(acc ? `Аккаунт "${acc}" подключён.` : 'Подключено к Allegro.');
			if (acc) setActiveAccountId(acc);
			window.history.replaceState({}, '', window.location.pathname);
		} else if (params.get('error')) {
			setBannerNote(
				`Ошибка авторизации: ${params.get('error')} ${params.get('message') ?? ''}`,
			);
			window.history.replaceState({}, '', window.location.pathname);
		}
	}, [refreshAccounts, setActiveAccountId]);

	// Keep publish & source targets in sync with the active account by default.
	useEffect(() => {
		if (activeAccountId && !publishAccountId) setPublishAccountId(activeAccountId);
		if (activeAccountId && !sourceAccountId) setSourceAccountId(activeAccountId);
	}, [activeAccountId, publishAccountId, sourceAccountId]);
	useEffect(() => {
		// When user switches active account in the header, move both pickers there.
		// User can still pick different source/target afterwards.
		if (activeAccountId) {
			setPublishAccountId(activeAccountId);
			setSourceAccountId(activeAccountId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeAccountId]);

	const activeAccount = useMemo(
		() => accounts?.find(a => a.id === activeAccountId) ?? null,
		[accounts, activeAccountId],
	);

	const cleanedOverrides = useMemo(() => {
		const map: Record<string, string> = {};
		for (const o of overrides) {
			const k = o.name.trim();
			const v = o.value.trim();
			if (k && v) map[k] = v;
		}
		return map;
	}, [overrides]);

	// key -> resolved value for description variables. Overrides win over
	// source values; @title / @price mirror the offer-level overrides.
	const varMap = useMemo(
		() =>
			buildVarMap({
				parameters: preview?.parameters ?? [],
				overrides: cleanedOverrides,
				title: nameOverride,
				price: priceOverride,
			}),
		[preview, cleanedOverrides, nameOverride, priceOverride],
	);

	// Live-computed title with parameter overrides applied (mirrors server logic).
	const autoName = useMemo(() => {
		if (!preview?.name) return '';
		let out = preview.name;
		for (const o of overrides) {
			const meta = preview.parameters?.find(
				p => (p.name ?? '').toLowerCase() === o.name.trim().toLowerCase(),
			);
			// Allegro stores dict-param values in `valuesLabels` and free-form ones in `values`.
			const old = meta?.valuesLabels?.[0] || meta?.values?.[0];
			if (!old || !o.value.trim()) continue;
			out = substituteValueVariants(out, old, o.value.trim());
		}
		return out;
	}, [preview, overrides]);

	// When a new offer is loaded, reset "user edited" flags.
	useEffect(() => {
		setNameUserEdited(false);
		setPriceUserEdited(false);
		setStockUserEdited(false);
		setImagesUserEdited(false);
		setDescriptionUserEdited(false);
	}, [preview?.id]);

	// Auto-fill images and description from the source on offer load (one-time per offer).
	// Skipped when a catalog target product is bound — product data should come from the
	// catalog card, not be carried over from the source offer.
	useEffect(() => {
		if (!preview) return;
		if (targetProduct) return;
		if (!imagesUserEdited) {
			const offerImgs = preview.images ?? [];
			const productImgs = preview.product?.images ?? [];
			const src = offerImgs.length ? offerImgs : productImgs;
			setImageUrls(src.map(it => (typeof it === 'string' ? it : it.url)));
		}
		if (!descriptionUserEdited) {
			setDescription(
				preview.description ?? { sections: [] },
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [preview?.id]);

	// Description templates are global; load the list once on mount.
	useEffect(() => {
		api.descriptionTemplates
			.list()
			.then(r => setTemplates(r.templates))
			.catch(() => {
				/* non-fatal: templates panel just stays empty */
			});
	}, []);

	// Auto-fill name (live-updated as overrides change) unless user has typed.
	// Skipped when a catalog target product is bound — name comes from the catalog.
	useEffect(() => {
		if (targetProduct) return;
		if (!nameUserEdited) setNameOverride(autoName);
	}, [autoName, nameUserEdited, targetProduct]);

	// When a target product gets attached, wipe any product-derived state that was
	// auto-filled from source offer. Only commercial fields (price/stock) survive.
	useEffect(() => {
		if (!targetProduct) return;
		setImageUrls([]);
		setImagesUserEdited(false);
		setDescription({ sections: [] });
		setDescriptionUserEdited(false);
		setOverrides([]);
		setNameOverride('');
		setNameUserEdited(false);
	}, [targetProduct?.id]);

	// Auto-fill price/stock from source when offer loads (one-time per offer).
	useEffect(() => {
		if (!preview) return;
		if (!priceUserEdited) {
			setPriceOverride(preview.sellingMode?.price?.amount ?? '');
		}
		if (!stockUserEdited) {
			setStockOverride(
				preview.stock?.available != null ? String(preview.stock.available) : '',
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [preview?.id]);

	const loadPreview = async () => {
		if (!offerId) return;
		setPreviewLoading(true);
		setPreviewError(null);
		setPreview(null);
		try {
			const p = await api.offerPreview(offerId, sourceAccountId || undefined);
			setPreview(p);
		} catch (e) {
			setPreviewError((e as Error).message);
		} finally {
			setPreviewLoading(false);
		}
	};

	const cleanedImages = useMemo(
		() => imageUrls.map(u => u.trim()).filter(Boolean),
		[imageUrls],
	);

	// Strip empty TEXT items, drop emptied sections, then flatten {{variables}}
	// to plain text so Allegro receives no tokens.
	const cleanedDescription = useMemo<DescriptionSections | undefined>(() => {
		const cleaned = description.sections
			.map(s => ({
				items: s.items.filter(it =>
					it.type === 'TEXT' ? it.content.trim() : it.url.trim(),
				),
			}))
			.filter(s => s.items.length > 0);
		if (cleaned.length === 0) return undefined;
		return flattenVars({ sections: cleaned }, varMap).sections;
	}, [description, varMap]);

	const resetImages = () => {
		if (!preview) return;
		const offerImgs = preview.images ?? [];
		const productImgs = preview.product?.images ?? [];
		const src = offerImgs.length ? offerImgs : productImgs;
		setImageUrls(src.map(it => (typeof it === 'string' ? it : it.url)));
		setImagesUserEdited(false);
	};

	const resetDescription = () => {
		if (!preview) return;
		setDescription(preview.description ?? { sections: [] });
		setDescriptionUserEdited(false);
	};

	const refreshTemplates = () =>
		api.descriptionTemplates
			.list()
			.then(r => setTemplates(r.templates))
			.catch(() => {
				/* non-fatal */
			});

	const handleSaveTemplate = async (name: string) => {
		if (description.sections.length === 0) {
			alert('Описание пусто — нечего сохранять.');
			return;
		}
		try {
			await api.descriptionTemplates.create(name, description.sections);
			await refreshTemplates();
		} catch (e) {
			alert(`Не удалось сохранить шаблон: ${(e as Error).message}`);
		}
	};

	const handleApplyTemplate = (id: string, applyMode: 'replace' | 'append') => {
		const tpl = templates.find(t => t.id === id);
		if (!tpl) return;
		const nextSections =
			applyMode === 'replace'
				? tpl.sections
				: [...description.sections, ...tpl.sections];
		setDescription({ sections: nextSections });
		setDescriptionUserEdited(true);
		const { unresolved } = flattenVars({ sections: tpl.sections }, varMap);
		if (unresolved.length) {
			alert(
				'Шаблон применён. Не подставлены переменные (нет таких параметров ' +
					'у оффера):\n' +
					unresolved.map(k => `• ${k}`).join('\n'),
			);
		}
	};

	const handleRenameTemplate = async (id: string, name: string) => {
		try {
			await api.descriptionTemplates.update(id, { name });
			await refreshTemplates();
		} catch (e) {
			alert(`Не удалось переименовать: ${(e as Error).message}`);
		}
	};

	const handleDeleteTemplate = async (id: string) => {
		try {
			await api.descriptionTemplates.remove(id);
			await refreshTemplates();
		} catch (e) {
			alert(`Не удалось удалить: ${(e as Error).message}`);
		}
	};

	const buildPayload = (dryRun: boolean) => ({
		sourceOfferId: offerId,
		paramOverrides: cleanedOverrides,
		nameOverride: nameOverride.trim() || undefined,
		priceOverride: priceOverride.trim() || undefined,
		stockOverride: stockOverride ? Number(stockOverride) : undefined,
		publicationStatus,
		descriptionOverride: descriptionUserEdited ? cleanedDescription : undefined,
		imagesOverride: imagesUserEdited ? cleanedImages : undefined,
		targetProductId: targetProduct?.id,
		accountId: publishAccountId || undefined,
		sourceAccountId: sourceAccountId || undefined,
		dryRun,
	});

	const runClone = async () => {
		if (!offerId) return;
		const targetLabel =
			accounts?.find(a => a.id === publishAccountId)?.label ?? publishAccountId;
		if (!confirm(`Создать клон оферты ${offerId} в аккаунте "${targetLabel}"?`)) return;
		setWorking('clone');
		setSteps([]);
		setOutcome(undefined);
		setErrorBox(null);
		try {
			const r = await api.clone(buildPayload(false));
			setSteps(r.steps);
			setOutcome(r.outcome);
			setErrorBox(r.error ?? null);
		} catch (e) {
			setErrorBox({ message: (e as Error).message });
		} finally {
			setWorking('idle');
		}
	};

	if (!accounts) {
		return (
			<div className='min-h-screen flex items-center justify-center text-[13px] text-ink-muted'>
				{statusError ? (
					<span className='text-bad'>Сервер недоступен: {statusError}</span>
				) : (
					<span>· · · загрузка · · ·</span>
				)}
			</div>
		);
	}

	const anyConnected = accounts.some(a => a.connected);
	if (!anyConnected) {
		return (
			<Page>
				{bannerNote && (
					<Banner note={bannerNote} onDismiss={() => setBannerNote(null)} />
				)}
				<ConnectGate
					accounts={accounts}
					defaultAccountId={defaultAccountId}
					onConnected={refreshAccounts}
				/>
			</Page>
		);
	}

	const cloneDisabled = !offerId || working !== 'idle' || !publishAccountId;

	return (
		<Page>
			{bannerNote && (
				<Banner note={bannerNote} onDismiss={() => setBannerNote(null)} />
			)}

			<div className='max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10'>
				<div className='flex items-center justify-between mb-5'>
					<div className='flex items-center gap-3'>
						<h1 className='text-[20px] font-semibold text-ink leading-tight'>
							{MODE_LABELS[mode].title}
						</h1>
						<div className='flex h-8 border border-border rounded-md overflow-hidden text-[12px] font-medium'>
							{(['clone', 'create'] as const).map((m, i, arr) => (
								<button
									key={m}
									type='button'
									onClick={() => setMode(m)}
									className={`px-3 transition ${
										mode === m
											? 'bg-soft text-ink'
											: 'bg-card text-ink-muted hover:text-ink'
									} ${i < arr.length - 1 ? 'border-r border-border' : ''}`}>
									{MODE_LABELS[m].tab}
								</button>
							))}
						</div>
					</div>
					<div className='flex items-center gap-2'>
						{activeAccount && (
							<span
								className={
									activeAccount.env === 'production'
										? 'chip border-flame/30 bg-flame-tint text-flame'
										: 'chip border-warn/30 bg-warnTint text-warn'
								}>
								{activeAccount.env === 'production' ? 'prod' : 'sand'}
							</span>
						)}
						<AccountSwitcher
							accounts={accounts}
							activeId={activeAccountId}
							onSwitch={setActiveAccountId}
							onRefresh={refreshAccounts}
						/>
						<ThemeToggle />
					</div>
				</div>

				{mode === 'create' ? (
					<NewProductPanel
						env={activeAccount?.env ?? 'production'}
						accounts={accounts}
						publishAccountId={publishAccountId}
						onPublishAccountChange={setPublishAccountId}
					/>
				) : (
				<div className='grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-5'>
					<div className='space-y-4'>
						<CatalogLookup
							picked={targetProduct}
							onPick={setTargetProduct}
						/>

						<SourcePanel
							offerId={offerId}
							onOfferIdChange={setOfferId}
							preview={preview}
							loading={previewLoading}
							error={previewError}
							onLoad={loadPreview}
							accounts={accounts}
							sourceAccountId={sourceAccountId}
							onSourceAccountChange={setSourceAccountId}
						/>

						{!targetProduct && (
							<OverridesEditor
								preview={preview}
								overrides={overrides}
								onChange={setOverrides}
							/>
						)}

						{preview && !targetProduct && (
							<ImagesEditor
								urls={imageUrls}
								onChange={v => {
									setImageUrls(v);
									setImagesUserEdited(true);
								}}
								dirty={imagesUserEdited}
								onReset={resetImages}
							/>
						)}

						{preview && !targetProduct && (
							<DescriptionEditor
								value={description}
								onChange={v => {
									setDescription(v);
									setDescriptionUserEdited(true);
								}}
								dirty={descriptionUserEdited}
								onReset={resetDescription}
								varMap={varMap}
								templates={templates}
								onSaveTemplate={handleSaveTemplate}
								onApplyTemplate={handleApplyTemplate}
								onRenameTemplate={handleRenameTemplate}
								onDeleteTemplate={handleDeleteTemplate}
							/>
						)}

						<ExtrasPanel
							nameOverride={nameOverride}
							onName={v => {
								setNameOverride(v);
								setNameUserEdited(true);
							}}
							priceOverride={priceOverride}
							onPrice={v => {
								setPriceOverride(v);
								setPriceUserEdited(true);
							}}
							stockOverride={stockOverride}
							onStock={v => {
								setStockOverride(v);
								setStockUserEdited(true);
							}}
							publicationStatus={publicationStatus}
							onPub={setPublicationStatus}
						/>

						<div className='sticky bottom-4 space-y-2'>
							<BindingStatus
								targetProduct={targetProduct}
								sourceProductId={preview?.product?.id}
								sourceProductName={preview?.product?.name}
							/>
							<PublishAccountPicker
								accounts={accounts}
								value={publishAccountId}
								onChange={setPublishAccountId}
							/>
							<button
								type='button'
								className='btn btn-primary w-full'
								disabled={cloneDisabled}
								onClick={runClone}>
								{working === 'clone' ? 'клонирую · · ·' : 'Клонировать'}
							</button>
						</div>
					</div>

					<div className='xl:sticky xl:top-6 self-start'>
						<ResultPanel
							steps={steps}
							outcome={outcome}
							error={errorBox}
						/>
					</div>
				</div>
				)}
			</div>
		</Page>
	);
}

function Page({ children }: { children: React.ReactNode }) {
	return <div className='min-h-screen bg-app'>{children}</div>;
}

function CatalogLookup({
	picked,
	onPick,
}: {
	picked: SelectedTargetProduct | null;
	onPick: (p: SelectedTargetProduct | null) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<section className='panel'>
			<button
				type='button'
				onClick={() => setOpen(o => !o)}
				className='w-full px-4 h-11 flex items-center justify-between hover:bg-soft/40 transition border-b border-border'
				style={{ borderBottomWidth: open ? 1 : 0 }}>
				<span className='label flex items-center gap-2'>
					Найти товар в каталоге
					{picked && (
						<span className='chip border-ok/30 bg-okTint text-ok normal-case tracking-normal text-[11px] font-medium'>
							привязан
						</span>
					)}
				</span>
				<span className='text-[12px] text-ink-faint'>{open ? '▲' : '▼'}</span>
			</button>
			{picked && (
				<div className='px-4 py-2 flex items-center gap-2 text-[12px] border-b border-border-muted bg-okTint/30'>
					<span className='text-ink-muted'>→</span>
					<span className='text-ink truncate flex-1'>{picked.name}</span>
					<span className='font-mono text-ink-faint text-[11px] truncate max-w-[160px]'>
						{picked.id}
					</span>
					<button
						type='button'
						onClick={() => onPick(null)}
						className='btn btn-ghost h-6 px-2 text-[11px]'
						title='Снять привязку'>
						✕
					</button>
				</div>
			)}
			{open && (
				<div className='p-3'>
					<FindProductPanel onPick={onPick} pickedId={picked?.id ?? null} />
				</div>
			)}
		</section>
	);
}

/**
 * Right above the Clone button — surfaces exactly which product card the
 * clone will be bound to. Without this it's possible to inspect a catalog
 * product without ever clicking "Использовать в клоне →", and discover only
 * after publishing that the source's card was reused.
 */
function BindingStatus({
	targetProduct,
	sourceProductId,
	sourceProductName,
}: {
	targetProduct: SelectedTargetProduct | null;
	sourceProductId: string | undefined;
	sourceProductName: string | undefined;
}) {
	if (targetProduct) {
		return (
			<div className='flex items-center gap-2 px-3 py-2 rounded-md border border-ok/40 bg-okTint text-[12px]'>
				<span className='text-ok font-semibold'>✓ Привязка к каталогу</span>
				<span className='text-ink truncate flex-1'>{targetProduct.name}</span>
				<span className='font-mono text-ink-faint text-[11px] truncate max-w-[140px]'>
					{targetProduct.id}
				</span>
			</div>
		);
	}
	if (sourceProductId) {
		return (
			<div className='flex items-center gap-2 px-3 py-2 rounded-md border border-warn/40 bg-warnTint text-[12px]'>
				<span className='text-warn font-semibold'>↻ Карточка источника</span>
				<span className='text-ink truncate flex-1'>
					{sourceProductName ?? '—'}
				</span>
				<span className='font-mono text-ink-faint text-[11px] truncate max-w-[140px]'>
					{sourceProductId}
				</span>
			</div>
		);
	}
	return (
		<div className='px-3 py-2 rounded-md border border-border bg-soft/40 text-[12px] text-ink-muted'>
			Загрузите оферту — карточка определится из productSet источника.
		</div>
	);
}

function Banner({ note, onDismiss }: { note: string; onDismiss: () => void }) {
	const isErr = /ошибк|error|fail/i.test(note);
	return (
		<div className='max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 mt-4'>
			<div
				className={`flex items-center justify-between rounded-md border px-3 py-2 text-[13px] ${
					isErr
						? 'border-bad/30 bg-badTint text-bad'
						: 'border-ok/30 bg-okTint text-ok'
				}`}>
				<span>{note}</span>
				<button onClick={onDismiss} className='text-ink-muted hover:text-ink'>
					✕
				</button>
			</div>
		</div>
	);
}

function ExtrasPanel({
	nameOverride,
	onName,
	priceOverride,
	onPrice,
	stockOverride,
	onStock,
	publicationStatus,
	onPub,
}: {
	nameOverride: string;
	onName: (v: string) => void;
	priceOverride: string;
	onPrice: (v: string) => void;
	stockOverride: string;
	onStock: (v: string) => void;
	publicationStatus: 'ACTIVE' | 'INACTIVE';
	onPub: (v: 'ACTIVE' | 'INACTIVE') => void;
}) {
	return (
		<section className='panel'>
			<div className='p-4 grid grid-cols-1 md:grid-cols-2 gap-3'>
				<Labelled label='Название'>
					<input
						className='input'
						value={nameOverride}
						onChange={e => onName(e.target.value)}
					/>
				</Labelled>
				<Labelled label='Цена (PLN)'>
					<input
						className='input'
						value={priceOverride}
						onChange={e => onPrice(e.target.value)}
					/>
				</Labelled>
				<Labelled label='Остаток (шт)'>
					<input
						className='input'
						inputMode='numeric'
						value={stockOverride}
						onChange={e => onStock(e.target.value.replace(/\D/g, ''))}
					/>
				</Labelled>
				<Labelled label='Статус публикации'>
					<div className='flex h-10 border border-border rounded-md overflow-hidden'>
						{(['INACTIVE', 'ACTIVE'] as const).map((opt, i) => (
							<button
								key={opt}
								type='button'
								onClick={() => onPub(opt)}
								className={`flex-1 text-[12px] font-medium transition ${
									publicationStatus === opt
										? opt === 'ACTIVE'
											? 'bg-flame text-white'
											: 'bg-soft text-ink'
										: 'bg-card text-ink-muted hover:text-ink'
								} ${i === 0 ? 'border-r border-border' : ''}`}>
								{opt === 'ACTIVE' ? 'Активна' : 'Черновик'}
							</button>
						))}
					</div>
				</Labelled>
			</div>
		</section>
	);
}

function Labelled({
	label,
	children,
	action,
}: {
	label: string;
	children: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<label className='block'>
			<div className='flex items-baseline justify-between mb-1.5 gap-3'>
				<span className='label'>{label}</span>
				{action}
			</div>
			{children}
		</label>
	);
}

function ResultPanel({
	steps,
	outcome,
	error,
}: {
	steps: CloneStep[];
	outcome: CloneResult['outcome'];
	error: CloneResult['error'] | null;
}) {
	const logRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (logRef.current) {
			logRef.current.scrollTop = logRef.current.scrollHeight;
		}
	}, [steps]);

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>Лог</span>
				<span className='text-[11px] text-ink-faint'>
					{steps.length} шаг(ов)
				</span>
			</header>

			<div ref={logRef} className='max-h-[60vh] overflow-y-auto py-2'>
				<StepsLog steps={steps} empty='Пусто.' />
			</div>

			{(outcome || error) && (
				<div className='border-t border-border'>
					{outcome?.kind === 'created' && (
						<SummaryRow
							tone='ok'
							label='Оферта создана'
							value={outcome.offerId}
						/>
					)}
					{outcome?.kind === 'queued' && (
						<SummaryRow
							tone={
								outcome.status.publication.status === 'SUCCESS' ? 'ok' : 'warn'
							}
							label={`Команда: ${outcome.status.publication.status}`}
							value={outcome.commandId}
						/>
					)}
					{outcome?.kind === 'dry-run' && (
						<SummaryRow
							tone='info'
							label='Превью'
							value='Тело собрано — не отправлено'
						/>
					)}
					{error && (
						<SummaryRow
							tone='err'
							label={`Ошибка ${error.status ?? ''}`}
							value={error.message}
						/>
					)}
				</div>
			)}
		</section>
	);
}

function SummaryRow({
	tone,
	label,
	value,
	children,
}: {
	tone: 'ok' | 'warn' | 'err' | 'info';
	label: string;
	value: string;
	children?: React.ReactNode;
}) {
	const palette =
		tone === 'ok'
			? { bar: 'bg-ok', tint: 'bg-okTint' }
			: tone === 'warn'
				? { bar: 'bg-warn', tint: 'bg-warnTint' }
				: tone === 'err'
					? { bar: 'bg-bad', tint: 'bg-badTint' }
					: { bar: 'bg-flame', tint: 'bg-flame-tint' };
	return (
		<div
			className={`flex items-center justify-between gap-3 px-4 py-3 ${palette.tint}`}>
			<div className='flex items-stretch gap-3 min-w-0'>
				<span className={`w-1 rounded-full ${palette.bar}`} />
				<div className='min-w-0'>
					<div className='label'>{label}</div>
					<div className='text-[13px] text-ink truncate'>{value}</div>
				</div>
			</div>
			{children}
		</div>
	);
}

// Mirrors server-side substituteValueVariants to keep the live title preview in sync.
function substituteValueVariants(
	s: string,
	oldVal: string,
	newVal: string,
): string {
	const variants = expandVariants(oldVal);
	const targets = expandVariants(newVal);
	let out = s;
	for (let i = 0; i < variants.length; i++) {
		const re = new RegExp(escapeRegExp(variants[i]), 'gi');
		if (re.test(out)) out = out.replace(re, targets[i]);
	}
	return out;
}

function expandVariants(v: string): string[] {
	const trimmed = v.trim();
	const tight = trimmed.replace(/\s+/g, '');
	return Array.from(
		new Set([trimmed, tight, tight.toLowerCase(), tight.toUpperCase()]),
	);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

