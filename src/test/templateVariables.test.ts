import * as assert from 'assert';
import { expandDateVariables, type DateVariableContext } from '../templateVariables';

suite('Date template variables', () => {
	test('expands all seven date variables from the supplied local date', () => {
		const context: DateVariableContext = {
			now: new Date(2026, 9, 1, 3, 4, 5),
			displayLanguage: 'en',
		};
		const cases: readonly (readonly [string, string])[] = [
			['$CURRENT_YEAR', '2026'],
			['$CURRENT_MONTH', '10'],
			['$CURRENT_DATE', '01'],
			['$CURRENT_DAY_NAME_SHORT', 'Thu'],
			['$CURRENT_HOUR', '03'],
			['$CURRENT_MINUTE', '04'],
			['$CURRENT_SECOND', '05'],
		];

		for (const [input, expected] of cases) {
			assert.strictEqual(expandDateVariables(input, context), expected, input);
		}
	});

	test('localizes the short weekday using the supplied display language', () => {
		const now = new Date(2026, 9, 1, 3, 4, 5);
		assert.strictEqual(
			expandDateVariables('$CURRENT_DAY_NAME_SHORT', { now, displayLanguage: 'ja' }),
			'木',
		);
		assert.strictEqual(
			expandDateVariables('$CURRENT_DAY_NAME_SHORT', { now, displayLanguage: 'en' }),
			'Thu',
		);
	});

	test('formats local date fields across the year boundary', () => {
		const pattern = '$CURRENT_YEAR$CURRENT_MONTH$CURRENT_DATE$CURRENT_HOUR$CURRENT_MINUTE$CURRENT_SECOND';
		const beforeMidnight: DateVariableContext = {
			now: new Date(2026, 11, 31, 23, 59, 59),
			displayLanguage: 'en',
		};
		const afterMidnight: DateVariableContext = {
			now: new Date(2027, 0, 1, 0, 0, 0),
			displayLanguage: 'en',
		};

		assert.strictEqual(expandDateVariables(pattern, beforeMidnight), '20261231235959');
		assert.strictEqual(expandDateVariables(pattern, afterMidnight), '20270101000000');
	});

	test('recognizes only complete date variable names and consumes dollar escapes once', () => {
		const context: DateVariableContext = {
			now: new Date(2026, 9, 1, 3, 4, 5),
			displayLanguage: 'en',
		};
		const cases: readonly (readonly [string, string])[] = [
			['[$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE]', '[2026-10-01]'],
			['$CURRENT_DAY_NAME_SHORT $CURRENT_HOUR:$CURRENT_MINUTE:$CURRENT_SECOND', 'Thu 03:04:05'],
			['$$CURRENT_YEAR', '$CURRENT_YEAR'],
			['$$CURRENT_UNKNOWN', '$CURRENT_UNKNOWN'],
			['$CURRENT_UNKNOWN', '$CURRENT_UNKNOWN'],
			['$CURRENT_YEAR_SUFFIX / $CURRENT_YEAR2', '$CURRENT_YEAR_SUFFIX / $CURRENT_YEAR2'],
			['$CURRENT_YEAR年', '2026年'],
			['$CURRENT_YEAR$CURRENT_MONTH', '202610'],
			['$$$CURRENT_YEAR', '$2026'],
			['$$$$CURRENT_YEAR', '$$CURRENT_YEAR'],
			['$ / $1 / $current_year / ${CURRENT_YEAR}', '$ / $1 / $current_year / ${CURRENT_YEAR}'],
		];

		for (const [input, expected] of cases) {
			assert.strictEqual(expandDateVariables(input, context), expected, input);
		}
	});

	test('preserves unknown names that match prototype properties', () => {
		const context: DateVariableContext = {
			now: new Date(2026, 9, 1, 3, 4, 5),
			displayLanguage: 'en',
		};
		const cases: readonly (readonly [string, string])[] = [
			['$constructor', '$constructor'],
			['$toString', '$toString'],
			['$__proto__', '$__proto__'],
		];

		for (const [input, expected] of cases) {
			assert.strictEqual(expandDateVariables(input, context), expected, input);
		}
	});

	test('preserves empty text, line endings, and backslashes', () => {
		const context: DateVariableContext = {
			now: new Date(2026, 9, 1, 3, 4, 5),
			displayLanguage: 'en',
		};

		assert.strictEqual(expandDateVariables('', context), '');
		assert.strictEqual(expandDateVariables('\n$CURRENT_YEAR\r\n', context), '\n2026\r\n');
		assert.strictEqual(expandDateVariables('\\$CURRENT_YEAR', context), '\\2026');
	});

	test('uses English weekday names when the display language is unsupported or invalid', () => {
		const now = new Date(2026, 9, 1, 3, 4, 5);
		for (const displayLanguage of ['zz', 'invalid_locale']) {
			assert.strictEqual(
				expandDateVariables('$CURRENT_DAY_NAME_SHORT', { now, displayLanguage }),
				'Thu',
				displayLanguage,
			);
		}
	});
});
