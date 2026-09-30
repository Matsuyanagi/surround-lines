import * as assert from 'assert';
import * as vscode from 'vscode';
import { validateFormats } from '../formats';

const defaultFormats = [{ name: 'comment', header: '/*', footer: '*/', indent: true }];

suite('Format validation', () => {
	test('preserves the default-shaped format', () => {
		assert.deepStrictEqual(validateFormats(defaultFormats), defaultFormats);
	});

	test('accepts an empty array', () => {
		assert.deepStrictEqual(validateFormats([]), []);
	});

	test('rejects non-array inputs', () => {
		for (const raw of [undefined, null, 'comment', {}, 1]) {
			assert.strictEqual(validateFormats(raw), undefined);
		}
	});

	test('rejects items with missing or incorrectly typed fields', () => {
		const valid = { name: 'comment', header: '/*', footer: '*/', indent: true };
		const invalidItems = [
			{ header: '/*', footer: '*/', indent: true },
			{ name: 'comment', footer: '*/', indent: true },
			{ name: 'comment', header: '/*', indent: true },
			{ name: 'comment', header: '/*', footer: '*/' },
			{ ...valid, name: 1 },
			{ ...valid, header: 1 },
			{ ...valid, footer: 1 },
			{ ...valid, indent: 'true' },
		];

		for (const item of invalidItems) {
			assert.strictEqual(validateFormats([valid, item]), undefined);
		}
		for (const item of [null, [], true, 1, 'comment']) {
			assert.strictEqual(validateFormats([item]), undefined);
		}
	});

	test('rejects empty and whitespace-only names', () => {
		for (const name of ['', ' \t\n ']) {
			assert.strictEqual(validateFormats([{ ...defaultFormats[0], name }]), undefined);
		}
	});

	test('rejects duplicate names in the entire array', () => {
		assert.strictEqual(validateFormats([defaultFormats[0], { ...defaultFormats[0] }]), undefined);
	});

	test('treats names with different casing as distinct', () => {
		const formats = [
			{ ...defaultFormats[0], name: 'Foo' },
			{ ...defaultFormats[0], name: 'foo' },
		];
		assert.deepStrictEqual(validateFormats(formats), formats);
	});

	test('preserves surrounding whitespace in a nonblank name', () => {
		const formats = [{ ...defaultFormats[0], name: ' custom ' }];
		assert.deepStrictEqual(validateFormats(formats), formats);
	});

	test('accepts empty and multiline headers and footers', () => {
		const formats = [
			{ name: 'empty', header: '', footer: '', indent: false },
			{ name: 'multiline', header: 'first\nsecond', footer: 'third\nfourth', indent: true },
		];
		assert.deepStrictEqual(validateFormats(formats), formats);
	});

	test('exposes the default format through VS Code configuration', () => {
		assert.deepStrictEqual(vscode.workspace.getConfiguration('surroundLines').get('formats'), defaultFormats);
	});
});
