import { useCallback, useRef, useState } from 'react';
import CrmGalleryPicker from '../components/CrmGalleryPicker';

/**
 * Owns the CRM picker modal. `openPicker(initialSearch)` opens it and resolves
 * with the selected photo URLs (empty array on cancel). Render `element` once.
 */
export function useCrmPicker() {
	const [open, setOpen] = useState(false);
	const [initialSearch, setInitialSearch] = useState('');
	const resolver = useRef<((urls: string[]) => void) | null>(null);

	const openPicker = useCallback(
		(search?: string) =>
			new Promise<string[]>(resolve => {
				resolver.current = resolve;
				setInitialSearch(search ?? '');
				setOpen(true);
			}),
		[],
	);

	const finish = useCallback((urls: string[]) => {
		setOpen(false);
		resolver.current?.(urls);
		resolver.current = null;
	}, []);

	const element = (
		<CrmGalleryPicker
			open={open}
			initialSearch={initialSearch}
			onConfirm={finish}
			onCancel={() => finish([])}
		/>
	);

	return { openPicker, element };
}
