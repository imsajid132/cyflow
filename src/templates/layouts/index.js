/**
 * Layout registry.
 *
 * Adding a template means adding a module here and its slug to IMAGE_TEMPLATES
 * in config/constants.js — nothing else in the pipeline needs to change.
 */

import * as editorialPremium from './editorialPremium.js';
import * as boldServicePromo from './boldServicePromo.js';
import * as localAuthority from './localAuthority.js';
import * as modernSplit from './modernSplit.js';
import * as minimalLuxury from './minimalLuxury.js';
import * as geometricConversion from './geometricConversion.js';
import * as photoOverlay from './photoOverlay.js';
// Phase 4.7: content-type layouts the planner selects by post shape.
import * as checklistTips from './checklistTips.js';
import * as statProof from './statProof.js';
import * as splitComparison from './splitComparison.js';
// Phase 4.7.1: the planner design families. These are what the planner uses;
// the earlier layouts stay registered so existing drafts keep rendering.
import * as editorialInsight from './editorialInsight.js';
import * as lightEditorial from './lightEditorial.js';
import * as checklistGuide from './checklistGuide.js';
import * as comparisonCards from './comparisonCards.js';
import * as statHighlight from './statHighlight.js';
import * as serviceAuthority from './serviceAuthority.js';
import * as localInsight from './localInsight.js';
// Phase 4.8: two structurally distinct additions.
import * as numberedSteps from './numberedSteps.js';
import * as faqEditorial from './faqEditorial.js';
// The Make-derived poster family: the seven Make card compositions plus the
// comparison card, native and dynamically branded.
import {
  posterService, posterStat, posterCheatsheet, posterProject,
  posterWarning, posterQuote, posterComparison, posterTestimonial,
} from './poster.js';

const MODULES = [
  posterService,
  posterStat,
  posterCheatsheet,
  posterProject,
  posterWarning,
  posterQuote,
  posterComparison,
  posterTestimonial,
  // --- planner design families (Phase 4.7.1) ---
  editorialInsight,
  lightEditorial,
  checklistGuide,
  comparisonCards,
  statHighlight,
  serviceAuthority,
  localInsight,
  numberedSteps,
  faqEditorial,
  // --- earlier layouts, still selectable and still rendering old drafts ---
  editorialPremium,
  boldServicePromo,
  localAuthority,
  modernSplit,
  minimalLuxury,
  geometricConversion,
  checklistTips,
  statProof,
  splitComparison,
  photoOverlay,
];

export const LAYOUTS = Object.freeze(
  Object.fromEntries(MODULES.map((m) => [m.id, Object.freeze({ id: m.id, label: m.label, render: m.render })])),
);

export const LAYOUT_IDS = Object.freeze(MODULES.map((m) => m.id));

/** Human-readable labels, for UI pickers. */
export const LAYOUT_LABELS = Object.freeze(
  Object.fromEntries(MODULES.map((m) => [m.id, m.label])),
);

export default { LAYOUTS, LAYOUT_IDS, LAYOUT_LABELS };
