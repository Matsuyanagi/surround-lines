import * as assert from 'assert';
import * as vscode from 'vscode';
import { planInsertions } from '../lineEdits';

const plainFormat = { name: 'plain', header: 'H', footer: 'F', indent: false };

function selection(anchorLine: number, anchorCharacter: number, activeLine = anchorLine, activeCharacter = anchorCharacter): vscode.Selection {
	return new vscode.Selection(anchorLine, anchorCharacter, activeLine, activeCharacter);
}

function applyInsertions(document: vscode.TextDocument, result: ReturnType<typeof planInsertions>): string {
	if (result.kind === 'overlap') {
		return document.getText();
	}

	let text = document.getText();
	const insertions = [...result.insertions].sort(
		(left, right) => document.offsetAt(right.position) - document.offsetAt(left.position),
	);
	for (const insertion of insertions) {
		const offset = document.offsetAt(insertion.position);
		text = text.slice(0, offset) + insertion.text + text.slice(offset);
	}
	return text;
}

async function resultText(
	source: string,
	selections: readonly vscode.Selection[],
	format = plainFormat,
): Promise<{ result: ReturnType<typeof planInsertions>; text: string; eol: string }> {
	const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: source });
	const result = planInsertions(document, selections, format);
	return {
		result,
		text: applyInsertions(document, result),
		eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
	};
}

suite('Selection normalization and insertion planning', () => {
	test('surrounds the whole line for a partial one-line selection', async () => {
		const { result, text } = await resultText('before\n  alpha tail\nafter', [selection(1, 2, 1, 7)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'before\nH\n  alpha tail\nF\nafter');
	});

	test('surrounds every line touched by a partial multi-line selection', async () => {
		const { result, text } = await resultText('before\n first\nsecond tail\nafter', [selection(1, 2, 2, 3)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'before\nH\n first\nsecond tail\nF\nafter');
	});

	test('excludes the end line when a nonempty selection ends at column zero', async () => {
		const { result, text } = await resultText('zero\none\ntwo\nthree\nfour', [selection(1, 0, 3, 0)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'zero\nH\none\ntwo\nF\nthree\nfour');
	});

	test('includes the cursor line when an empty selection is at column zero', async () => {
		const { result, text } = await resultText('zero\none\ntwo', [selection(1, 0)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'zero\nH\none\nF\ntwo');
	});

	test('normalizes reversed selections to the same touched line interval', async () => {
		const { result, text } = await resultText('zero\none\ntwo\nthree', [selection(2, 2, 1, 1)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'zero\nH\none\ntwo\nF\nthree');
	});

	test('plans multiple cursors independently', async () => {
		const { result, text } = await resultText('zero\none\ntwo\nthree', [selection(0, 0), selection(2, 0)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'H\nzero\nF\none\nH\ntwo\nF\nthree');
	});

	test('plans a cursor and a separate nonempty selection together', async () => {
		const { result, text } = await resultText('zero\none\ntwo\nthree\nfour', [selection(0, 0), selection(2, 1, 3, 2)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'H\nzero\nF\none\nH\ntwo\nthree\nF\nfour');
	});

	test('rejects overlapping line intervals without applying any insertion', async () => {
		const { result, text } = await resultText('zero\none\ntwo\nthree', [selection(0, 0, 2, 1), selection(2, 0)]);

		assert.deepStrictEqual(result, { kind: 'overlap' });
		assert.strictEqual(text, 'zero\none\ntwo\nthree');
	});

	test('allows adjacent intervals and places the previous footer before the next header', async () => {
		const { result, text } = await resultText('one\ntwo\nthree', [selection(0, 0), selection(1, 0)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'H\none\nF\nH\ntwo\nF\nthree');
		assert.strictEqual(
			result.insertions.filter((insertion) => insertion.position.line === 1 && insertion.position.character === 0).length,
			1,
		);
	});

	test('indents nonempty configured lines from the first nonblank selected source line', async () => {
		const source = ' \t\n\t  code\n\t  next\nafter   ';
		const format = { name: 'indented', header: 'head\n\n \t', footer: 'tail\n \t', indent: true };
		const { result, text } = await resultText(source, [selection(0, 0, 2, 1)], format);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, '\t  head\n\n\t   \t\n \t\n\t  code\n\t  next\n\t  tail\n\t   \t\nafter   ');
	});

	test('leaves configured lines unindented when automatic indentation is disabled', async () => {
		const format = { name: 'plain-multiline', header: 'H\nJ', footer: 'F\nG', indent: false };
		const { result, text } = await resultText('  code\nnext', [selection(0, 0, 0, 1)], format);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'H\nJ\n  code\nF\nG\nnext');
	});

	test('uses document CRLF for mixed configured line endings and preserves configured blank lines', async () => {
		const format = { name: 'mixed-eol', header: 'h1\r\n\rh2\n', footer: '\nfoot', indent: false };
		const { result, text } = await resultText('source\r\nnext', [selection(0, 0, 0, 1)], format);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'h1\r\n\r\nh2\r\n\r\nsource\r\n\r\nfoot\r\nnext');
	});

	test('places a footer at EOF without adding a trailing newline to a source without one', async () => {
		const { result, text } = await resultText('before\n  target', [selection(1, 0, 1, 6)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'before\nH\n  target\nF');
	});

	test('preserves the final empty line when the source already has a trailing newline', async () => {
		const { result, text } = await resultText('before\n  target\n', [selection(1, 0, 1, 6)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'before\nH\n  target\nF\n');
	});

	test('surrounds the empty document line with a blank line between header and footer', async () => {
		const { result, text, eol } = await resultText('', [selection(0, 0)]);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, `H${eol}${eol}F`);
	});

	test('omits an empty header or footer and returns no edits when both are empty', async () => {
		const onlyFooter = await resultText('alpha\nbeta', [selection(0, 0)], {
			name: 'footer-only', header: '', footer: 'F', indent: false,
		});
		const onlyHeader = await resultText('alpha\nbeta', [selection(0, 0)], {
			name: 'header-only', header: 'H', footer: '', indent: false,
		});
		const emptyFormat = await resultText('alpha\nbeta', [selection(0, 0)], {
			name: 'empty', header: '', footer: '', indent: false,
		});

		assert.strictEqual(onlyFooter.text, 'alpha\nF\nbeta');
		assert.strictEqual(onlyHeader.text, 'H\nalpha\nbeta');
		assert.deepStrictEqual(emptyFormat.result, { kind: 'ok', insertions: [] });
		assert.strictEqual(emptyFormat.text, 'alpha\nbeta');
	});

	test('uses no indentation when every selected source line contains only spaces and tabs', async () => {
		const format = { name: 'blank-source', header: 'H', footer: 'F', indent: true };
		const { result, text } = await resultText(' \t\n   ', [selection(0, 0, 1, 3)], format);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, 'H\n \t\n   \nF');
	});

	test('preserves trailing spaces in source lines around inserted text', async () => {
		const format = { name: 'spaces', header: 'H', footer: 'F', indent: true };
		const { result, text } = await resultText('  source  \nnext   ', [selection(0, 0)], format);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(text, '  H\n  source  \n  F\nnext   ');
	});
});
