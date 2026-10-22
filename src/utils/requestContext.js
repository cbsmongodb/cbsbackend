import { AsyncLocalStorage } from "node:async_hooks";

// Remembers the current request while it is being handled, so the error logger
// can say WHO (logged-in employee), WHERE (page in the app) and WHAT (action) failed.
export const requestStore = new AsyncLocalStorage();

export function requestContext(req, res, next) {
  requestStore.run({ req }, next);
}
