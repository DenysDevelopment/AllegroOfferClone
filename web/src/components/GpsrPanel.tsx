import { useEffect, useRef, useState } from 'react';
import {
	api,
	type ClonePayload,
	type OfferGpsr,
	type ResponsiblePerson,
	type ResponsibleProducer,
} from '../api';

interface GpsrPanelProps {
	/** GPSR read off the source offer (preview.gpsr). */
	sourceGpsr: OfferGpsr | null | undefined;
	/** Account the clone publishes to — lists are read / new entries created here. */
	publishAccountId: string;
	/** true when source account ≠ publish account (foreign-account ids invalid). */
	crossAccount: boolean;
	/** Emits the confirmed GPSR state up to App for the clone payload. */
	onChange: (gpsr: NonNullable<ClonePayload['gpsr']>) => void;
}

// 27 EU ISO codes accepted by Allegro for responsible persons. Producers accept
// any [A-Z]{2}, but an EU dropdown covers the realistic cases for both.
const EU_COUNTRY_CODES = [
	'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GR', 'ES', 'IE',
	'LT', 'LU', 'LV', 'MT', 'NL', 'DE', 'PL', 'PT', 'RO', 'SK', 'SI', 'SE', 'HU', 'IT',
];

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Match a source producer against the target list by trade name + postal code. */
function matchProducer(
	src: OfferGpsr['responsibleProducer'] | undefined,
	list: ResponsibleProducer[],
): ResponsibleProducer | undefined {
	if (!src) return undefined;
	if ('producerData' in src) {
		const hits = list.filter(
			p =>
				norm(p.producerData.tradeName) === norm(src.producerData.tradeName) &&
				norm(p.producerData.address.postalCode) ===
					norm(src.producerData.address.postalCode),
		);
		return hits.length === 1 ? hits[0] : undefined;
	}
	// bare ref — only a NAME ref carries something matchable; an ID ref points
	// at the source account's dictionary and can't be matched in the target.
	if (src.type === 'NAME') {
		const hits = list.filter(p => norm(p.name) === norm(src.name));
		return hits.length === 1 ? hits[0] : undefined;
	}
	return undefined;
}

/** Match a source person against the target list by public name + postal code. */
function matchPerson(
	src: OfferGpsr['responsiblePerson'] | undefined,
	list: ResponsiblePerson[],
): ResponsiblePerson | undefined {
	if (!src) return undefined;
	if ('personalData' in src) {
		const hits = list.filter(
			p =>
				norm(p.personalData.name) === norm(src.personalData.name) &&
				norm(p.personalData.address.postalCode) ===
					norm(src.personalData.address.postalCode),
		);
		return hits.length === 1 ? hits[0] : undefined;
	}
	// bare ref — only a { name } ref is matchable; an { id } ref points at the
	// source account's dictionary.
	if ('name' in src) {
		const hits = list.filter(p => norm(p.name) === norm(src.name));
		return hits.length === 1 ? hits[0] : undefined;
	}
	return undefined;
}

interface CreateFormState {
	name: string;
	publicName: string;
	countryCode: string;
	street: string;
	postalCode: string;
	city: string;
	email: string;
	phoneNumber: string;
	formUrl: string;
}

const EMPTY_FORM: CreateFormState = {
	name: '',
	publicName: '',
	countryCode: 'PL',
	street: '',
	postalCode: '',
	city: '',
	email: '',
	phoneNumber: '',
	formUrl: '',
};

export function GpsrPanel({
	sourceGpsr,
	publishAccountId,
	crossAccount,
	onChange,
}: GpsrPanelProps) {
	const [producers, setProducers] = useState<ResponsibleProducer[]>([]);
	const [persons, setPersons] = useState<ResponsiblePerson[]>([]);
	const [loading, setLoading] = useState(false);
	const [listError, setListError] = useState<string | null>(null);

	const [producerId, setProducerId] = useState('');
	const [personId, setPersonId] = useState('');
	const [safetyText, setSafetyText] = useState('');

	const [producerForm, setProducerForm] = useState<CreateFormState | null>(null);
	const [personForm, setPersonForm] = useState<CreateFormState | null>(null);
	const [createError, setCreateError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	// Guards stale list responses when publishAccountId changes mid-flight.
	const loadSeqRef = useRef(0);
	// Once the operator dismisses an auto-opened create form, don't re-open it
	// for the same source offer (reset when a new source offer loads).
	const lastSourceRef = useRef<OfferGpsr | null | undefined>(undefined);
	const producerDismissedRef = useRef(false);
	const personDismissedRef = useRef(false);

	// Load the target account's dictionaries whenever the publish account changes.
	useEffect(() => {
		if (!publishAccountId) return;
		const seq = ++loadSeqRef.current;
		setLoading(true);
		setListError(null);
		Promise.all([
			api.gpsr.listProducers(publishAccountId),
			api.gpsr.listPersons(publishAccountId),
		])
			.then(([pr, pe]) => {
				if (loadSeqRef.current !== seq) return;
				setProducers(pr.responsibleProducers ?? []);
				setPersons(pe.responsiblePersons ?? []);
			})
			.catch(e => {
				if (loadSeqRef.current !== seq) return;
				setListError((e as Error).message);
			})
			.finally(() => {
				if (loadSeqRef.current === seq) setLoading(false);
			});
	}, [publishAccountId]);

	// Prefill safety text from the source offer (TEXT is account-agnostic).
	useEffect(() => {
		setSafetyText(sourceGpsr?.safetyInformation?.description ?? '');
	}, [sourceGpsr]);

	// Match source producer/person against the loaded target lists.
	useEffect(() => {
		if (loading) return;
		setProducerId(matchProducer(sourceGpsr?.responsibleProducer, producers)?.id ?? '');
		setPersonId(matchPerson(sourceGpsr?.responsiblePerson, persons)?.id ?? '');
	}, [loading, producers, persons, sourceGpsr]);

	// Cross-account + no match → open a create form prefilled from the source.
	// `setXForm(f => f ?? …)` only opens when the form isn't already open, so
	// re-firing (e.g. lists reload) never clobbers in-progress edits. A new
	// source offer resets the per-source "dismissed" guard.
	useEffect(() => {
		if (loading || !crossAccount) return;
		if (lastSourceRef.current !== sourceGpsr) {
			lastSourceRef.current = sourceGpsr;
			producerDismissedRef.current = false;
			personDismissedRef.current = false;
		}
		const src = sourceGpsr?.responsibleProducer;
		if (
			src &&
			'producerData' in src &&
			!matchProducer(src, producers) &&
			!producerDismissedRef.current
		) {
			setProducerForm(f =>
				f ?? {
					name: src.name,
					publicName: src.producerData.tradeName,
					countryCode: src.producerData.address.countryCode || 'PL',
					street: src.producerData.address.street,
					postalCode: src.producerData.address.postalCode,
					city: src.producerData.address.city,
					email: src.producerData.contact.email ?? '',
					phoneNumber: src.producerData.contact.phoneNumber ?? '',
					formUrl: src.producerData.contact.formUrl ?? '',
				},
			);
		}
		const srcP = sourceGpsr?.responsiblePerson;
		if (
			srcP &&
			'personalData' in srcP &&
			!matchPerson(srcP, persons) &&
			!personDismissedRef.current
		) {
			setPersonForm(f =>
				f ?? {
					name: srcP.name,
					publicName: srcP.personalData.name,
					countryCode: srcP.personalData.address.countryCode || 'PL',
					street: srcP.personalData.address.street,
					postalCode: srcP.personalData.address.postalCode,
					city: srcP.personalData.address.city,
					email: srcP.personalData.contact.email ?? '',
					phoneNumber: srcP.personalData.contact.phoneNumber ?? '',
					formUrl: srcP.personalData.contact.formUrl ?? '',
				},
			);
		}
	}, [loading, crossAccount, producers, persons, sourceGpsr]);

	// Emit the confirmed GPSR state upward whenever a selection changes.
	// NOTE: App.tsx must pass a useCallback-stable onChange or this loops.
	useEffect(() => {
		onChange({
			responsibleProducer: producerId ? { type: 'ID', id: producerId } : null,
			responsiblePerson: personId ? { id: personId } : null,
			safetyInformation: safetyText.trim()
				? { type: 'TEXT', description: safetyText.trim() }
				: null,
		});
	}, [producerId, personId, safetyText, onChange]);

	const submitProducer = async () => {
		if (!producerForm) return;
		setCreating(true);
		setCreateError(null);
		try {
			const created = await api.gpsr.createProducer({
				name: producerForm.name.trim(),
				producerData: {
					tradeName: producerForm.publicName.trim(),
					address: {
						countryCode: producerForm.countryCode,
						street: producerForm.street.trim(),
						postalCode: producerForm.postalCode.trim(),
						city: producerForm.city.trim(),
					},
					contact: {
						email: producerForm.email.trim() || undefined,
						phoneNumber: producerForm.phoneNumber.trim() || undefined,
						formUrl: producerForm.formUrl.trim() || undefined,
					},
				},
				accountId: publishAccountId || undefined,
			});
			setProducers(prev => [created, ...prev]);
			setProducerId(created.id);
			setProducerForm(null);
		} catch (e) {
			setCreateError(
				(e as { data?: { message?: string } }).data?.message ??
					(e as Error).message,
			);
		} finally {
			setCreating(false);
		}
	};

	const submitPerson = async () => {
		if (!personForm) return;
		setCreating(true);
		setCreateError(null);
		try {
			const created = await api.gpsr.createPerson({
				name: personForm.name.trim(),
				personalData: {
					name: personForm.publicName.trim(),
					address: {
						countryCode: personForm.countryCode,
						street: personForm.street.trim(),
						postalCode: personForm.postalCode.trim(),
						city: personForm.city.trim(),
					},
					contact: {
						email: personForm.email.trim() || undefined,
						phoneNumber: personForm.phoneNumber.trim() || undefined,
						formUrl: personForm.formUrl.trim() || undefined,
					},
				},
				accountId: publishAccountId || undefined,
			});
			setPersons(prev => [created, ...prev]);
			setPersonId(created.id);
			setPersonForm(null);
		} catch (e) {
			setCreateError(
				(e as { data?: { message?: string } }).data?.message ??
					(e as Error).message,
			);
		} finally {
			setCreating(false);
		}
	};

	// Suppressed while the lists are loading — otherwise the warning flashes
	// before the match effect has had the data to run against.
	const producerUnmatched =
		!loading && !!sourceGpsr?.responsibleProducer && !producerId;
	const personUnmatched =
		!loading && !!sourceGpsr?.responsiblePerson && !personId;

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>GPSR · производитель / ответственное лицо</span>
				{loading && <span className='text-[11px] text-ink-faint'>· · ·</span>}
			</header>
			<div className='p-4 space-y-4'>
				{listError && (
					<div className='text-[13px] text-bad border border-bad/30 bg-badTint rounded-md px-3 py-2'>
						{listError}
					</div>
				)}

				<GpsrField
					label='Dane producenta'
					unmatched={producerUnmatched}
					unmatchedHint='Производитель источника не найден в target-аккаунте — выбери или создай.'
					selectValue={producerId}
					onSelect={setProducerId}
					options={producers.map(p => ({
						id: p.id,
						label: `${p.name} — ${p.producerData.tradeName}`,
					}))}
					createOpen={!!producerForm}
					onToggleCreate={() => {
						if (producerForm) {
							setProducerForm(null);
							producerDismissedRef.current = true;
						} else {
							setProducerForm({ ...EMPTY_FORM });
							producerDismissedRef.current = false;
						}
					}}
				/>
				{producerForm && (
					<GpsrCreateForm
						kind='producer'
						state={producerForm}
						onChange={setProducerForm}
						onSubmit={submitProducer}
						onCancel={() => {
							setProducerForm(null);
							producerDismissedRef.current = true;
						}}
						busy={creating}
						error={createError}
					/>
				)}

				<GpsrField
					label='Osoba odpowiedzialna'
					unmatched={personUnmatched}
					unmatchedHint='Ответственное лицо источника не найдено в target-аккаунте — выбери или создай.'
					selectValue={personId}
					onSelect={setPersonId}
					options={persons.map(p => ({
						id: p.id,
						label: `${p.name} — ${p.personalData.name}`,
					}))}
					createOpen={!!personForm}
					onToggleCreate={() => {
						if (personForm) {
							setPersonForm(null);
							personDismissedRef.current = true;
						} else {
							setPersonForm({ ...EMPTY_FORM });
							personDismissedRef.current = false;
						}
					}}
				/>
				{personForm && (
					<GpsrCreateForm
						kind='person'
						state={personForm}
						onChange={setPersonForm}
						onSubmit={submitPerson}
						onCancel={() => {
							setPersonForm(null);
							personDismissedRef.current = true;
						}}
						busy={creating}
						error={createError}
					/>
				)}

				<label className='block'>
					<span className='label block mb-1.5'>
						Informacja o bezpieczeństwie (TEXT)
					</span>
					<textarea
						className='input min-h-[72px] resize-y'
						value={safetyText}
						maxLength={5000}
						onChange={e => setSafetyText(e.target.value)}
						placeholder='Текст безопасности продукта (переносится с источника)'
					/>
					<span className='text-[11px] text-ink-faint'>
						{safetyText.length}/5000
					</span>
				</label>
			</div>
		</section>
	);
}

function GpsrField({
	label,
	unmatched,
	unmatchedHint,
	selectValue,
	onSelect,
	options,
	createOpen,
	onToggleCreate,
}: {
	label: string;
	unmatched: boolean;
	unmatchedHint: string;
	selectValue: string;
	onSelect: (id: string) => void;
	options: Array<{ id: string; label: string }>;
	createOpen: boolean;
	onToggleCreate: () => void;
}) {
	return (
		<div className='space-y-1.5'>
			<div className='flex items-center justify-between'>
				<span className='label'>{label}</span>
				<button
					type='button'
					onClick={onToggleCreate}
					className='btn btn-ghost h-7 px-2 text-[11px]'>
					{createOpen ? 'отмена' : '+ создать'}
				</button>
			</div>
			<select
				className={`input ${unmatched ? 'border-warn' : ''}`}
				value={selectValue}
				onChange={e => onSelect(e.target.value)}>
				<option value=''>— не выбрано —</option>
				{options.map(o => (
					<option key={o.id} value={o.id}>
						{o.label}
					</option>
				))}
			</select>
			{unmatched && <p className='text-[11px] text-warn'>{unmatchedHint}</p>}
		</div>
	);
}

function GpsrCreateForm({
	kind,
	state,
	onChange,
	onSubmit,
	onCancel,
	busy,
	error,
}: {
	kind: 'producer' | 'person';
	state: CreateFormState;
	onChange: (s: CreateFormState) => void;
	onSubmit: () => void;
	onCancel: () => void;
	busy: boolean;
	error: string | null;
}) {
	const set = (patch: Partial<CreateFormState>) =>
		onChange({ ...state, ...patch });
	const canSubmit =
		!!state.name.trim() &&
		!!state.publicName.trim() &&
		!!state.street.trim() &&
		!!state.postalCode.trim() &&
		!!state.city.trim() &&
		!!(state.email.trim() || state.formUrl.trim());

	return (
		<div className='border border-border-muted rounded-md p-3 space-y-2 bg-soft/40'>
			<div className='text-[11px] text-ink-muted uppercase tracking-wide'>
				Новый {kind === 'producer' ? 'производитель' : 'ответственное лицо'}
			</div>
			<input
				className='input'
				placeholder='Внутреннее имя (≤50)'
				value={state.name}
				maxLength={50}
				onChange={e => set({ name: e.target.value })}
			/>
			<input
				className='input'
				placeholder={
					kind === 'producer'
						? 'Trade name / название компании (≤200)'
						: 'Имя лица/компании (≤200)'
				}
				value={state.publicName}
				maxLength={200}
				onChange={e => set({ publicName: e.target.value })}
			/>
			<div className='grid grid-cols-2 gap-2'>
				<select
					className='input'
					value={state.countryCode}
					onChange={e => set({ countryCode: e.target.value })}>
					{EU_COUNTRY_CODES.map(c => (
						<option key={c} value={c}>
							{c}
						</option>
					))}
				</select>
				<input
					className='input'
					placeholder='Город'
					value={state.city}
					maxLength={100}
					onChange={e => set({ city: e.target.value })}
				/>
			</div>
			<input
				className='input'
				placeholder='Улица, дом'
				value={state.street}
				maxLength={200}
				onChange={e => set({ street: e.target.value })}
			/>
			<input
				className='input'
				placeholder='Индекс'
				value={state.postalCode}
				maxLength={20}
				onChange={e => set({ postalCode: e.target.value })}
			/>
			<input
				className='input'
				placeholder='Email (или URL формы)'
				value={state.email}
				maxLength={50}
				onChange={e => set({ email: e.target.value })}
			/>
			<input
				className='input'
				placeholder='Телефон (опц.)'
				value={state.phoneNumber}
				maxLength={30}
				onChange={e => set({ phoneNumber: e.target.value })}
			/>
			<input
				className='input'
				placeholder='URL формы (если без email)'
				value={state.formUrl}
				maxLength={80}
				onChange={e => set({ formUrl: e.target.value })}
			/>
			{error && <p className='text-[12px] text-bad'>{error}</p>}
			<div className='flex gap-2'>
				<button
					type='button'
					className='btn btn-primary h-8 px-3 text-[12px]'
					disabled={!canSubmit || busy}
					onClick={onSubmit}>
					{busy ? 'создаю · · ·' : 'Создать в Allegro'}
				</button>
				<button
					type='button'
					className='btn btn-ghost h-8 px-3 text-[12px]'
					onClick={onCancel}
					disabled={busy}>
					Отмена
				</button>
			</div>
		</div>
	);
}
