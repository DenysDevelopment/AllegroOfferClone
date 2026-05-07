import { useMemo } from 'react';
import type { OfferPreview } from '../api';
import { Combobox } from './Combobox';

export interface ParamOverride {
	name: string;
	value: string;
}

interface Props {
	preview: OfferPreview | null;
	overrides: ParamOverride[];
	onChange: (next: ParamOverride[]) => void;
}

export function OverridesEditor({ preview, overrides, onChange }: Props) {
	const paramIndex = useMemo(() => {
		const map = new Map<string, { current: string; suggestions: string[] }>();
		for (const p of preview?.parameters ?? []) {
			if (!p.name) continue;
			const dictMatch = preview?.categoryParameters.find(
				cp => cp.id === p.id || cp.name.toLowerCase() === p.name?.toLowerCase(),
			);
			const suggestions = dictMatch?.dictionary?.map(d => d.value) ?? [];
			map.set(p.name, {
				current: p.values?.[0] ?? '',
				suggestions,
			});
		}
		return map;
	}, [preview]);

	const update = (i: number, patch: Partial<ParamOverride>) => {
		const next = overrides.slice();
		next[i] = { ...next[i], ...patch };
		onChange(next);
	};

	const remove = (i: number) => onChange(overrides.filter((_, j) => j !== i));
	const add = () => onChange([...overrides, { name: '', value: '' }]);
	const addPreset = (name: string, value: string) => {
		if (overrides.some(o => o.name.toLowerCase() === name.toLowerCase()))
			return;
		onChange([...overrides, { name, value }]);
	};

	const knownParamNames = Array.from(paramIndex.keys());
	const hasSSD = knownParamNames.includes('Pojemność dysku SSD');
	const hasRAM = knownParamNames.includes('Pamięć RAM');
	const hasPresets = preview && (hasSSD || hasRAM);

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>Что заменить</span>
				<button
					type='button'
					onClick={add}
					className='btn btn-ghost h-7 px-2 text-[12px]'>
					+ добавить
				</button>
			</header>

			{hasPresets && (
				<div className='px-4 pt-3 flex flex-wrap gap-1.5 border-b border-border-muted pb-3'>
					{hasSSD && (
						<Preset
							onClick={() => addPreset('Pojemność dysku SSD', '512 GB')}
							label='SSD → 512 ГБ'
						/>
					)}
					{hasSSD && (
						<Preset
							onClick={() => addPreset('Pojemność dysku SSD', '1 TB')}
							label='SSD → 1 ТБ'
						/>
					)}
					{hasSSD && (
						<Preset
							onClick={() => addPreset('Pojemność dysku SSD', '2 TB')}
							label='SSD → 2 ТБ'
						/>
					)}
					{hasRAM && (
						<Preset
							onClick={() => addPreset('Pamięć RAM', '16 GB')}
							label='RAM → 16 ГБ'
						/>
					)}
					{hasRAM && (
						<Preset
							onClick={() => addPreset('Pamięć RAM', '32 GB')}
							label='RAM → 32 ГБ'
						/>
					)}
				</div>
			)}

			<div className='p-4 space-y-2'>
				{overrides.length === 0 ? (
					<p className='text-[13px] text-ink-muted'>
						{preview
							? 'Жми +'
							: 'Сначала загрузи оферту — появятся подсказки и пресеты.'}
					</p>
				) : (
					overrides.map((row, i) => {
						const meta = paramIndex.get(row.name);
						return (
							<div
								key={i}
								className='grid grid-cols-[1fr_1fr_auto] gap-2 items-start'>
								<div className='flex flex-col gap-1'>
									<Combobox
										value={row.name}
										onChange={v => update(i, { name: v })}
										options={knownParamNames}
										placeholder='Параметр'
										hint={(opt) => paramIndex.get(opt)?.current}
									/>
									{meta && (
										<div className='text-[11px] text-ink-faint px-1'>
											сейчас:{' '}
											<span className='text-ink-muted'>
												{meta.current || '—'}
											</span>
										</div>
									)}
								</div>
								<div className='flex flex-col gap-1'>
									<Combobox
										value={row.value}
										onChange={v => update(i, { value: v })}
										options={meta?.suggestions ?? []}
										placeholder='Новое значение'
									/>
								</div>
								<button
									type='button'
									onClick={() => remove(i)}
									className='btn btn-ghost h-10 w-10 px-0 text-ink-faint hover:text-bad'
									aria-label='убрать'
									title='убрать'>
									✕
								</button>
							</div>
						);
					})
				)}
			</div>
		</section>
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
