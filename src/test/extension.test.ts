import * as assert from 'assert';
import * as vscode from 'vscode';

type Picker = (names: readonly string[]) => Promise<string | undefined>;
type Warning = (message: string) => Promise<unknown> | unknown;

interface ExtensionExports {
	runSurroundLines?: (
		editor: vscode.TextEditor,
		rawFormats: unknown,
		args: unknown,
		pick: Picker,
		warn?: Warning,
	) => Promise<void>;
}

const simpleFormat = { name: 'simple', header: 'BEGIN', footer: 'END', indent: false };

async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'surround-lines');
	assert.ok(extension, 'the surround-lines extension should be available to the test host');
	if (!extension.isActive) {
		await extension.activate();
	}
}

async function getRunSurroundLines(): Promise<NonNullable<ExtensionExports['runSurroundLines']>> {
	await activateExtension();
	const extension = require('../extension') as ExtensionExports;
	assert.ok(
		extension && typeof extension.runSurroundLines === 'function',
		'the extension should export its testable command workflow',
	);
	return extension.runSurroundLines!;
}

async function withDocument(
	content: string,
	action: (editor: vscode.TextEditor, document: vscode.TextDocument) => Promise<void>,
): Promise<void> {
	const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
	const editor = await vscode.window.showTextDocument(document);
	try {
		await action(editor, document);
	} finally {
		if (vscode.window.activeTextEditor !== editor) {
			await vscode.window.showTextDocument(document);
		}
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	}
}

suite('Surround Lines command workflow', () => {
	test('uses an exact directly selected format without opening Quick Pick', async () => {
		const run = await getRunSurroundLines();
		await withDocument('first\nsecond\nthird', async (editor, document) => {
			editor.selection = new vscode.Selection(1, 0, 1, 0);
			let pickerCalls = 0;
			const warnings: string[] = [];

			await run(
				editor,
				[simpleFormat, { ...simpleFormat, name: 'Simple', header: 'wrong' }],
				{ name: 'simple' },
				async () => {
					pickerCalls += 1;
					return 'Simple';
				},
				async (message) => warnings.push(message),
			);

			assert.strictEqual(document.getText(), 'first\nBEGIN\nsecond\nEND\nthird');
			assert.strictEqual(pickerCalls, 0);
			assert.deepStrictEqual(warnings, []);
		});
	});

	test('shows Quick Pick names in configuration order and applies the chosen format', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			const formats = [
				{ name: 'first', header: '<', footer: '>', indent: false },
				{ name: 'second', header: '[', footer: ']', indent: false },
			];
			let pickedNames: readonly string[] | undefined;
			const warnings: string[] = [];

			await run(
				editor,
				formats,
				undefined,
				async (names) => {
					pickedNames = names;
					return 'second';
				},
				async (message) => warnings.push(message),
			);

			assert.deepStrictEqual(pickedNames, ['first', 'second']);
			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			assert.strictEqual(document.getText(), ['[', 'target', ']'].join(eol));
			assert.deepStrictEqual(warnings, []);
		});
	});

	test('cancelling Quick Pick leaves the document unchanged and silent', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			const warnings: string[] = [];
			await run(
				editor,
				[simpleFormat],
				undefined,
				async () => undefined,
				async (message) => warnings.push(message),
			);
			assert.strictEqual(document.getText(), 'target');
			assert.deepStrictEqual(warnings, []);
		});
	});

	test('rejects an invalid formats setting before showing Quick Pick', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			let pickerCalls = 0;
			const warnings: string[] = [];
			await run(
				editor,
				[simpleFormat, { ...simpleFormat, name: 'simple' }],
				undefined,
				async () => {
					pickerCalls += 1;
					return 'simple';
				},
				async (message) => warnings.push(message),
			);
			assert.strictEqual(document.getText(), 'target');
			assert.strictEqual(pickerCalls, 0);
			assert.deepStrictEqual(warnings, ['Surround Lines: invalid format configuration.']);
		});
	});

	test('reports an empty formats setting without opening Quick Pick', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			let pickerCalls = 0;
			const warnings: string[] = [];
			await run(
				editor,
				[],
				undefined,
				async () => {
					pickerCalls += 1;
					return undefined;
				},
				async (message) => warnings.push(message),
			);
			assert.strictEqual(document.getText(), 'target');
			assert.strictEqual(pickerCalls, 0);
			assert.deepStrictEqual(warnings, ['Surround Lines: no formats are configured.']);
		});
	});

	test('rejects malformed explicit arguments without editing', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			const warnings: string[] = [];
			const throwingName = Object.defineProperty({}, 'name', {
				get: () => {
					throw new Error('invalid name accessor');
				},
			});
			for (const args of [null, {}, { name: '' }, { name: '   ' }, 'simple', throwingName]) {
				await run(
					editor,
					[simpleFormat],
					args,
					async () => 'simple',
					async (message) => warnings.push(message),
				);
			}
			assert.strictEqual(document.getText(), 'target');
			assert.strictEqual(warnings.length, 6);
			assert.ok(warnings.every((message) => message === 'Surround Lines: argument must be an object with a non-empty name.'));
		});
	});

	test('warns when an explicit format name is unknown', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			const warnings: string[] = [];
			await run(
				editor,
				[simpleFormat],
				{ name: 'missing' },
				async () => undefined,
				async (message) => warnings.push(message),
			);
			assert.strictEqual(document.getText(), 'target');
			assert.deepStrictEqual(warnings, ['Surround Lines: unknown format "missing".']);
		});
	});

	test('warns about overlapping line selections and applies no insertions', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target\nnext', async (editor, document) => {
			editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(0, 2, 0, 2)];
			const warnings: string[] = [];
			await run(
				editor,
				[simpleFormat],
				{ name: 'simple' },
				async () => undefined,
				async (message) => warnings.push(message),
			);
			assert.strictEqual(document.getText(), 'target\nnext');
			assert.deepStrictEqual(warnings, ['Surround Lines: selections overlap.']);
		});
	});

	test('uses the selections captured before Quick Pick opens', async () => {
		const run = await getRunSurroundLines();
		await withDocument('first\nsecond', async (editor, document) => {
			editor.selection = new vscode.Selection(0, 0, 0, 0);
			await run(
				editor,
				[simpleFormat],
				undefined,
				async () => {
					editor.selection = new vscode.Selection(1, 0, 1, 0);
					return 'simple';
				},
			);
			assert.strictEqual(document.getText(), 'BEGIN\nfirst\nEND\nsecond');
		});
	});

	test('cancels Quick Pick results if the document changes while it is open', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			const warnings: string[] = [];
			await run(
				editor,
				[simpleFormat],
				undefined,
				async () => {
					await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), 'changed '));
					return 'simple';
				},
				async (message) => warnings.push(message),
			);
			assert.strictEqual(document.getText(), 'changed target');
			assert.deepStrictEqual(warnings, []);
		});
	});

	test('registers the command, uses the contributed comment default, and undoes a multi-selection edit once', async () => {
		await activateExtension();
		await withDocument('first\nmiddle\nlast', async (editor, document) => {
			const formats = vscode.workspace.getConfiguration('surroundLines', document.uri).get<unknown>('formats');
			assert.ok(Array.isArray(formats));
			assert.strictEqual((formats[0] as { name?: unknown }).name, 'comment');
			editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(2, 0, 2, 0)];

			await vscode.commands.executeCommand('extension.surroundLines', { name: 'comment' });
			assert.strictEqual(document.getText(), '/*\nfirst\n*/\nmiddle\n/*\nlast\n*/');

			await vscode.commands.executeCommand('undo');
			assert.strictEqual(document.getText(), 'first\nmiddle\nlast');
		});
	});
});
