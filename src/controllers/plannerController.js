/**
 * Planner controller (factory).
 *
 * Thin: every rule lives in plannerService. Identity always comes from the
 * session (`req.user.id`) — never from the body or params — so a user can only
 * ever read or mutate their own plans.
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { timezoneCatalogue } from '../services/timezoneService.js';
import { plannerService as defaultService } from '../services/plannerService.js';

export function createPlannerController({ plannerService = defaultService } = {}) {
  /**
   * The full IANA catalogue, with offsets computed for the planning date so a
   * DST zone is labelled correctly for the week being planned.
   */
  const listTimezones = asyncHandler(async (req, res) => {
    const entries = timezoneCatalogue({
      forDate: req.query.forDate ? new Date(String(req.query.forDate)) : new Date(),
      search: req.query.search ? String(req.query.search) : '',
      limit: req.query.limit ? Number(req.query.limit) : 0,
    });
    return sendSuccess(res, { timezones: entries, total: entries.length });
  });

  // --- preferences ---------------------------------------------------------

  const getPreferences = asyncHandler(async (req, res) => {
    const preferences = await plannerService.getPreferences(req.user.id);
    return sendSuccess(res, { preferences });
  });

  const savePreferences = asyncHandler(async (req, res) => {
    const preferences = await plannerService.savePreferences(req.user.id, req.body, { req });
    return sendSuccess(res, { preferences });
  });

  /**
   * The weekly rhythm, resolved and labelled. Read-only: a preview of the
   * strategy a plan WOULD use, so the wizard can show its reasoning before
   * anything is generated. `preset` lets the preview follow the selector
   * without saving.
   */
  const describeRhythm = asyncHandler(async (req, res) => {
    const rhythm = await plannerService.describeWeeklyRhythm(req.user.id, {
      preset: typeof req.query.preset === 'string' ? req.query.preset : undefined,
    });
    return sendSuccess(res, { rhythm });
  });

  // --- plans ---------------------------------------------------------------

  const listPlans = asyncHandler(async (req, res) => {
    const plans = await plannerService.listPlans(req.user.id, {
      limit: req.query.limit ? Number(req.query.limit) : 20,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    return sendSuccess(res, { plans });
  });

  /** What a plan WOULD create. The wizard shows this before generating. */
  const summarizePlan = asyncHandler(async (req, res) => {
    const summary = await plannerService.summarizePlan(req.user.id, req.body);
    return sendSuccess(res, { summary });
  });

  const generatePlan = asyncHandler(async (req, res) => {
    const plan = await plannerService.generatePlan(req.user.id, req.body, { req });
    return sendSuccess(res, plan, 201);
  });

  /** What deleting this plan would do, for the confirmation dialog. */
  const describeDeletion = asyncHandler(async (req, res) => {
    const plan = await plannerService.describeDeletion(req.user.id, req.params.id);
    // The run object is already available via GET; only the impact is needed.
    const { run, ...impact } = plan;
    return sendSuccess(res, impact);
  });

  const getPlan = asyncHandler(async (req, res) => {
    const plan = await plannerService.getPlan(req.user.id, req.params.id);
    return sendSuccess(res, plan);
  });

  const deletePlan = asyncHandler(async (req, res) => {
    const result = await plannerService.deletePlan(req.user.id, req.params.id, {
      // Opt-in only: cancelling queued posts is never implied by "delete".
      cancelQueued: req.body?.cancelQueued === true,
      req,
    });
    return sendSuccess(res, result);
  });

  // --- items ---------------------------------------------------------------

  const updateItem = asyncHandler(async (req, res) => {
    const item = await plannerService.updateItem(req.user.id, req.params.itemId, req.body, { req });
    return sendSuccess(res, { item });
  });

  const regenerateItem = asyncHandler(async (req, res) => {
    const item = await plannerService.regenerateItem(req.user.id, req.params.itemId, req.body.target, {
      force: Boolean(req.body.force),
      req,
    });
    return sendSuccess(res, { item });
  });

  const setItemStatus = asyncHandler(async (req, res) => {
    const item = await plannerService.setItemStatus(req.user.id, req.params.itemId, req.body.status, { req });
    return sendSuccess(res, { item });
  });

  const deleteItem = asyncHandler(async (req, res) => {
    const result = await plannerService.deleteItem(req.user.id, req.params.itemId, { req });
    return sendSuccess(res, result);
  });

  const duplicateAsDraft = asyncHandler(async (req, res) => {
    const result = await plannerService.duplicateAsDraft(req.user.id, req.params.itemId, { req });
    return sendSuccess(res, result, 201);
  });

  // --- bulk ----------------------------------------------------------------

  const bulkSetStatus = asyncHandler(async (req, res) => {
    const result = await plannerService.bulkSetStatus(
      req.user.id, req.params.id, req.body.itemIds, req.body.status, { req },
    );
    return sendSuccess(res, result);
  });

  const removeRejected = asyncHandler(async (req, res) => {
    const result = await plannerService.removeRejected(req.user.id, req.params.id, { req });
    return sendSuccess(res, result);
  });

  const queueApproved = asyncHandler(async (req, res) => {
    const result = await plannerService.queueApproved(req.user.id, req.params.id, req.body.itemIds, { req });
    return sendSuccess(res, result);
  });

  return {
    listTimezones,
    getPreferences,
    savePreferences,
    describeRhythm,
    listPlans,
    summarizePlan,
    generatePlan,
    getPlan,
    describeDeletion,
    deletePlan,
    updateItem,
    regenerateItem,
    setItemStatus,
    deleteItem,
    duplicateAsDraft,
    bulkSetStatus,
    removeRejected,
    queueApproved,
  };
}

export default createPlannerController;
