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

const MODULES = [
  editorialPremium,
  boldServicePromo,
  localAuthority,
  modernSplit,
  minimalLuxury,
  geometricConversion,
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
