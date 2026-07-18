/**
 * A tiny registry so the health route can report background-job state without
 * importing the server entry point (which would start it) or reaching into a
 * container it does not own.
 *
 * The runner is registered by `server.js` only when single-process mode is on.
 * When it is off — every host that runs a separate worker — the status is a
 * fixed `disabled`, which is the honest answer: this process is not responsible
 * for jobs, and reporting anything else would hide a stopped external worker.
 */

import { DISABLED_STATUS } from './backgroundRunner.js';

let runner = null;

export function setBackgroundRunner(instance) {
  runner = instance || null;
}

/** Non-secret operational snapshot. Never contains paths, ids or credentials. */
export function backgroundStatus() {
  if (!runner || typeof runner.status !== 'function') return { ...DISABLED_STATUS };
  return runner.status();
}

/** Test hook: forget any registered runner. */
export function resetBackgroundRunner() {
  runner = null;
}

export default { setBackgroundRunner, backgroundStatus, resetBackgroundRunner };
