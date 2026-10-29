// ui-layout-engine v0.1.0 — canonical source: J:\CLAUDE\PROJECTS\HTML UI ENGINE\schema.mjs
//
// FIELDS + MODE_SCHEMA — the single source of truth for every layout field.
// Pure JSON-serializable data. NO functions live in this file, by design —
// see UI_Layout_Engine_Architecture.md Section 9 for why (portability,
// static validation, and Claude Code comprehension all depend on this file
// being inspectable as plain data, not executable code).
//
// This module has zero knowledge of any host application. It only
// understands: elements, roles, layout configuration, position modes, size
// modes, constraints, responsive overrides, tokens, presets. Nothing here
// references Clicko, Wikiglobe, Walking, Hando, or any other project.
//
// A field's `resolver` name must exist in RESOLVERS (engine.mjs). validate.mjs
// checks this statically at load time.
//
// Native ES module, zero dependencies, zero build step — per the
// Implementation Plan's packaging decision (Section 7): loadable directly
// via `<script type="module">` in a browser, or `import`ed directly by
// Node (including `node --test`) with no package.json required, since
// Node treats a `.mjs` file as an ES module unconditionally.

// ============================================================
// FIELDS — every field used anywhere in the schema, keyed by name.
// Each entry: { type, values?, default, space, tier, control, resolver, resolverArgs }
//   type        - 'enum' | 'length' | 'number' | 'boolean' | 'elementRef' | 'string'
//   values      - allowed values, only for type:'enum'
//   default     - the value assumed when the field is absent
//   space       - which coordinate/reference space this field resolves against
//                 (documentation + machine-readable metadata; see Architecture Section 4 Point 5)
//   tier        - 'basic' | 'advanced' — disclosure tier for the Inspector (Section 10)
//   control     - named widget type the Inspector renders (see inspector.mjs's WIDGETS)
//   resolver    - named resolver type the engine calls (see engine.mjs's RESOLVERS)
//   resolverArgs- static arguments passed to the resolver alongside the field's value
// ============================================================
export const FIELDS = {
  // ---- position: flow ----
  parent: {
    type: 'elementRef', default: null,
    space: 'dom-parent-assertion', tier: 'basic',
    control: 'select-element',
    resolver: 'dom-ref-noop', resolverArgs: {},
  },
  order: {
    type: 'number', default: 0,
    space: 'flow-order', tier: 'basic',
    control: 'slider-number',
    resolver: 'css-number-var', resolverArgs: { cssVar: '--ui-order' },
  },
  alignment: {
    type: 'enum', values: ['start', 'center', 'end', 'stretch'], default: 'stretch',
    space: 'flow-cross-axis', tier: 'advanced',
    control: 'select',
    resolver: 'css-attr', resolverArgs: { attr: 'data-ui-align' },
  },

  // ---- position: anchor / fixed (shared fields) ----
  anchorH: {
    type: 'enum', values: ['left', 'right', 'center'], default: 'left',
    space: 'containing-block-edge', tier: 'basic',
    control: 'select',
    resolver: 'css-attr', resolverArgs: { attr: 'data-anchor-h' },
  },
  anchorV: {
    type: 'enum', values: ['top', 'bottom', 'center'], default: 'top',
    space: 'containing-block-edge', tier: 'basic',
    control: 'select',
    resolver: 'css-attr', resolverArgs: { attr: 'data-anchor-v' },
  },
  offsetX: {
    type: 'length', default: '0px',
    space: 'containing-block-edge', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-offset-x' },
  },
  offsetY: {
    type: 'length', default: '0px',
    space: 'containing-block-edge', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-offset-y' },
  },
  viewportAnchor: {
    type: 'enum',
    values: ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'],
    default: 'top-left',
    space: 'viewport', tier: 'basic',
    control: 'select',
    resolver: 'css-attr', resolverArgs: { attr: 'data-viewport-anchor' },
  },

  // ---- position: relative (v0.2.2 — element-to-element anchor alignment.
  //      Implemented via CSS Anchor Positioning where supported (native,
  //      zero-JS, recomputes on every browser layout pass automatically —
  //      including continuous "scale with browser" resizing on either the
  //      self or the target element, since `anchor()` and the percentage
  //      `transform` it pairs with are both live CSS, not one-shot JS
  //      measurements) with a measure-and-apply JS fallback for browsers
  //      without support (~12% per Architecture Section 8's research),
  //      re-run on window resize and via a ResizeObserver on BOTH the self
  //      and target elements — see registry.mjs's `applyRelativeAnchor()`
  //      for the actual resolution logic; these 4 fields only carry the
  //      declared intent (which element, which anchor point on each box,
  //      how much gap), consumed directly by resolveElementLayout() rather
  //      than through a per-field CSS resolver — see engine.mjs's
  //      `relativeAnchor` descriptor. ----
  relativeTo: {
    type: 'elementRef', default: null,
    space: 'element-reference', tier: 'basic',
    control: 'select-element',
    resolver: 'anchor-ref-noop', resolverArgs: {},
  },
  myAnchor: {
    type: 'enum',
    values: ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'],
    default: 'top-center',
    space: 'own-box', tier: 'basic',
    control: 'select',
    resolver: 'anchor-ref-noop', resolverArgs: {},
  },
  targetAnchor: {
    type: 'enum',
    values: ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'],
    default: 'bottom-center',
    space: 'element-reference', tier: 'basic',
    control: 'select',
    resolver: 'anchor-ref-noop', resolverArgs: {},
  },
  gap: {
    // DEPRECATED (v0.2.8): replaced by relative mode's literal signed offsetX / offsetY. Still accepted so existing configs load; the registry converts it
    // to offsetX / offsetY on load (createUIElement / loadLayoutConfig / resetLayoutConfig) and the Inspector no longer lists it.
    deprecated: true,
    type: 'length', default: '0px',
    space: 'element-reference', tier: 'basic',
    control: 'slider-length',
    resolver: 'anchor-ref-noop', resolverArgs: {},
  },

  // ---- position: absolute ----
  containingBlock: {
    type: 'elementRef', default: null,
    space: 'dom-containment-assertion', tier: 'basic',
    control: 'select-element',
    resolver: 'containing-block-ref', resolverArgs: {},
  },
  x: {
    type: 'length', default: '0px',
    space: 'containing-block-padding-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-x' },
  },
  y: {
    type: 'length', default: '0px',
    space: 'containing-block-padding-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-y' },
  },

  // ---- size: width axis ----
  widthValue: {
    type: 'length', default: 'auto',
    space: 'own-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-width' },
  },
  widthMin: {
    type: 'length', default: '0px',
    space: 'own-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-width-min' },
  },
  widthPreferred: {
    type: 'length', default: '50%',
    space: 'own-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-width-preferred' },
  },
  widthMax: {
    type: 'length', default: '100%',
    space: 'own-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-width-max' },
  },
  widthRatio: {
    type: 'string', default: '1/1',
    space: 'cross-axis', tier: 'basic',
    control: 'text',
    resolver: 'css-enum-var', resolverArgs: { cssVar: '--ui-width-ratio' },
  },
  widthBasis: {
    type: 'enum', values: ['width', 'height'], default: 'width',
    space: 'cross-axis', tier: 'advanced',
    control: 'select',
    resolver: 'css-attr', resolverArgs: { attr: 'data-width-basis' },
  },

  // ---- size: height axis (mirrors width) ----
  heightValue: {
    type: 'length', default: 'auto',
    space: 'own-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-height' },
  },
  heightMin: {
    type: 'length', default: '0px',
    space: 'own-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-height-min' },
  },
  heightPreferred: {
    type: 'length', default: '50%',
    space: 'own-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-height-preferred' },
  },
  heightMax: {
    type: 'length', default: '100%',
    space: 'own-box', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-height-max' },
  },
  heightRatio: {
    type: 'string', default: '1/1',
    space: 'cross-axis', tier: 'basic',
    control: 'text',
    resolver: 'css-enum-var', resolverArgs: { cssVar: '--ui-height-ratio' },
  },
  heightBasis: {
    type: 'enum', values: ['width', 'height'], default: 'height',
    space: 'cross-axis', tier: 'advanced',
    control: 'select',
    resolver: 'css-attr', resolverArgs: { attr: 'data-height-basis' },
  },

  // ---- size: match (v0.2.6 — a size axis whose value tracks ANOTHER
  //      element's live rendered size on that same axis, e.g. "my width
  //      always equals this other element's width" regardless of how either
  //      element's own content/font-size/viewport scaling changes it. Real
  //      motivating case: two text elements where the upper is authored at
  //      a fixed font-size ratio to the lower, and the lower's WIDTH should
  //      track the upper's rendered width exactly, at any browser size —
  //      not expressible as a formula (text width is a rendered/measured
  //      quantity, not a computable ratio, once content/letter-spacing
  //      enter the picture), so unlike every other size mode this one
  //      requires a live DOM measurement of the target, exactly the same
  //      architectural shape position's own 'relative' mode already has
  //      (see relativeTo's own comment above) — implemented the same way:
  //      these 2 fields only carry the declared intent (which element, same
  //      axis on both sides — deliberately no separate width-tracks-height
  //      cross-axis option, keeping this to the one concrete use case
  //      asked for), consumed directly by resolveElementLayout() into a
  //      `sizeMatch` descriptor rather than through a per-field CSS
  //      resolver, same as relativeAnchor. See registry.mjs's
  //      `applySizeMatch()` for the actual resolution logic (a JS
  //      measurement + ResizeObserver watcher — no native-CSS path exists
  //      for this the way CSS Anchor Positioning covers position; browser
  //      support for reading another element's size declaratively
  //      (`anchor-size()`) is even narrower than `anchor()`, and MVP-scoped
  //      out for the same reason the viewport constraint's JS-only path
  //      was — see that field's own comment). ----
  widthRelativeTo: {
    type: 'elementRef', default: null,
    space: 'element-reference', tier: 'basic',
    control: 'select-element',
    resolver: 'size-match-noop', resolverArgs: {},
  },
  heightRelativeTo: {
    type: 'elementRef', default: null,
    space: 'element-reference', tier: 'basic',
    control: 'select-element',
    resolver: 'size-match-noop', resolverArgs: {},
  },

  // ---- constraints ----
  keepInsideViewport: {
    type: 'boolean', default: true,
    space: 'viewport', tier: 'advanced',
    control: 'checkbox',
    resolver: 'css-class-toggle', resolverArgs: { class: 'ui-constraint-viewport' },
  },
  keepInsideParent: {
    type: 'boolean', default: false,
    space: 'containing-block-padding-box', tier: 'advanced',
    control: 'checkbox',
    resolver: 'css-class-toggle', resolverArgs: { class: 'ui-constraint-parent' },
  },

  // ---- typography (v0.2.7) ----
  // Flat, always-optional field list, same architectural shape as
  // constraints directly above (not mode-dispatched — a text element's
  // typography doesn't depend on its position.mode/size.mode). Scoped
  // against TEMPLATE_DEV_PANEL.html's own real buildTextElementControls()
  // battery (read directly, not from a summary — see CHANGELOG.md's v0.2.7
  // entry) MINUS its 2 opt-in Drop Shadow / Extrusion sub-panels, per direct
  // instruction ("leave out the shadow and extrusion stuff"). This engine
  // now owns typography as a real field category for the first time —
  // previously out of scope entirely (see docs/ENGINE_API.md's old "Non-
  // layout styling... fonts... via the host's own existing style system"
  // line, now corrected) — anticipated and pre-designed for in
  // docs/DEV_PANEL_ADAPTER.md §11, not a speculative scope creep.
  enabled: {
    type: 'boolean', default: true,
    space: 'typography', tier: 'basic',
    control: 'checkbox',
    // Deliberately NOT css-boolean-keyword-var (which always sets a CSS var
    // either way) — a visible element must never have its `display` touched
    // at all, so a host's own display type (block/inline/flex/...) is never
    // clobbered. Only the FALSE case emits anything.
    resolver: 'css-class-toggle-false', resolverArgs: { class: 'ui-typography-hidden' },
  },
  fontFamily: {
    type: 'enum',
    values: [
      'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman',
      'Georgia', 'Garamond', 'Courier New', 'Lucida Console', 'Impact', 'Comic Sans MS',
      'Palatino', 'Segoe UI', 'Calibri', 'Cambria', 'Franklin Gothic Medium',
      'Century Gothic', 'Rockwell', 'Consolas',
    ],
    default: 'Arial',
    space: 'typography', tier: 'basic',
    control: 'select',
    resolver: 'css-enum-var', resolverArgs: { cssVar: '--ui-font-family' },
  },
  fontSize: {
    type: 'length', default: '16px',
    space: 'typography', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-font-size' },
  },
  color: {
    type: 'string', default: '#ffffff',
    space: 'typography', tier: 'basic',
    control: 'color-picker',
    resolver: 'css-enum-var', resolverArgs: { cssVar: '--ui-font-color' },
  },
  bold: {
    type: 'boolean', default: false,
    space: 'typography', tier: 'basic',
    control: 'checkbox',
    resolver: 'css-boolean-keyword-var', resolverArgs: { cssVar: '--ui-font-weight', trueValue: 'bold', falseValue: 'normal' },
  },
  italic: {
    type: 'boolean', default: false,
    space: 'typography', tier: 'basic',
    control: 'checkbox',
    resolver: 'css-boolean-keyword-var', resolverArgs: { cssVar: '--ui-font-style', trueValue: 'italic', falseValue: 'normal' },
  },
  underline: {
    type: 'boolean', default: false,
    space: 'typography', tier: 'basic',
    control: 'checkbox',
    resolver: 'css-boolean-keyword-var', resolverArgs: { cssVar: '--ui-text-decoration', trueValue: 'underline', falseValue: 'none' },
  },
  letterSpacing: {
    type: 'length', default: '0px',
    space: 'typography', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-letter-spacing' },
  },
  lineSpacing: {
    type: 'number', default: 1.2,
    space: 'typography', tier: 'basic',
    control: 'slider-number',
    resolver: 'css-number-var', resolverArgs: { cssVar: '--ui-line-height' },
  },
  opacity: {
    type: 'number', default: 1,
    space: 'typography', tier: 'basic',
    control: 'slider-number',
    resolver: 'css-number-var', resolverArgs: { cssVar: '--ui-opacity' },
  },
  wordWrap: {
    type: 'boolean', default: true,
    space: 'typography', tier: 'basic',
    control: 'checkbox',
    resolver: 'css-boolean-keyword-var', resolverArgs: { cssVar: '--ui-overflow-wrap', trueValue: 'break-word', falseValue: 'normal' },
  },
  maxWidth: {
    type: 'length', default: '400px',
    space: 'typography', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-max-width' },
  },
  // 'scale' (shrink-to-fit) is a dev-panel-only 4th option, deliberately not
  // mirrored here — it requires a live DOM measurement + JS-driven resize
  // loop (the same architectural category as relative mode / size 'match',
  // not a pure-CSS resolver), and nothing has evidenced a real need for it
  // yet. wrap/truncate/clip are all expressible as pure CSS, same resolver
  // pattern as anchorH/anchorV/widthBasis above.
  overflow: {
    type: 'enum', values: ['wrap', 'truncate', 'clip'], default: 'wrap',
    space: 'typography', tier: 'basic',
    control: 'select',
    resolver: 'css-attr', resolverArgs: { attr: 'data-ui-overflow' },
  },
  outlineEnabled: {
    type: 'boolean', default: false,
    space: 'typography', tier: 'basic',
    control: 'checkbox',
    resolver: 'css-class-toggle', resolverArgs: { class: 'ui-typography-outline' },
  },
  outlineColor: {
    type: 'string', default: '#000000',
    space: 'typography', tier: 'basic',
    control: 'color-picker',
    resolver: 'css-enum-var', resolverArgs: { cssVar: '--ui-outline-color' },
  },
  outlineThickness: {
    type: 'length', default: '2px',
    space: 'typography', tier: 'basic',
    control: 'slider-length',
    resolver: 'css-length', resolverArgs: { cssVar: '--ui-outline-thickness' },
  },
};

// ============================================================
// TYPOGRAPHY_FIELDS — typography is a flat, always-optional field list, same
// architectural shape as CONSTRAINT_FIELDS above (not mode-dispatched).
// ============================================================
export const TYPOGRAPHY_FIELDS = [
  'enabled', 'fontFamily', 'fontSize', 'color', 'bold', 'italic', 'underline',
  'letterSpacing', 'lineSpacing', 'opacity', 'wordWrap', 'maxWidth', 'overflow',
  'outlineEnabled', 'outlineColor', 'outlineThickness',
];

// ============================================================
// MODE_SCHEMA — position modes. required/optional name FIELDS keys above.
// Forbidden fields are DERIVED (not hand-listed): anything not required or
// optional for a mode is implicitly forbidden for it. See validate.mjs.
// ============================================================
export const MODE_SCHEMA = {
  flow: {
    required: ['parent'],
    optional: ['order', 'alignment'],
  },
  anchor: {
    required: ['anchorH', 'anchorV'],
    optional: ['offsetX', 'offsetY'],
  },
  relative: {
    required: ['relativeTo', 'myAnchor', 'targetAnchor'],
    optional: ['offsetX', 'offsetY', 'gap'], // v0.2.8: offsetX / offsetY are literal signed offsets (negative works, any anchor pair); gap is the deprecated direction-aware predecessor
  },
  absolute: {
    required: ['containingBlock'],
    optional: ['x', 'y'],
  },
  fixed: {
    required: ['viewportAnchor'],
    optional: ['offsetX', 'offsetY'],
  },
};

// ============================================================
// SIZE_AXIS_MODE_SCHEMA — size modes, per axis. A field key here is a
// SUFFIX ('Value', 'Min', 'Preferred', 'Max', 'Ratio', 'Basis') that gets
// prefixed with 'width' or 'height' to resolve the real FIELDS key
// (e.g. suffix 'Value' + axis 'width' -> FIELDS.widthValue). This mirrors
// the position schema's own per-mode field-list pattern exactly, applied
// per-axis instead of per-element — see engine.mjs's resolveAxisFields().
// ============================================================
export const SIZE_AXIS_MODE_SCHEMA = {
  content: { required: [], optional: [] },
  fixed: { required: ['Value'], optional: [] },
  fill: { required: [], optional: [] },
  clamp: { required: ['Min', 'Preferred', 'Max'], optional: [] },
  aspect: { required: ['Ratio'], optional: ['Basis'] },
  match: { required: ['RelativeTo'], optional: [] },
};

// ============================================================
// CONSTRAINT_FIELDS — constraints are a flat, always-optional field list
// (not mode-dispatched like position/size — see Architecture Section 6:
// constraints apply uniformly regardless of which position mode resolved
// the element).
// ============================================================
export const CONSTRAINT_FIELDS = ['keepInsideViewport', 'keepInsideParent'];

// ============================================================
// POSITION_MODES / SIZE_MODES — the closed, exhaustive lists. Used by
// validate.mjs and inspector.mjs so "which modes exist" has exactly one
// source, matching every other part of this schema's own design.
// ============================================================
export const POSITION_MODES = Object.keys(MODE_SCHEMA);
export const SIZE_MODES = Object.keys(SIZE_AXIS_MODE_SCHEMA);
