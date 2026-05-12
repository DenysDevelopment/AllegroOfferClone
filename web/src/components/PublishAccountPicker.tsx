import type { AccountSummary } from '../api';

interface Props {
	accounts: AccountSummary[];
	value: string;
	onChange: (id: string) => void;
}

/**
 * Inline dropdown rendered above the publish/clone button so the user can
 * override the publishing target without leaving the form. Disabled accounts
 * (no creds / not connected) are present but greyed out — they still need
 * to be authorised via the header switcher first.
 */
export function PublishAccountPicker({ accounts, value, onChange }: Props) {
	if (accounts.length <= 1) return null;
	const selected = accounts.find(a => a.id === value);
	const usable = (a: AccountSummary) => a.hasCredentials && a.connected;

	return (
		<div className='flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-soft/40 text-[12px]'>
			<span className='label'>Опубликовать в</span>
			<select
				className='flex-1 bg-transparent text-ink outline-none cursor-pointer'
				value={value}
				onChange={e => onChange(e.target.value)}>
				{accounts.map(a => (
					<option key={a.id} value={a.id} disabled={!usable(a)}>
						{a.label}
						{!a.hasCredentials
							? ' — нет creds'
							: !a.connected
								? ' — не подключён'
								: ''}
					</option>
				))}
			</select>
			{selected && (
				<span
					className={
						selected.env === 'production'
							? 'chip border-flame/30 bg-flame-tint text-flame text-[10px]'
							: 'chip border-warn/30 bg-warnTint text-warn text-[10px]'
					}>
					{selected.env === 'production' ? 'prod' : 'sand'}
				</span>
			)}
		</div>
	);
}
