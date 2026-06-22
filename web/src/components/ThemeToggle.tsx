import { useEffect, useState } from 'react';
import {
	applyTheme,
	getStoredPref,
	getSystemTheme,
	resolveTheme,
	setStoredPref,
	type ThemePref,
} from '../theme';

const OPTIONS: Array<{ pref: ThemePref; label: string; title: string }> = [
	{ pref: 'system', label: 'Авто', title: 'Как в системе' },
	{ pref: 'light', label: 'Светлая', title: 'Светлая тема' },
	{ pref: 'dark', label: 'Тёмная', title: 'Тёмная тема' },
];

export function ThemeToggle() {
	const [pref, setPref] = useState<ThemePref>(() => getStoredPref());

	useEffect(() => {
		applyTheme(resolveTheme(pref));
		setStoredPref(pref);
	}, [pref]);

	// In "system" mode, track OS theme changes live.
	useEffect(() => {
		if (pref !== 'system') return;
		const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
		if (!mq) return;
		const onChange = () => applyTheme(getSystemTheme());
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, [pref]);

	return (
		<div
			role='group'
			aria-label='Тема'
			className='inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5'>
			{OPTIONS.map(o => {
				const active = pref === o.pref;
				return (
					<button
						key={o.pref}
						type='button'
						onClick={() => setPref(o.pref)}
						title={o.title}
						aria-pressed={active}
						className={
							'h-7 px-2 text-[12px] rounded transition ' +
							(active
								? 'bg-flame-tint text-flame font-medium'
								: 'text-ink-muted hover:text-ink')
						}>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}
