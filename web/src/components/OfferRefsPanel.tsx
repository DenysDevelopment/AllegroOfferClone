import { useEffect, useRef, useState } from 'react';
import { api, type ClonePayload, type OfferRefs } from '../api';

interface OfferRefsPanelProps {
	/** Account-scoped refs read off the source offer (preview.offerRefs). */
	sourceRefs: OfferRefs | null | undefined;
	/** Account the clone publishes to — lists are read here. */
	publishAccountId: string;
	/** true when source account ≠ publish account. */
	crossAccount: boolean;
	/** Emits the confirmed refs up to App for the clone payload. */
	onChange: (offerRefs: NonNullable<ClonePayload['offerRefs']>) => void;
}

type RefList = Array<{ id: string; name: string }>;

// Allegro seller settings — generic link shown when a ref isn't found in the
// target account (these dictionary entries can't be created from this tool).
const ALLEGRO_SETTINGS_URL = 'https://allegro.pl/moje-allegro/sprzedaz/ustawienia';

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Match a source ref name against the target list; returns the id or ''. */
function matchByName(srcName: string | undefined, list: RefList): string {
	if (!srcName) return '';
	const hits = list.filter(r => norm(r.name) === norm(srcName));
	return hits.length === 1 ? hits[0].id : '';
}

export function OfferRefsPanel({
	sourceRefs,
	publishAccountId,
	crossAccount,
	onChange,
}: OfferRefsPanelProps) {
	const [shippingRates, setShippingRates] = useState<RefList>([]);
	const [returnPolicies, setReturnPolicies] = useState<RefList>([]);
	const [impliedWarranties, setImpliedWarranties] = useState<RefList>([]);
	const [warranties, setWarranties] = useState<RefList>([]);
	const [loading, setLoading] = useState(false);
	const [listError, setListError] = useState<string | null>(null);

	const [shippingRatesId, setShippingRatesId] = useState('');
	const [returnPolicyId, setReturnPolicyId] = useState('');
	const [impliedWarrantyId, setImpliedWarrantyId] = useState('');
	const [warrantyId, setWarrantyId] = useState('');

	// Guards stale list responses when publishAccountId changes mid-flight.
	const loadSeqRef = useRef(0);
	// Always call the latest onChange without it being an effect dependency —
	// the emit effect must not re-fire just because the parent re-rendered.
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	// Load the target account's dictionaries whenever the publish account changes.
	useEffect(() => {
		if (!publishAccountId) return;
		const seq = ++loadSeqRef.current;
		setLoading(true);
		setListError(null);
		Promise.all([
			api.helpers.shippingRates(publishAccountId),
			api.helpers.returnPolicies(publishAccountId),
			api.helpers.impliedWarranties(publishAccountId),
			api.helpers.warranties(publishAccountId),
		])
			.then(([sr, rp, iw, wr]) => {
				if (loadSeqRef.current !== seq) return;
				setShippingRates(sr ?? []);
				setReturnPolicies(rp ?? []);
				setImpliedWarranties(iw ?? []);
				setWarranties(wr ?? []);
			})
			.catch(e => {
				if (loadSeqRef.current !== seq) return;
				setListError((e as Error).message);
			})
			.finally(() => {
				if (loadSeqRef.current === seq) setLoading(false);
			});
	}, [publishAccountId]);

	// Match source ref names against the loaded target lists.
	useEffect(() => {
		if (loading) return;
		setShippingRatesId(matchByName(sourceRefs?.shippingRates?.name, shippingRates));
		setReturnPolicyId(matchByName(sourceRefs?.returnPolicy?.name, returnPolicies));
		setImpliedWarrantyId(
			matchByName(sourceRefs?.impliedWarranty?.name, impliedWarranties),
		);
		setWarrantyId(matchByName(sourceRefs?.warranty?.name, warranties));
	}, [loading, shippingRates, returnPolicies, impliedWarranties, warranties, sourceRefs]);

	// Emit the confirmed refs upward whenever a selection changes.
	// Uses onChangeRef so an unstable parent callback can't cause a render loop.
	useEffect(() => {
		onChangeRef.current({
			shippingRates: shippingRatesId ? { id: shippingRatesId } : null,
			returnPolicy: returnPolicyId ? { id: returnPolicyId } : null,
			impliedWarranty: impliedWarrantyId ? { id: impliedWarrantyId } : null,
			warranty: warrantyId ? { id: warrantyId } : null,
		});
	}, [shippingRatesId, returnPolicyId, impliedWarrantyId, warrantyId]);

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>
					Справочники оферты · доставка / возвраты / гарантия
				</span>
				{loading && <span className='text-[11px] text-ink-faint'>· · ·</span>}
			</header>
			<div className='p-4 space-y-3'>
				{listError && (
					<div className='text-[13px] text-bad border border-bad/30 bg-badTint rounded-md px-3 py-2'>
						{listError}
					</div>
				)}
				<RefRow
					label='Cennik dostawy'
					sourceName={sourceRefs?.shippingRates?.name}
					value={shippingRatesId}
					onChange={setShippingRatesId}
					options={shippingRates}
					loading={loading}
				/>
				<RefRow
					label='Warunki zwrotów'
					sourceName={sourceRefs?.returnPolicy?.name}
					value={returnPolicyId}
					onChange={setReturnPolicyId}
					options={returnPolicies}
					loading={loading}
				/>
				<RefRow
					label='Reklamacje'
					sourceName={sourceRefs?.impliedWarranty?.name}
					value={impliedWarrantyId}
					onChange={setImpliedWarrantyId}
					options={impliedWarranties}
					loading={loading}
				/>
				<RefRow
					label='Gwarancja'
					sourceName={sourceRefs?.warranty?.name}
					value={warrantyId}
					onChange={setWarrantyId}
					options={warranties}
					loading={loading}
				/>
				{crossAccount && (
					<p className='text-[11px] text-ink-faint'>
						Кросс-аккаунт: ссылки матчатся по имени. Нет в списке —{' '}
						<a
							className='underline'
							href={ALLEGRO_SETTINGS_URL}
							target='_blank'
							rel='noreferrer'>
							создай в настройках Allegro ↗
						</a>
					</p>
				)}
			</div>
		</section>
	);
}

function RefRow({
	label,
	sourceName,
	value,
	onChange,
	options,
	loading,
}: {
	label: string;
	sourceName: string | undefined;
	value: string;
	onChange: (id: string) => void;
	options: RefList;
	loading: boolean;
}) {
	// Suppressed while the lists load — otherwise the warning flashes before
	// the match effect has had data to run against.
	const unmatched = !loading && !!sourceName && !value;
	return (
		<div className='space-y-1'>
			<div className='flex items-center justify-between'>
				<span className='label'>{label}</span>
				{sourceName && (
					<span className='text-[11px] text-ink-faint'>
						источник: {sourceName}
					</span>
				)}
			</div>
			<select
				className={`input ${unmatched ? 'border-warn' : ''}`}
				value={value}
				onChange={e => onChange(e.target.value)}>
				<option value=''>— не выбрано —</option>
				{options.map(o => (
					<option key={o.id} value={o.id}>
						{o.name}
					</option>
				))}
			</select>
			{unmatched && (
				<p className='text-[11px] text-warn'>
					«{sourceName}» не найден в target-аккаунте — выбери из списка.
				</p>
			)}
		</div>
	);
}
