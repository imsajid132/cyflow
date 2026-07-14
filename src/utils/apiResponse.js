/**
 * Standard API response envelopes.
 *
 * Success: { success: true, data, requestId }
 * Error:   { success: false, error: { code, message }, requestId }
 */

/**
 * Send a success envelope.
 * @param {import('express').Response} res
 * @param {any} [data={}]
 * @param {number} [statusCode=200]
 */
export function sendSuccess(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    requestId: res.req?.id ?? null,
  });
}

/**
 * Send an error envelope.
 * @param {import('express').Response} res
 * @param {{ code: string, message: string, statusCode?: number }} error
 */
export function sendError(res, { code, message, statusCode = 500 }) {
  return res.status(statusCode).json({
    success: false,
    error: { code, message },
    requestId: res.req?.id ?? null,
  });
}

export default { sendSuccess, sendError };
