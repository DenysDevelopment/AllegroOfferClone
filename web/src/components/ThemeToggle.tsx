import { useEffect, useState } from 'react';
import {
	applyTheme,
	getInitialTheme,
	setStoredTheme,
	type Theme,
} from '../theme';

export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

	useEffect(() => {
		applyTheme(theme);
		setStoredTheme(theme);
	}, [theme]);

	const isDark = theme === 'dark';
	const toggle = () => setTheme(isDark ? 'light' : 'dark');

	return (
		<button
			type='button'
			onClick={toggle}
			className='btn btn-ghost h-8 w-8 px-0'
			title={isDark ? 'Светлая тема' : 'Тёмная тема'}
			aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}>
			{isDark ? <SunIcon /> : <MoonIcon />}
		</button>
	);
}

function SunIcon() {
	return (
		<svg
			width='16'
			height='16'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'>
			<circle cx='12' cy='12' r='4' />
			<path d='M12 2v2' />
			<path d='M12 20v2' />
			<path d='m4.93 4.93 1.41 1.41' />
			<path d='m17.66 17.66 1.41 1.41' />
			<path d='M2 12h2' />
			<path d='M20 12h2' />
			<path d='m6.34 17.66-1.41 1.41' />
			<path d='m19.07 4.93-1.41 1.41' />
		</svg>
	);
}

function MoonIcon() {
	return (
		<svg
			width='16'
			height='16'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'>
			<path d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' />
		</svg>
	);
}
