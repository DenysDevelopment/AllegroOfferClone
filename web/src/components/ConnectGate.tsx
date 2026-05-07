import { useState } from 'react';
import type { AuthStatus } from '../api';
import { api } from '../api';

interface Props {
	status: AuthStatus;
	onConnected: () => void;
}

export function ConnectGate({ status, onConnected: _onConnected }: Props) {
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const startLogin = async () => {
		setBusy(true);
		setErr(null);
		try {
			const { url } = await api.loginUrl();
			window.location.href = url;
		} catch (e) {
			setErr((e as Error).message);
			setBusy(false);
		}
	};

	return (
		<div className='min-h-[80vh] flex items-center justify-center px-6'>
			<div className='w-full max-w-md panel'>
				<div className='p-6'>
					<div className='flex items-center justify-between mb-5'>
						<span className='label'>Требуется вход</span>
						<span
							className={
								status.env === 'production'
									? 'chip border-flame/30 bg-flame-tint text-flame'
									: 'chip border-warn/30 bg-warnTint text-warn'
							}></span>
					</div>

					<h1 className='text-xl font-semibold mb-1.5 text-ink'>
						Подключиться к Allegro
					</h1>

					{!status.hasCredentials ? (
						<div className='text-[13px] text-warn border border-warn/30 bg-warnTint rounded-md px-3 py-2 mb-4'>
							Не задан CLIENT_ID / CLIENT_SECRET для env={status.env}.
						</div>
					) : null}

					<button
						type='button'
						className='btn btn-primary w-full'
						onClick={startLogin}
						disabled={!status.hasCredentials || busy}>
						{busy ? 'Перенаправляю · · ·' : 'Подключиться'}
					</button>

					{err && (
						<div className='mt-4 text-[13px] text-bad border border-bad/30 bg-badTint rounded-md px-3 py-2'>
							{err}
						</div>
					)}

					<div className='mt-5 pt-4 border-t border-border'>
						<div className='label mb-1.5'>Redirect URI</div>
						<code className='block font-mono text-[12px] text-ink bg-soft border border-border rounded-md px-3 py-2 break-all'>
							{status.redirectUri}
						</code>
					</div>
				</div>
			</div>
		</div>
	);
}
