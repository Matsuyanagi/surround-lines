export interface SurroundLinesFormat {
	name: string;
	header: string;
	footer: string;
	indent: boolean;
}

export function validateFormats(raw: unknown): SurroundLinesFormat[] | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}

	const names = new Set<string>();
	for (const item of raw) {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) {
			return undefined;
		}

		const format = item as Record<string, unknown>;
		if (
			typeof format.name !== 'string' ||
			format.name.trim().length === 0 ||
			typeof format.header !== 'string' ||
			typeof format.footer !== 'string' ||
			typeof format.indent !== 'boolean'
		) {
			return undefined;
		}

		if (names.has(format.name)) {
			return undefined;
		}
		names.add(format.name);
	}

	return raw as SurroundLinesFormat[];
}
