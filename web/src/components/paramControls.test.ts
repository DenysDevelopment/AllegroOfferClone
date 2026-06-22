import { describe, expect, it } from 'vitest';
import type { CategoryParameter } from '../api';
import {
	allowsCustomValue,
	controlKind,
	diffOverrides,
	seedParamValues,
} from './paramControls';

const dict = (over: Partial<CategoryParameter> = {}): CategoryParameter => ({
	id: 'P',
	name: 'Złącza',
	type: 'dictionary',
	dictionary: [{ id: '1', value: 'USB' }, { id: '2', value: 'HDMI' }],
	...over,
});

describe('controlKind', () => {
	it('single-choice dictionary → dict-single', () => {
		expect(controlKind(dict({ restrictions: { multipleChoices: false } }))).toBe('dict-single');
	});
	it('multi-choice dictionary → dict-multi', () => {
		expect(controlKind(dict({ restrictions: { multipleChoices: true } }))).toBe('dict-multi');
	});
	it('integer without range → number', () => {
		expect(controlKind({ id: 'I', name: 'RAM', type: 'integer' })).toBe('number');
	});
	it('float with range → range', () => {
		expect(controlKind({ id: 'F', name: 'Waga', type: 'float', restrictions: { range: true } })).toBe('range');
	});
	it('string → text', () => {
		expect(controlKind({ id: 'S', name: 'Kod', type: 'string' })).toBe('text');
	});
});

describe('allowsCustomValue', () => {
	it('true only when customValuesEnabled AND an ambiguousValueId exists', () => {
		expect(allowsCustomValue(dict({ options: { customValuesEnabled: true, ambiguousValueId: '9' } }))).toBe(true);
		expect(allowsCustomValue(dict({ options: { customValuesEnabled: true } }))).toBe(false);
		expect(allowsCustomValue(dict({ options: { customValuesEnabled: false, ambiguousValueId: '9' } }))).toBe(false);
	});
});

describe('seedParamValues', () => {
	it('seeds dictionary labels and numeric values by parameter name', () => {
		const cats: CategoryParameter[] = [
			dict(),
			{ id: 'P_RAM', name: 'Pamięć RAM', type: 'integer', unit: 'GB' },
		];
		const seed = seedParamValues(cats, [
			{ id: 'P', valuesLabels: ['USB'], values: null },
			{ id: 'P_RAM', values: ['16'] },
		]);
		expect(seed['Złącza']).toEqual(['USB']);
		expect(seed['Pamięć RAM']).toEqual(['16']);
	});
});

describe('diffOverrides', () => {
	const seed = { 'Złącza': ['USB'], 'Pamięć RAM': ['16'] };
	it('emits only changed params', () => {
		expect(diffOverrides({ 'Złącza': ['USB'], 'Pamięć RAM': ['32'] }, seed)).toEqual({ 'Pamięć RAM': ['32'] });
	});
	it('treats reordered multi-values as unchanged', () => {
		expect(diffOverrides({ 'Złącza': ['USB', 'HDMI'] }, { 'Złącza': ['HDMI', 'USB'] })).toEqual({});
	});
	it('ignores an emptied value (not an override)', () => {
		expect(diffOverrides({ 'Pamięć RAM': ['  '] }, seed)).toEqual({});
	});
});
