// ui-layout-engine v0.2.0 — canonical source: J:\CLAUDE\PROJECTS\HTML UI ENGINE\fieldAccess.mjs
//
// Single source of truth for "given a flat FIELDS key (e.g. 'anchorH',
// 'widthMin', 'keepInsideViewport'), where does its value live inside a
// layout config, and how do I read/write it there." Previously this logic
// was duplicated three ways (engine.mjs's readNestedPositionField,
// inspector.mjs's readPositionField/writePositionField, validate.mjs's
// flattenPositionFields) — consolidated here because the new responsive
// override system (registry.mjs) needs the exact same mapping a fourth
// time, and duplicating it again would be exactly the "duplicated field
// definitions" architectural smell the canonical-schema work is supposed
// to avoid.
//
// A field belongs to exactly one of four layers, determined by convention
// (not stored per-field in schema.mjs, to avoid yet another parallel
// classification table):
//   - constraints: listed in schema.mjs's CONSTRAINT_FIELDS
//   - typography:  listed in schema.mjs's TYPOGRAPHY_FIELDS (v0.2.7)
//   - size axis:   key starts with 'width' or 'height'
//   - position:    everything else

import { CONSTRAINT_FIELDS, TYPOGRAPHY_FIELDS, ICON_FIELDS } from './schema.mjs';

function fieldLayer(fieldKey) {
  if (CONSTRAINT_FIELDS.includes(fieldKey)) return 'constraints';
  if (TYPOGRAPHY_FIELDS.includes(fieldKey)) return 'typography';
  if (ICON_FIELDS.includes(fieldKey)) return 'icon'; // v0.2.12
  if (fieldKey.startsWith('width')) return 'size.width';
  if (fieldKey.startsWith('height')) return 'size.height';
  return 'position';
}

function sizeSubKey(fieldKey, axis) {
  // 'widthMin' -> 'min', 'heightValue' -> 'value'
  const suffix = fieldKey.slice(axis.length);
  return suffix.charAt(0).toLowerCase() + suffix.slice(1);
}

export function readFieldValue(layoutConfig, fieldKey) {
  const layer = fieldLayer(fieldKey);
  if (layer === 'constraints') {
    return layoutConfig.constraints ? layoutConfig.constraints[fieldKey] : undefined;
  }
  if (layer === 'typography') {
    return layoutConfig.typography ? layoutConfig.typography[fieldKey] : undefined;
  }
  if (layer === 'icon') {
    return layoutConfig.icon ? layoutConfig.icon[fieldKey] : undefined;
  }
  if (layer === 'size.width' || layer === 'size.height') {
    const axis = layer === 'size.width' ? 'width' : 'height';
    const axisConfig = layoutConfig.size && layoutConfig.size[axis];
    if (!axisConfig) return undefined;
    if (fieldKey === axis + 'Mode') return axisConfig.mode;
    return axisConfig[sizeSubKey(fieldKey, axis)];
  }
  // position
  const position = layoutConfig.position || {};
  if (fieldKey === 'anchorH') return position.horizontal && position.horizontal.anchor;
  if (fieldKey === 'anchorV') return position.vertical && position.vertical.anchor;
  if (fieldKey === 'offsetX') return (position.horizontal && position.horizontal.offset) ?? (position.offset && position.offset.x);
  if (fieldKey === 'offsetY') return (position.vertical && position.vertical.offset) ?? (position.offset && position.offset.y);
  return position[fieldKey];
}

// Returns a NEW layoutConfig with fieldKey set to value — never mutates its
// input, matching every other function in this engine's own convention.
export function writeFieldValue(layoutConfig, fieldKey, value) {
  const layer = fieldLayer(fieldKey);
  const next = { ...layoutConfig };

  if (layer === 'constraints') {
    next.constraints = { ...(layoutConfig.constraints || {}), [fieldKey]: value };
    return next;
  }
  if (layer === 'typography') {
    next.typography = { ...(layoutConfig.typography || {}), [fieldKey]: value };
    return next;
  }
  if (layer === 'icon') {
    next.icon = { ...(layoutConfig.icon || {}), [fieldKey]: value };
    return next;
  }
  if (layer === 'size.width' || layer === 'size.height') {
    const axis = layer === 'size.width' ? 'width' : 'height';
    const axisConfig = { ...((layoutConfig.size && layoutConfig.size[axis]) || {}) };
    axisConfig[sizeSubKey(fieldKey, axis)] = value;
    next.size = { ...(layoutConfig.size || {}), [axis]: axisConfig };
    return next;
  }
  // position
  const position = { ...(layoutConfig.position || {}) };
  if (fieldKey === 'anchorH') position.horizontal = { ...(position.horizontal || {}), anchor: value };
  else if (fieldKey === 'anchorV') position.vertical = { ...(position.vertical || {}), anchor: value };
  else if (fieldKey === 'offsetX') position.horizontal = { ...(position.horizontal || {}), offset: value };
  else if (fieldKey === 'offsetY') position.vertical = { ...(position.vertical || {}), offset: value };
  else position[fieldKey] = value;
  next.position = position;
  return next;
}

// Applies a flat { fieldKey: value } override map on top of a base layout
// config, field by field, via writeFieldValue — this is the one function
// the new responsive-context resolution (registry.mjs) needs, and it's
// built entirely out of the same read/write primitives everything else
// uses, so there is exactly one place that knows "where a field lives."
export function applyFieldOverrides(layoutConfig, overrides) {
  let result = layoutConfig;
  for (const [fieldKey, value] of Object.entries(overrides || {})) {
    result = writeFieldValue(result, fieldKey, value);
  }
  return result;
}
