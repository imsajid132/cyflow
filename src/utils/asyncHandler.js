/**
 * Wrap an async Express handler so rejected promises are forwarded to
 * `next(err)` and handled by the centralized error middleware.
 *
 * Usage: `router.get('/x', asyncHandler(async (req, res) => { ... }))`
 */

/**
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<any>} fn
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(fn) {
  return function wrappedAsyncHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
