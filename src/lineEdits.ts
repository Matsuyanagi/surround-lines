import * as vscode from 'vscode';
import type { SurroundLinesFormat } from './formats';

export interface LineInsertion {
	position: vscode.Position;
	text: string;
}

interface LineInterval {
	startLine: number;
	endLine: number;
}

interface OrderedInsertion extends LineInsertion {
	intervalIndex: number;
	side: 'header' | 'footer';
}

type InsertionsResult =
	| { kind: 'ok'; insertions: LineInsertion[] }
	| { kind: 'overlap' };

function normalizeSelections(selections: readonly vscode.Selection[]): LineInterval[] {
	return selections
		.map((selection) => ({
			startLine: selection.isEmpty ? selection.active.line : selection.start.line,
			endLine: selection.isEmpty
				? selection.active.line
				: selection.end.character === 0
					? selection.end.line - 1
					: selection.end.line,
		}))
		.sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
}

function hasOverlappingLines(intervals: readonly LineInterval[]): boolean {
	for (let index = 1; index < intervals.length; index += 1) {
		if (intervals[index].startLine <= intervals[index - 1].endLine) {
			return true;
		}
	}
	return false;
}

function comparePositions(left: vscode.Position, right: vscode.Position): number {
	return left.line - right.line || left.character - right.character;
}

function findIndent(document: vscode.TextDocument, interval: LineInterval, enabled: boolean): string {
	if (!enabled) {
		return '';
	}

	for (let lineNumber = interval.startLine; lineNumber <= interval.endLine; lineNumber += 1) {
		const text = document.lineAt(lineNumber).text;
		if (/[^ \t]/.test(text)) {
			return /^[ \t]*/.exec(text)?.[0] ?? '';
		}
	}
	return '';
}

function renderConfiguredText(text: string, indent: string, eol: string): string {
	return text
		.split(/\r\n|\r|\n/)
		.map((line) => (line.length > 0 ? `${indent}${line}` : line))
		.join(eol);
}

function addInsertion(
	insertions: OrderedInsertion[],
	intervalIndex: number,
	side: OrderedInsertion['side'],
	position: vscode.Position,
	text: string,
): void {
	if (text.length > 0) {
		insertions.push({ intervalIndex, side, position, text });
	}
}

export function planInsertions(
	document: vscode.TextDocument,
	selections: readonly vscode.Selection[],
	format: SurroundLinesFormat,
): InsertionsResult {
	const intervals = normalizeSelections(selections);
	if (hasOverlappingLines(intervals)) {
		return { kind: 'overlap' };
	}

	const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
	const documentText = document.getText();
	const endsWithEol = documentText.length > 0 && documentText.endsWith(eol);
	const orderedInsertions: OrderedInsertion[] = [];
	for (const [intervalIndex, interval] of intervals.entries()) {
		const indent = findIndent(document, interval, format.indent);
		if (format.header !== '') {
			const header = renderConfiguredText(format.header, indent, eol);
			addInsertion(
				orderedInsertions,
				intervalIndex,
				'header',
				new vscode.Position(interval.startLine, 0),
				`${header}${eol}`,
			);
		}

		if (format.footer !== '') {
			const footer = renderConfiguredText(format.footer, indent, eol);
			if (interval.endLine + 1 < document.lineCount) {
				addInsertion(
					orderedInsertions,
					intervalIndex,
					'footer',
					new vscode.Position(interval.endLine + 1, 0),
					`${footer}${eol}`,
				);
			} else {
				const end = document.lineAt(interval.endLine).range.end;
				const text = endsWithEol && interval.endLine === document.lineCount - 1
					? `${eol}${footer}${eol}`
					: `${eol}${footer}`;
				addInsertion(
					orderedInsertions,
					intervalIndex,
					'footer',
					end,
					text,
				);
			}
		}
	}

	orderedInsertions.sort(
		(left, right) =>
			comparePositions(left.position, right.position) ||
			left.intervalIndex - right.intervalIndex ||
			(left.side === right.side ? 0 : left.side === 'header' ? -1 : 1),
	);

	const insertions: LineInsertion[] = [];
	for (const insertion of orderedInsertions) {
		const previous = insertions[insertions.length - 1];
		if (previous && comparePositions(previous.position, insertion.position) === 0) {
			previous.text += insertion.text;
		} else {
			insertions.push({ position: insertion.position, text: insertion.text });
		}
	}

	return { kind: 'ok', insertions };
}
