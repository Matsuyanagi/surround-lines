export interface DateVariableContext {
	readonly now: Date;
	readonly displayLanguage: string;
}

function isIdentifierStart(code: number): boolean {
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isIdentifierPart(code: number): boolean {
	return isIdentifierStart(code) || (code >= 48 && code <= 57);
}

function shortWeekday(date: Date, displayLanguage: string): string {
	let locale = 'en';
	try {
		if (Intl.DateTimeFormat.supportedLocalesOf(displayLanguage).length > 0) {
			locale = displayLanguage;
		}
	} catch {
		locale = 'en';
	}

	return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
}

export function expandDateVariables(text: string, context: DateVariableContext): string {
	const now = context.now;
	const values = new Map<string, string>([
		['CURRENT_YEAR', String(now.getFullYear())],
		['CURRENT_MONTH', String(now.getMonth() + 1).padStart(2, '0')],
		['CURRENT_DATE', String(now.getDate()).padStart(2, '0')],
		['CURRENT_DAY_NAME_SHORT', shortWeekday(now, context.displayLanguage)],
		['CURRENT_HOUR', String(now.getHours()).padStart(2, '0')],
		['CURRENT_MINUTE', String(now.getMinutes()).padStart(2, '0')],
		['CURRENT_SECOND', String(now.getSeconds()).padStart(2, '0')],
	]);
	const expanded: string[] = [];

	for (let index = 0; index < text.length;) {
		if (text[index] !== '$') {
			expanded.push(text[index]);
			index += 1;
			continue;
		}

		if (text[index + 1] === '$') {
			expanded.push('$');
			index += 2;
			continue;
		}

		let identifierEnd = index + 1;
		if (!isIdentifierStart(text.charCodeAt(identifierEnd))) {
			expanded.push('$');
			index += 1;
			continue;
		}

		identifierEnd += 1;
		while (identifierEnd < text.length && isIdentifierPart(text.charCodeAt(identifierEnd))) {
			identifierEnd += 1;
		}

		const identifier = text.slice(index + 1, identifierEnd);
		expanded.push(values.get(identifier) ?? text.slice(index, identifierEnd));
		index = identifierEnd;
	}

	return expanded.join('');
}