/**
 * Post controller (factory). Uses asyncHandler + the standard API envelope.
 * Ownership is always the session user; nothing sensitive (keys, tokens,
 * encrypted values, raw provider responses) is ever returned.
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { postService as defaultPostService } from '../services/postService.js';

export function createPostController({ postService = defaultPostService } = {}) {
  const createDraft = asyncHandler(async (req, res) => {
    const post = await postService.createDraft(req.user.id, req.body, { req });
    return sendSuccess(res, { post }, 201);
  });

  const listPosts = asyncHandler(async (req, res) => {
    const posts = await postService.listPosts(req.user.id, {
      limit: req.query.limit,
      offset: req.query.offset,
      status: typeof req.query.status === 'string' ? req.query.status : null,
    });
    return sendSuccess(res, { posts });
  });

  const getPost = asyncHandler(async (req, res) => {
    const post = await postService.getPost(req.user.id, req.params.id);
    return sendSuccess(res, { post });
  });

  const updateDraft = asyncHandler(async (req, res) => {
    const post = await postService.updateDraft(req.user.id, req.params.id, req.body, { req });
    return sendSuccess(res, { post });
  });

  const generateContent = asyncHandler(async (req, res) => {
    const post = await postService.generateContent(req.user.id, req.params.id, { req });
    return sendSuccess(res, { post });
  });

  const selectMedia = asyncHandler(async (req, res) => {
    const post = await postService.selectMedia(req.user.id, req.params.id, req.body.mediaAssetId ?? null, { req });
    return sendSuccess(res, { post });
  });

  const generateImage = asyncHandler(async (req, res) => {
    const post = await postService.generateImage(req.user.id, req.params.id, { req });
    return sendSuccess(res, { post });
  });

  const setTargets = asyncHandler(async (req, res) => {
    const post = await postService.setTargets(req.user.id, req.params.id, req.body.targets, { req });
    return sendSuccess(res, { post });
  });

  // E: Save Draft — brief/params and/or hand-edited per-platform copy, versioned.
  const saveDraft = asyncHandler(async (req, res) => {
    const post = await postService.saveDraft(req.user.id, req.params.id, {
      fields: {
        title: req.body.title, brief: req.body.brief,
        template: req.body.template, aspectRatio: req.body.aspectRatio,
        backgroundStyle: req.body.backgroundStyle,
        brandName: req.body.brandName, callToAction: req.body.callToAction,
        language: req.body.language, tone: req.body.tone,
        hashtagPreference: req.body.hashtagPreference,
        additionalInstructions: req.body.additionalInstructions,
      },
      platformCaptions: req.body.platformCaptions,
      expectedVersion: req.body.expectedVersion,
    }, { req });
    return sendSuccess(res, { post });
  });

  // E: per-target readiness for the workspace (compute, never store).
  const readiness = asyncHandler(async (req, res) => {
    const result = await postService.getReadiness(req.user.id, req.params.id);
    return sendSuccess(res, { readiness: result });
  });

  const schedule = asyncHandler(async (req, res) => {
    const result = await postService.schedulePost(
      req.user.id,
      req.params.id,
      {
        scheduledDate: req.body.scheduledDate,
        scheduledTime: req.body.scheduledTime,
        timezone: req.body.timezone,
        expectedVersion: req.body.expectedVersion,
      },
      { req },
    );
    const { notice, readiness: r, ...post } = result;
    return sendSuccess(res, { post, notice, readiness: r });
  });

  // E: Publish Now — validate readiness, queue + enqueue durable jobs, honest state.
  const publishNow = asyncHandler(async (req, res) => {
    const result = await postService.publishNow(
      req.user.id, req.params.id, { expectedVersion: req.body.expectedVersion }, { req },
    );
    const { notice, readiness: r, ...post } = result;
    return sendSuccess(res, { post, notice, readiness: r });
  });

  const cancel = asyncHandler(async (req, res) => {
    const post = await postService.cancelPost(req.user.id, req.params.id, { req });
    return sendSuccess(res, { post });
  });

  const deleteDraft = asyncHandler(async (req, res) => {
    await postService.deleteDraft(req.user.id, req.params.id, { req });
    return sendSuccess(res, { deleted: true });
  });

  const getCapabilities = asyncHandler(async (req, res) => {
    const capabilities = await postService.getCapabilities(req.user.id);
    return sendSuccess(res, capabilities);
  });

  return {
    createDraft,
    listPosts,
    getPost,
    updateDraft,
    saveDraft,
    readiness,
    generateContent,
    selectMedia,
    generateImage,
    setTargets,
    schedule,
    publishNow,
    cancel,
    deleteDraft,
    getCapabilities,
  };
}

export default createPostController;
