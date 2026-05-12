import { useEffect, useRef, useState } from 'react';
import type { AccountSummary } from '../api';
import { api } from '../api';

interface Props {
	accounts: AccountSummary[];
	activeId: string | null;
	onSwitch: (id: string) => void;
	onRefresh: () => Promise<unknown> | void;
}

export function AccountSwitcher({ accounts, activeId, onSwitch, onRefresh }: Props) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onClick = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		document.addEventListener('mousedown', onClick);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onClick);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	const active = accounts.find(a => a.id === activeId) ?? accounts[0];

	const startLogin = async (id: string) => {
		setBusy(id);
		try {
			const { url } = await api.loginUrl(id);
			window.location.href = url;
		} catch (e) {
			alert(`Не удалось получить ссылку для входа: ${(e as Error).message}`);
			setBusy(null);
		}
	};

	const disconnect = async (id: string) => {
		if (!confirm(`Отключить аккаунт "${id}"?`)) return;
		setBusy(id);
		try {
			await api.disconnect(id);
			await onRefresh();
		} finally {
			setBusy(null);
		}
	};

	if (!active) return null;

	return (
		<div ref={rootRef} className='relative'>
			<button
				type='button'
				onClick={() => setOpen(o => !o)}
				className='btn btn-ghost h-8 px-3 text-[12px] flex items-center gap-2'
				title='Сменить аккаунт'>
				<span
					className={`inline-block w-1.5 h-1.5 rounded-full ${
						active.connected ? 'bg-ok' : 'bg-ink-faint'
					}`}
				/>
				<span className='font-medium text-ink truncate max-w-[160px]'>
					{active.label}
				</span>
				<span className='text-ink-faint'>{open ? '▲' : '▼'}</span>
			</button>

			{open && (
				<div className='absolute right-0 top-9 z-20 w-[280px] panel shadow-lg'>
					<div className='px-3 pt-3 pb-1.5 label'>Аккаунты Allegro</div>
					<ul className='py-1'>
						{accounts.map(a => {
							const isActive = a.id === active.id;
							return (
								<li key={a.id} className='px-1'>
									<div
										className={`rounded-md px-3 py-2 flex items-center gap-2 ${
											isActive ? 'bg-soft' : 'hover:bg-soft/60'
										}`}>
										<span
											className={`inline-block w-1.5 h-1.5 rounded-full ${
												a.connected ? 'bg-ok' : 'bg-ink-faint'
											}`}
										/>
										<button
											type='button'
											onClick={() => {
												if (!a.connected) {
													startLogin(a.id);
													return;
												}
												onSwitch(a.id);
												setOpen(false);
											}}
											className='flex-1 text-left text-[13px] text-ink truncate'>
											{a.label}
										</button>
										{!a.hasCredentials ? (
											<span className='text-[11px] text-warn'>нет creds</span>
										) : a.connected ? (
											<button
												type='button'
												className='btn btn-ghost h-6 px-2 text-[11px]'
												disabled={busy === a.id}
												onClick={() => disconnect(a.id)}>
												{busy === a.id ? '…' : 'выйти'}
											</button>
										) : (
											<button
												type='button'
												className='btn btn-primary h-6 px-2 text-[11px]'
												disabled={busy === a.id}
												onClick={() => startLogin(a.id)}>
												{busy === a.id ? '…' : 'войти'}
											</button>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}
