import { useState } from 'react';
import type { AccountSummary } from '../api';
import { api } from '../api';

interface Props {
	accounts: AccountSummary[];
	defaultAccountId: string;
	onConnected: () => void;
}

export function ConnectGate({ accounts, defaultAccountId, onConnected: _onConnected }: Props) {
	const [busy, setBusy] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);

	const startLogin = async (id: string) => {
		setBusy(id);
		setErr(null);
		try {
			const { url } = await api.loginUrl(id);
			window.location.href = url;
		} catch (e) {
			setErr((e as Error).message);
			setBusy(null);
		}
	};

	// Single-account layout collapses to the original gate.
	const single = accounts.length === 1 ? accounts[0] : null;
	const redirectExample = `${window.location.origin}/api/auth/callback`;

	return (
		<div className='min-h-[80vh] flex items-center justify-center px-6'>
			<div className='w-full max-w-md panel'>
				<div className='p-6'>
					<div className='flex items-center justify-between mb-5'>
						<span className='label'>Требуется вход</span>
					</div>

					<h1 className='text-xl font-semibold mb-1.5 text-ink'>
						Подключиться к Allegro
					</h1>

					{single ? (
						<>
							{!single.hasCredentials && (
								<div className='text-[13px] text-warn border border-warn/30 bg-warnTint rounded-md px-3 py-2 mb-4'>
									Не задан CLIENT_ID / CLIENT_SECRET для аккаунта "{single.id}".
								</div>
							)}
							<button
								type='button'
								className='btn btn-primary w-full'
								onClick={() => startLogin(single.id)}
								disabled={!single.hasCredentials || busy !== null}>
								{busy === single.id ? 'Перенаправляю · · ·' : 'Подключиться'}
							</button>
						</>
					) : (
						<>
							<div className='text-[13px] text-ink-muted mb-3'>
								Подключите как минимум один аккаунт. Дополнительные можно подключить позже из переключателя в шапке.
							</div>
							<ul className='space-y-2'>
								{accounts.map(a => (
									<li
										key={a.id}
										className='flex items-center gap-3 border border-border rounded-md px-3 py-2'>
										<div className='flex-1 min-w-0'>
											<div className='flex items-center gap-2'>
												<span className='text-[13px] text-ink font-medium truncate'>
													{a.label}
												</span>
												{a.id === defaultAccountId && (
													<span className='chip border-ink-faint/30 bg-soft text-ink-muted text-[10px]'>
														default
													</span>
												)}
												<span
													className={
														a.env === 'production'
															? 'chip border-flame/30 bg-flame-tint text-flame text-[10px]'
															: 'chip border-warn/30 bg-warnTint text-warn text-[10px]'
													}>
													{a.env === 'production' ? 'prod' : 'sand'}
												</span>
											</div>
											<div className='text-[11px] font-mono text-ink-faint truncate'>
												{a.id}
											</div>
										</div>
										{!a.hasCredentials ? (
											<span className='text-[11px] text-warn'>нет creds</span>
										) : (
											<button
												type='button'
												className='btn btn-primary h-8 px-3 text-[12px]'
												disabled={busy !== null}
												onClick={() => startLogin(a.id)}>
												{busy === a.id ? '…' : 'войти'}
											</button>
										)}
									</li>
								))}
							</ul>
						</>
					)}

					{err && (
						<div className='mt-4 text-[13px] text-bad border border-bad/30 bg-badTint rounded-md px-3 py-2'>
							{err}
						</div>
					)}

					<div className='mt-5 pt-4 border-t border-border'>
						<div className='label mb-1.5'>Redirect URI</div>
						<code className='block font-mono text-[12px] text-ink bg-soft border border-border rounded-md px-3 py-2 break-all'>
							{redirectExample}
						</code>
					</div>
				</div>
			</div>
		</div>
	);
}
