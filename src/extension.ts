import * as vscode from 'vscode';
import { validateFormats, type SurroundLinesFormat } from './formats';
import { planInsertions } from './lineEdits';

type FormatPicker = (names: readonly string[]) => Promise<string | undefined>;
type WarningHandler = (message: string) => Promise<unknown> | unknown;

const invalidConfigurationWarning = 'Surround Lines: invalid format configuration.';
const invalidArgumentsWarning = 'Surround Lines: argument must be an object with a non-empty name.';
const noFormatsWarning = 'Surround Lines: no formats are configured.';
const editFailedWarning = 'Surround Lines: edit failed.';

async function showWarning(warn: WarningHandler, message: string): Promise<void> {
	try {
		await warn(message);
	} catch {
		// A notification failure should not make a cancelled or rejected edit escape the command.
	}
}

function getRequestedName(args: unknown): string | undefined {
	if (args === undefined) {
		return undefined;
	}
	if (args === null || typeof args !== 'object' || Array.isArray(args)) {
		return '';
	}

	const name = (args as { name?: unknown }).name;
	return typeof name === 'string' && name.trim().length > 0 ? name : '';
}

export async function runSurroundLines(
	editor: vscode.TextEditor,
	rawFormats: unknown,
	args: unknown,
	pick: FormatPicker,
	warn: WarningHandler = (message) => vscode.window.showWarningMessage(message),
): Promise<void> {
	let formats: SurroundLinesFormat[] | undefined;
	try {
		formats = validateFormats(rawFormats);
	} catch {
		await showWarning(warn, invalidConfigurationWarning);
		return;
	}
	if (!formats) {
		await showWarning(warn, invalidConfigurationWarning);
		return;
	}

	let requestedName: string | undefined;
	try {
		requestedName = getRequestedName(args);
	} catch {
		await showWarning(warn, invalidArgumentsWarning);
		return;
	}
	if (requestedName === '') {
		await showWarning(warn, invalidArgumentsWarning);
		return;
	}
	if (requestedName === undefined && formats.length === 0) {
		await showWarning(warn, noFormatsWarning);
		return;
	}

	const document = editor.document;
	const version = document.version;
	const selections = [...editor.selections];
	let format: SurroundLinesFormat | undefined;

	if (requestedName === undefined) {
		let selectedName: string | undefined;
		try {
			selectedName = await pick(formats.map(({ name }) => name));
		} catch {
			return;
		}
		if (selectedName === undefined) {
			return;
		}
		if (
			vscode.window.activeTextEditor !== editor ||
			editor.document !== document ||
			document.version !== version
		) {
			return;
		}
		format = formats.find(({ name }) => name === selectedName);
		if (!format) {
			await showWarning(warn, `Surround Lines: unknown format "${selectedName}".`);
			return;
		}
	} else {
		format = formats.find(({ name }) => name === requestedName);
		if (!format) {
			await showWarning(warn, `Surround Lines: unknown format "${requestedName}".`);
			return;
		}
	}

	let plan: ReturnType<typeof planInsertions>;
	try {
		plan = planInsertions(document, selections, format);
	} catch {
		await showWarning(warn, 'Surround Lines: unable to plan insertions.');
		return;
	}
	if (plan.kind === 'overlap') {
		await showWarning(warn, 'Surround Lines: selections overlap.');
		return;
	}
	if (plan.insertions.length === 0) {
		return;
	}

	try {
		const applied = await editor.edit((editBuilder) => {
			for (const insertion of plan.insertions) {
				editBuilder.insert(insertion.position, insertion.text);
			}
		});
		if (!applied) {
			await showWarning(warn, editFailedWarning);
		}
	} catch {
		await showWarning(warn, editFailedWarning);
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const command = vscode.commands.registerCommand('extension.surroundLines', async (args?: unknown) => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		const configuration = vscode.workspace.getConfiguration('surroundLines', editor.document.uri);
		const rawFormats = configuration.get<unknown>('formats');
		await runSurroundLines(editor, rawFormats, args, async (names) =>
			(await vscode.window.showQuickPick([...names], { placeHolder: 'Choose a format to surround lines.' }))
		);
	});
	context.subscriptions.push(command);
}

export function deactivate(): void {}
