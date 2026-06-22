import { useMemo, useState } from 'react';
import type { CategoryParameter, OfferPreview } from '../api';
import {
	allowsCustomValue,
	controlKind,
	useSelectForDictionary,
} from './paramControls';

interface Props {
	preview: OfferPreview | null;
	/** Working values keyed by parameter name. */
	values: Record<string, string[]>;
	/** Current source values keyed by parameter name (for "сейчас" + changed badge). */
	seed: Record<string, string[]>;
	onChange: (next: Record<string, string[]>) => void;
}

function changed(a: string[] = [], b: string[] = []): boolean {
	const ca = a.map(v => v.trim()).filter(Boolean);
	const cb = b.map(v => v.trim()).filter(Boolean);
	if (ca.length !== cb.length) return true;
	const sb = new Set(cb);
	return !ca.every(v => sb.has(v));
}

export function ParametersEditor({ preview, values, seed, onChange }: Props) {
	const params = preview?.categoryParameters ?? [];
	const [filter, setFilter] = useState('');
	const [onlyChanged, setOnlyChanged] = useState(false);

	const setValue = (name: string, next: string[]) =>
		onChange({ ...values, [name]: next });

	const setPreset = (name: string, value: string) => {
		if (!params.some(p => p.name === name)) return;
		onChange({ ...values, [name]: [value] });
	};

	const names = params.map(p => p.name);
	const hasSSD = names.includes('Pojemność dysku SSD');
	const hasRAM = names.includes('Pamięć RAM');

	const visible = useMemo(() => {
		const q = filter.trim().toLowerCase();
		return params.filter(p => {
			if (q && !(p.name ?? '').toLowerCase().includes(q)) return false;
			if (onlyChanged && !changed(values[p.name], seed[p.name])) return false;
			return true;
		});
	}, [params, filter, onlyChanged, values, seed]);

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>Параметры{params.length ? ` (${params.length})` : ''}</span>
				<label className='flex items-center gap-1.5 text-[12px] text-ink-muted'>
					<input
						type='checkbox'
						checked={onlyChanged}
						onChange={e => setOnlyChanged(e.target.checked)}
					/>
					только изменённые
				</label>
			</header>

			{!preview ? (
				<p className='p-4 text-[13px] text-ink-muted'>
					Сначала загрузи оферту — появятся параметры категории.
				</p>
			) : params.length === 0 ? (
				<p className='p-4 text-[13px] text-ink-muted'>
					У категории нет параметров (или категория не определена).
				</p>
			) : (
				<>
					<div className='px-4 pt-3 flex flex-wrap items-center gap-2 border-b border-border-muted pb-3'>
						<input
							className='input h-7 flex-1 min-w-[140px] text-[12px]'
							placeholder='Фильтр по названию'
							value={filter}
							onChange={e => setFilter(e.target.value)}
						/>
						{hasSSD && (
							<Preset onClick={() => setPreset('Pojemność dysku SSD', '512 GB')} label='SSD → 512 ГБ' />
						)}
						{hasSSD && (
							<Preset onClick={() => setPreset('Pojemność dysku SSD', '1 TB')} label='SSD → 1 ТБ' />
						)}
						{hasRAM && (
							<Preset onClick={() => setPreset('Pamięć RAM', '16 GB')} label='RAM → 16 ГБ' />
						)}
						{hasRAM && (
							<Preset onClick={() => setPreset('Pamięć RAM', '32 GB')} label='RAM → 32 ГБ' />
						)}
					</div>

					<div className='p-4 space-y-3'>
						{visible.map(p => (
							<ParamRow
								key={p.id || p.name}
								param={p}
								value={values[p.name] ?? []}
								current={seed[p.name] ?? []}
								onChange={next => setValue(p.name, next)}
							/>
						))}
						{visible.length === 0 && (
							<p className='text-[13px] text-ink-faint'>Ничего не найдено.</p>
						)}
					</div>
				</>
			)}
		</section>
	);
}

function ParamRow({
	param,
	value,
	current,
	onChange,
}: {
	param: CategoryParameter;
	value: string[];
	current: string[];
	onChange: (next: string[]) => void;
}) {
	const kind = controlKind(param);
	const isChanged = changed(value, current);
	const unit = param.unit ? ` ${param.unit}` : '';

	return (
		<div className='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 items-start'>
			<div className='pt-1.5'>
				<div className='text-[13px] text-ink'>
					{param.name}
					{param.required && <span className='text-flame'> *</span>}
				</div>
				<div className='text-[11px] text-ink-faint'>
					сейчас: <span className='text-ink-muted'>{current.join(', ') || '—'}</span>
					{isChanged && (
						<span className='ml-1.5 text-flame'>· изменено</span>
					)}
				</div>
			</div>
			<div className='flex flex-col gap-1.5'>
				{kind === 'dict-multi' && (
					<DictMulti param={param} value={value} onChange={onChange} />
				)}
				{kind === 'dict-single' && (
					<DictSingle param={param} value={value} onChange={onChange} />
				)}
				{kind === 'number' && (
					<NumberInput param={param} value={value} unit={unit} onChange={onChange} />
				)}
				{kind === 'range' && <RangeDisplay current={current} unit={unit} />}
				{kind === 'text' && (
					<input
						className='input'
						maxLength={(param.restrictions as { maxLength?: number })?.maxLength}
						placeholder='Значение'
						value={value[0] ?? ''}
						onChange={e => onChange(e.target.value ? [e.target.value] : [])}
					/>
				)}
			</div>
		</div>
	);
}

function DictMulti({
	param,
	value,
	onChange,
}: {
	param: CategoryParameter;
	value: string[];
	onChange: (next: string[]) => void;
}) {
	const toggle = (label: string) =>
		onChange(value.includes(label) ? value.filter(v => v !== label) : [...value, label]);
	return (
		<div className='flex flex-wrap gap-x-4 gap-y-1.5'>
			{(param.dictionary ?? []).map(d => (
				<label key={d.id ?? d.value} className='flex items-center gap-1.5 text-[13px] text-ink'>
					<input
						type='checkbox'
						checked={value.includes(d.value)}
						onChange={() => toggle(d.value)}
					/>
					{d.value}
				</label>
			))}
		</div>
	);
}

function DictSingle({
	param,
	value,
	onChange,
}: {
	param: CategoryParameter;
	value: string[];
	onChange: (next: string[]) => void;
}) {
	const selected = value[0] ?? '';
	const custom = allowsCustomValue(param);
	const known = (param.dictionary ?? []).some(d => d.value === selected);

	if (useSelectForDictionary(param)) {
		return (
			<div className='flex flex-col gap-1.5'>
				<select
					className='input cursor-pointer'
					value={known ? selected : ''}
					onChange={e => onChange(e.target.value ? [e.target.value] : [])}>
					<option value=''>— не задано —</option>
					{(param.dictionary ?? []).map(d => (
						<option key={d.id ?? d.value} value={d.value}>
							{d.value}
						</option>
					))}
				</select>
				{custom && (
					<input
						className='input'
						placeholder='Своё значение'
						value={known ? '' : selected}
						onChange={e => onChange(e.target.value ? [e.target.value] : [])}
					/>
				)}
			</div>
		);
	}

	return (
		<div className='flex flex-col gap-1.5'>
			<div className='flex flex-wrap gap-x-4 gap-y-1.5'>
				{(param.dictionary ?? []).map(d => (
					<label key={d.id ?? d.value} className='flex items-center gap-1.5 text-[13px] text-ink'>
						<input
							type='radio'
							name={`p-${param.id ?? param.name}`}
							checked={selected === d.value}
							onChange={() => onChange([d.value])}
						/>
						{d.value}
					</label>
				))}
			</div>
			{custom && (
				<input
					className='input'
					placeholder='Своё значение'
					value={known ? '' : selected}
					onChange={e => onChange(e.target.value ? [e.target.value] : [])}
				/>
			)}
		</div>
	);
}

function NumberInput({
	param,
	value,
	unit,
	onChange,
}: {
	param: CategoryParameter;
	value: string[];
	unit: string;
	onChange: (next: string[]) => void;
}) {
	const r = (param.restrictions ?? {}) as {
		min?: number;
		max?: number;
		precision?: number;
	};
	const step = param.type === 'float' && r.precision ? 1 / 10 ** r.precision : 1;
	return (
		<div className='flex items-center gap-2'>
			<input
				className='input w-40'
				type='number'
				min={r.min}
				max={r.max}
				step={step}
				placeholder='Значение'
				value={value[0] ?? ''}
				onChange={e => onChange(e.target.value ? [e.target.value] : [])}
			/>
			{unit && <span className='text-[12px] text-ink-muted'>{unit.trim()}</span>}
			{(r.min !== undefined || r.max !== undefined) && (
				<span className='text-[11px] text-ink-faint'>
					{r.min ?? '…'}–{r.max ?? '…'}
				</span>
			)}
		</div>
	);
}

function RangeDisplay({ current, unit }: { current: string[]; unit: string }) {
	return (
		<div className='text-[12px] text-ink-muted'>
			{current.length ? `${current.join(' – ')}${unit}` : '—'}
			<span className='ml-2 text-ink-faint'>(диапазон — только просмотр)</span>
		</div>
	);
}

function Preset({ onClick, label }: { onClick: () => void; label: string }) {
	return (
		<button
			type='button'
			onClick={onClick}
			className='text-[12px] font-medium px-2.5 h-7 border border-border rounded-full bg-card text-ink-muted hover:border-flame hover:text-flame hover:bg-flame-tint transition'>
			{label}
		</button>
	);
}
