import * as assert from 'assert';
import * as vscode from 'vscode';
import type { DateVariableContext } from '../templateVariables';

type Picker = (names: readonly string[]) => Promise<string | undefined>;
type Warning = (message: string) => Promise<unknown> | unknown;

interface ExtensionExports {
	runSurroundLines?: (
		editor: vscode.TextEditor,
		rawFormats: unknown,
		args: unknown,
		pick: Picker,
		warn?: Warning,
		getDateContext?: () => DateVariableContext,
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
	languageId = 'plaintext',
): Promise<void> {
	const document = await vscode.workspace.openTextDocument({ language: languageId, content });
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

	test('filters picker candidates for the current document language', async () => {
		const run = await getRunSurroundLines();
		const formats = [
			{ name: 'default', header: 'D', footer: 'd', indent: false, languageId: ['cpp'] },
			{ name: 'date', header: 'T', footer: 't', indent: false },
		];

		for (const [languageId, expectedNames, expectedText] of [
			['cpp', ['default', 'date'], 'D\ntarget\nd'],
			['plaintext', ['date'], 'T\ntarget\nt'],
		] as const) {
			await withDocument('target', async (editor, document) => {
				let pickerCalls = 0;
				const warnings: string[] = [];

				await run(
					editor,
					formats,
					undefined,
					async (names) => {
						pickerCalls += 1;
						assert.deepStrictEqual(names, expectedNames);
						return expectedNames[0];
					},
					async (message) => warnings.push(message),
				);

				const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
				assert.strictEqual(document.getText(), expectedText.replaceAll('\n', eol));
				assert.strictEqual(pickerCalls, 1);
				assert.deepStrictEqual(warnings, []);
			}, languageId);
		}
	});

	test('reports no matching formats without opening the picker', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			let pickerCalls = 0;
			let dateContextCalls = 0;
			const initialVersion = document.version;
			const warnings: string[] = [];

			await run(
				editor,
				[{ ...simpleFormat, languageId: ['cpp'] }],
				undefined,
				async () => {
					pickerCalls += 1;
					return 'simple';
				},
				async (message) => warnings.push(message),
				() => {
					dateContextCalls += 1;
					return { now: new Date(2026, 9, 1), displayLanguage: 'en' };
				},
			);

			assert.strictEqual(document.getText(), 'target');
			assert.strictEqual(document.version, initialVersion);
			assert.strictEqual(pickerCalls, 0);
			assert.strictEqual(dateContextCalls, 0);
			assert.deepStrictEqual(warnings, ['Surround Lines: no formats are available for language "plaintext".']);
		});
	});

	test('ignores language scope for an explicitly named format', async () => {
		const run = await getRunSurroundLines();
		await withDocument('first\nsecond', async (editor, document) => {
			editor.selection = new vscode.Selection(0, 0, 0, 0);
			let pickerCalls = 0;
			const warnings: string[] = [];
			const formats = [
				{ name: 'cpp-only', header: 'CPP', footer: 'END', indent: false, languageId: ['cpp'] },
				{ name: 'empty-scope', header: 'EMPTY', footer: 'END', indent: false, languageId: [] },
			];
			await run(
				editor,
				formats,
				{ name: 'cpp-only' },
				async () => {
					pickerCalls += 1;
					return undefined;
				},
				async (message) => warnings.push(message),
			);
			editor.selection = new vscode.Selection(3, 0, 3, 0);
			await run(
				editor,
				formats,
				{ name: 'empty-scope' },
				async () => {
					pickerCalls += 1;
					return undefined;
				},
				async (message) => warnings.push(message),
			);
			assert.strictEqual(document.getText(), 'CPP\nfirst\nEND\nEMPTY\nsecond\nEND');
			assert.strictEqual(pickerCalls, 0);
			assert.deepStrictEqual(warnings, []);
		});
	});

	test('rejects invalid language settings before filtering', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			let pickerCalls = 0;
			const warnings: string[] = [];
			await run(
				editor,
				[
					{ ...simpleFormat, name: 'hidden-invalid', languageId: 'cpp' as unknown as string[] },
				{ ...simpleFormat, name: 'visible' },
				],
				undefined,
				async () => {
					pickerCalls += 1;
					return 'visible';
				},
				async (message) => warnings.push(message),
			);
			assert.strictEqual(document.getText(), 'target');
			assert.strictEqual(pickerCalls, 0);
			assert.deepStrictEqual(warnings, ['Surround Lines: invalid format configuration.']);
		});
	});

	test('cancels picker results after a language change', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			const warnings: string[] = [];
			await run(
				editor,
				[simpleFormat],
				undefined,
				async () => {
					await vscode.languages.setTextDocumentLanguage(document, 'cpp');
					return 'simple';
				},
				async (message) => warnings.push(message),
			);
			assert.strictEqual(document.getText(), 'target');
			assert.deepStrictEqual(warnings, []);
		});
	});

	test('cancelling Quick Pick leaves the document unchanged and silent', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			const warnings: string[] = [];
			let dateContextCalls = 0;
			await run(
				editor,
				[simpleFormat],
				undefined,
				async () => undefined,
				async (message) => warnings.push(message),
				() => {
					dateContextCalls += 1;
					return { now: new Date(2026, 9, 1), displayLanguage: 'en' };
				},
			);
			assert.strictEqual(document.getText(), 'target');
			assert.strictEqual(dateContextCalls, 0);
			assert.deepStrictEqual(warnings, []);
		});
	});

	test('rejects an invalid formats setting before showing Quick Pick', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			let pickerCalls = 0;
			let dateContextCalls = 0;
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
				() => {
					dateContextCalls += 1;
					return { now: new Date(2026, 9, 1), displayLanguage: 'en' };
				},
			);
			assert.strictEqual(document.getText(), 'target');
			assert.strictEqual(pickerCalls, 0);
			assert.strictEqual(dateContextCalls, 0);
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

	test('captures one date context after Quick Pick resolves', async () => {
		const run = await getRunSurroundLines();
		await withDocument('target', async (editor, document) => {
			let now = new Date(2026, 11, 31, 23, 59, 58);
			let pickerCompleted = false;
			let dateContextCalls = 0;
			await run(
				editor,
				[
					{
						name: 'date',
						header: '$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE $CURRENT_HOUR:$CURRENT_MINUTE:$CURRENT_SECOND',
						footer: '$CURRENT_YEAR',
						indent: false,
					},
				],
				undefined,
				async (names) => {
					assert.deepStrictEqual(names, ['date']);
					pickerCompleted = true;
					now = new Date(2027, 0, 1, 0, 0, 1);
					return 'date';
				},
				undefined,
				() => {
					assert.strictEqual(pickerCompleted, true);
					dateContextCalls += 1;
					return { now, displayLanguage: 'en' };
				},
			);

			const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			assert.strictEqual(document.getText(), ['2027-01-01 00:00:01', 'target', '2027'].join(eol));
			assert.strictEqual(dateContextCalls, 1);
		});
	});

	test('shares one date context across multi-selection insertions and one Undo', async () => {
		const run = await getRunSurroundLines();
		await withDocument('first\nmiddle\nlast', async (editor, document) => {
			const format = {
				name: 'date',
				header: '[$CURRENT_YEAR]',
				footer: '[$CURRENT_MONTH/$CURRENT_DATE]',
				indent: false,
			};
			const original = document.getText();
			editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(2, 0, 2, 0)];
			let pickerCalls = 0;
			let dateContextCalls = 0;
			await run(
				editor,
				[format],
				{ name: 'date' },
				async () => {
					pickerCalls += 1;
					return 'date';
				},
				undefined,
				() => {
					dateContextCalls += 1;
					return { now: new Date(2026, 9, 1, 3, 4, 5), displayLanguage: 'en' };
				},
			);
			assert.strictEqual(document.getText(), '[2026]\nfirst\n[10/01]\nmiddle\n[2026]\nlast\n[10/01]');
			assert.strictEqual(dateContextCalls, 1);
			assert.strictEqual(pickerCalls, 0);

			await vscode.commands.executeCommand('undo');
			assert.strictEqual(document.getText(), original);
		});
	});

	test('expands templates in multiline headers while preserving CRLF and source text', async () => {
		const run = await getRunSurroundLines();
		const source = '$CURRENT_YEAR\r\n  target\r\nend';
		await withDocument(source, async (editor, document) => {
			assert.strictEqual(document.eol, vscode.EndOfLine.CRLF);
			editor.selection = new vscode.Selection(1, 0, 1, 0);
			const format = {
				name: 'template',
				header: 'title:\n\n$CURRENT_YEAR $CURRENT_DAY_NAME_SHORT',
				footer: '',
				indent: true,
			};
			const originalHeader = format.header;
			const originalFooter = format.footer;
			let dateContextCalls = 0;
			const firstContext: DateVariableContext = {
				now: new Date(2026, 9, 1, 3, 4, 5),
				displayLanguage: 'en',
			};
			await run(
				editor,
				[format],
				{ name: 'template' },
				async () => undefined,
				undefined,
				() => {
					dateContextCalls += 1;
					return firstContext;
				},
			);
			assert.strictEqual(
				document.getText(),
				'$CURRENT_YEAR\r\n  title:\r\n\r\n  2026 Thu\r\n  target\r\nend',
			);
			assert.strictEqual(dateContextCalls, 1);
			assert.strictEqual(format.header, originalHeader);
			assert.strictEqual(format.footer, originalFooter);

			await vscode.commands.executeCommand('undo');
			assert.strictEqual(document.getText(), source);
			dateContextCalls = 0;
			const secondContext: DateVariableContext = {
				now: new Date(2027, 0, 2, 3, 4, 5),
				displayLanguage: 'en',
			};
			await run(
				editor,
				[format],
				{ name: 'template' },
				async () => undefined,
				undefined,
				() => {
					dateContextCalls += 1;
					return secondContext;
				},
			);
			assert.strictEqual(
				document.getText(),
				'$CURRENT_YEAR\r\n  title:\r\n\r\n  2027 Sat\r\n  target\r\nend',
			);
			assert.strictEqual(dateContextCalls, 1);
			assert.strictEqual(format.header, originalHeader);
			assert.strictEqual(format.footer, originalFooter);
		}, 'plaintext');
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
