import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What one request cost the database, in the units D1 bills: rows read and rows
 * written. Nothing here names an account, a record or a payload; a request is
 * known only by its route and, where the route says, what kind of round it was.
 */
export type RequestCost = {
	/** Set by the route when the path alone does not say what the request did. */
	kind: string | null;
	queries: number;
	rowsRead: number;
	rowsWritten: number;
	/** Where a sync round's time went, as the relay reports it. */
	phases: Record<string, number>;
};

/** Rows one database call, or a whole relay round, reports. */
export type DatabaseCost = Pick<RequestCost, 'queries' | 'rowsRead' | 'rowsWritten'>;

const current = new AsyncLocalStorage<RequestCost>();

export function newRequestCost(): RequestCost {
	return { kind: null, queries: 0, rowsRead: 0, rowsWritten: 0, phases: {} };
}

/** Run `work` with every database call inside it counted into `cost`. */
export function measureRequestCost<T>(cost: RequestCost, work: () => T): T {
	return current.run(cost, work);
}

/** Count database work into the request running now, if one is being measured. */
export function addDatabaseCost(cost: DatabaseCost): void {
	const request = current.getStore();
	if (!request) return;
	request.queries += cost.queries;
	request.rowsRead += cost.rowsRead;
	request.rowsWritten += cost.rowsWritten;
}

export function nameRequestCost(kind: string): void {
	const request = current.getStore();
	if (request) request.kind = kind;
}

export function addRequestPhases(phases: Record<string, number>): void {
	const request = current.getStore();
	if (request) Object.assign(request.phases, phases);
}
