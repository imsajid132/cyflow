/**
 * Automation controller (factory). Ownership is always the session user; a
 * cross-user id surfaces as the service's NotFound. Nothing sensitive is ever
 * returned. Stop requires an explicit confirmation token (checked in the
 * validator) because it cancels future preparation.
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

export function createAutomationController({ automationService } = {}) {
  const create = asyncHandler(async (req, res) => {
    const automation = await automationService.createAutomation(req.user.id, req.body, { req });
    return sendSuccess(res, { automation }, 201);
  });

  const list = asyncHandler(async (req, res) => {
    const automations = await automationService.listAutomations(req.user.id);
    return sendSuccess(res, { automations });
  });

  const get = asyncHandler(async (req, res) => {
    const automation = await automationService.getAutomation(req.user.id, req.params.id);
    return sendSuccess(res, { automation });
  });

  const update = asyncHandler(async (req, res) => {
    const automation = await automationService.updateFutureSettings(req.user.id, req.params.id, req.body, { req });
    return sendSuccess(res, { automation });
  });

  const activate = asyncHandler(async (req, res) => {
    const automation = await automationService.activate(req.user.id, req.params.id, { req });
    return sendSuccess(res, { automation });
  });

  const pause = asyncHandler(async (req, res) => {
    const automation = await automationService.pause(req.user.id, req.params.id, { req });
    return sendSuccess(res, { automation });
  });

  const resume = asyncHandler(async (req, res) => {
    const automation = await automationService.resume(req.user.id, req.params.id, { req });
    return sendSuccess(res, { automation });
  });

  const stop = asyncHandler(async (req, res) => {
    const automation = await automationService.stop(req.user.id, req.params.id, { req });
    return sendSuccess(res, { automation });
  });

  const refillNow = asyncHandler(async (req, res) => {
    const result = await automationService.refillNow(req.user.id, req.params.id, { req });
    return sendSuccess(res, result);
  });

  const upcoming = asyncHandler(async (req, res) => {
    const items = await automationService.listUpcoming(req.user.id, req.params.id);
    return sendSuccess(res, { items });
  });

  const history = asyncHandler(async (req, res) => {
    const events = await automationService.listHistory(req.user.id, req.params.id);
    return sendSuccess(res, { events });
  });

  const failures = asyncHandler(async (req, res) => {
    const failures = await automationService.listFailures(req.user.id, req.params.id);
    return sendSuccess(res, { failures });
  });

  return { create, list, get, update, activate, pause, resume, stop, refillNow, upcoming, history, failures };
}

export default createAutomationController;
