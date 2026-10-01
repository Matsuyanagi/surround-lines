import * as assert from 'assert';
import * as vscode from 'vscode';
import { getFormatsForLanguage, validateFormats } from '../formats';

interface JsonSchema {
	type?: string;
	required?: string[];
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema;
	minLength?: number;
	minItems?: number;
	pattern?: string;
	enum?: unknown[];
	uniqueItems?: boolean;
}

const extensionPackageJson = require('../../package.json') as {
	contributes: {
		configuration: {
			properties: Record<string, JsonSchema & { default?: unknown }>;
		};
	};
};

function satisfiesContributedSchema(value: unknown, schema: JsonSchema): boolean {
	if (schema.type === 'array') {
		return (
			Array.isArray(value) &&
			(schema.minItems === undefined || value.length >= schema.minItems) &&
			(schema.uniqueItems !== true || new Set(value).size === value.length) &&
			(schema.items === undefined || value.every(item => satisfiesContributedSchema(item, schema.items!)))
		);
	}

	if (schema.type === 'object') {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return false;
		}
		const object = value as Record<string, unknown>;
		if (schema.required?.some(name => !Object.prototype.hasOwnProperty.call(object, name))) {
			return false;
		}
		return Object.entries(schema.properties ?? {}).every(([name, propertySchema]) => {
			return !Object.prototype.hasOwnProperty.call(object, name) || satisfiesContributedSchema(object[name], propertySchema);
		});
	}

	if (schema.type === 'string') {
		return (
			typeof value === 'string' &&
			(schema.enum === undefined || schema.enum.includes(value)) &&
			(schema.minLength === undefined || value.length >= schema.minLength) &&
			(schema.pattern === undefined || new RegExp(schema.pattern).test(value))
		);
	}

	if (schema.type === 'boolean') {
		return typeof value === 'boolean';
	}

	return true;
}

const defaultFormats = [{ name: 'comment', header: '/*', footer: '*/', indent: true }];

interface TestFormat {
	name: string;
	header: string;
	footer: string;
	indent: boolean;
	languageId?: string[];
}

function namesForLanguage(formats: readonly TestFormat[], languageId: string): string[] {
	return getFormatsForLanguage(formats, languageId).map(format => format.name);
}

suite('Format validation', () => {
	test('preserves the default-shaped format', () => {
		assert.deepStrictEqual(validateFormats(defaultFormats), defaultFormats);
	});

	test('accepts optional language ID arrays', () => {
		const formats = [
			{ name: 'omitted', header: '/*', footer: '*/', indent: true },
			{ name: 'empty', header: '/*', footer: '*/', indent: true, languageId: [] },
			{ name: 'common', header: '/*', footer: '*/', indent: true, languageId: ['c', 'cpp', 'csharp'] },
			{ name: 'duplicate', header: '/*', footer: '*/', indent: true, languageId: ['cpp', 'cpp'] },
			{ name: 'custom', header: '/*', footer: '*/', indent: true, languageId: ['custom-language'] },
		];

		assert.deepStrictEqual(validateFormats(formats), formats);
	});

	test('rejects malformed language settings as a whole', () => {
		const valid = { name: 'valid', header: '/*', footer: '*/', indent: true };
		const malformedLanguageIds: unknown[] = [null, 'cpp', {}, [1], ['cpp', null], [''], [' \t']];

		for (const [index, languageId] of malformedLanguageIds.entries()) {
			const invalid = { name: `invalid-${index}`, header: '/*', footer: '*/', indent: true, languageId };
			assert.strictEqual(validateFormats([valid, invalid]), undefined);
		}
	});

	test('filters formats by exact language ID in configuration order', () => {
		const formats = [
			{ name: 'global', header: '/*', footer: '*/', indent: true },
			{ name: 'c-only', header: '/*', footer: '*/', indent: true, languageId: ['c', 'cpp'] },
			{ name: 'hidden', header: '/*', footer: '*/', indent: true, languageId: [] },
			{ name: 'cpp-only', header: '/*', footer: '*/', indent: true, languageId: ['cpp'] },
		];

		assert.deepStrictEqual(namesForLanguage(formats, 'cpp'), ['global', 'c-only', 'cpp-only']);
		assert.deepStrictEqual(namesForLanguage(formats, 'plaintext'), ['global']);
		assert.deepStrictEqual(namesForLanguage(formats, 'CPP'), ['global']);
	});

	test('matches custom IDs without normalizing them', () => {
		const formats = [
			{ name: 'custom', header: '/*', footer: '*/', indent: true, languageId: ['custom-language'] },
			{ name: 'spaced', header: '/*', footer: '*/', indent: true, languageId: [' cpp '] },
			{ name: 'wildcard', header: '/*', footer: '*/', indent: true, languageId: ['*'] },
		];

		assert.deepStrictEqual(namesForLanguage(formats, 'custom-language'), ['custom']);
		assert.deepStrictEqual(namesForLanguage(formats, 'cpp'), []);
	});

	test('keeps format names globally unique', () => {
		const formats = [
			{ name: 'same', header: '/*', footer: '*/', indent: true, languageId: ['cpp'] },
			{ name: 'same', header: '//', footer: '', indent: false, languageId: ['c'] },
		];

		assert.strictEqual(validateFormats(formats), undefined);
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

	test('declares optional language IDs in the contributed setting schema', () => {
		assert.deepStrictEqual(vscode.workspace.getConfiguration('surroundLines').get('formats'), defaultFormats);

		const setting = extensionPackageJson.contributes.configuration.properties['surroundLines.formats'];
		assert.strictEqual(setting.type, 'array');
		assert.deepStrictEqual(setting.default, defaultFormats);
		assert.ok(setting.items);
		assert.strictEqual(setting.items.type, 'object');
		assert.deepStrictEqual(setting.items.required, ['name', 'header', 'footer', 'indent']);

		const languageIdSchema = setting.items.properties?.languageId;
		assert.ok(languageIdSchema);
		assert.strictEqual(languageIdSchema.type, 'array');
		assert.ok(languageIdSchema.items);
		assert.strictEqual(languageIdSchema.items.type, 'string');
		assert.strictEqual(languageIdSchema.items.minLength, 1);
		assert.strictEqual(languageIdSchema.items.pattern, '\\S');
		assert.strictEqual(languageIdSchema.minItems, undefined);
		assert.strictEqual(languageIdSchema.enum, undefined);
		assert.strictEqual(languageIdSchema.items.enum, undefined);
		assert.strictEqual(languageIdSchema.uniqueItems, undefined);

		const formatSchema = setting.items;
		const schemaAccepted = [
			{ name: 'omitted', header: '/*', footer: '*/', indent: true },
			{ name: 'empty', header: '/*', footer: '*/', indent: true, languageId: [] },
			{ name: 'duplicates', header: '/*', footer: '*/', indent: true, languageId: ['cpp', 'cpp'] },
			{ name: 'custom', header: '/*', footer: '*/', indent: true, languageId: ['custom-language', ' cpp '] },
		];
		for (const format of schemaAccepted) {
			assert.strictEqual(satisfiesContributedSchema(format, formatSchema), true);
		}

		const schemaRejectedLanguageIds: unknown[] = [null, 'cpp', {}, [1], ['cpp', null], [''], [' \t']];
		for (const [index, languageId] of schemaRejectedLanguageIds.entries()) {
			const format = { name: `invalid-${index}`, header: '/*', footer: '*/', indent: true, languageId };
			assert.strictEqual(satisfiesContributedSchema(format, formatSchema), false);
		}
	});
});
