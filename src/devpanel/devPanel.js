// ================================================================
// Verbatim from .claude/TEMPLATE_DEV_PANEL.html's final <script>
// block, plus exactly one inserted splice-point comment below
// (search 'PROJECT: splice point'). Fix real bugs in the template,
// not here -- see CLAUDE.md S12 and LENTICULOSO/CLAUDE.md for the
// worked convention this follows.
// ================================================================
    // ================================================================
    // DEV PANEL ENGINE — everything below is generic, no project-
    // specific names. See the big comment at the top of this file for
    // how to integrate your own settings.
    // ================================================================

    // devPanelBuilt MUST be declared here, as one of the very first
    // statements in this script - NOT further down near
    // ensureDevPanelBuilt() itself, however natural that might look.
    // The DEV toggle button's onclick (parsed early, in the HTML above,
    // long before this ~2000-line script finishes downloading/
    // executing) reads this variable the moment it's clicked - if a
    // visitor clicks it before script execution reaches a `let`
    // declared later in the file, that read throws "Cannot access
    // 'devPanelBuilt' before initialization" (a real bug, reproduced
    // and fixed this exact way in a real project - MAINTENANCE note at
    // the top of this file). Declaring it here, before anything else
    // that could plausibly be clicked, closes that gap by construction.
    let devPanelBuilt = false;

    // isDevAllowed gates both the panel's CSS visibility (the early
    // <head> script above sets html.dev-mode from this SAME condition,
    // kept in sync manually - see its own comment for why it can't
    // share this declaration) and, below, the LAZY-BUILD trigger itself
    // (search "LAZY-BUILD"). PROJECT: if you change this condition,
    // update the early <head> script's own copy to match.
    const isDevAllowed = location.protocol === 'file:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        new URLSearchParams(location.search).get('dev') === '1';

    const devPanel = document.getElementById('devPanel');

    // Which tabs exist, and their DOM-id prefix (tabId + 'TabContent',
    // tabId + 'TabBtn' pattern via devTab<Cap>Btn). Add/remove/rename a
    // tab here — but note the HTML above, the #<id>TabContent.hidden CSS
    // rule, and the 3 tab <button> elements all currently hardcode these
    // 3 literal names too (see the top-of-file comment on why that one
    // CSS rule couldn't be made fully attribute-generic cleanly) — treat
    // this constant as the single source of truth to keep them in sync
    // if you do change it.
    // ================================================================
    // [JS-1] SETUP & TAB CONFIG
    // ================================================================
    const DEV_PANEL_TABS = ['desktop', 'mobile', 'landscape'];

    // Host extension point -- CORRECTED 2026-09-24 (ported from a real
    // project's own dev panel, MAINTENANCE note at the top of this
    // file): a host project with its own tab-dependent logic (e.g. a
    // control/group that should only be visible or active for a
    // particular device) had no reliable way to know when the active tab
    // actually changed -- switchDevPanelTab() (the ONLY place that
    // changes which tab is showing) called nothing a host could hook
    // into, so a host's own tab-dependent visibility code could only
    // ever be evaluated once, at whatever moment it happened to run, and
    // silently go stale the next time the user switched tabs unless the
    // host remembered to wire its own separate click listener on every
    // tab button (fragile, and easy to forget on one of the 3). A real
    // host project hit exactly this: a control meant to hide on Desktop
    // stayed visible after every page load until a tab was clicked.
    // Reassign this to your own function (or edit the body directly) to
    // re-run your own project's tab-dependent logic whenever the active
    // tab changes, e.g.:
    //   devOnTabChanged = (tab) => { myProjectRefreshTabDependentUI(); };
    // No-op by default -- safe to leave unset if nothing in your project
    // depends on which tab is currently showing.
    let devOnTabChanged = function (tab) {};

    function isNarrowViewport() { return window.innerWidth < 768; }

    // ================================================================
    // [JS-2] GROUP COLLAPSE/TOGGLE & CUSTOM GROUP CREATION
    // ================================================================
    // A group title created by createDevGroupElement() carries a
    // trailing cascade checkbox as a real DOM child - every plain
    // `titleEl.textContent = ...` rewrite below would otherwise wipe it
    // (destroying its listeners) every single collapse/expand or rename-
    // sync. Detaches it first, runs `fn`, reattaches the SAME node
    // (listeners/checked state intact) after - a static built-in title
    // (no checkbox) just runs `fn` directly, unaffected either way. See
    // buildGroupCascadeCheckbox()'s own comment ([JS-4b0] above).
    function withPreservedTitleCheckbox(titleEl, fn) {
        // Generalized 2026-09-28 to preserve EVERY direct-child checkbox
        // (was hardcoded to just .dev-group-cascade-checkbox) — the new
        // Toggleable Settings Group checkbox (makeDevGroupToggleable(),
        // below) also lives as a title child and needs the exact same
        // rename/collapse protection, or a rename would silently delete it
        // the same way an unprotected cascade checkbox once would have.
        const cbs = Array.from(titleEl.querySelectorAll(':scope > input[type="checkbox"]'));
        cbs.forEach(cb => cb.remove());
        fn();
        cbs.forEach(cb => titleEl.appendChild(cb));
    }
    // Group collapse/toggle, custom group creation
    function toggleSection(titleEl) {
        if (sectionJustDragged) { sectionJustDragged = false; return; }
        if (textEditModeEnabled) { openDevTextEditFor(titleEl, getSectionKey(titleEl), true); return; }
        const content = titleEl.nextElementSibling;
        content.classList.toggle('collapsed');
        withPreservedTitleCheckbox(titleEl, () => {
            titleEl.textContent = content.classList.contains('collapsed') ? '▶ ' + titleEl.textContent.slice(2) : '▼ ' + titleEl.textContent.slice(2);
        });
        // Direct report 2026-10-15: a curve editor built while its own
        // group is still collapsed (display:none, width 0) bakes a wrong
        // marker counter-scale into its first redraw() (see
        // buildCurveEditorRow's own scaleX comment) - ResizeObserver was
        // tried first to catch the collapsed->expanded transition and
        // confirmed, live, NOT to fire for it in this environment (a
        // display:none-ancestor 0-to-real-size change), so this pokes
        // every curve editor inside the section directly instead, the
        // instant it's actually expanded and has a real size to measure.
        if (!content.classList.contains('collapsed')) {
            content.querySelectorAll('.dev-curve-editor-svg').forEach(svgEl => {
                if (svgEl.__curveEditorRedraw) svgEl.__curveEditorRedraw();
            });
            // Direct request 2026-10-25: expanding a group counts as
            // "interacting with" it, for addDevGroup()'s own no-selection
            // placement rule below (recordDevGroupInteraction()'s own
            // comment has the full reasoning). Only the EXPAND transition
            // counts, never collapse.
            recordDevGroupInteraction(titleEl.closest('.dev-section'));
        }
    }

    // `tab` ('desktop' | 'mobile' | 'landscape') decides which kind of
    // group-level cascade checkbox this group gets - see
    // buildGroupCascadeCheckbox()'s own comment ([JS-4b0] above).
    // Defaults to 'desktop' only for backward compat with any call site
    // that predates this parameter; every real call site in this file
    // passes it explicitly.
    // CORRECTED 2026-09-24 (ported from a real project's own dev panel --
    // MAINTENANCE note at the top of this file): this used to set
    // title.textContent straight from the literal `name`, with no
    // devTextOverrides lookup at all -- only applyDevTextOverrides()'s
    // own explicit sweep (normally run once at page load, or after
    // Reset/Undo) ever reapplied a saved rename. Any host code that
    // rebuilds a group's DOM after its first creation -- a live redraw
    // driven by changed data, a kind-switch, anything beyond this
    // template's own built-in reorder/rename/drag mechanics -- silently
    // lost the rename the moment it rebuilt, unless that host code
    // remembered to call applyDevTextOverrides() itself afterward every
    // single time. Checking devTextOverrides here means a freshly built
    // group is correct by construction, with no host discipline
    // required. Uses the exact same key formula getSectionKey() computes
    // for an already-attached title (`tab + ':' + sid`) -- computed
    // directly here since `section`/`title` aren't attached to a
    // #<tab>TabContent yet at this point, which getSectionKey() itself
    // relies on via .closest().
    function createDevGroupElement(name, tab) {
        const section = document.createElement('div');
        section.className = 'dev-section';
        const title = document.createElement('div');
        title.className = 'dev-section-title';
        title.setAttribute('onclick', 'toggleSection(this)');
        title.dataset.sid = name;
        const sectionKey = (tab || 'desktop') + ':' + name;
        devTextOriginalFor(sectionKey, name);
        title.textContent = '▼ ' + (devTextOverrides[sectionKey] != null ? devTextOverrides[sectionKey] : name);
        title.appendChild(buildGroupCascadeCheckbox(section, (tab || 'desktop') === 'desktop' ? 'visibility' : 'independence'));
        const content = document.createElement('div');
        content.className = 'dev-section-content';
        section.appendChild(title);
        section.appendChild(content);
        addGroupDragHandle(section);
        addGroupLockIcon(section);
        section.appendChild(buildGroupUndockButton(section));
        return section;
    }

    // Builds and appends one group's own drag-handle icon — per CLAUDE.md
    // §12n's far-left-icon-only convention (ported from Clicko's own
    // identical fix; see that project's CHANGELOG for the direct request
    // this came from — ultimately modeled on the Handy Dandies project's
    // own handle-only drag gating). A plain SIBLING of .dev-section-title
    // (see .dev-section's own CSS comment for why — unlike the cascade
    // checkbox, this icon never needs to survive a textContent rewrite
    // via preserve/reattach, since it was never inside the title to begin
    // with). setupDragReorder()'s own pointerdown listener gates on
    // handleSelector ('.dev-group-drag-handle', not '.dev-section-title' —
    // see its own call site below), so a plain click on the title still
    // only ever toggles collapse, never arms a drag. Idempotent (removes
    // any existing handle first) so calling it twice on the same section
    // (e.g. a custom group recreated by applySectionOrder() from saved
    // data) just replaces the icon rather than duplicating it.
    function addGroupDragHandle(section) {
        const existing = section.querySelector(':scope > .dev-group-drag-handle');
        if (existing) existing.remove();
        const titleEl = section.querySelector(':scope > .dev-section-title');
        if (!titleEl) return;
        const handle = document.createElement('span');
        handle.className = 'dev-group-drag-handle';
        handle.textContent = '⠿';
        handle.title = 'Drag to reorder or nest this group';
        section.appendChild(handle);
    }
    // One-time pass over every group already in the DOM when the panel is
    // first built (createDevGroupElement() covers any group added or
    // recreated after this point via its own addGroupDragHandle() call).
    // Tab-wide, any nesting depth — nested groups need the icon too.
    function injectGroupDragHandles() {
        DEV_PANEL_TABS.forEach(tab => {
            const tabEl = document.getElementById(tab + 'TabContent');
            if (!tabEl) return;
            tabEl.querySelectorAll('.dev-section').forEach(addGroupDragHandle);
        });
    }
    // Row-level counterpart. Idempotent (skips a row that already has
    // one) so it's safe to call repeatedly - needed here unlike a fully
    // static panel, since this template's own dynamicDevice feature
    // (ensureDynamicTargetRow(), [JS-4b0] above) DOES create new row DOM
    // after the panel is first built, whenever a Mobile/Landscape mirror
    // row doesn't exist yet. Called once here at panel-build time for
    // every row that exists already, and again at the end of
    // syncTabOrderToDesktop() (see its own call) for any row freshly
    // created by that same sync pass.
    function injectRowDragHandles() {
        document.querySelectorAll('.dev-row').forEach(row => {
            if (row.querySelector(':scope > .dev-row-drag-handle')) return;
            const handle = document.createElement('span');
            handle.className = 'dev-row-drag-handle';
            handle.textContent = '⠿';
            handle.title = 'Drag to reorder or move to another group';
            row.insertBefore(handle, row.firstChild);
        });
    }

    // "+ Add Group" handler — considers EVERY group in the tab (top-
    // level and nested), not just top-level siblings, so a new group's
    // name is unique against an existing nested group's name too.
    // Shift+click multi-select - per direct request ("when i hold the
    // Shift key, I will be able to select a single or multiple settings
    // or groups or a mix of the two. Once selected, when i click Add
    // Group, the selected things will automatically be placed within
    // the new group. Unselect when i click outside of the dev panel").
    // Holds real DOM elements directly (a .dev-row for a selected
    // setting, a .dev-section for a selected group) rather than keys/ids
    // - simpler since a selection is a short-lived, purely-runtime UI
    // gesture with no persistence of its own (never saved/copied), and
    // addDevGroup() below just needs to move these exact nodes.
    const devPanelSelectedItems = new Set();
    // Direct request 2026-10-25: a no-selection "+ Add Group" places the
    // new group at the top of whichever group/subgroup the user most
    // recently "interacted within or with" — tracked here, per tab
    // (each Desktop/Mobile/Landscape tab has its own independent group
    // tree, so a group tracked on one tab is meaningless on another).
    // Two triggers update it, per the request's own explicit examples:
    // (1) expanding a group (toggleSection()'s own expand branch, above
    // — collapsing does NOT count), (2) changing any setting that lives
    // inside a group (the delegated 'input'/'change' listener right
    // below). Deliberately does NOT cover every possible way to
    // "interact" with a group (dragging it, toggling its own cascade
    // checkbox, renaming it, etc.) — scoped to exactly the 2 triggers
    // the request named, not generalized further.
    let lastInteractedDevGroup = { desktop: null, mobile: null, landscape: null };
    function recordDevGroupInteraction(sectionEl) {
        if (!sectionEl || !sectionEl.classList.contains('dev-section')) return;
        const tabEl = sectionEl.closest('[id$="TabContent"]');
        if (!tabEl) return;
        const tab = tabEl.id.slice(0, -'TabContent'.length);
        lastInteractedDevGroup[tab] = sectionEl;
    }
    // Trigger (2) above — any slider drag, checkbox/select change, text
    // edit, or custom-widget hidden-input update (curve editor, range
    // bar, gradient picker, list picker) that happens inside a group's
    // own content counts as "interacting with" that group. One
    // delegated listener covers every control type uniformly, including
    // ones a project's own render*Controls() adds later — no per-
    // control-type wiring needed. Walks to the NEAREST enclosing
    // .dev-section (the deepest group actually containing the changed
    // control), matching "within" in the request's own wording.
    function setupDevGroupInteractionTracking() {
        ['input', 'change'].forEach(evtName => {
            devPanel.addEventListener(evtName, (e) => {
                const content = e.target.closest('.dev-section-content');
                if (!content) return;
                recordDevGroupInteraction(content.parentElement);
            }, true);
        });
    }
    // Set by #devAddGroupBtn's own contextmenu handler
    // (setupDevHeaderIconButtons()) - while true, a PLAIN left click also
    // selects (no Shift needed), per direct request ("If i right click
    // the Add Group button, I want to be able to left click mutiple
    // settings or groups to select them"). Shift+click keeps working
    // regardless of this flag - the two triggers are additive, not
    // mutually exclusive.
    let devGroupSelectionArmed = false;
    function toggleDevSelection(el) {
        if (devPanelSelectedItems.has(el)) {
            devPanelSelectedItems.delete(el);
            el.classList.remove('dev-selected');
        } else {
            devPanelSelectedItems.add(el);
            el.classList.add('dev-selected');
        }
    }
    function clearDevSelection() {
        devPanelSelectedItems.forEach(el => el.classList.remove('dev-selected'));
        devPanelSelectedItems.clear();
    }
    function disarmDevGroupSelection() {
        devGroupSelectionArmed = false;
        const btn = document.getElementById('devAddGroupBtn');
        if (btn) btn.classList.remove('armed');
    }
    // A capturing listener on the panel itself (not each row/title
    // individually) so it works uniformly for every control type,
    // including ones added later by a project's own render*Controls().
    // Capturing + preventDefault/stopPropagation together ensure a
    // Shift+click (or an armed plain click) SELECTS instead of also
    // operating the control under the cursor (toggling a checkbox,
    // collapsing a group via the title's own onclick, etc.) -
    // stopPropagation during capture keeps the event from ever reaching
    // the target's own bubble-phase listeners (including inline
    // onclick="..." attributes) at all. A group's own TITLE takes
    // priority over a row match - Shift/armed-clicking a group's title
    // bar selects the WHOLE group (the entire .dev-section, to be moved
    // as one nested unit), not some nearby row.
    function setupDevGroupSelection() {
        devPanel.addEventListener('click', (e) => {
            if (!e.shiftKey && !devGroupSelectionArmed) return;
            // A shift-click INSIDE a list-picker's own items (.dev-lp-row)
            // is that list-picker's OWN internal multi-select (range-
            // select across its saved items, entry.multiSelected) — a
            // different, more specific meaning than "select this whole
            // control to fold into a new group." Bail out here so the
            // click reaches the list-picker's own row listener instead of
            // being hijacked by this outer, panel-wide selection system —
            // confirmed live 2026-09-28 as a real, pre-existing bug: this
            // capture-phase listener always intercepted a list-picker's
            // own shift-click range-select first, since the list-picker's
            // own outer container carries .dev-row too (closest('.dev-row')
            // matched the WHOLE control, not the individual item).
            if (e.target.closest('.dev-lp-row')) return;
            const titleEl = e.target.closest('.dev-section-title');
            const target = titleEl ? titleEl.closest('.dev-section') : e.target.closest('.dev-row');
            if (!target) return;
            e.preventDefault();
            e.stopPropagation();
            toggleDevSelection(target);
        }, true);
        // Per the request's own explicit clear condition - only a click
        // OUTSIDE the panel clears the selection; normal clicks/drags
        // inside the panel (adjusting a slider, collapsing a group,
        // switching tabs) leave it alone. Also disarms right-click
        // select-mode, same reasoning.
        document.addEventListener('click', (e) => {
            if (devPanel.contains(e.target)) return;
            if (devPanelSelectedItems.size) clearDevSelection();
            if (devGroupSelectionArmed) disarmDevGroupSelection();
        }, true);
    }
    // devSelectionAncestorGroupChain()/findDevSelectionCommonAncestorGroup()
    // (2026-09-20's "nest in the deepest group common to every selected
    // item" logic) were REMOVED 2026-10-25 — superseded by addDevGroup()'s
    // own simpler "insert directly before the first selected item, in its
    // own current parent" rule (see that function's own comment for the
    // full reasoning). Neither function has any other caller.
    function addDevGroup(tab) {
        const tabEl = document.getElementById(tab + 'TabContent');
        const existingNames = new Set(
            Array.from(tabEl.querySelectorAll('.dev-section > .dev-section-title')).map(t => t.dataset.sid)
        );
        let name = 'New Group';
        let n = 2;
        while (existingNames.has(name)) { name = 'New Group (' + n + ')'; n++; }
        const section = createDevGroupElement(name, tab);
        const selectedInTab = Array.from(devPanelSelectedItems).filter(el => tabEl.contains(el));
        // Placement, corrected 2026-10-25 (direct request, superseding
        // the 2026-09-20 "deepest common ancestor" rework below — kept
        // here for history, not followed any more):
        // "When I right click to group multiple items... place the group
        // in the same nesting and order location as the first item. If
        // I click new group with a left click [no selection], place the
        // group at the top of the group/subgroup I most recently
        // interacted within."
        //
        // WITH a selection: insert the new (still-empty) group directly
        // in front of the FIRST selected item (devPanelSelectedItems is
        // a Set, so insertion order = selection order — "first" means
        // first-clicked, not necessarily topmost on screen), in that
        // item's OWN current parent. This is simpler than, and replaces,
        // the old findDevSelectionCommonAncestorGroup() approach — the
        // first item's own parent already IS the correct nesting level
        // by construction, no separate "common ancestor of every
        // selected item" computation needed. A later selected item from
        // a DIFFERENT subgroup still gets moved into the new group same
        // as before (selectedInTab.forEach(...) below) — only WHERE the
        // group itself lands changed, not whether cross-subgroup items
        // get folded in.
        //
        // WITHOUT a selection: use lastInteractedDevGroup[tab] (see its
        // own declaration/recordDevGroupInteraction() comment) if it's
        // still a real, attached group — top of ITS content. Falls back
        // to the original Debug -> Dev Panel -> position-0 top-of-list
        // placement (2026-09-20's own fix, still correct as the
        // fallback) when nothing has been interacted with yet this
        // session, or the tracked group was since deleted.
        if (selectedInTab.length) {
            const firstSelected = selectedInTab[0];
            firstSelected.parentElement.insertBefore(section, firstSelected);
        } else {
            const tracked = lastInteractedDevGroup[tab];
            const trackedContent = (tracked && document.body.contains(tracked)) ? tracked.querySelector(':scope > .dev-section-content') : null;
            if (trackedContent) {
                trackedContent.insertBefore(section, trackedContent.firstChild);
            } else {
                // Per direct request ("When I add a new group, place it at
                // the top of the list instead of the bottom") - inserted
                // right after the built-in Dev Panel/Debug groups, which
                // stay first per CLAUDE.md §12i/§12i-1's own mandatory
                // ordering (buttons, then Dev Panel, then Debug, THEN any
                // project-specific groups) - so this is the top of the
                // project-specific group list, not a literal position-0
                // insert that would push a new custom group above those 2
                // mandatory ones.
                // Falls back through UI -> Debug -> Dev Panel -> position 0
                // (UI added 2026-10-25, 3rd mandatory group upstream in the
                // template, kept here for drop-in parity even though this
                // project has no top-level group literally named "UI" —
                // the optional-chained lookup below simply finds nothing
                // and falls through), not straight to position 0 the
                // moment none is found at the top level - a user (or an
                // earlier fold-into-new-group action) can legally nest any
                // of them somewhere else, and jumping straight to position
                // 0 in that case would incorrectly place a new custom
                // group above the others too (caught live, pre-UI, on the
                // template: folding Debug into a new group left a
                // SUBSEQUENT new group landing before Dev Panel, since the
                // old version only ever checked for Debug).
                const uiSection = tabEl.querySelector(':scope > .dev-section > .dev-section-title[data-sid="UI"]')?.closest('.dev-section');
                const debugSection = tabEl.querySelector(':scope > .dev-section > .dev-section-title[data-sid="Debug"]')?.closest('.dev-section');
                const devPanelSection = tabEl.querySelector(':scope > .dev-section > .dev-section-title[data-sid="Dev Panel"]')?.closest('.dev-section');
                const anchorSection = uiSection || debugSection || devPanelSection;
                if (anchorSection) {
                    tabEl.insertBefore(section, anchorSection.nextSibling);
                } else {
                    tabEl.insertBefore(section, tabEl.firstChild);
                }
            }
        }
        // Per direct request ("New Feature - when i hold the Shift key...
        // Once selected, when i click Add Group, the selected things
        // will automatically be placed within the new group") - fold any
        // current selection into the group just created, scoped to THIS
        // tab only (a selection lingering from a different tab, if any,
        // is left alone rather than silently vanishing/relocating
        // cross-tab - see setupDevGroupSelection()'s own comment).
        const content = section.querySelector(':scope > .dev-section-content');
        if (selectedInTab.length) {
            selectedInTab.forEach(el => content.appendChild(el));
            clearDevSelection();
            injectRowDragHandles();
        }
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Whichever Desktop/Mobile/Landscape tab is currently showing - same
    // expression already used elsewhere in this file (see the scroll-
    // wheel handler below) for "which tab am I actually looking at right
    // now", reused here so the header's own Add Group/Collapse All
    // buttons (single shared controls, not one per tab any more - see
    // their own HTML comment) know which tab to act on.
    function getActiveDevPanelTab() {
        return DEV_PANEL_TABS.find(t => !document.getElementById(t + 'TabContent').classList.contains('hidden')) || 'desktop';
    }
    // "Collapse All" - per direct request. Collapses every group (any
    // nesting depth) in the currently active tab that isn't already
    // collapsed - reuses toggleSection()'s own collapse/expand mechanics
    // directly (not a call to toggleSection() itself, since that also
    // handles Text Edit Mode's click-to-rename branch, irrelevant here).
    function collapseAllDevGroups() {
        const tabEl = document.getElementById(getActiveDevPanelTab() + 'TabContent');
        tabEl.querySelectorAll('.dev-section-title').forEach(titleEl => {
            const content = titleEl.nextElementSibling;
            if (!content || content.classList.contains('collapsed')) return;
            content.classList.add('collapsed');
            withPreservedTitleCheckbox(titleEl, () => {
                titleEl.textContent = '▶ ' + titleEl.textContent.slice(2);
            });
        });
    }
    // Wires the 3 header icon buttons - per direct request ("Text Edit
    // Mode and Add Group are now icon buttons on the Dev Panel Title
    // Label bit. Also provide a 'Collapse All' button there... If i
    // right click the Add Group button, I want to be able to left click
    // mutiple settings or groups to select them, then when i left click
    // or right click Add Group again, all the selected items will be
    // placed within the new group."). Called once from
    // initDevPanelEngine() - always on, same as the D-key listener and
    // setupDevGroupSelection(), regardless of whether the panel's own
    // controls have been lazily built yet.
    function setupDevHeaderIconButtons() {
        const textEditBtn = document.getElementById('devTextEditModeBtn');
        if (textEditBtn) {
            textEditBtn.classList.toggle('active', textEditModeEnabled);
            textEditBtn.addEventListener('click', () => {
                textEditModeEnabled = !textEditModeEnabled;
                textEditBtn.classList.toggle('active', textEditModeEnabled);
            });
        }
        const addGroupBtn = document.getElementById('devAddGroupBtn');
        if (addGroupBtn) {
            // A plain left click: if armed (a right-click already started a
            // selection), this is the "finalize" click - create the group
            // and fold the selection in, same as a right-click would (see
            // below). If NOT armed, it's just the ORIGINAL, unchanged
            // behavior - create an empty group immediately.
            addGroupBtn.addEventListener('click', () => {
                addDevGroup(getActiveDevPanelTab());
                disarmDevGroupSelection();
            });
            // Right click: arms select mode on the FIRST right-click (no
            // group created yet - just starts letting plain left-clicks
            // select). A SECOND right-click, while already armed, finalizes
            // instead - matches the request's own "when i left click or
            // right click Add Group again" wording (either button, once
            // armed, does the same finalize action).
            addGroupBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (devGroupSelectionArmed) {
                    addDevGroup(getActiveDevPanelTab());
                    disarmDevGroupSelection();
                } else {
                    if (typeof devDeleteGroupArmed !== 'undefined' && devDeleteGroupArmed) disarmDevDeleteGroup();
                    devGroupSelectionArmed = true;
                    addGroupBtn.classList.add('armed');
                }
            });
        }
        const collapseAllBtn = document.getElementById('devCollapseAllBtn');
        if (collapseAllBtn) collapseAllBtn.addEventListener('click', collapseAllDevGroups);
        const deleteGroupBtn = document.getElementById('devDeleteGroupBtn');
        if (deleteGroupBtn) {
            // A plain click arms/disarms (toggle) - unlike Add Group,
            // Delete has no OTHER click behavior to stay compatible with,
            // so it doesn't need Add Group's left-vs-right-click
            // distinction. Arming this also disarms Add Group's own
            // selection-arm mode (and vice versa, in that button's own
            // contextmenu handler above) - both being armed at once would
            // make a single group-title click ambiguous between "select
            // it" and "delete it".
            deleteGroupBtn.addEventListener('click', () => {
                if (devDeleteGroupArmed) {
                    disarmDevDeleteGroup();
                } else {
                    disarmDevGroupSelection();
                    devDeleteGroupArmed = true;
                    deleteGroupBtn.classList.add('armed');
                }
            });
        }
    }
    let devDeleteGroupArmed = false;
    function disarmDevDeleteGroup() {
        devDeleteGroupArmed = false;
        const btn = document.getElementById('devDeleteGroupBtn');
        if (btn) btn.classList.remove('armed');
    }
    // Walks target's own .dev-section AND every ancestor .dev-section,
    // refusing deletion if any of them is mandatory standing scaffolding
    // (Dev Panel/Debug - CLAUDE.md Section 12i/12i-1) - ported from
    // Clicko (2026-09-17), which additionally checks a locked-groups Set
    // this template doesn't have (lock-groups is Clicko-only), so this
    // version only has the mandatory-scaffolding half of that check.
    // Checking the WHOLE ancestor chain (not just the immediate parent)
    // means a setting living inside Dev Panel/Debug is refused the same
    // way the group itself already was.
    function findDevDeleteProtectionReason(el) {
        let sec = el.closest('.dev-section');
        while (sec) {
            const titleEl = sec.querySelector(':scope > .dev-section-title');
            if (titleEl) {
                const sid = titleEl.dataset.sid;
                if (sid === 'Dev Panel' || sid === 'Debug') {
                    return 'mandatory standing scaffolding (CLAUDE.md Section 12i/12i-1)';
                }
                if (lockedGroups.has(getSectionKey(titleEl))) {
                    return 'locked ("' + titleEl.textContent.slice(2) + '")';
                }
            }
            sec = sec.parentElement ? sec.parentElement.closest('.dev-section') : null;
        }
        return null;
    }
    // Per direct request ("Add a delete group button next to the add
    // group function. Functionally, I will click it, it highlights like
    // the add group right click, then i will click a group to delete"),
    // extended per direct follow-up ("Delete button should also allow me
    // to delete single settings") - ported from Clicko (2026-09-17). A
    // capturing listener on the panel (same "title takes priority over
    // row" pattern as setupDevGroupSelection()) so it works uniformly for
    // a group (any nesting depth) or an individual setting row;
    // preventDefault/stopPropagation stop the click from also collapsing
    // the group via its own onclick.
    function setupDevDeleteGroup() {
        devPanel.addEventListener('click', (e) => {
            if (!devDeleteGroupArmed) return;
            if (e.target.closest('#devDeleteGroupBtn')) return;
            const titleEl = e.target.closest('.dev-section-title');
            const target = titleEl ? titleEl.closest('.dev-section') : e.target.closest('.dev-row');
            if (!target) return;
            e.preventDefault();
            e.stopPropagation();
            const reason = findDevDeleteProtectionReason(target);
            if (reason) {
                console.warn('Delete: refused - ' + reason);
                disarmDevDeleteGroup();
                return;
            }
            // pushDevDeleteUndoEntry(), not the generic pointerdown-based
            // snapshot push - see that function's own comment for why a
            // plain value snapshot can't actually undo a deletion.
            // parent/nextSibling captured BEFORE remove() so undo can put
            // the node back in its exact original spot.
            const parent = target.parentElement;
            const nextSibling = target.nextElementSibling;
            target.remove();
            pushDevDeleteUndoEntry(target, parent, nextSibling);
            disarmDevDeleteGroup();
        }, true);
        document.addEventListener('click', (e) => {
            if (devPanel.contains(e.target)) return;
            if (devDeleteGroupArmed) disarmDevDeleteGroup();
        }, true);
    }

    // Infinite undo (2026-09-17, ported from Clicko) - per direct request
    // ("Add... an undo button. It will undo any dev panel changes be it
    // reordering, setting input change, renaming, group nesting,
    // anything. And allow me to undo infinitely until the last save
    // click"), later clarified as session-only ("the undo only remembers
    // changes within that browser session. so if i refresh, the undo
    // wont do anything... it rememebrs all changes from that moment,
    // until i click save, then it starts new again").
    //
    // Implementation: a plain in-memory stack of FULL PANEL SNAPSHOTS
    // (captureFullDevPanelState() - the exact same object Copy/Sync/Named
    // Setting States already build) for ordinary value/order/rename
    // changes, PLUS a separate entry kind for deletions specifically -
    // see pushDevDeleteUndoEntry()'s own comment for why a value snapshot
    // alone can't undo a deletion (it can recreate a deleted GROUP only
    // as an empty shell, and has no way to recreate a deleted SETTING's
    // actual control markup at all - confirmed live on Clicko before this
    // port: deleting a group then a setting inside it, Undo brought names
    // back but the actual content stayed gone).
    //
    // WHEN a snapshot gets pushed: not wired into each of the dev panel's
    // dozen+ mutation code paths individually. Instead, ONE capturing
    // 'pointerdown' listener on the whole panel pushes a snapshot the
    // FIRST time the pointer goes down inside it, gated to once per
    // "gesture" (reset on pointerup/pointercancel/window-focus - see
    // resetDevUndoGesture()'s own comment for why 3 separate reset paths
    // are needed) - pointerdown fires before essentially every kind of
    // interaction this panel has, so this single hook captures the
    // pre-action state for all of them without touching their own
    // individual handlers. A multi-tick drag (a slider dragged across
    // many 'input' events, or a reorder dragged across many pointermove
    // events) is correctly captured as ONE undo step, not one per tick,
    // since the gesture gate only pushes on the drag's own initial
    // pointerdown.
    let devUndoStack = [];
    let devUndoGestureActive = false;
    // Extension point for state Undo can't see on its own (2026-09-27,
    // ported from a real HANDO bug/fix — direct report: "when i hit undo,
    // it doesnt undo the last setting i chaged. it seems ot undo the last
    // pose change"). This panel's own undo snapshot only ever captures
    // `captureFullDevPanelState()` — the dev panel's OWN controls. Any
    // project that has host state living OUTSIDE those controls (HANDO's
    // case: a draggable 3D gizmo that mutates a skeleton bone's rotation
    // directly, never through a dev-panel slider) is invisible to Undo
    // for 2 separate reasons: the panel's own pointerdown-gated push
    // below is scoped to `devPanel`'s own DOM, so an interaction on a
    // <canvas> or anywhere else outside the panel never triggers a push
    // at all; and even if it did, `captureFullDevPanelState()` has
    // nothing in it to restore that state from.
    //
    // A project sets these 2 (both optional, default no-op) directly,
    // same convention as registerDevControlArray() — usually right next
    // to its own render*Controls() call (top-of-file usage step 3):
    //   devUndoCaptureExtra = () => ({ boneQuat: myBone.quaternion.toArray() });
    //   devUndoApplyExtra = (extra) => { myBone.quaternion.fromArray(extra.boneQuat); myBone.updateMatrixWorld(true) };
    // Then call `pushDevPanelUndoSnapshot()` directly (it's just a plain
    // function in this same script scope, nothing to import) from
    // wherever the project's own OUTSIDE-the-panel interaction begins
    // (HANDO's case: the gizmo's own `mouseDown` handler) — the same
    // checkpoint a real panel edit already gets for free via the
    // pointerdown listener below.
    let devUndoCaptureExtra = null;
    let devUndoApplyExtra = null;
    // Save/Load's own equivalent of the pair directly above — same
    // reasoning, different pipeline. Per direct request 2026-09-28 ("any
    // settings i set within any ui... be it text based, or dev panel
    // based, or anything, that should be captured by the Save button, as
    // well as captured by the undo button... even setting changes i
    // change within browser screen space, for example... if i drag a
    // finger gizmo, that too should be saved unless told otherwise"): a
    // project with host state living OUTSIDE the dev panel's own
    // registered controls needs BOTH extension points wired, not just
    // the undo one, or that state survives Undo/Redo but is silently
    // lost on Save/reload. Default is no-op — a project opts in the same
    // way as devUndoCaptureExtra/devUndoApplyExtra:
    //   devSaveCaptureExtra = () => ({ boneQuat: myBone.quaternion.toArray() });
    //   devSaveApplyExtra = (extra) => { myBone.quaternion.fromArray(extra.boneQuat); myBone.updateMatrixWorld(true) };
    let devSaveCaptureExtra = null;
    let devSaveApplyExtra = null;
    function pushDevPanelUndoSnapshot() {
        // Deep-cloned (JSON round-trip - every field captureFullDevPanelState()
        // returns is already plain JSON-safe data) - REQUIRED, not a
        // defensive extra: that function returns some fields (cssVars-
        // equivalents inside `controls`, devPanelStyle, etc.) by plain
        // reference in places, the SAME live objects later edits mutate
        // in place. Pushing the object literal as-is (caught live on
        // Clicko before this port: a slider dragged from 42.5 to 55, then
        // Undo, "restored" to 55 instead of 42.5) meant every snapshot
        // already on the stack silently changed underneath Undo the
        // moment ANY later edit touched the same underlying state
        // object, since they were never actually 2 separate objects to
        // begin with. Same reasoning applies to `extra` below.
        const extra = devUndoCaptureExtra ? devUndoCaptureExtra() : undefined;
        devUndoStack.push({
            kind: 'snapshot',
            data: JSON.parse(JSON.stringify(captureFullDevPanelState())),
            extra: extra !== undefined ? JSON.parse(JSON.stringify(extra)) : undefined
        });
    }
    // A SEPARATE undo-entry kind, specifically for deleting a group or
    // setting (called from setupDevDeleteGroup()'s own click handler) -
    // NOT just another pushDevPanelUndoSnapshot() call. Captures the
    // REAL, LIVE DOM node being removed (not a clone - a live node keeps
    // its own already-wired event listeners, so no re-wiring is needed on
    // restore) plus exactly where it sat (parent + nextSibling), and puts
    // it straight back on undo - full-fidelity by construction, for a
    // group (with all its own contents, at any nesting depth) or a
    // single setting row alike.
    function pushDevDeleteUndoEntry(node, parent, nextSibling) {
        devUndoStack.push({ kind: 'delete', node, parent, nextSibling });
        devRedoStack = []; // a genuine new edit invalidates any pending redo history
    }
    // Redo — direct request 2026-09-28. A separate LIFO stack, populated
    // only by undoDevPanelChange()/redoDevPanelChange() themselves (never
    // by a real edit directly — see setupDevPanelUndo()'s own pointerdown
    // listener, which clears it instead). For a 'delete' entry, undo and
    // redo are exact mirror images of the same {node, parent,
    // nextSibling} descriptor — reusing the SAME object for both
    // directions is correct by construction, since re-inserting then
    // re-removing the same node at the same anchor point is a well-
    // defined, reversible pair of DOM operations.
    let devRedoStack = [];
    function undoDevPanelChange() {
        if (!devUndoStack.length) return;
        const entry = devUndoStack.pop();
        if (entry.kind === 'delete') {
            devRedoStack.push(entry); // redoing = deleting this same node again
            if (entry.nextSibling && entry.nextSibling.parentNode === entry.parent) {
                entry.parent.insertBefore(entry.node, entry.nextSibling);
            } else {
                entry.parent.appendChild(entry.node);
            }
        } else {
            const extra = devUndoCaptureExtra ? devUndoCaptureExtra() : undefined;
            devRedoStack.push({
                kind: 'snapshot',
                data: JSON.parse(JSON.stringify(captureFullDevPanelState())),
                extra: extra !== undefined ? JSON.parse(JSON.stringify(extra)) : undefined
            });
            applyFullDevPanelState(entry.data);
            if (entry.extra !== undefined && devUndoApplyExtra) devUndoApplyExtra(entry.extra);
        }
    }
    function redoDevPanelChange() {
        if (!devRedoStack.length) return;
        const entry = devRedoStack.pop();
        if (entry.kind === 'delete') {
            devUndoStack.push(entry); // undoing the redo = re-inserting it again
            entry.node.remove();
        } else {
            pushDevPanelUndoSnapshot();
            applyFullDevPanelState(entry.data);
            if (entry.extra !== undefined && devUndoApplyExtra) devUndoApplyExtra(entry.extra);
        }
    }
    // How long a "gesture" is allowed to hold the undo-push gate open with
    // no matching pointerup - a real, confirmed bug on Clicko before this
    // port: opening a NATIVE color picker (this panel's own
    // <input type="color"> controls) never delivers a pointerup back to
    // the page at all - the OS-level picker dialog eats it - which
    // permanently stuck devUndoGestureActive at true and silently broke
    // EVERY undo push for the rest of the session after the first color
    // picker use. Generous on purpose - real slider/reorder drags can
    // legitimately run a few seconds; this is a safety net for a
    // genuinely abandoned/swallowed gesture, not a normal timer.
    const DEV_UNDO_GESTURE_TIMEOUT_MS = 2000;
    let devUndoGestureTimer = null;
    function resetDevUndoGesture() {
        devUndoGestureActive = false;
        if (devUndoGestureTimer) { clearTimeout(devUndoGestureTimer); devUndoGestureTimer = null; }
    }
    // Direct request 2026-10-06 ("Scrolling doesnt count"): a pointerdown
    // whose target is EXACTLY one of these generic wrapper elements (not
    // a more specific descendant) is "the empty space you'd grab to
    // scroll the panel by dragging" — never a real interaction. Checking
    // for an EXACT match (not .closest()) is what makes this robust
    // against every current and future control type without having to
    // enumerate them: a button, input, drag handle, lock icon, curve-
    // editor SVG, etc. is always a MORE SPECIFIC target than its own
    // containing row/section/scroll-area, so it never matches this list
    // and always still triggers a snapshot as before.
    function isDevUndoScrollOnlyTarget(el) {
        if (el === devPanel) return true;
        if (!el.classList) return false;
        return el.classList.contains('dev-panel-scroll-content')
            || el.classList.contains('dev-section-content')
            || el.classList.contains('dev-row')
            || el.classList.contains('dev-section')
            || el.classList.contains('dev-header-buttons')
            || el.classList.contains('dev-buttons')
            || el.classList.contains('dev-list-picker')
            || el.classList.contains('dev-lp-group-body')
            || el.classList.contains('dev-lp-ungrouped-body');
    }
    function setupDevPanelUndo() {
        devPanel.addEventListener('pointerdown', (e) => {
            if (devUndoGestureActive) return;
            if (isDevUndoScrollOnlyTarget(e.target)) return;
            // While Delete Group/Setting is armed, the very next click
            // either deletes something (which pushes its own precise
            // pushDevDeleteUndoEntry() instead) or is refused/disarms with
            // no mutation at all - a plain value snapshot here would be a
            // dead, unpoppable-to-any-useful-state entry either way, so
            // skip it.
            if (devDeleteGroupArmed) return;
            // THE root cause of a real, confirmed "Undo does literally
            // nothing" report on Clicko (2026-09-17), ported here as a
            // fix, not just a feature: the Undo button is itself inside
            // devPanel, so clicking it ALSO fires this same capturing
            // pointerdown listener - without this guard, a click on Undo
            // would push a snapshot of the CURRENT (already-changed)
            // state, then its own 'click' handler immediately pops that
            // SAME just-pushed entry, restoring the current state onto
            // itself - a complete no-op that leaves the user's real prior
            // change buried, untouched, one slot deeper on the stack
            // (confirmed live on Clicko: after one real edit + one real
            // Undo click, devUndoStack.length was 1, not the correct 0).
            // Every earlier test of this feature used undoBtn.click() (the
            // JS method) to trigger Undo, which does NOT fire pointerdown/
            // mousedown at all, only 'click' directly - exactly why this
            // never showed up in testing despite extensive verification;
            // only a REAL mouse click (or a synthetic pointerdown+click
            // pair) exposes it.
            // Redo button needs the exact same self-push guard as Undo,
            // for the identical reason (it's also inside devPanel).
            if (e.target.closest('#devUndoBtn') || e.target.closest('#devRedoBtn')) return;
            devUndoGestureActive = true;
            pushDevPanelUndoSnapshot();
            // A genuine new edit invalidates any pending redo history —
            // standard undo/redo semantics, direct request 2026-09-28.
            devRedoStack = [];
            // Belt-and-suspenders reset, on top of the real pointerup/
            // pointercancel/focus listeners below - if NONE of those ever
            // fire for some reason this hasn't been discovered yet, the
            // gate still can't stay stuck forever.
            devUndoGestureTimer = setTimeout(resetDevUndoGesture, DEV_UNDO_GESTURE_TIMEOUT_MS);
        }, true);
        document.addEventListener('pointerup', resetDevUndoGesture, true);
        document.addEventListener('pointercancel', resetDevUndoGesture, true);
        // Catches the native-picker-eats-pointerup case directly - the
        // window reliably regains focus the moment a native color/file/
        // date picker (or any other OS-level dialog) closes, even though
        // the page itself never saw a pointerup for the click that opened
        // it.
        window.addEventListener('focus', resetDevUndoGesture);
        const undoBtn = document.getElementById('devUndoBtn');
        if (undoBtn) undoBtn.addEventListener('click', undoDevPanelChange);
        const redoBtn = document.getElementById('devRedoBtn');
        if (redoBtn) redoBtn.addEventListener('click', redoDevPanelChange);
        // Ctrl+Z - standard undo shortcut, matching the D/R single-key
        // shortcuts this panel already has (Hide/Reset). Ctrl+Shift+Z and
        // Ctrl+Y (the 2 most common cross-platform Redo shortcuts) added
        // 2026-09-28, direct request ("also provide the keyboard shortcut
        // like ctrl z"). Ignored while focus is in a genuine text-input
        // context (a rename textarea, the search box) so it doesn't fight
        // the browser/OS's own native text-field undo/redo.
        document.addEventListener('keydown', (e) => {
            if (!(e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y') || !(e.ctrlKey || e.metaKey)) return;
            const tag = document.activeElement ? document.activeElement.tagName : '';
            if (tag === 'TEXTAREA' || (tag === 'INPUT' && document.activeElement.type === 'text')) return;
            e.preventDefault();
            const isRedo = (e.key === 'y' || e.key === 'Y') || ((e.key === 'z' || e.key === 'Z') && e.shiftKey);
            if (isRedo) redoDevPanelChange(); else undoDevPanelChange();
        });
    }
    // Clears the undo AND redo stacks - called from saveDevPanelSettings()
    // itself (per the request's own explicit "until i click save, then it
    // starts new again"), so a Sync draws a hard line under everything
    // before it; nothing before a Sync is ever undoable OR redoable after
    // it.
    function clearDevPanelUndoStack() {
        devUndoStack = [];
        devRedoStack = [];
    }

    // ============================================================
    // [JS-HOTKEYS] CUSTOM HOTKEY ASSIGNMENT SYSTEM
    // ============================================================
    // Ported from Handyset's src/devpanel/devPanel.js (2026-09-30)
    // Users can assign single-letter hotkeys (like 'R' for Reset) to any control
    // Multi-key sequences supported via 500ms timeout window
    let devHotkeys = {}; // { 'r': { id: 'resetBtn', action: 'click' }, ... }
    let hotkeyBuffer = '';
    let hotkeyBufferTimer = null;
    const HOTKEY_SEQUENCE_WINDOW_MS = 500;

    // FIXED 2026-10-04 (ported from HANDO, after "Set hotkeys button doesn't seem to
    // work"). Faults in the version this replaced, all read from its code:
    //  1. The listener called preventDefault() on EVERY plain letter and on every
    //     Ctrl/Alt/Shift+letter whenever focus wasn't in a text box -- whether or not a
    //     hotkey was assigned -- so it silently killed browser shortcuts (Ctrl+F, Ctrl+R,
    //     Ctrl+C ...). It now only intercepts a combo that is actually assigned.
    //  2. A single-letter hotkey waited the full 500 ms sequence window before firing.
    //     It now fires at once unless a longer assigned sequence starts with it.
    //  3. The Set Hotkey button was swallowed by its own capture listener (it is a
    //     .dev-header-icon-btn with an id), so once armed it could not be switched off.
    //  4. The editor was a text box that needed an extra Enter/click-away; it now commits
    //     the moment the key is pressed (Esc cancels, Backspace clears) and disarms.
    //  5. Hotkeys were never saved; they are now part of captureFullDevPanelState()
    //     (Copy / Sync / Reset / Undo / Saved Dev Settings).
    //  6. A slider/colour/number hotkey did nothing on press (click() on a range is a
    //     no-op); it now focuses the control, and a select cycles to its next option.
    function isTypingIntoAnInput(e) {
        const el = document.activeElement;
        if (!el) return false;
        if (el.isContentEditable) return true;
        const tag = el.tagName;
        if (tag === 'TEXTAREA') return true;
        if (tag === 'INPUT' && (el.type === 'text' || el.type === 'number' || el.type === 'email' || el.type === 'password' || el.type === 'search' || el.type === 'url')) return true;
        return false;
    }

    // ROOT CAUSE of "Set hotkeys doesn't work" in this template (found 2026-10-04 by live test): the
    // hotkey code was ported from Handyset/HANDO, where an `el()` DOM helper exists, but this
    // template never defined one -- so starting ANY hotkey assignment threw "el is not defined"
    // and nothing could be assigned. Defined here under its own name (hkEl) so it can't be
    // shadowed by the many local `const el = ...` variables in this file.
    function hkEl(tag, className, attrs) {
        const n = document.createElement(tag);
        if (className) n.className = className;
        if (attrs) {
            Object.keys(attrs).forEach(k => {
                if (k === 'style') n.style.cssText = attrs[k];
                else if (k in n) n[k] = attrs[k];
                else n.setAttribute(k, attrs[k]);
            });
        }
        return n;
    }

    // "ctrl+shift+x"-style combo for a real key event; null for a bare modifier press.
    function hotkeyComboFromEvent(e) {
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
        const mods = (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + (e.shiftKey ? 'shift+' : '') + (e.altKey ? 'alt+' : '');
        return mods + (e.key === ' ' ? 'space' : e.key.toLowerCase());
    }

    function processHotkeyBuffer() {
        const key = hotkeyBuffer.toLowerCase();
        if (devHotkeys[key]) triggerHotkey(devHotkeys[key]);
        hotkeyBuffer = '';
    }

    function triggerHotkey(entry) {
        if (entry.fn) { entry.fn(); return; }
        const el = entry.id ? document.getElementById(entry.id) : null;
        if (!el) return;
        if (entry.action === 'toggle' && el.classList) { el.classList.toggle(entry.toggleClass || 'active'); return; }
        if (el.tagName === 'SELECT' && el.options.length) {
            el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.tagName === 'INPUT' && ['range', 'color', 'text', 'number'].includes(el.type)) {
            // Nothing to "press" on a slider/colour/text box: bring it into view and focus it.
            el.scrollIntoView({ block: 'nearest' });
            el.focus();
        } else {
            el.click();
        }
    }

    function setupHotkeySequenceListener() {
        // Capture phase, so an assigned key wins over any other keydown handler.
        document.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const combo = hotkeyComboFromEvent(e);
            if (!combo) return;
            const hasMod = combo.includes('+');
            if (isTypingIntoAnInput(e) && !(e.ctrlKey || e.metaKey || e.altKey)) return;
            // Modifier combos and named keys (f5, arrowup, space ...): exact lookup only.
            if (hasMod || combo.length > 1) {
                const entry = devHotkeys[combo];
                if (!entry) return; // not ours: leave the browser's own shortcut alone
                e.preventDefault();
                e.stopPropagation();
                triggerHotkey(entry);
                return;
            }
            // Plain single character: sequence-aware, but fire immediately when nothing longer matches.
            hotkeyBuffer += combo;
            clearTimeout(hotkeyBufferTimer);
            const exact = devHotkeys[hotkeyBuffer];
            const longer = Object.keys(devHotkeys).some(k => k.length > hotkeyBuffer.length && k.startsWith(hotkeyBuffer) && /^[a-z0-9]+$/.test(k));
            if (exact && !longer) {
                e.preventDefault();
                e.stopPropagation();
                triggerHotkey(exact);
                hotkeyBuffer = '';
            } else if (exact || longer) {
                e.preventDefault();
                e.stopPropagation();
                hotkeyBufferTimer = setTimeout(processHotkeyBuffer, HOTKEY_SEQUENCE_WINDOW_MS);
            } else {
                hotkeyBuffer = '';
            }
        }, true);
    }

    // Hotkey assignment - manual per-control binding. State: devHotkeys, devSetHotkeyArmed
    let devSetHotkeyArmed = false;

    function disarmHotkeyAssign() {
        devSetHotkeyArmed = false;
        const btn = document.getElementById('devSetHotkeyBtn');
        if (btn) btn.classList.remove('armed');
    }

    function setupSetHotkeyButton() {
        const btn = document.getElementById('devSetHotkeyBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (devSetHotkeyArmed) { disarmHotkeyAssign(); return; }
            devSetHotkeyArmed = true;
            btn.classList.add('armed');
            // Disarm other modes
            devGroupSelectionArmed = false;
            devDeleteGroupArmed = false;
        });
    }

    function setupHotkeyAssignmentCapture() {
        // Wire data-hotkey-default buttons (e.g. Copy, Reset, Sync)
        document.querySelectorAll('[data-hotkey-default]').forEach(el => {
            const key = el.getAttribute('data-hotkey-default');
            if (key) devHotkeys[key.toLowerCase()] = { id: el.id, action: 'click' };
        });
        // Click listener: when armed, clicking a control or header button opens hotkey editor
        devPanel.addEventListener('click', (e) => {
            if (!devSetHotkeyArmed) return;
            // The Set Hotkey button itself (and the editor) must keep working, or armed mode can never be left.
            if (e.target.closest('#devSetHotkeyBtn, .dev-hotkey-input, .dev-hotkey-modal')) return;

            // Header buttons first (dev-header-icon-btn, dev-collapse-btn, dev-hide-btn)
            const headerBtn = e.target.closest('.dev-header-icon-btn, .dev-collapse-btn, .dev-hide-btn');
            if (headerBtn && headerBtn.id) {
                e.preventDefault();
                e.stopPropagation();
                startHotkeyEditForHeaderBtn(headerBtn);
                return;
            }

            // Then .dev-row (regular settings)
            const row = e.target.closest('.dev-row');
            if (row) {
                e.preventDefault();
                e.stopPropagation();
                startHotkeyEdit(row);
                return;
            }
        }, true);
    }

    // Real key capture shared by the row editor and the header-button modal: press the
    // key (or Ctrl/Shift/Alt + key). Esc cancels, Backspace/Delete clears this target's
    // hotkeys. Commits immediately and leaves assignment mode.
    function openHotkeyCapture(parent, targetId, afterCommit) {
        devPanel.querySelectorAll('.dev-hotkey-input').forEach(n => n.remove());
        document.querySelectorAll('.dev-hotkey-modal .dev-hotkey-input').forEach(n => n.remove());
        const input = hkEl('input', 'dev-hotkey-input', { type: 'text', maxLength: '20', placeholder: 'press a key (Esc cancels, Backspace clears)' });
        input.readOnly = true;
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            const modal = input.closest('.dev-hotkey-modal');
            input.remove();
            if (modal) modal.remove();
            disarmHotkeyAssign();
        };
        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') { finish(); return; }
            const clear = (e.key === 'Backspace' || e.key === 'Delete');
            const combo = clear ? null : hotkeyComboFromEvent(e);
            if (!clear && !combo) return; // bare modifier: wait for the real key
            pushDevPanelUndoSnapshot(); // BEFORE the change, so Undo returns to the previous hotkeys
            Object.keys(devHotkeys).forEach(k => { if (devHotkeys[k].id === targetId) delete devHotkeys[k]; });
            if (combo) devHotkeys[combo] = { id: targetId, action: 'click' };
            finish();
            afterCommit();
        });
        input.addEventListener('blur', () => setTimeout(finish, 120));
        parent.insertBefore(input, parent.firstChild);
        input.focus();
    }

    function startHotkeyEdit(row) {
        const rowId = row.dataset.controlId || row.id;
        if (!rowId) return;
        openHotkeyCapture(row, rowId, () => renderAllHotkeyBadges());
    }

    function startHotkeyEditForHeaderBtn(btn) {
        // Header buttons can't carry a child badge like rows, so use a small floating modal.
        const modal = hkEl('div', 'dev-hotkey-modal', {
            style: 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); ' +
                   'background: var(--dev-bg, #1a1a1a); border: 1px solid var(--dev-accent-color, #0ff); ' +
                   'padding: 12px; z-index: 99999; border-radius: 4px; box-shadow: 0 0 10px rgba(0,255,255,0.3);'
        });
        document.body.appendChild(modal);
        openHotkeyCapture(modal, btn.id, () => renderHotkeyBadgeForHeaderBtn(btn));
    }

    function renderHotkeyBadgeForHeaderBtn(btn) {
        // Header buttons don't show badge indicators — hotkey is set silently
        // The user simply knows the hotkey works by using it
        refreshHotkeysListSubgroup();
    }

    function renderHotkeyBadgesForRow(row) {
        const rowId = row.dataset.controlId || row.id;
        const key = Object.keys(devHotkeys).find(k => devHotkeys[k].id === rowId);

        // Remove existing badge
        row.querySelector('.dev-hotkey-badge')?.remove();

        if (key) {
            const badge = hkEl('span', 'dev-hotkey-badge', { textContent: key.toUpperCase() });
            badge.title = 'Double-click to edit, double-right-click to delete';

            badge.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                startHotkeyEdit(row);
            });

            badge.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                pushDevPanelUndoSnapshot();
                delete devHotkeys[key];
                renderHotkeyBadgesForRow(row);
            });

            row.insertBefore(badge, row.firstChild);
        }
    }

    function renderAllHotkeyBadges() {
        devPanel.querySelectorAll('.dev-row').forEach(row => renderHotkeyBadgesForRow(row));
        refreshHotkeysListSubgroup();
    }

    // ----------------------------------------------------------------
    // "Hot Keys" subgroup, inside the built-in "Dev Panel" group --
    // lists every current hotkey/target pair, with the same double-
    // click-to-reassign / double-right-click-to-delete interaction as
    // an inline row badge. Adapted from Handyset's own devPanel.js
    // (added there 2026-09-30, ahead of this template), simplified to
    // this template's own plain `{id, action}` devHotkeys shape (no
    // per-target `type`/touch-device HUD system) and its own
    // startHotkeyEdit(row)/startHotkeyEditForHeaderBtn(btn) signatures
    // (row/button only, no extra args) -- reassign/delete here always
    // goes through those same, already-tested functions rather than
    // calling openHotkeyCapture() directly, so this list can never
    // drift out of sync with the inline-badge behavior.
    // Desktop-tab only, like Mouse Log/Debug ([JS-13c]) -- devHotkeys
    // is one global object regardless of which tab is showing, so
    // there is nothing to mirror into Mobile/Landscape.
    // ----------------------------------------------------------------
    function ensureHotkeysSubgroup() {
        const tabEl = document.getElementById('desktopTabContent');
        if (!tabEl) return null;
        const devPanelSec = Array.from(tabEl.querySelectorAll(':scope > .dev-section')).find(s => {
            const t = s.querySelector(':scope > .dev-section-title');
            return t && (t.dataset.sid || t.textContent.replace(/^[▼▶]\s*/, '')) === 'Dev Panel';
        });
        if (!devPanelSec) return null;
        const content = devPanelSec.querySelector(':scope > .dev-section-content');
        const existing = content.querySelector(':scope > .dev-section[data-sid="Hot Keys"]');
        if (existing) return existing;
        const g = createDevGroupElement('Hot Keys', 'desktop');
        content.appendChild(g);
        const gc = g.querySelector(':scope > .dev-section-content');
        const listContainer = document.createElement('div');
        listContainer.id = 'devHotkeysListContainer';
        gc.appendChild(listContainer);
        return g;
    }
    function hotkeyIsHeaderBtnEl(el) {
        return !!el && (el.classList.contains('dev-header-icon-btn') || el.classList.contains('dev-collapse-btn') || el.classList.contains('dev-hide-btn'));
    }
    function hotkeyTargetLabel(entry) {
        const el = document.getElementById(entry.id);
        if (!el) return entry.id;
        if (hotkeyIsHeaderBtnEl(el)) return (el.title || entry.id).replace(/\s*\([^)]*key\)\s*$/i, '');
        const row = el.closest('.dev-row');
        const label = row && row.querySelector(':scope > .dev-label');
        return (label && label.textContent) || entry.id;
    }
    function refreshHotkeysListSubgroup() {
        const container = document.getElementById('devHotkeysListContainer');
        if (!container) return;
        container.innerHTML = '';
        Object.entries(devHotkeys).forEach(([key, entry]) => {
            const el = document.getElementById(entry.id);
            const row = document.createElement('div');
            row.className = 'dev-row';
            row.style.cssText = 'display:flex; align-items:center; gap:6px;';
            const badge = document.createElement('span');
            badge.className = 'dev-hotkey-badge';
            badge.textContent = key.split('+').map(k => k.charAt(0).toUpperCase() + k.slice(1)).join('+');
            badge.title = 'Double-click to edit, double-right-click to delete';
            let lastContextmenuAt = 0;
            badge.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (!el) return;
                if (hotkeyIsHeaderBtnEl(el)) startHotkeyEditForHeaderBtn(el);
                else { const targetRow = el.closest('.dev-row'); if (targetRow) startHotkeyEdit(targetRow); }
            });
            badge.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const now = performance.now();
                if (now - lastContextmenuAt < HOTKEY_SEQUENCE_WINDOW_MS) {
                    pushDevPanelUndoSnapshot();
                    delete devHotkeys[key];
                    renderAllHotkeyBadges();
                }
                lastContextmenuAt = now;
            });
            const labelSpan = document.createElement('span');
            labelSpan.textContent = hotkeyTargetLabel(entry);
            row.appendChild(badge);
            row.appendChild(labelSpan);
            container.appendChild(row);
        });
    }

    // Ctrl+F-style search for group/setting names, ported from
    // DickoClicko's own dpSearchInput mechanism (2026-09-17) and adapted
    // to this template's tab-scoped .dev-section-title/.dev-row DOM shape
    // (DickoClicko has a single flat group tree, no Desktop/Mobile/
    // Landscape tab split, so its own .dp-group/.dp-row selectors don't
    // apply directly here - the underlying navigate/highlight/expand
    // logic is the same, just re-scoped to whichever tab is currently
    // active via getActiveDevPanelTab()). Deliberately does NOT highlight
    // every match at once - per DickoClicko's own direct correction ("dont
    // do the expanding and scroll thing if i havent hit enter yet"):
    // typing only recomputes devSearchMatches and shows a plain "N found"
    // count; only Enter (first press jumps to match 0) or Shift+Enter
    // (previous, wrapping) actually navigates - and navigating to a NEW
    // match first UNDOES whatever the PREVIOUS match's own navigation did
    // (un-highlight, re-collapse whatever this mechanism itself had to
    // expand), so only ONE match is ever expanded/highlighted at a time.
    let devSearchMatches = [];
    let devSearchActiveIndex = -1;
    let devSearchActiveEl = null;
    let devSearchExpandedGroups = [];

    function collectDevSearchMatches(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const tabEl = document.getElementById(getActiveDevPanelTab() + 'TabContent');
        if (!tabEl) return [];
        const matches = [];
        // A single combined selector (not 2 separate querySelectorAll
        // calls) so matches come back in real document order for free.
        tabEl.querySelectorAll('.dev-section-title, .dev-row').forEach(node => {
            if (node.classList.contains('dev-section-title')) {
                // textContent always starts with a "\u25bc " or "\u25b6 " collapse-arrow
                // prefix (toggleSection()'s own convention) - stripped before
                // matching so a search for "dev" doesn't need the arrow glyph.
                const text = node.textContent.slice(2).toLowerCase();
                if (text.includes(q)) matches.push({ type: 'group', targetEl: node, sectionEl: node.closest('.dev-section') });
            } else {
                const label = node.querySelector(':scope > .dev-label');
                if (label && label.textContent.toLowerCase().includes(q)) {
                    matches.push({ type: 'row', targetEl: label, rowEl: node });
                }
            }
        });
        return matches;
    }

    function devSearchCollapseExpanded() {
        devSearchExpandedGroups.forEach(sec => {
            const titleEl = sec.querySelector(':scope > .dev-section-title');
            const content = sec.querySelector(':scope > .dev-section-content');
            if (content) content.classList.add('collapsed');
            if (titleEl) titleEl.textContent = '\u25b6 ' + titleEl.textContent.slice(2);
        });
        devSearchExpandedGroups = [];
    }
    function devSearchClearActiveHighlight() {
        if (devSearchActiveEl) devSearchActiveEl.classList.remove('dev-search-highlight-active');
        devSearchActiveEl = null;
    }
    // Undoes whatever the CURRENT match's own navigation did - always call
    // this before moving to a different match (or abandoning the search).
    function devSearchUndoCurrentMatch() {
        devSearchClearActiveHighlight();
        devSearchCollapseExpanded();
    }
    // startEl is the whole matched element (a .dev-section for a group
    // match, a .dev-row for a row match) so walking up from its OWN parent
    // correctly skips the matched group itself and only expands genuine
    // ANCESTORS - a group's own title is always visible regardless of its
    // own collapsed state, only its content needs expanding.
    function devSearchExpandAncestors(startEl) {
        let sec = startEl.parentElement ? startEl.parentElement.closest('.dev-section') : null;
        while (sec) {
            const titleEl = sec.querySelector(':scope > .dev-section-title');
            const content = sec.querySelector(':scope > .dev-section-content');
            if (content && content.classList.contains('collapsed')) {
                content.classList.remove('collapsed');
                if (titleEl) titleEl.textContent = '\u25bc ' + titleEl.textContent.slice(2);
                devSearchExpandedGroups.push(sec);
            }
            sec = sec.parentElement ? sec.parentElement.closest('.dev-section') : null;
        }
    }
    function devSearchUpdateCount() {
        const countEl = document.getElementById('devSearchCount');
        if (!countEl) return;
        const total = devSearchMatches.length;
        const input = document.getElementById('devSearchInput');
        if (!input || !input.value.trim()) countEl.textContent = '';
        else if (!total) countEl.textContent = '0 found';
        else if (devSearchActiveIndex === -1) countEl.textContent = total + ' found';
        else countEl.textContent = (devSearchActiveIndex + 1) + '/' + total;
    }
    function devSearchGoTo(index) {
        if (!devSearchMatches.length) return;
        devSearchUndoCurrentMatch();
        const n = devSearchMatches.length;
        devSearchActiveIndex = ((index % n) + n) % n;
        const m = devSearchMatches[devSearchActiveIndex];
        devSearchExpandAncestors(m.type === 'row' ? m.rowEl : m.sectionEl);
        m.targetEl.classList.add('dev-search-highlight-active');
        devSearchActiveEl = m.targetEl;
        m.targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        devSearchUpdateCount();
    }
    function setupDevSearch() {
        const input = document.getElementById('devSearchInput');
        if (!input) return;
        input.addEventListener('input', () => {
            devSearchUndoCurrentMatch();
            devSearchActiveIndex = -1;
            devSearchMatches = collectDevSearchMatches(input.value);
            devSearchUpdateCount();
        });
        input.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (e.shiftKey) devSearchGoTo(devSearchActiveIndex - 1);
            else devSearchGoTo(devSearchActiveIndex + 1);
        });
        // Any click that isn't on the search input itself undoes the current
        // match's own highlight/expansion - same "click elsewhere clears it"
        // convention setupDevGroupSelection() already uses.
        document.addEventListener('click', e => {
            if (e.target === input) return;
            if (devSearchActiveIndex === -1) return;
            devSearchUndoCurrentMatch();
            devSearchActiveIndex = -1;
            devSearchUpdateCount();
        }, true);
    }

    // ================================================================
    // [JS-3] DRAG-TO-REORDER ENGINE
    // ================================================================
    // Generic pointer-based drag-to-reorder (groups AND settings use
    // this same function, with different selectors — see the 2 call
    // sites near the bottom of this script). Pointer events (not native
    // HTML5 draggable=true) for real touch support. A live "swap on
    // crossing" reorder — once past a small movement threshold, the
    // dragged item moves in the DOM whenever the pointer crosses a
    // sibling's midpoint.
    //   handleSelector: what starts a drag (e.g. '.dev-section-title')
    //     — deliberately NOT the item's own interactive control, so
    //     dragging a slider/checkbox/input still works normally.
    //   itemSelector: the element that actually moves (may differ from
    //     the handle — a group's handle is its title, but the whole
    //     .dev-section reorders).
    //   onDrop: called once after a real drag completes, to persist the
    //     new order.
    //   crossContainerSelector: omit for a single-container drag (e.g.
    //     groups, which never leave their tab). Pass a CSS selector (or
    //     a function(tabRoot, dragging) => [elements], when you need to
    //     include tabRoot itself as a valid drop target — querySelectorAll
    //     can never return its own context node) to let a dragged item
    //     cross into a DIFFERENT sibling container.
    // ----------------------------------------------------------------
    // Used for the SIBLING-POSITION comparison inside setupDragReorder()
    // (not for `itemSelector`, which stays per-call and decides what the
    // drag HANDLE actually picks up) - 2026-09-19, direct request that a
    // dragged group or row be positionable relative to BOTH types, not
    // just its own kind, so a group can land above/below/between settings
    // and vice versa with no forced ordering either way. Before this, the
    // 2 setupDragReorder() calls below (one for '.dev-section', one for
    // '.dev-row') each only ever compared position against same-type
    // siblings, since the sibling query used the call's own itemSelector -
    // meaning a dragged group could never be interleaved with rows, and a
    // dragged row could never be interleaved with groups.
    const REORDERABLE_SIBLING_SELECTOR = ':scope > .dev-section, :scope > .dev-row, :scope > .dev-lp-group, :scope > .dev-lp-row';
    let sectionJustDragged = false;
    function setupDragReorder(handleSelector, itemSelector, onDrop, crossContainerSelector, getMoveGroup) {
        let dragging = null;
        // Multi-select-aware drag (2026-10-19, list-picker rows only --
        // every OTHER caller omits getMoveGroup, so dragSet is always
        // exactly [dragging] there, making every dragSet-based line below
        // a no-op-equivalent rewrite of the original single-item logic).
        // `dragging` stays the single "anchor" element the handle was
        // grabbed on (used for all position/threshold math, unchanged);
        // `dragSet` is the full set of elements that actually move
        // together, always including `dragging`, in their ORIGINAL
        // relative DOM order (captured once at drag-start, then always
        // re-inserted in that same order on every crossing, so a
        // multi-item drag never scrambles the selection's own ordering).
        let dragSet = [];
        let startY = 0;
        let moved = false;
        // BUG (found live on Clicko, direct report: "when i clcik and drag
        // the icon, it doesnt register. Instead my cursor becomes tot he
        // NA Icon... the dragging doesnt work" - intermittent, retrying
        // sometimes works). Unlike every other custom pointer-drag in this
        // file (the panel's own resize handles, its move-by-header drag),
        // this one never called setPointerCapture() on the handle. The
        // handle is only 22px with touch-action:none - without capture, a
        // fast pointer move can carry the cursor outside that tiny hit
        // area before the next pointermove tick, and the browser
        // re-evaluates touch-action against whatever's now underneath -
        // exactly the ambiguous state Chromium/the OS shows the native
        // "not-allowed" cursor for, silently dropping the gesture.
        // Capturing the pointer on the handle itself routes every
        // subsequent event for this pointerId to it regardless of where
        // the cursor travels, removing the ambiguity entirely.
        let capturedHandle = null;
        const THRESHOLD = 8;

        // Touch needs a hold-to-arm gate that mouse doesn't: the handles
        // are deliberately NOT touch-action:none (so a normal swipe still
        // scrolls the panel), which means a touch drag can't be
        // recognized by movement alone. A touch only commits to drag
        // mode after being held still past TOUCH_HOLD_MS; real movement
        // before that cancels the hold and falls through to native
        // scroll. Mouse/pen keep the original immediate, movement-
        // threshold-based behavior — touch-action never governs them.
        const TOUCH_HOLD_MS = 1000;
        const TOUCH_HOLD_MOVE_TOLERANCE = 10;
        let pendingTouch = null;

        function cancelPendingTouch() {
            if (pendingTouch) { clearTimeout(pendingTouch.timerId); pendingTouch = null; }
        }

        document.addEventListener('pointerdown', (e) => {
            const handle = e.target.closest(handleSelector);
            if (!handle) return;
            const item = handle.closest(itemSelector);
            if (!item) return;
            // Refuses to even START a drag on a .dev-row whose own group is
            // locked (ported from Clicko - see lockedGroups' own comment).
            // A locked group's OWN position is unaffected - it can still be
            // dragged/reordered/nested as a whole; only its contents are
            // frozen.
            if (item.matches('.dev-row')) {
                const ownSection = item.closest('.dev-section');
                const ownTitle = ownSection && ownSection.querySelector(':scope > .dev-section-title');
                if (ownTitle && lockedGroups.has(getSectionKey(ownTitle))) return;
            } else if (item.matches('.dev-section')) {
                // Direct request 2026-10-11: "when a group is locked...all
                // its subgroups will be locked as well...none of the
                // subgroups or settings in every subgroup cannot be dragged
                // or nested or regrouped in anyway. I will have to unlock
                // the parent group to allow that." Locking already
                // cascades lockedGroups onto every nested subgroup (see
                // addGroupLockIcon's own comment), but until now that only
                // blocked .dev-row drags above - a nested .dev-section
                // (subgroup) itself could still be dragged out from under a
                // locked ancestor. Walks ANCESTOR sections only (never the
                // item itself) so a directly-locked group can still be
                // dragged/reordered/nested as a whole (unchanged); it's
                // only frozen from the inside once something nests it under
                // a locked parent.
                let sec = item.parentElement ? item.parentElement.closest('.dev-section') : null;
                while (sec) {
                    const title = sec.querySelector(':scope > .dev-section-title');
                    if (title && lockedGroups.has(getSectionKey(title))) return;
                    sec = sec.parentElement ? sec.parentElement.closest('.dev-section') : null;
                }
            }

            // See capturedHandle's own top-of-function comment - routes
            // every subsequent pointer event for this pointerId to the
            // handle regardless of where the cursor travels, same
            // try/catch-wrapped best-effort convention as every other
            // setPointerCapture() call in this file.
            try { handle.setPointerCapture(e.pointerId); } catch (err) { /* best-effort only */ }
            capturedHandle = handle;

            // Computed once per drag, at grab time: the anchor item always
            // moves; getMoveGroup (list-picker rows only) can additionally
            // include every OTHER currently multi-selected row, in their
            // existing relative DOM order -- defensive unshift in case a
            // caller's getMoveGroup forgets to include the anchor itself.
            const moveGroup = (getMoveGroup ? getMoveGroup(item) : [item]).filter(Boolean);
            if (!moveGroup.includes(item)) moveGroup.unshift(item);

            if (e.pointerType === 'touch') {
                const startX0 = e.clientX, startY0 = e.clientY, pointerId = e.pointerId;
                cancelPendingTouch();
                pendingTouch = {
                    item, startX: startX0, startY: startY0, pointerId,
                    timerId: setTimeout(() => {
                        if (!pendingTouch || pendingTouch.pointerId !== pointerId) return;
                        pendingTouch = null;
                        dragging = item;
                        dragSet = moveGroup;
                        startY = startY0;
                        moved = true;
                        dragSet.forEach(el => el.classList.add('dev-reorder-dragging'));
                    }, TOUCH_HOLD_MS),
                };
                return;
            }

            dragging = item;
            dragSet = moveGroup;
            startY = e.clientY;
            moved = false;
        });

        document.addEventListener('pointermove', (e) => {
            if (pendingTouch && e.pointerId === pendingTouch.pointerId) {
                const dist = Math.hypot(e.clientX - pendingTouch.startX, e.clientY - pendingTouch.startY);
                if (dist > TOUCH_HOLD_MOVE_TOLERANCE) cancelPendingTouch();
                return;
            }
            if (!dragging) return;
            if (!moved && Math.abs(e.clientY - startY) > THRESHOLD) {
                moved = true;
                dragSet.forEach(el => el.classList.add('dev-reorder-dragging'));
            }
            if (!moved) return;
            e.preventDefault();
            if (crossContainerSelector) {
                const tabRoot = dragging.closest(DEV_PANEL_TABS.map(t => '#' + t + 'TabContent').join(', '));
                const containers = typeof crossContainerSelector === 'function'
                    ? crossContainerSelector(tabRoot, dragging)
                    : Array.from(tabRoot.querySelectorAll(crossContainerSelector));
                // A candidate container is normally a .dev-section-content
                // div, but a COLLAPSED group's content is display:none -
                // getBoundingClientRect() on it returns an all-zero rect, so
                // every collapsed group's content ties at the same
                // degenerate {top:0,bottom:0,height:0}. Groups default to
                // collapsed, so this is the common case, not an edge case -
                // it silently breaks both the "pointer is over this
                // container" check and the "nearest by center" fallback
                // below (real incident: Clicko's own deployed panel hit this
                // exact bug - "cant seem to reorder or modify group
                // nesting" - confirmed live: cross-group drop worked the
                // instant the target was pre-expanded, and broke again the
                // moment it was collapsed). Fixed with a hit-test rect that
                // falls back to the group's own TITLE BAR (always rendered,
                // never zero-size) whenever its content is collapsed - also
                // the correct visual target, since that's the only part of
                // a collapsed group a user can actually see and aim at.
                function hitTestRect(c) {
                    const r = c.getBoundingClientRect();
                    if (r.height > 0) return r;
                    const titleEl = c.previousElementSibling;
                    return (titleEl && titleEl.classList.contains('dev-section-title')) ? titleEl.getBoundingClientRect() : r;
                }
                let targetContainer = containers.find(c => {
                    const r = hitTestRect(c);
                    return e.clientY >= r.top && e.clientY <= r.bottom;
                });
                if (!targetContainer) {
                    let minDist = Infinity;
                    containers.forEach(c => {
                        const r = hitTestRect(c);
                        const dist = Math.abs(e.clientY - (r.top + r.height / 2));
                        if (dist < minDist) { minDist = dist; targetContainer = c; }
                    });
                }
                if (!targetContainer) return;
                // Combined selector (not the per-call itemSelector alone) -
                // 2026-09-19, per direct request that a dragged group or
                // row should be positionable relative to EITHER type, not
                // just its own ("no prioritization in terms of settings
                // area lways above groups or anyting liek that"). See
                // REORDERABLE_SIBLING_SELECTOR's own comment.
                // Excludes every element in dragSet, not just the anchor —
                // for a plain single-item drag (dragSet === [dragging])
                // this is identical to the old `el !== dragging` filter.
                const targetSiblings = Array.from(targetContainer.querySelectorAll(REORDERABLE_SIBLING_SELECTOR)).filter(el => !dragSet.includes(el));
                const before = targetSiblings.find(sib => e.clientY < sib.getBoundingClientRect().top + sib.getBoundingClientRect().height / 2);
                // Re-inserting the whole dragSet in its captured relative
                // order, one at a time, keeps that order intact: each
                // subsequent insertBefore(el, before) lands immediately
                // after the previously-inserted element and before
                // `before` itself.
                if (before) dragSet.forEach(el => targetContainer.insertBefore(el, before));
                else dragSet.forEach(el => targetContainer.appendChild(el));
                return;
            }
            const siblings = Array.from(dragging.parentElement.querySelectorAll(REORDERABLE_SIBLING_SELECTOR)).filter(el => !dragSet.includes(el));
            for (const sib of siblings) {
                const rect = sib.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                const draggingIsBefore = !!(dragging.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_FOLLOWING);
                if (e.clientY < mid && !draggingIsBefore) { dragSet.forEach(el => sib.parentElement.insertBefore(el, sib)); break; }
                else if (e.clientY >= mid && draggingIsBefore) { const ref = sib.nextSibling; dragSet.forEach(el => sib.parentElement.insertBefore(el, ref)); break; }
            }
        }, { passive: false });

        // Releases the pointer capture taken in pointerdown above - BEFORE
        // the `if (!dragging) return` early exit, since capture is taken on
        // EVERY handle pointerdown (including a touch still pending its
        // hold-to-arm timer, where dragging is still null) and has to be
        // released even when a drag never actually started, or it stays
        // stuck captured on the handle for the rest of that pointerId's
        // lifetime.
        function releaseCapturedHandle(e) {
            if (!capturedHandle) return;
            try { if (capturedHandle.hasPointerCapture(e.pointerId)) capturedHandle.releasePointerCapture(e.pointerId); } catch (err) { /* best-effort only */ }
            capturedHandle = null;
        }
        document.addEventListener('pointerup', (e) => {
            if (pendingTouch && e.pointerId === pendingTouch.pointerId) cancelPendingTouch();
            releaseCapturedHandle(e);
            if (!dragging) return;
            dragSet.forEach(el => el.classList.remove('dev-reorder-dragging'));
            if (moved) { sectionJustDragged = true; if (onDrop) onDrop(); }
            dragging = null;
            dragSet = [];
            moved = false;
        });
        document.addEventListener('pointercancel', (e) => {
            if (pendingTouch && e.pointerId === pendingTouch.pointerId) cancelPendingTouch();
            releaseCapturedHandle(e);
            if (!dragging) return;
            dragSet.forEach(el => el.classList.remove('dev-reorder-dragging'));
            dragging = null;
            dragSet = [];
            moved = false;
        });
    }

    // ================================================================
    // [JS-4] GROUP/SETTING ORDER & COLLAPSE-STATE PERSISTENCE
    // ================================================================
    // Group/setting order + collapse-state persistence. Stable identity
    // (not DOM position) for both a group (tab + its data-sid, frozen
    // at creation) and a setting row (the id of whatever control it
    // contains) — position would silently point at the wrong thing
    // after any reorder.
    // ----------------------------------------------------------------
    function getSectionKey(titleEl) {
        const tab = DEV_PANEL_TABS.find(t => titleEl.closest('#' + t + 'TabContent')) || DEV_PANEL_TABS[0];
        return tab + ':' + (titleEl.dataset.sid || titleEl.textContent.replace(/^[▼▶]\s*/, ''));
    }
    function captureSectionCollapseState() {
        const state = {};
        document.querySelectorAll('.dev-section-title').forEach(titleEl => {
            state[getSectionKey(titleEl)] = titleEl.nextElementSibling.classList.contains('collapsed');
        });
        return state;
    }
    function applySectionCollapseState(state) {
        if (!state) return;
        document.querySelectorAll('.dev-section-title').forEach(titleEl => {
            const key = getSectionKey(titleEl);
            if (!(key in state)) return;
            const shouldCollapse = !!state[key];
            const content = titleEl.nextElementSibling;
            if (content.classList.contains('collapsed') !== shouldCollapse) {
                content.classList.toggle('collapsed');
                withPreservedTitleCheckbox(titleEl, () => {
                    titleEl.textContent = content.classList.contains('collapsed') ? '▶ ' + titleEl.textContent.slice(2) : '▼ ' + titleEl.textContent.slice(2);
                });
            }
        });
    }
    function getRowKey(row, fallbackIndex) {
        const idEl = row.querySelector('[id]');
        return idEl ? idEl.id : ('__row' + fallbackIndex);
    }
    // Captures one group's own direct rowKeys, plus (genuinely UNLIMITED
    // depth, via recursion -- verified 2026-09-14 with a direct 3-level
    // capture/destroy/restore round-trip) any subgroups it directly
    // contains. All queries :scope-scoped (direct children only, at
    // whichever level the current recursive call is examining) — a plain
    // descendant selector would also match a NESTED subgroup's own rows,
    // double-counting them. Corrected 2026-09-14: an earlier version of
    // this comment claimed "one level deep only," which was already wrong
    // by the time it was read back -- the recursive call below
    // (`captureSection(sub)`) naturally walks to any depth; only the
    // COMMENT was stale, not the code.
    // items: a SINGLE ordered list, interleaving rows and subgroups in
    // real DOM order (2026-09-19) - replaces the old separate rowKeys/
    // subgroups arrays, which could only ever express "all rows, then all
    // subgroups" (or vice versa on restore), never an actual interleaved
    // order. Direct request: "I want to be able to reorder nested groups
    // and settings such that Nested groups can be placed above settings.
    // there should be no prioritization in terms of settings area lways
    // above groups or anyting liek that." rowKeys/subgroups are still
    // populated alongside items (derived from it, not a 2nd source of
    // truth) purely so anything outside this function that still reads
    // them directly (there is none in this file as of this change, but
    // keeping them cheap insurance against a future reader assuming the
    // old shape) sees a sane, consistent value.
    function captureSection(sec) {
        const titleEl = sec.querySelector(':scope > .dev-section-title');
        const content = sec.querySelector(':scope > .dev-section-content');
        const items = Array.from(content.querySelectorAll(':scope > .dev-row, :scope > .dev-section')).map((el, i) => {
            return el.classList.contains('dev-row')
                ? { type: 'row', key: getRowKey(el, i) }
                : { type: 'group', section: captureSection(el) };
        });
        return {
            key: getSectionKey(titleEl),
            items,
            rowKeys: items.filter(it => it.type === 'row').map(it => it.key),
            subgroups: items.filter(it => it.type === 'group').map(it => it.section),
        };
    }
    function captureSectionOrder() {
        const result = {};
        DEV_PANEL_TABS.forEach(tab => {
            const tabId = tab + 'TabContent';
            const tabEl = document.getElementById(tabId);
            if (!tabEl) return;
            const sections = Array.from(tabEl.querySelectorAll(':scope > .dev-section'));
            result[tabId] = sections.map(sec => captureSection(sec));
        });
        return result;
    }
    function applySectionOrder(order) {
        if (!order) return;
        DEV_PANEL_TABS.forEach(tab => {
            const tabId = tab + 'TabContent';
            const tabEl = document.getElementById(tabId);
            const savedSections = order[tabId];
            if (!tabEl || !savedSections) return;
            const sectionsByKey = {};
            tabEl.querySelectorAll('.dev-section').forEach(sec => {
                sectionsByKey[getSectionKey(sec.querySelector(':scope > .dev-section-title'))] = sec;
            });
            // Widened from '.dev-section-content > .dev-row' to plain
            // '.dev-row' (real bug found live in Clicko - "the ordering
            // and grouping and nesting of the Preview text boxes etc arent
            // being reflected, even in desktop mode"): a row with NO
            // .dev-section-content ancestor at all (a loose row sitting
            // directly under tabEl - a project's own equivalent of
            // Clicko's ~10 loose top-level checkboxes) was captured fine
            // by captureSectionOrder() the moment it was dragged into a
            // group, but could never be FOUND here to restore it there on
            // the next Reset/reload - it silently stayed loose forever.
            // Safe to widen: a row's real identity is its own key
            // (getRowKey), not its current parent.
            const rowsByKey = {};
            tabEl.querySelectorAll('.dev-row').forEach((row, i) => {
                rowsByKey[getRowKey(row, i)] = row;
            });
            // Places one saved group (and, at UNLIMITED depth, its own
            // subgroups) into parentContainer — either tabEl itself
            // (top-level) or another group's own .dev-section-content
            // (nested). Recursive with no depth cap -- verified 2026-09-14
            // with a direct 3-level round-trip; the earlier "only ever
            // called 2 deep" claim here was stale documentation, not an
            // actual limit in the code (`placeSection(sub, content)` below
            // recurses exactly as deep as the saved data goes).
            // Bug fixed 2026-09-27 (found live in the 3JS ENGINE project:
            // "when I choose a Rendering Style, place the setting group
            // under the Style dropdown -- right now it's showing up
            // first"): `appendChild` on an element ALREADY in the DOM
            // moves it to the end of its parent -- it does not insert in
            // place. Every item this function processes gets progressively
            // moved to the end, in saved order, which correctly
            // reconstructs that order AMONG THEM. But a row or subgroup
            // added to the real content AFTER this order was last saved
            // (a new dev-panel control shipped in a later update) has no
            // entry in `savedSec.items`/`rowKeys`/`subgroups` at all, so
            // this function never touches it -- it simply stays wherever
            // it already was. Since new content is appended at the END by
            // the normal build process, and everything ELSE then gets
            // moved past it one at a time, the untouched new content ends
            // up FIRST instead of last -- confirmed live: 3 rendering
            // styles added after the saved order was captured appeared
            // ahead of the group's own Enabled checkbox and Style
            // dropdown, not after them. Fixed by explicitly appending
            // every current child NOT referenced by the saved order, in
            // their existing relative order, once the saved items are
            // done being placed -- new content now always lands at the
            // end, where it belongs, regardless of when it was added.
            function appendUntouchedChildren(container, touched) {
                Array.from(container.children).forEach(child => {
                    if (!touched.has(child)) container.appendChild(child);
                });
            }
            function placeSection(savedSec, parentContainer) {
                let sec = sectionsByKey[savedSec.key];
                if (!sec) {
                    // Not a mistake — this is how a CUSTOM group (see
                    // addDevGroup()) survives a reload: it doesn't exist
                    // in the static HTML at all, only in saved order.
                    const name = savedSec.key.split('>').pop().replace(new RegExp('^(' + DEV_PANEL_TABS.join('|') + '):'), '');
                    sec = createDevGroupElement(name, tab);
                    sectionsByKey[savedSec.key] = sec;
                }
                parentContainer.appendChild(sec);
                const content = sec.querySelector(':scope > .dev-section-content');
                const touched = new Set();
                // Interleaved order (savedSec.items, see captureSection()'s
                // own comment) - falls back to the OLD "all rows, then all
                // subgroups" shape for a save made before this change, so
                // an existing saved settings.json still loads correctly
                // (just without any interleaving it never had to begin
                // with) instead of erroring or silently dropping content.
                if (savedSec.items) {
                    savedSec.items.forEach(item => {
                        if (item.type === 'row') {
                            const row = rowsByKey[item.key];
                            if (row) { content.appendChild(row); touched.add(row); }
                        } else {
                            placeSection(item.section, content);
                            const sub = sectionsByKey[item.section.key];
                            if (sub) touched.add(sub);
                        }
                    });
                } else {
                    (savedSec.rowKeys || []).forEach(rowKey => {
                        const row = rowsByKey[rowKey];
                        if (row) { content.appendChild(row); touched.add(row); }
                    });
                    (savedSec.subgroups || []).forEach(sub => {
                        placeSection(sub, content);
                        const subEl = sectionsByKey[sub.key];
                        if (subEl) touched.add(subEl);
                    });
                }
                appendUntouchedChildren(content, touched);
            }
            const touchedTopLevel = new Set();
            savedSections.forEach(savedSec => {
                placeSection(savedSec, tabEl);
                const sec = sectionsByKey[savedSec.key];
                if (sec) touchedTopLevel.add(sec);
            });
            appendUntouchedChildren(tabEl, touchedTopLevel);
        });
    }

    // ================================================================
    // [JS-4b0] DYNAMIC MOBILE/LANDSCAPE VISIBILITY + INDEPENDENCE
    // ================================================================
    // Per direct request (2026-09-13): every Desktop row/group gets a
    // "Show in Mobile/Landscape" checkbox; every Mobile/Landscape
    // row/group gets an "Independent from Desktop" checkbox. DEFAULT
    // state is CATEGORY-AWARE (hasStaticDeviceCounterpart(), below),
    // not a flat ON/OFF - a control that already has a real, separately-
    // registered per-tab entry defaults to visible+independent (its
    // exact pre-existing behavior preserved); a control that never had
    // one defaults to hidden/mirrors-Desktop (also its exact pre-
    // existing behavior preserved, since it never had a Mobile/
    // Landscape presence at all before this feature). Unchecking
    // Desktop's own checkbox for a setting removes it from Mobile/
    // Landscape ENTIRELY (no DOM row there at all) - "if nothing is
    // checked, Mobile/Landscape will look empty and just use Desktop
    // settings" - but per explicit follow-up clarification, hiding/un-
    // independent-izing NEVER discards that tab's own last-tuned value:
    // it's kept in devDeviceValues below, restored the moment
    // visibility/independence is turned back on.
    //
    // Modeled on the DICKOCLICKO project's own just-shipped "Independent
    // from Desktop" feature (per direct request to look at it) -
    // REUSES its 2 key design decisions directly: (1) a group's own
    // checkbox has NO persisted state of its own - it's a pure
    // cascading UI convenience that reads/writes every CURRENT child's
    // own real flag, walking the live DOM at the moment of the click
    // (correct for a custom "+ Add Group" group and drag-reordered rows
    // alike, and works for a real non-dev visitor with no dev-panel DOM
    // at all, since nothing about value RESOLUTION depends on group
    // membership - only on each row's own flag); (2) editing a non-
    // independent Mobile/Landscape control is understood as editing the
    // Desktop value it's currently just mirroring, not a no-op.
    //
    // ONE genuine divergence from DICKOCLICKO's own version, not a
    // simplification: DICKOCLICKO keeps a single active settings object
    // swapped on tab-click; this template (like the real project this
    // engine was built from) keeps Desktop/Mobile/Landscape's controls
    // ALL simultaneously live/interactive regardless of which tab is
    // showing (switchDevPanelTab() doesn't touch cssVars-equivalent
    // state, only visibility) - so a non-independent row's value isn't
    // resolved once on tab-switch, it's LIVE-MIRRORED: applyDesktopMirror()
    // below re-pushes Desktop's current value into every non-independent
    // Mobile/Landscape counterpart the instant Desktop changes, not just
    // when that tab is next opened.
    //
    // SCOPE (this pass): covers the 4 uniform row types (slider/color/
    // select/checkbox) via buildUniformControlRow() - NOT buildTextInputRow()
    // (a project's own text/number inputs), a known, deliberately
    // untouched gap to keep this pass bounded; add the same checkbox-
    // append call there yourself if a project needs it.
    //
    // UNIVERSAL as of 2026-09-17 (ported from a real project, CLICKO,
    // that made this exact change): every control registered under
    // `tab: 'desktop'` gets this whole feature automatically (checkbox,
    // dynamic Mobile/Landscape row creation, live mirroring) - no opt-in
    // flag needed any more. This is SAFE for a control already authored
    // the OLD way (3 SEPARATE, independently-tuned per-tab array
    // entries, still fully supported) specifically BECAUSE the checkbox's
    // own default state is category-aware, not because the checkbox
    // itself is now optional: hasStaticDeviceCounterpart() (below)
    // checks whether a real per-tab entry already exists, so such a
    // control's independence checkbox defaults CHECKED (independent),
    // never silently overwriting its already-tuned value on a mirror-
    // sync the way a flat default-unchecked would have. A NEW control
    // that only ever registers a single Desktop entry needs nothing
    // extra - the old `dynamicDevice: true` flag is no longer read or
    // required anywhere (harmless if still present on an older control).
    //
    // Keyed by the DESKTOP row's own id (e.g. sliderButtonDiameter) for
    // rows, or by the Desktop group's own data-sid for groups - never a
    // Mobile/Landscape-prefixed id, since these maps ARE the source of
    // truth for whether/how a Mobile/Landscape counterpart exists.
    let devVisibility = {}; // { [desktopId]: boolean } - default true (visible) when absent
    let devIndependence = { mobile: {}, landscape: {} }; // { [desktopId]: boolean } - default false (mirrors Desktop) when absent
    let devDeviceValues = { mobile: {}, landscape: {} }; // { [desktopId]: lastIndependentValue } - retained even while hidden/non-independent

    // Whether a REAL, separately-registered per-device control already
    // exists for a Desktop control on a given tab (an old-style control,
    // authored with its own independently-tuned Mobile/Landscape array
    // entry, before this feature existed) - drives the checkbox DEFAULT
    // state below when no explicit devVisibility/devIndependence entry
    // exists yet, so applying this system UNIVERSALLY (every control,
    // not just ones explicitly opted in) never silently changes any
    // existing project's behavior: a control that already had its own
    // real per-tab entry defaults to visible+independent (exactly its
    // pre-existing behavior); a control that never had one defaults to
    // hidden/mirrors-desktop (also exactly its pre-existing behavior,
    // since it had no Mobile/Landscape presence at all before). Ported
    // from a real project (CLICKO) that needed the identical category-
    // aware default to go from opt-in to universal without migrating any
    // of its ~250 existing control definitions.
    function hasStaticDeviceCounterpart(desktopId, tab) {
        const devicePrefix = tab === 'landscape' ? 'Landscape' : 'Mobile';
        const targetId = desktopId.replace(/^(slider|color|select|checkbox|curveEditor|rangeBar|gradientPicker)/, '$1' + devicePrefix);
        if (findRegisteredControlById(targetId)) return true;
        // Fallback for a control OUTSIDE the registerDevControlArray()
        // system entirely - a hand-authored row a project added directly
        // (not via the registration API), same as this engine's own
        // skipDeviceCheckbox-excluded chrome controls but for a REAL
        // project control instead. A real DOM element already existing at
        // this id means a real per-device value genuinely exists for it.
        // Ported from CLICKO, which found this exact gap live: a group
        // uncheck correctly hid its array-driven children but left several
        // hand-authored ones behind, un-hidden, because they were never in
        // any registered array at all. Safe for the array-driven system's
        // OWN self-referential construction timing (a control's own row,
        // mid-construction, isn't in the DOM yet at the moment this runs
        // for it) because the registration check above already returns
        // true for those first - this fallback is only ever reached for a
        // control the registration system doesn't cover, and a hand-
        // authored static row is present in the DOM from initial page
        // parse, well before any render call runs.
        // CORRECTED 2026-10-08 (found live on WALKING): this fallback used to
        // also see the Mobile/Landscape twin row the engine ITSELF creates
        // (ensureDynamicTargetRow(), below) -- once that row was attached,
        // every registered desktop-only control with no explicit
        // devIndependence entry read as independent (155 of 155 on WALKING)
        // instead of mirroring Desktop. The registration check above does
        // NOT cover that case (it looks up the twin's id, which is never
        // registered for a desktop-only control). Engine-created twins carry
        // data-dynamic-twin and are ignored here; a genuine hand-authored
        // twin still counts.
        const el = document.getElementById(targetId);
        const row = el ? el.closest('.dev-row') : null;
        return !!el && !(row && row.dataset.dynamicTwin);
    }
    function isDevRowVisible(desktopId) {
        if (devVisibility[desktopId] !== undefined) return devVisibility[desktopId];
        if (/^(checkbox|slider|color)SongBar/.test(desktopId)) return true; // Song Timeline rows show on every tab by default
        if (/^(checkbox|slider|color)GlobalOverride|^checkboxOverride|^sliderGlobalAnim/.test(desktopId)) return true; // Global Override rows too
        // Button and Scrub Line animation rows show on every tab by default (they are not per-device tuned, so they mirror Desktop until set)
        if (/(Anim(Enabled|Time|HoverSize|ClickSize|ReleaseSize|HoverOpacity|ClickOpacity)|ScrubLine(Drag|AnimTime|HoverWidth|ClickWidth|ReleaseWidth|HoverOpacity|ClickOpacity))$/.test(desktopId)) return true;
        return hasStaticDeviceCounterpart(desktopId, 'mobile') || hasStaticDeviceCounterpart(desktopId, 'landscape');
    }
    function isDevRowIndependent(tab, desktopId) {
        if (devIndependence[tab] && devIndependence[tab][desktopId] !== undefined) return devIndependence[tab][desktopId];
        return hasStaticDeviceCounterpart(desktopId, tab);
    }

    // Shows/hides an existing Mobile/Landscape row per its own
    // devVisibility flag, for a control OUTSIDE the registerDevControlArray()
    // system - ensureDynamicTargetRow() (below) early-returns without ever
    // checking visibility when findRegisteredControlById(desktopId) finds
    // nothing (its own `if (!desktopCtrl) return existingId || null;`
    // guard), so a hand-authored control's row would never actually hide
    // even with a correctly-unchecked checkbox. Uses a CSS class, not DOM
    // removal, since these rows are static HTML that always exists - there
    // is nothing to "recreate". No-op for a REGISTERED control (already
    // correctly handled by ensureDynamicTargetRow/syncTabOrderToDesktop),
    // so the 2 mechanisms never fight over the same row.
    function syncStaticRowVisibility(desktopId) {
        if (findRegisteredControlById(desktopId)) return;
        const visible = isDevRowVisible(desktopId);
        ['mobile', 'landscape'].forEach(tab => {
            const devicePrefix = tab === 'landscape' ? 'Landscape' : 'Mobile';
            const targetId = desktopId.replace(/^(slider|color|select|checkbox|curveEditor|rangeBar|gradientPicker)/, '$1' + devicePrefix);
            const el = document.getElementById(targetId);
            const row = el ? el.closest('.dev-row') : null;
            if (!row) return;
            row.classList.toggle('dev-row-hidden-by-checkbox', !visible);
        });
    }
    // Backfills both checkbox kinds onto any .dev-row lacking one, across
    // all 3 tabs - covers a hand-authored control a project added directly
    // rather than through registerDevControlArray() (this engine's own
    // built-in chrome controls are excluded via the skipDeviceCheckbox/
    // data-skip-device-checkbox marker - see buildUniformControlRow()'s own
    // comment). Idempotent - skips a row that already has its checkbox -
    // safe to call repeatedly; only ever needs to run once in practice for
    // a static row, since it's never removed/recreated. Also applies each
    // newly-covered row's own current visibility default immediately.
    // Ported from CLICKO's own identical fix.
    function injectRowDeviceCheckboxes() {
        document.querySelectorAll('#desktopTabContent .dev-row').forEach(row => {
            if (row.querySelector('.dev-visibility-checkbox') || row.dataset.skipDeviceCheckbox) return;
            const controlEl = row.querySelector('[id]');
            if (!controlEl) return;
            row.appendChild(buildVisibilityCheckbox(controlEl, controlEl.id));
        });
        ['mobile', 'landscape'].forEach(tab => {
            document.querySelectorAll('#' + tab + 'TabContent .dev-row').forEach(row => {
                if (row.querySelector('.dev-independence-checkbox') || row.dataset.skipDeviceCheckbox) return;
                const controlEl = row.querySelector('[id]');
                if (!controlEl) return;
                const { desktopId } = resolveDevControlId(controlEl.id);
                row.appendChild(buildIndependenceCheckbox(tab, desktopId, controlEl));
            });
        });
        document.querySelectorAll('#desktopTabContent .dev-row [id]').forEach(controlEl => {
            syncStaticRowVisibility(controlEl.id);
        });
    }

    // Auto-hides an ENTIRE Mobile/Landscape group (any nesting depth) the
    // instant none of its own rows or subgroups are visible any more -
    // matching DickoClicko's own refreshVisibilityUI() (its groupEl.style.display
    // driven by "does the group body have any non-hidden child" check).
    // Ported from CLICKO, which found this exact bug live (unchecking a
    // whole group correctly hid its real rows but left the empty group
    // shell, and empty nested subgroups, visible). Depth-sorted deepest-
    // first (same technique as refreshAllGroupCascadeCheckboxes()) so a
    // parent's own "any visible child" check always sees its children's
    // ALREADY-current hidden state. A row hidden via DOM removal (the
    // registered-control dynamic system) is automatically excluded just by
    // not existing in the query; a row hidden via .dev-row-hidden-by-checkbox
    // (the non-registered/static-row system) is excluded via the :not()
    // below - both hide mechanisms are correctly accounted for.
    function refreshEmptyGroupVisibility(tab) {
        const tabEl = document.getElementById(tab + 'TabContent');
        if (!tabEl) return;
        function depth(el) {
            let d = 0, cur = el.parentElement;
            while (cur) { if (cur.classList.contains('dev-section')) d++; cur = cur.parentElement; }
            return d;
        }
        const sections = Array.from(tabEl.querySelectorAll('.dev-section')).sort((a, b) => depth(b) - depth(a));
        sections.forEach(sec => {
            const content = sec.querySelector(':scope > .dev-section-content');
            if (!content) return;
            const hasVisibleRow = !!content.querySelector(':scope > .dev-row:not(.dev-row-hidden-by-checkbox)');
            const hasVisibleSubgroup = !!content.querySelector(':scope > .dev-section:not(.dev-section-hidden-empty)');
            sec.classList.toggle('dev-section-hidden-empty', !hasVisibleRow && !hasVisibleSubgroup);
        });
    }

    // Re-syncs every already-built .dev-visibility-checkbox/.dev-
    // independence-checkbox element's own .checked DOM property from
    // devVisibility/devIndependence - needed after applyFullDevPanelState()
    // (Undo/Reset/Load) restores those state objects, since nothing else
    // touches an ALREADY-EXISTING checkbox element's own .checked:
    // syncTabOrderToDesktop() only creates/destroys MOBILE/LANDSCAPE rows
    // via ensureDynamicTargetRow() (a newly-created row's checkbox is
    // already correct at creation time), and refreshAllGroupCascadeCheckboxes()
    // only recomputes GROUP-level state by READING whatever these row
    // checkboxes currently show - neither ever pushes restored state back
    // onto a row checkbox that already existed before the restore. Call
    // BEFORE refreshAllGroupCascadeCheckboxes() so group state computes
    // from freshly-synced, not stale, row state. Ported from a real
    // project (CLICKO) that found this exact bug live: toggling a
    // visibility checkbox then clicking Undo correctly reverted
    // devVisibility underneath, but the checkbox stayed visually checked.
    function syncDeviceCheckboxesFromState() {
        document.querySelectorAll('#desktopTabContent .dev-visibility-checkbox').forEach(cb => {
            const controlEl = cb.closest('.dev-row') && cb.closest('.dev-row').querySelector('[id]');
            if (!controlEl) return;
            cb.checked = isDevRowVisible(controlEl.id);
            // Also re-applies hide/show to a non-registered control's
            // static Mobile/Landscape counterpart - see
            // syncStaticRowVisibility()'s own comment. A no-op for a
            // registered control (already handled by
            // syncTabOrderToDesktop(), called just before this at every
            // real call site).
            syncStaticRowVisibility(controlEl.id);
        });
        ['mobile', 'landscape'].forEach(tab => {
            document.querySelectorAll('#' + tab + 'TabContent .dev-independence-checkbox').forEach(cb => {
                const controlEl = cb.closest('.dev-row') && cb.closest('.dev-row').querySelector('[id]');
                if (!controlEl) return;
                const { desktopId } = resolveDevControlId(controlEl.id);
                cb.checked = isDevRowIndependent(tab, desktopId);
            });
        });
    }

    // Finds a control's own registered metadata (label/type/min/max/
    // options/etc) by id, searching every array registered via
    // registerDevControlArray() - used to clone a Desktop control's
    // definition into a dynamically-created Mobile/Landscape row.
    function findRegisteredControlById(id) {
        for (const { array } of DEV_PANEL_REGISTERED_ARRAYS) {
            const found = array.find(c => c.id === id);
            if (found) return found;
        }
        return null;
    }
    // Reads a row's own current live value directly off its DOM control
    // - single source of truth, same convention as captureAllRegisteredControlValues().
    function readDevControlValue(id) {
        const el = document.getElementById(id);
        if (!el) return undefined;
        return el.type === 'checkbox' ? el.checked : (el.type === 'range' || el.type === 'number') ? parseFloat(el.value) : el.value;
    }
    // Writes a value into a row's own DOM control + display, mirroring
    // applyControlValues()'s own per-type logic (but without dispatching
    // an event - this is a display/state sync, not a simulated user
    // edit, so it must never itself trigger the mirroring/independence
    // listeners below - that would recurse).
    function writeDevControlValue(id, value) {
        const el = document.getElementById(id);
        if (!el || value === undefined) return;
        if (el.type === 'checkbox') el.checked = !!value;
        else el.value = value;
        if (el.type === 'range') {
            const valEl = document.getElementById(id.replace(/^slider/, 'value'));
            if (valEl && !valEl.querySelector('input')) valEl.textContent = value;
        }
    }
    // Pushes Desktop's CURRENT value into every non-independent Mobile/
    // Landscape counterpart's own DOM - called live, on every Desktop
    // control's own input/change (see wireDesktopMirrorSource() below),
    // not just on tab-switch, since all 3 tabs stay simultaneously live
    // here (see this section's own top comment on why this differs from
    // DICKOCLICKO's switch-time-only resolve).
    function applyDesktopMirror(desktopId) {
        const value = readDevControlValue(desktopId);
        if (value === undefined) return;
        ['mobile', 'landscape'].forEach(tab => {
            if (isDevRowIndependent(tab, desktopId)) return;
            const devicePrefix = tab === 'landscape' ? 'Landscape' : 'Mobile';
            const targetId = desktopId.replace(/^(slider|color|select|checkbox|curveEditor|rangeBar|gradientPicker)/, '$1' + devicePrefix);
            writeDevControlValue(targetId, value);
        });
    }
    // Wires a Desktop control so every real edit live-mirrors to its
    // non-independent Mobile/Landscape counterparts. Takes the element
    // DIRECTLY (not an id to look up via document.getElementById) -
    // this is called from buildUniformControlRow() while the row is
    // still an in-memory, not-yet-attached DOM subtree (before whatever
    // called it appends the row somewhere), where getElementById would
    // find nothing at all; querying/passing the element straight from
    // the row itself works regardless of attachment. Idempotent (checks
    // a data flag) since ensureDynamicTargetRow()/buildUniformControlRow()
    // can both end up calling this for the same control.
    function wireDesktopMirrorSource(el, desktopId) {
        if (!el || el.dataset.mirrorWired) return;
        el.dataset.mirrorWired = '1';
        el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => applyDesktopMirror(desktopId));
    }
    // Called when a Mobile/Landscape control is edited directly. Per
    // this section's own top comment (DICKOCLICKO design decision 2):
    // while NOT independent, the edit is understood as editing Desktop's
    // own value (which this row is just mirroring), so it's redirected
    // there (and Desktop's own control DOM is updated to match, then
    // applyDesktopMirror() re-broadcasts to any OTHER non-independent
    // tab too - e.g. editing a non-independent Mobile slider also moves
    // the non-independent Landscape one). While independent, the edit
    // just updates this tab's own retained value store, nothing else.
    function onDevTargetControlEdited(tab, desktopId, targetId) {
        if (isDevRowIndependent(tab, desktopId)) {
            devDeviceValues[tab][desktopId] = readDevControlValue(targetId);
            return;
        }
        const value = readDevControlValue(targetId);
        writeDevControlValue(desktopId, value);
        const desktopEl = document.getElementById(desktopId);
        if (desktopEl) desktopEl.dispatchEvent(new Event(desktopEl.type === 'checkbox' || desktopEl.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    }
    // Desktop-only: "Show in Mobile/Landscape" - unchecking removes any
    // existing Mobile/Landscape row for this control entirely (next
    // sync); checking restores it, seeded from devDeviceValues (or
    // Desktop's current value, the first time). Appended by
    // buildUniformControlRow() itself, see that function's own comment -
    // `controlEl` is the row's own just-built control (see
    // wireDesktopMirrorSource()'s own comment on why an element
    // reference, not an id-lookup, is required here).
    function buildVisibilityCheckbox(controlEl, desktopId) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'dev-visibility-checkbox';
        cb.title = 'Show in Mobile/Landscape';
        cb.checked = isDevRowVisible(desktopId);
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
            devVisibility[desktopId] = cb.checked;
            syncTabOrderToDesktop('mobile');
            syncTabOrderToDesktop('landscape');
            syncStaticRowVisibility(desktopId);
            refreshEmptyGroupVisibility('mobile');
            refreshEmptyGroupVisibility('landscape');
            refreshGroupCascadeCheckboxState('desktop', desktopId);
        });
        wireDesktopMirrorSource(controlEl, desktopId);
        return cb;
    }
    // Mobile/Landscape-only: "Independent from Desktop." Unchecking
    // immediately snaps this row back to Desktop's current value
    // (matching DICKOCLICKO's own identical behavior - "unchecking
    // reverts this ONE control back to mirroring Desktop's own current
    // value immediately"); checking restores whatever this tab's own
    // value was the last time it was independent (devDeviceValues), or
    // just leaves the current (mirrored) value in place the first time.
    // `targetEl` is this row's own just-built control (element
    // reference, not an id - see wireDesktopMirrorSource()'s own
    // comment for why).
    function buildIndependenceCheckbox(tab, desktopId, targetEl) {
        const targetId = targetEl ? targetEl.id : null;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'dev-independence-checkbox';
        cb.title = 'Independent from Desktop';
        cb.checked = isDevRowIndependent(tab, desktopId);
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
            devIndependence[tab][desktopId] = cb.checked;
            if (cb.checked) {
                const restored = devDeviceValues[tab][desktopId];
                if (restored !== undefined) writeDevControlValue(targetId, restored);
            } else {
                // Captures the CURRENT (about-to-be-overwritten) value
                // before snapping to Desktop's - otherwise a control that
                // defaults independent (a real per-tab value, never live-
                // edited yet so onDevTargetControlEdited never ran) loses
                // its only copy of that tuned value the first time it's
                // unchecked, since devDeviceValues was never populated for
                // it. Ported from CLICKO, which found this exact bug live.
                devDeviceValues[tab][desktopId] = readDevControlValue(targetId);
                writeDevControlValue(targetId, readDevControlValue(desktopId));
            }
            refreshGroupCascadeCheckboxState(tab, desktopId);
        });
        if (targetEl && !targetEl.dataset.indepWired) {
            targetEl.dataset.indepWired = '1';
            targetEl.addEventListener(targetEl.type === 'checkbox' || targetEl.tagName === 'SELECT' ? 'change' : 'input', () => onDevTargetControlEdited(tab, desktopId, targetId));
        }
        return cb;
    }
    // Shared cascade behavior for BOTH group-level checkbox kinds
    // (Desktop visibility, Mobile/Landscape independence) - per this
    // section's own top comment, neither has persisted state of its
    // own; checking/unchecking the group checkbox just writes through
    // to every CURRENT child row's real flag (walking the live DOM), and
    // its own checked/indeterminate display is always COMPUTED from
    // children, never read back from storage. `getRowCheckbox(rowEl)`
    // returns that row's own real checkbox (visibility or independence,
    // whichever this cascade instance is for); `setChecked(rowEl, v)`
    // performs the actual state change (delegates to the same handler a
    // real click would run, so every side effect - sync, mirroring,
    // devDeviceValues - happens identically either way).
    function buildGroupCascadeCheckbox(sectionEl, kind) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'dev-group-cascade-checkbox';
        cb.dataset.cascadeKind = kind;
        cb.title = kind === 'visibility' ? 'Show in Mobile/Landscape (whole group)' : 'Independent from Desktop (whole group)';
        // CORRECTED 2026-09-21 (found live on HANDYSET, a real project built
        // from this template): this used to hardcode `cb.style.display =
        // 'none'` here, and nothing anywhere else in this file ever set it
        // back to visible (confirmed by exhaustive grep) -- the checkbox
        // existed in the DOM and worked functionally, but was permanently
        // invisible on every project built from this template, in every
        // group, forever. Left it fully visible by default instead (it's
        // meant to be a real, usable control sitting left of the group's
        // own undock/lock icons, per §12e/§12f-1's own documentation).
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
            const checked = cb.checked;
            const content = sectionEl.querySelector(':scope > .dev-section-content');
            if (!content) return;
            content.querySelectorAll(':scope > .dev-row [id]').forEach(idEl => {
                const rowCb = idEl.closest('.dev-row').querySelector(kind === 'visibility' ? '.dev-visibility-checkbox' : '.dev-independence-checkbox');
                if (rowCb && rowCb.checked !== checked) { rowCb.checked = checked; rowCb.dispatchEvent(new Event('change')); }
            });
            content.querySelectorAll(':scope > .dev-section').forEach(subSec => {
                const subCb = subSec.querySelector(':scope > .dev-section-title > .dev-group-cascade-checkbox[data-cascade-kind="' + kind + '"]');
                // subCb.indeterminate is checked separately from
                // subCb.checked !== checked - a subgroup already showing
                // checked:false/indeterminate:true (mixed) would otherwise
                // be silently skipped (false !== false is false), leaving
                // its own descendants completely untouched by the cascade.
                // Found live on CLICKO: unchecking a large group left a
                // nested mixed-state subgroup - and everything under it -
                // fully checked, never actually cascaded into at all.
                if (subCb && (subCb.indeterminate || subCb.checked !== checked)) {
                    subCb.checked = checked;
                    subCb.indeterminate = false;
                    subCb.dispatchEvent(new Event('change'));
                }
            });
        });
        return cb;
    }
    // Undock/Dock (2026-09-19, direct request: "next to the lock button per
    // settings group, provide a 'undock' button that undocks that one
    // setting group and allows me to use it, visibly as a differetn panel.
    // But when i click the 'undock/dock' button again, it will dock back
    // in its previous position in the dev panel. I want the undocked
    // panel to be able to be resized and drag and moved same as the dev
    // panel." - "lock button" was clarified to mean the group-level
    // cascade checkbox above). Session-only by design - no position/size/
    // undocked-state persistence across reload/Save/Copy (see
    // dockAllUndockedGroups()'s own comment below) - undocking is a live
    // viewing convenience, not a saved layout choice.
    // Lock icon (2026-09-19, ported from Clicko - "add a lock icon that i
    // can select. If selected, the settings within that group cannot be
    // reordered or moved into another group"). Keyed the same way as
    // devTextOverrides/sectionCollapseState (getSectionKey(titleEl) -
    // stable, DOM-position-independent). Deliberately scoped to ONLY the
    // contents INSIDE a locked group - the locked group ITSELF can still
    // be dragged/reordered/nested as a whole; only what's nested inside it
    // (rows AND, per the 2026-10-11 correction below, subgroups at any
    // depth) can't be reordered within it or dragged out to another group.
    // Enforced in setupDragReorder() itself (search "lockedGroups.has") by
    // refusing to even START a drag on a .dev-row or nested .dev-section
    // whose own ancestor .dev-section is locked - satisfies both halves of
    // the request at once, since a drag that never starts can neither
    // reorder in place nor be dropped into a different group. Also refuses
    // delete (findDevDeleteProtectionReason()).
    // CORRECTED 2026-10-11, direct request: "when a group is locked in the
    // dev panel, all its subgroups will be locked as well...none of the
    // subgroups or settings in every subgroup cannot be dragged or nested
    // or regrouped in anyway. I will have to unlock the parent group to
    // allow that." Originally (2026-09-19) this gate only covered .dev-row
    // drags, on the stated assumption that a nested subgroup needed no
    // separate check since it only ever moved as a whole unit. That left a
    // real gap once lock-cascading onto nested subgroups shipped
    // (2026-10-06): a subgroup nested inside a locked ancestor could still
    // be dragged OUT from under it, even though every row directly inside
    // that same ancestor was already frozen. Fixed by adding the matching
    // .dev-section branch in setupDragReorder()'s pointerdown gate -
    // ancestor-only (never the item's own lock state), so a directly-
    // locked group still moves as a whole unit exactly as before.
    // Dev Panel and Debug start locked by default on every tab, per
    // direct request 2026-09-28 ("by default set the lock mode on all
    // default setting groups to locked. such as the Dev panel settings
    // group") — these 2 are the template's own mandatory built-in groups
    // (CLAUDE.md §12i/§12i-1), so locking them out of the box protects
    // them from an accidental drag/delete the same way
    // findDevDeleteProtectionReason() already refuses to delete them
    // outright; a project can still unlock either via its own lock icon
    // if it genuinely wants to reorganize them.
    let lockedGroups = new Set(
        DEV_PANEL_TABS.flatMap(tab => [tab + ':Dev Panel', tab + ':Debug'])
    );
    // Builds and appends one group's own lock-toggle icon - a SIBLING of
    // .dev-section-title (same rename-survival reasoning as the drag
    // handle/undock button). Shared by createDevGroupElement() (a freshly-
    // created group) and injectGroupLockIcons() (every group already in
    // the DOM at panel-build time) - idempotent, so calling it twice on
    // the same section just replaces the old icon rather than duplicating it.
    function addGroupLockIcon(section) {
        const existing = section.querySelector(':scope > .dev-group-lock-icon');
        if (existing) existing.remove();
        const titleEl = section.querySelector(':scope > .dev-section-title');
        if (!titleEl) return;
        const icon = document.createElement('span');
        icon.className = 'dev-group-lock-icon';
        const key = getSectionKey(titleEl);
        icon.classList.toggle('locked', lockedGroups.has(key));
        icon.textContent = lockedGroups.has(key) ? '🔒' : '🔓';
        icon.title = lockedGroups.has(key) ? 'Locked - click to unlock' : 'Unlocked - click to lock';
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            const k = getSectionKey(titleEl);
            const nowLocked = !lockedGroups.has(k);
            // Cascades to every nested subgroup, direct request 2026-10-06
            // ("when i lock a group, all subgroups gets locked as well.
            // And vice versa to unlock") — walks every descendant
            // .dev-section (any depth) and applies the SAME lock state to
            // each, keeping lockedGroups and every icon's own display in
            // sync, not just the group that was actually clicked.
            section.querySelectorAll('.dev-section').forEach(subSection => {
                const subTitle = subSection.querySelector(':scope > .dev-section-title');
                if (!subTitle) return;
                const subKey = getSectionKey(subTitle);
                const subIcon = subSection.querySelector(':scope > .dev-group-lock-icon');
                if (nowLocked) lockedGroups.add(subKey); else lockedGroups.delete(subKey);
                if (subIcon) {
                    subIcon.textContent = nowLocked ? '🔒' : '🔓';
                    subIcon.title = nowLocked ? 'Locked - click to unlock' : 'Unlocked - click to lock';
                    subIcon.classList.toggle('locked', nowLocked);
                }
            });
            if (nowLocked) { lockedGroups.add(k); icon.textContent = '🔒'; icon.title = 'Locked - click to unlock'; icon.classList.add('locked'); }
            else { lockedGroups.delete(k); icon.textContent = '🔓'; icon.title = 'Unlocked - click to lock'; icon.classList.remove('locked'); }
        });
        // pointerdown also needs stopping - setupDragReorder() listens at
        // the document level, and the icon visually overlaps the title bar
        // (the group-reorder drag handle's own hit area), so without this a
        // click on the icon would also arm a group-drag underneath it.
        icon.addEventListener('pointerdown', (e) => e.stopPropagation());
        section.appendChild(icon);
    }
    // One-time pass over every group already in the DOM when the panel is
    // first built - createDevGroupElement() covers any group created AFTER
    // this point via its own addGroupLockIcon() call (see its own comment).
    function injectGroupLockIcons() {
        DEV_PANEL_TABS.forEach(tab => {
            const tabEl = document.getElementById(tab + 'TabContent');
            if (!tabEl) return;
            tabEl.querySelectorAll('.dev-section').forEach(addGroupLockIcon);
        });
    }
    const undockedGroups = new Map(); // sectionEl -> { panel, parent, nextSibling, btn }
    function buildGroupUndockButton(sectionEl) {
        const btn = document.createElement('span');
        btn.className = 'dev-group-undock-btn';
        // U+2197 (simple NORTH EAST ARROW), not U+2B08 (a Miscellaneous
        // Symbols and Arrows glyph with much weaker font-fallback support -
        // direct report: "i dont see the dock and undock button", root-
        // caused to this rendering as an unrecognizable small mark rather
        // than a real icon, not the element being absent). ↗/↙ below are
        // in the basic Arrows block, same broad support as ←→↑↓.
        btn.textContent = '↗';
        btn.title = 'Undock this group into its own floating panel';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleGroupUndock(sectionEl, btn);
        });
        return btn;
    }
    // Creates the floating panel a group's content moves into while
    // undocked - own drag-to-move header + 8-handle resize (reusing
    // setupPanelResizeHandle()'s now-generalized setLeftTop callback, see
    // its own comment, plus the same .dev-panel-resize-edge/-corner CSS
    // classes the main panel uses) - position/size held as plain inline
    // styles, independent per undocked panel, never persisted.
    function createUndockPanel(sectionEl, titleText) {
        const rect = sectionEl.getBoundingClientRect();
        const panel = document.createElement('div');
        panel.className = 'dev-undock-panel';
        panel.style.left = Math.round(rect.left) + 'px';
        panel.style.top = Math.round(rect.top) + 'px';
        panel.style.width = Math.max(240, Math.round(rect.width)) + 'px';
        panel.style.height = Math.min(window.innerHeight - Math.round(rect.top) - 20, Math.max(160, Math.round(rect.height) + 60)) + 'px';

        const header = document.createElement('div');
        header.className = 'dev-undock-panel-header';
        const titleSpan = document.createElement('span');
        titleSpan.textContent = titleText;
        const dockBtn = document.createElement('button');
        dockBtn.className = 'dev-undock-panel-dock-btn';
        dockBtn.textContent = 'DOCK';
        dockBtn.title = 'Dock this group back into the dev panel';
        dockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const entry = undockedGroups.get(sectionEl);
            if (entry) toggleGroupUndock(sectionEl, entry.btn);
        });
        header.appendChild(titleSpan);
        header.appendChild(dockBtn);
        panel.appendChild(header);

        const body = document.createElement('div');
        body.className = 'dev-undock-panel-body';
        panel.appendChild(body);

        ['edge-top', 'edge-bottom', 'edge-left', 'edge-right', 'corner-tl', 'corner-tr', 'corner-bl', 'corner-br'].forEach(cls => {
            const handle = document.createElement('div');
            handle.className = (cls.indexOf('edge') === 0 ? 'dev-panel-resize-edge ' : 'dev-panel-resize-corner ') + cls;
            panel.appendChild(handle);
        });
        const setLeftTop = (key, value) => { panel.style[key] = value + 'px'; };
        setupPanelResizeHandle(panel, panel.querySelector('.edge-top'), null, 'top', setLeftTop);
        setupPanelResizeHandle(panel, panel.querySelector('.edge-bottom'), null, 'bottom', setLeftTop);
        setupPanelResizeHandle(panel, panel.querySelector('.edge-left'), 'left', null, setLeftTop);
        setupPanelResizeHandle(panel, panel.querySelector('.edge-right'), 'right', null, setLeftTop);
        setupPanelResizeHandle(panel, panel.querySelector('.corner-tl'), 'left', 'top', setLeftTop);
        setupPanelResizeHandle(panel, panel.querySelector('.corner-tr'), 'right', 'top', setLeftTop);
        setupPanelResizeHandle(panel, panel.querySelector('.corner-bl'), 'left', 'bottom', setLeftTop);
        setupPanelResizeHandle(panel, panel.querySelector('.corner-br'), 'right', 'bottom', setLeftTop);

        // Drag-to-move via the header, same pattern as devPanelHeader's own
        // drag handler above, simplified (no mobile-edge-swipe-gesture
        // clamping - that's specifically a concern for the ALWAYS-present
        // main panel; an undocked panel is a transient, opt-in convenience).
        let dragging = false;
        let dragStart = { pointerX: 0, pointerY: 0, left: 0, top: 0 };
        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            e.preventDefault();
            const r = panel.getBoundingClientRect();
            dragStart = { pointerX: e.clientX, pointerY: e.clientY, left: r.left, top: r.top };
            dragging = true;
            header.classList.add('dragging');
            try { header.setPointerCapture(e.pointerId); } catch (err) {}
        });
        document.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            if (e.buttons === 0) { endDrag(e); return; }
            const panelRect = panel.getBoundingClientRect();
            const dx = e.clientX - dragStart.pointerX;
            const dy = e.clientY - dragStart.pointerY;
            const newLeft = Math.max(0, Math.min(window.innerWidth - panelRect.width, dragStart.left + dx));
            const newTop = Math.max(0, Math.min(window.innerHeight - panelRect.height, dragStart.top + dy));
            panel.style.left = Math.round(newLeft) + 'px';
            panel.style.top = Math.round(newTop) + 'px';
        });
        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            header.classList.remove('dragging');
            if (e && e.pointerId !== undefined && header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);
        }
        document.addEventListener('pointerup', endDrag);
        document.addEventListener('pointercancel', endDrag);
        header.addEventListener('lostpointercapture', endDrag);

        document.body.appendChild(panel);
        body.appendChild(sectionEl);
        return panel;
    }
    // Toggles ONE group between docked (living in its normal place inside
    // the main dev panel) and undocked (living in its own floating panel -
    // createUndockPanel() above). Docking back uses the saved parent +
    // nextSibling reference to restore the EXACT original position, same
    // real-DOM-node-preservation technique this file's own Undo/Delete
    // already use for byte-identical restoration (not a rebuild from
    // captured data, which could drift).
    function toggleGroupUndock(sectionEl, btn) {
        const entry = undockedGroups.get(sectionEl);
        if (entry) {
            if (entry.nextSibling && entry.nextSibling.parentElement === entry.parent) {
                entry.parent.insertBefore(sectionEl, entry.nextSibling);
            } else {
                entry.parent.appendChild(sectionEl);
            }
            entry.panel.remove();
            undockedGroups.delete(sectionEl);
            btn.textContent = '↗';
            btn.title = 'Undock this group into its own floating panel';
            sectionEl.classList.remove('dev-group-undocked');
        } else {
            const parent = sectionEl.parentElement;
            const nextSibling = sectionEl.nextSibling;
            const titleText = sectionEl.querySelector(':scope > .dev-section-title')?.dataset.sid || 'Group';
            const panel = createUndockPanel(sectionEl, titleText);
            undockedGroups.set(sectionEl, { panel, parent, nextSibling, btn });
            btn.textContent = '↙';
            btn.title = 'Dock this group back into the dev panel';
            sectionEl.classList.add('dev-group-undocked');
        }
    }
    // Docks every currently-undocked group back into place - called before
    // any operation that captures/reads the panel's structure from its
    // normal DOM location (Copy/Sync/Named Setting States/Undo snapshot),
    // since an undocked group's .dev-section is no longer a descendant of
    // its tab's #<tab>TabContent at all (it's inside a floating panel,
    // appended to document.body) and would otherwise be silently invisible
    // to captureSectionOrder()/captureFullDevPanelState(). Keeps undocking
    // a purely live/transient state, never a saved one - simpler and safer
    // than teaching every capture path to look inside floating panels too.
    function dockAllUndockedGroups() {
        Array.from(undockedGroups.keys()).forEach(sectionEl => {
            const entry = undockedGroups.get(sectionEl);
            if (entry) toggleGroupUndock(sectionEl, entry.btn);
        });
    }
    // Recomputes every ancestor group's own cascade-checkbox checked/
    // indeterminate display from its current children - called after any
    // individual row checkbox changes (both a real click and a group-
    // cascade write-through), so an ancestor never shows a stale
    // all-checked/all-unchecked state. `tab` selects which kind
    // ('desktop' -> visibility, else -> independence); `desktopId` is
    // only used to find the row to start walking up from.
    function refreshGroupCascadeCheckboxState(tab, desktopId) {
        const kind = tab === 'desktop' ? 'visibility' : 'independence';
        const id = tab === 'desktop' ? desktopId : desktopId.replace(/^(slider|color|select|checkbox|curveEditor|rangeBar|gradientPicker)/, '$1' + (tab === 'landscape' ? 'Landscape' : 'Mobile'));
        const rowEl = document.getElementById(id)?.closest('.dev-row');
        let sectionEl = rowEl ? rowEl.closest('.dev-section') : null;
        while (sectionEl) {
            recomputeOneGroupCascadeCheckbox(sectionEl, kind);
            sectionEl = sectionEl.parentElement ? sectionEl.parentElement.closest('.dev-section') : null;
        }
    }
    // Computes ONE section's own cascade checkbox (of the given `kind`)
    // checked/indeterminate display from its DIRECT children only - a
    // no-op if this section has no such checkbox (e.g. a static group
    // before ensureStaticGroupCascadeCheckboxes() has run, or simply the
    // wrong `kind` for this tab). Shared by refreshGroupCascadeCheckboxState()
    // above (ancestor-walking, after one real checkbox change) and
    // refreshAllGroupCascadeCheckboxes() below (every section, after a
    // batch of rows was just built) - callers are responsible for
    // ordering (deepest-first for a full refresh, since a parent's own
    // correct state depends on its children already being current).
    function recomputeOneGroupCascadeCheckbox(sectionEl, kind) {
        const cb = sectionEl.querySelector(':scope > .dev-section-title > .dev-group-cascade-checkbox[data-cascade-kind="' + kind + '"]');
        if (!cb) return;
        const rowSelector = kind === 'visibility' ? '.dev-visibility-checkbox' : '.dev-independence-checkbox';
        const content = sectionEl.querySelector(':scope > .dev-section-content');
        const states = [];
        content.querySelectorAll(':scope > .dev-row').forEach(r => {
            const rcb = r.querySelector(rowSelector);
            if (rcb) states.push(rcb.checked);
        });
        content.querySelectorAll(':scope > .dev-section').forEach(sub => {
            const scb = sub.querySelector(':scope > .dev-section-title > .dev-group-cascade-checkbox[data-cascade-kind="' + kind + '"]');
            if (scb) states.push(scb.indeterminate ? 'mixed' : scb.checked);
        });
        const allChecked = states.length > 0 && states.every(s => s === true);
        const allUnchecked = states.every(s => s === false);
        cb.checked = allChecked;
        cb.indeterminate = !allChecked && !allUnchecked && states.length > 0;
    }
    // Full, one-shot refresh of EVERY group's own cascade checkbox
    // (both kinds) from its current children - needed because
    // refreshGroupCascadeCheckboxState() above only ever fires reactively,
    // off one real checkbox's own 'change' event. A batch of rows built
    // by a project's own render*Controls() call and appended with an
    // already-checked/unchecked default (buildVisibilityCheckbox()/
    // buildIndependenceCheckbox() set `.checked` directly, no 'change'
    // event fires for that) would otherwise leave every ancestor group's
    // own checkbox showing its stale build-time default (unchecked)
    // forever, until something happened to be toggled by hand. Call once
    // after your own render*Controls() calls finish (see
    // ensureDevPanelBuilt()'s own call below) - depth-sorted (deepest
    // groups computed first, same technique DICKOCLICKO's own
    // refreshGroupIndependenceStates() uses) so a parent's own
    // computation always sees its children's ALREADY-current state, not
    // last-refresh's stale one.
    function refreshAllGroupCascadeCheckboxes() {
        function depth(el) {
            let d = 0, cur = el.parentElement;
            while (cur) { if (cur.classList.contains('dev-section')) d++; cur = cur.parentElement; }
            return d;
        }
        const sections = Array.from(document.querySelectorAll('.dev-section')).sort((a, b) => depth(b) - depth(a));
        ['visibility', 'independence'].forEach(kind => {
            sections.forEach(sec => recomputeOneGroupCascadeCheckbox(sec, kind));
        });
    }
    // Backfills a group cascade checkbox onto any EXISTING .dev-section-title
    // that doesn't already have one - specifically the 3 static built-in
    // "Dev Panel" groups in the HTML above (createDevGroupElement()
    // already adds one to every group IT creates - custom "+ Add Group"
    // groups and dynamically-mirrored ones alike - so this only ever
    // needs to backfill markup that predates this feature and can't run
    // JS inline). Runs once at init (see initDevPanelEngine() below) -
    // nothing after that point can ever create a titleEl missing one.
    function ensureStaticGroupCascadeCheckboxes() {
        // Scoped to titles actually inside a tab content root - a
        // panel-level group outside the tab system entirely ("Saved Dev
        // Settings", added 2026-09-14 - see its own HTML comment) has no
        // Mobile/Landscape counterpart to be visible-in/independent-from
        // at all, so a cascade checkbox there would be meaningless. Was a
        // bare global '.dev-section-title' query before this group
        // existed.
        document.querySelectorAll('[id$="TabContent"] .dev-section-title').forEach(titleEl => {
            if (titleEl.querySelector(':scope > .dev-group-cascade-checkbox')) return;
            const tabContentEl = titleEl.closest('[id$="TabContent"]');
            const tab = tabContentEl ? tabContentEl.id.replace('TabContent', '') : 'desktop';
            const section = titleEl.closest('.dev-section');
            titleEl.appendChild(buildGroupCascadeCheckbox(section, tab === 'desktop' ? 'visibility' : 'independence'));
        });
    }
    // Same static-group backfill as ensureStaticGroupCascadeCheckboxes()
    // above, for the Undock button instead - every group that predates
    // this feature (i.e. every group in this template's own static HTML)
    // needs its button injected once, here; createDevGroupElement() above
    // covers any group created AFTER this feature exists. Idempotent
    // (skips a section that already has one) so it's safe to call again.
    function ensureStaticGroupUndockButtons() {
        document.querySelectorAll('[id$="TabContent"] .dev-section').forEach(section => {
            if (section.querySelector(':scope > .dev-group-undock-btn')) return;
            section.appendChild(buildGroupUndockButton(section));
        });
    }
    // Creates (or finds) a Mobile/Landscape counterpart row for one
    // Desktop control, per its own devVisibility flag - the dynamic
    // heart of this whole feature, called from syncTabOrderToDesktop()
    // below for EVERY Desktop row it walks (universal as of 2026-09-17 -
    // no opt-in flag any more). Returns the target-tab control's own id,
    // or null if this row shouldn't exist on this tab right now
    // (genuinely hidden, not one of the 4 uniform types this pass
    // covers, or not a registered control at all).
    function ensureDynamicTargetRow(targetTab, desktopId, targetRowByDesktopId, scratch) {
        const existingId = targetRowByDesktopId[desktopId];
        const desktopCtrl = findRegisteredControlById(desktopId);
        // No opt-in gate any more (UNIVERSAL as of 2026-09-17, see
        // buildUniformControlRow()'s own comment) - only a genuinely
        // unregistered desktopId (not a real control at all) short-
        // circuits here now.
        if (!desktopCtrl) return existingId || null;
        const visible = isDevRowVisible(desktopId);
        if (!visible) {
            if (existingId) {
                const el = document.getElementById(existingId);
                const rowEl = el ? el.closest('.dev-row') : null;
                if (rowEl) rowEl.remove();
                delete targetRowByDesktopId[desktopId];
            }
            return null;
        }
        if (existingId) return existingId;
        const devicePrefix = targetTab === 'landscape' ? 'Landscape' : 'Mobile';
        const newId = desktopId.replace(/^(slider|color|select|checkbox|curveEditor|rangeBar|gradientPicker)/, '$1' + devicePrefix);
        // Prefer a REAL, separately-registered per-device ctrl (an old-
        // style control, authored with its own independently-tuned
        // Mobile/Landscape entry before this feature existed) over
        // cloning Desktop's own definition - Desktop's min/max/value can
        // be flatly wrong for a control genuinely meant to differ per
        // device (e.g. a smaller Desktop range vs. a larger Mobile one).
        // Only reached when a hidden-then-re-shown row needs rebuilding,
        // since an already-visible old-style row is found via existingId
        // above and never touches this path at all.
        const realCtrl = findRegisteredControlById(newId);
        const baseCtrl = realCtrl || desktopCtrl;
        if (!UNIFORM_ROW_BUILDERS[baseCtrl.type]) return null; // not a uniform-type control - out of this pass's scope, see top comment
        const clonedCtrl = Object.assign({}, baseCtrl, { id: newId, tab: targetTab });
        const row = buildUniformControlRow(clonedCtrl);
        row.dataset.dynamicTwin = '1'; // engine-created -- see hasStaticDeviceCounterpart()
        if (clonedCtrl.type === 'select') row.querySelector('select').value = clonedCtrl.value;
        else if (clonedCtrl.type === 'checkbox') row.querySelector('input').checked = !!clonedCtrl.value;
        scratch.appendChild(row);
        const restored = devDeviceValues[targetTab][desktopId];
        const independent = isDevRowIndependent(targetTab, desktopId);
        if (independent && restored !== undefined) writeDevControlValue(newId, restored);
        else if (independent && realCtrl) writeDevControlValue(newId, realCtrl.value);
        else writeDevControlValue(newId, readDevControlValue(desktopId));
        targetRowByDesktopId[desktopId] = newId;
        return newId;
    }

    // ================================================================
    // [JS-4b] CROSS-TAB ORDER MIRRORING (DESKTOP -> MOBILE/LANDSCAPE)
    // ================================================================
    // Whenever Mobile or Landscape is opened, its own group/setting
    // order is re-derived from Desktop's CURRENT order, live, every
    // time — Desktop is always the source of truth, one-directional by
    // design (ported from a real project's own dev panel, where this
    // shipped in response to direct reports that renaming/reordering/
    // regrouping/nesting groups on Desktop wasn't reflected on the
    // other tabs — see the MAINTENANCE note at the top of this file).
    // Matches each Desktop group to its target-tab counterpart by
    // data-sid (a stable id frozen at creation - see getSectionKey()'s
    // own comment - so matching survives a rename; the DISPLAYED name
    // is a completely separate thing, mirrored by syncRename() below,
    // NOT by this id match alone) and each row by resolveDevControlId()'s
    // desktopId (a Mobile/Landscape control's id with the device name
    // removed — see [JS-5] below). A Desktop-only control (no id exists
    // on the target tab) is correctly dropped, never force-created; a
    // target-tab-only control (no Desktop id matches — e.g. a setting
    // that's deliberately only meaningful on Mobile) is preserved by
    // appending it to the end of whichever group it's currently sitting
    // in; a target-tab-only GROUP (no Desktop counterpart at all) is
    // preserved by appending it to the end of the tab, after every
    // Desktop-matched group, rather than being silently dropped or left
    // stranded at whatever DOM position it happened to occupy. Nesting
    // depth is unlimited and handled for free — captureSection()/
    // applySectionOrder() above are already fully recursive, this only
    // needs to translate through the same recursive shape.
    //
    // RENAME MIRRORING: a group's displayed TITLE and each setting's
    // displayed LABEL (both driven by devTextOverrides, [JS-9] above)
    // are ALSO mirrored here, live, every sync - not just carried over
    // once when a target-tab counterpart is first created. See
    // syncRename()'s own comment below for exactly why a naive
    // "copy-once" version is a real, shipped bug and not just a
    // theoretical risk.
    //
    // Known narrow gap, left unhandled (call this again from your own
    // code with a fix if you need it): a target-tab-only GROUP nested
    // INSIDE a Desktop-matched group isn't found by the leftover-group
    // pass below, which only scans the tab's own top-level groups — it
    // needs both a device-only nested group AND that exact nesting
    // depth to matter, a narrow enough case that a real project (CLICKO)
    // shipped without it and revisited only if it ever actually came up.
    function syncTabOrderToDesktop(targetTab) {
        if (targetTab === 'desktop') return;
        const desktopOrder = captureSectionOrder().desktopTabContent;
        const targetTabId = targetTab + 'TabContent';
        const targetTabEl = document.getElementById(targetTabId);
        if (!desktopOrder || !targetTabEl) return;

        // Every target-tab row, keyed by ITS OWN desktop-equivalent id -
        // tab-wide (not :scope-scoped to any one group), since a row's
        // target-tab counterpart may currently live nested, top-level,
        // or under a totally different parent than Desktop's.
        const targetRowByDesktopId = {};
        targetTabEl.querySelectorAll('.dev-row [id]').forEach(idEl => {
            targetRowByDesktopId[resolveDevControlId(idEl.id).desktopId] = idEl.id;
        });
        const placedRowIds = new Set();
        let overridesChanged = false;
        // Temporary parking spot for a row ensureDynamicTargetRow() just
        // created dynamically - needs to sit inside SOME .dev-section-content
        // for applySectionOrder()'s own rowsByKey lookup (built via
        // '.dev-section-content > .dev-row') to find it by id; removed
        // once applySectionOrder() has moved every real row out of it
        // into its correct final position (see below - it's always
        // empty by then, never left behind).
        const scratch = document.createElement('div');
        scratch.className = 'dev-section-content';
        scratch.style.display = 'none';
        targetTabEl.appendChild(scratch);

        // Mirrors ONE rename from its Desktop key onto its target-tab
        // counterpart key, live, EVERY sync - not just the first time
        // the counterpart is matched/created (ported from a real
        // project's own dev panel, which shipped without this re-copy
        // the first time and found a real bug: a rename only carried
        // over ONCE, since a naive "does the target already have an
        // override" check was true forever after that first carry-over
        // - see devTextOverridesManual's own comment, [JS-9] above).
        // Skips a key this tab has been independently renamed on
        // directly, so a deliberate target-tab-only name is never
        // clobbered; otherwise keeps re-copying Desktop's current value
        // - including clearing it back to null when Desktop's own
        // rename is itself cleared - so a LATER Desktop rename, not
        // just the initial one, reaches the target tab on every
        // subsequent switch. Used for both group titles and individual
        // row labels below.
        function syncRename(desktopKey, targetKey) {
            if (devTextOverridesManual.has(targetKey)) return;
            const desktopVal = devTextOverrides[desktopKey] != null ? devTextOverrides[desktopKey] : null;
            if (devTextOverrides[targetKey] !== desktopVal) {
                devTextOverrides[targetKey] = desktopVal;
                overridesChanged = true;
            }
        }

        function translateGroup(savedGroup) {
            const sid = savedGroup.key.slice(savedGroup.key.indexOf(':') + 1);
            // Mouse Log ([JS-13c]) is a single, Desktop-only widget - its
            // checkbox/slider ARE real registered rows (so they'd
            // otherwise mirror fine), but the live log display + Copy/
            // Save/Clear buttons are hand-built DOM outside the control-
            // registration system entirely, so a mirrored copy would only
            // ever be an empty, non-functional shell (confirmed live: 0
            // children). Skipped by name rather than generalizing "skip
            // truly empty groups" into this shared function for every
            // project's own groups - a narrow, explicitly-commented
            // exception for this one built-in widget.
            if (sid === 'Mouse Log') return null;
            const groupKey = targetTab + ':' + sid;
            // Walks savedGroup.items (the interleaved row/subgroup order -
            // 2026-09-19, see captureSection()'s own comment) instead of
            // the old separate rowKeys/subgroups arrays, so a row placed
            // ABOVE a subgroup on Desktop mirrors that same interleaved
            // order onto Mobile/Landscape, not "all rows first." Falls
            // back to the pre-2026-09-19 rowKeys-then-subgroups shape for
            // a savedGroup captured before this change (there is none in
            // practice - captureSectionOrder() above always produces the
            // new shape now - but this keeps translateGroup() correct
            // even if called on an externally-sourced legacy sectionOrder,
            // e.g. one round-tripped through localStorage from an older
            // page load).
            const items = savedGroup.items || [
                ...(savedGroup.rowKeys || []).map(key => ({ type: 'row', key })),
                ...(savedGroup.subgroups || []).map(section => ({ type: 'group', section })),
            ];
            const translatedItems = items.map(item => {
                if (item.type === 'row') {
                    // Per direct request: a row's presence here is now
                    // decided by its OWN devVisibility flag (default
                    // visible - see this feature's own [JS-4b0] section
                    // above), not by whether a target-tab DOM row happens
                    // to already exist - ensureDynamicTargetRow() creates
                    // one on the fly (cloning Desktop's own control
                    // metadata) or removes an existing one, whichever the
                    // flag currently says, and returns null only when
                    // neither applies (row hidden, or a control type
                    // outside this pass's scope).
                    const targetId = ensureDynamicTargetRow(targetTab, item.key, targetRowByDesktopId, scratch);
                    if (!targetId) return null;
                    placedRowIds.add(targetId);
                    syncRename(item.key, targetId);
                    return { type: 'row', key: targetId };
                }
                const translatedSub = translateGroup(item.section);
                return translatedSub ? { type: 'group', section: translatedSub } : null;
            }).filter(Boolean);
            syncRename(savedGroup.key, groupKey);
            return {
                key: groupKey,
                items: translatedItems,
                rowKeys: translatedItems.filter(it => it.type === 'row').map(it => it.key),
                subgroups: translatedItems.filter(it => it.type === 'group').map(it => it.section),
            };
        }
        const translated = desktopOrder.map(translateGroup).filter(Boolean);

        function findByKey(groups, key) {
            for (const g of groups) {
                if (g.key === key) return g;
                const found = findByKey(g.subgroups || [], key);
                if (found) return found;
            }
            return null;
        }
        // Leftover rows (target-tab-only controls, no Desktop id
        // matched anything above) - appended to the end of whichever
        // translated group they're CURRENTLY sitting in, found via
        // their live parent .dev-section's own key. applySectionOrder()
        // only ever places rows it's explicitly told about, so skipping
        // this step would silently drop these instead of preserving them.
        targetTabEl.querySelectorAll('.dev-row [id]').forEach(idEl => {
            if (placedRowIds.has(idEl.id)) return;
            const sec = idEl.closest('.dev-section');
            if (!sec) return;
            const key = getSectionKey(sec.querySelector(':scope > .dev-section-title'));
            const group = findByKey(translated, key);
            if (group) {
                // Pushed into BOTH items (what applySectionOrder() actually
                // reads now - see placeSection()'s own comment) and the
                // derived rowKeys, so this leftover row doesn't silently
                // vanish on restore the way it would if only rowKeys were
                // updated here (2026-09-19 - items/rowKeys used to be the
                // same single source before the interleaved-order change,
                // this push predates that change).
                group.items.push({ type: 'row', key: idEl.id });
                group.rowKeys.push(idEl.id);
            }
        });

        // Leftover groups (target-tab-only, no Desktop counterpart at
        // all) - appended to the end of the tab. See this function's
        // own top comment for the narrow nested-leftover-group gap this
        // doesn't cover.
        function collectKeys(groups, out) {
            groups.forEach(g => { out.add(g.key); collectKeys(g.subgroups || [], out); });
            return out;
        }
        const translatedKeys = collectKeys(translated, new Set());
        targetTabEl.querySelectorAll(':scope > .dev-section').forEach(sec => {
            const key = getSectionKey(sec.querySelector(':scope > .dev-section-title'));
            if (!translatedKeys.has(key)) translated.push(captureSection(sec));
        });

        applySectionOrder({ [targetTabId]: translated });
        // Always empty by now - every row ensureDynamicTargetRow() ever
        // parked here was included in `translated` above (via rowKeys),
        // so applySectionOrder() just moved each one out into its real
        // group. Safe to remove unconditionally.
        scratch.remove();
        // A newly-created group is painted with its raw internal name
        // by createDevGroupElement()/applySectionOrder() - re-run the
        // override painter now that devTextOverrides may have gained a
        // fresh entry for it (or for any row above), so a carried-over
        // rename actually shows instead of the raw fallback text.
        if (overridesChanged) applyDevTextOverrides();
        // Unlike Clicko (where every row is static, built once at page
        // load), this template's own dynamicDevice feature (ensureDynamicTargetRow()
        // above) DOES create new row DOM after the panel is first built -
        // any freshly-created Mobile/Landscape row needs its own drag
        // handle too, so re-run the same idempotent injection pass rather
        // than assuming injectRowDragHandles()'s one initial call already
        // covered it.
        injectRowDragHandles();
    }

    // ================================================================
    // [JS-5] DEVICE-SPLIT ID NAMING CONVENTION
    // ================================================================
    // Device-split naming convention: a Desktop control's own id
    // (e.g. sliderButtonSpeed) gets a Mobile/Landscape twin by inserting
    // "Mobile"/"Landscape" right after the type prefix (sliderMobile
    // ButtonSpeed, sliderLandscapeButtonSpeed) — per CLAUDE.md Section
    // 12f, spatial/size settings default to independently-tunable per
    // device; this is the naming convention that makes that pattern
    // parseable generically instead of hand-listing every id 3x.
    // Pure regex/naming logic, no project-specific coupling — use this
    // in your OWN device-split settings the same way the engine's own
    // DEVPANEL_STYLE_CONTROLS ids already follow it.
    function resolveDevControlId(id) {
        const m = id.match(/^(slider|color|select|checkbox|curveEditor|rangeBar)(Mobile|Landscape)(.+)$/);
        if (m) return { device: m[2] === 'Landscape' ? 'landscape' : 'mobile', desktopId: m[1] + m[3] };
        return { device: 'desktop', desktopId: id };
    }

    // ================================================================
    // [JS-6] ROW BUILDERS (SLIDER / COLOR / SELECT / CHECKBOX / TEXT INPUT)
    // ================================================================
    // Row builders — one function per control type + a dispatch table.
    // Each takes a plain {id, label, ...} object and returns a
    // <div class="dev-row"> ready to append into a group's content.
    // ----------------------------------------------------------------

    // Resolves a group's .dev-section-content by tab + data-sid,
    // warning on 0 matches (group not found) or 2+ matches (a data-sid
    // collision — e.g. 2 groups both named "New Group").
    function findGroupContent(tabId, groupSid, callerName, ctrlId) {
        // Descendant (not direct-child) selector: a group nested inside another group
        // (e.g. "Album Cover Colors" inside "Timeline Look") has to be findable too.
        const matches = document.querySelectorAll('#' + tabId + 'TabContent .dev-section-title[data-sid="' + groupSid.replace(/"/g, '\\"') + '"]');
        if (matches.length === 0) {
            console.warn(callerName + ': group not found', groupSid, ctrlId);
            return null;
        }
        if (matches.length > 1) {
            console.warn(callerName + ': ' + matches.length + ' groups share this data-sid (using the first) - a rename/duplication collision', groupSid, ctrlId);
        }
        return matches[0].nextElementSibling;
    }

    // {id, label, min, max, step, value}
    function buildSliderRow(ctrl) {
        const row = document.createElement('div');
        row.className = 'dev-row';
        const label = document.createElement('span');
        label.className = 'dev-label';
        label.textContent = ctrl.label;
        row.appendChild(label);
        // Editable min/max bound labels at each end of the track, per
        // direct request 2026-09-28 ("provide the min max numbers at
        // their respective ends, and allow me to click to edit these 2
        // values") — same click-to-type interaction as the value readout
        // below (makeDevSliderBoundsEditable()), but targets the
        // slider's own min/max instead of its current value. Wrapped
        // together with the slider itself in one non-splitting flex
        // group (.dev-slider-track-group) — direct report 2026-09-28: on
        // a narrow panel, the min label used to be its own separate flex
        // item, free to stay on the label's line while the slider (and
        // max label) wrapped to the next line on their own.
        const trackGroup = document.createElement('span');
        trackGroup.className = 'dev-slider-track-group';
        row.appendChild(trackGroup);
        const minLabel = document.createElement('span');
        minLabel.className = 'dev-slider-bound dev-slider-bound-editable';
        minLabel.dataset.sliderId = ctrl.id;
        minLabel.dataset.bound = 'min';
        minLabel.textContent = ctrl.min;
        trackGroup.appendChild(minLabel);
        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'dev-slider';
        input.id = ctrl.id;
        input.min = ctrl.min;
        input.max = ctrl.max;
        input.step = ctrl.step;
        input.value = ctrl.value;
        trackGroup.appendChild(input);
        const maxLabel = document.createElement('span');
        maxLabel.className = 'dev-slider-bound dev-slider-bound-editable';
        maxLabel.dataset.sliderId = ctrl.id;
        maxLabel.dataset.bound = 'max';
        maxLabel.textContent = ctrl.max;
        trackGroup.appendChild(maxLabel);
        const value = document.createElement('span');
        value.className = 'dev-value dev-value-editable';
        value.id = ctrl.id.replace(/^slider/, 'value');
        value.textContent = ctrl.value;
        row.appendChild(value);
        // Bug fixed 2026-09-24: the numeric readout used to only ever
        // update via a PROJECT's own semantic 'input' listener explicitly
        // calling something like syncControlDisplay() -- meaning a
        // project whose wiring (the documented worked-example pattern)
        // only calls its own apply function on 'input' left the readout
        // showing a STALE value for the entire drag, correcting itself
        // only on the next unrelated sync/restore. Confirmed live: moving
        // a slider from 3 to 7 left its readout showing "3". Wiring the
        // live update HERE, at the one place every slider row is built,
        // fixes it for every current and future project regardless of
        // that project's own wiring. The dev-value-editable class is also
        // now added at CREATION time (was previously only added by a
        // one-time makeDevValuesEditable() pass at panel-init, which
        // never reached rows a project builds dynamically afterward --
        // e.g. 3JS ENGINE's 40 Rendering Style subgroups -- silently
        // leaving click-to-type non-functional for all of them).
        input.addEventListener('input', () => { value.textContent = input.value; });
        return row;
    }
    // {id, label, value, note?} — note is an optional small descriptive
    // string shown instead of a plain value readout (e.g. "(tint)").
    function buildColorRow(ctrl) {
        const row = document.createElement('div');
        row.className = 'dev-row';
        const label = document.createElement('span');
        label.className = 'dev-label';
        label.textContent = ctrl.label;
        row.appendChild(label);
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'dev-color-picker';
        input.id = ctrl.id;
        input.value = ctrl.value;
        row.appendChild(input);
        if (ctrl.note) {
            const note = document.createElement('span');
            note.className = 'dev-value';
            note.style.fontSize = '9px';
            note.style.color = '#888';
            note.textContent = ctrl.note;
            row.appendChild(note);
        }
        return row;
    }
    // Recursive grouped/expandable dropdown — direct request 2026-10-19:
    // "For drop down selectors, if the selection shares the same data as
    // an item selector, if items are within groups, or there are nested
    // groups, show the groups as expandable instances within the drop
    // down itself. I dont want each item in the drop down to have its
    // group names in its row." A trigger button shows just the selected
    // item's own name (never a flattened "Group/Item" label); clicking it
    // opens a panel in-flow directly below the trigger (never floating/
    // absolutely-positioned, so it can't get clipped by the dev panel's
    // own scrollable ancestors). Ungrouped options render first, flat;
    // each group renders as its own collapsible header (▶/▼, starts
    // collapsed) and can itself contain NESTED subgroups to any depth, via
    // the exact same "/"-joined group-path convention the list-picker
    // control already uses (LP_GROUP_PATH_SEP) — a group whose own path is
    // "A/B" renders as a sub-header inside "A"'s own body, never a second
    // top-level header. Generalizes HANDO's own real, already-shipped
    // `buildGroupedDropdown()` (src/devpanel/devPanel.js, built for its
    // Tween Poses rows) from flat single-level groups to full recursion —
    // same calling convention, so a project already using that pattern can
    // adopt this version as a direct drop-in upgrade.
    //
    // getOptions(): () => an array of plain strings (ungrouped) or
    // {name, group} objects — `group` a flat OR "/"-joined nested path,
    // the exact shape every list-picker options() function in this
    // codebase family already returns. initialValue: the starting
    // selection — falls back to the first real option (flattened across
    // every group) if it's no longer present, the same validity rule
    // every other select/restore path in this file already follows.
    // onSelect(name): fires only for a real, later, user-driven pick —
    // never during construction or an external setValue() call.
    //
    // Returns { el, value, setValue(v) } — `value` is the resolved
    // initial selection; setValue() lets an external restore (Reset/
    // Undo/Sync load) update the trigger's own displayed text without
    // re-firing onSelect, the same "push a value in without echoing it
    // back out" contract syncValue() already uses project-wide.
    function buildGroupedDropdownWidget(getOptions, initialValue, onSelect) {
        const wrapper = document.createElement('div');
        wrapper.className = 'dev-grouped-dropdown';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'dev-grouped-dropdown-trigger';
        const panel = document.createElement('div');
        panel.className = 'dev-grouped-dropdown-panel';
        panel.hidden = true;
        wrapper.append(trigger, panel);

        function display(v) {
            wrapper.dataset.value = v || '';
            trigger.textContent = v || '(none)';
        }
        function close() {
            panel.hidden = true;
            document.removeEventListener('pointerdown', onOutsidePointerDown, true);
        }
        function onOutsidePointerDown(e) {
            if (!wrapper.contains(e.target)) close();
        }
        function choose(name) {
            display(name);
            close();
            onSelect(name);
        }
        // `node` = {items: [name,...], children: Map<leafSegment, node>} —
        // recurses into children for nested subgroups, any depth.
        function renderLevel(container, node) {
            node.items.forEach(name => {
                const opt = document.createElement('div');
                opt.className = 'dev-grouped-dropdown-option';
                opt.textContent = name;
                opt.addEventListener('click', () => choose(name));
                container.appendChild(opt);
            });
            node.children.forEach((childNode, leaf) => {
                const arrow = document.createElement('span');
                arrow.className = 'arrow';
                arrow.textContent = '▶';
                const header = document.createElement('div');
                header.className = 'dev-grouped-dropdown-header';
                const label = document.createElement('span');
                label.textContent = leaf;
                header.append(arrow, label);
                const body = document.createElement('div');
                body.className = 'dev-grouped-dropdown-body';
                body.hidden = true;
                header.addEventListener('click', (e) => {
                    e.stopPropagation();
                    body.hidden = !body.hidden;
                    arrow.textContent = body.hidden ? '▶' : '▼';
                });
                renderLevel(body, childNode);
                container.append(header, body);
            });
        }
        function buildTree(options) {
            const root = { items: [], children: new Map() };
            function ensureNode(segs) {
                let node = root;
                segs.forEach(seg => {
                    if (!node.children.has(seg)) node.children.set(seg, { items: [], children: new Map() });
                    node = node.children.get(seg);
                });
                return node;
            }
            options.forEach(opt => {
                const name = typeof opt === 'string' ? opt : opt.name;
                const group = typeof opt === 'string' ? null : opt.group;
                if (!group) { root.items.push(name); return; }
                ensureNode(group.split(LP_GROUP_PATH_SEP)).items.push(name);
            });
            return root;
        }
        function renderPanel() {
            panel.innerHTML = '';
            let options = [];
            try { options = getOptions() || []; } catch (err) { options = []; }
            renderLevel(panel, buildTree(options));
        }
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (panel.hidden) {
                renderPanel();
                panel.hidden = false;
                document.addEventListener('pointerdown', onOutsidePointerDown, true);
            } else {
                close();
            }
        });

        let opts = [];
        try { opts = getOptions() || []; } catch (err) { opts = []; }
        const names = opts.map(o => typeof o === 'string' ? o : o.name);
        const resolved = names.includes(initialValue) ? initialValue : (names[0] || null);
        display(resolved);

        return { el: wrapper, value: resolved, setValue: display };
    }

    // {id, label, options: [{value, text}]}
    function buildSelectRow(ctrl) {
        const row = document.createElement('div');
        row.className = 'dev-row';
        const label = document.createElement('span');
        label.className = 'dev-label';
        label.textContent = ctrl.label;
        row.appendChild(label);
        const select = document.createElement('select');
        select.className = 'dev-select';
        select.id = ctrl.id;
        ctrl.options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            select.appendChild(option);
        });
        row.appendChild(select);
        return row;
    }
    // {id, label} — checkboxes use an inverted shape vs every other
    // control here (a <label> wraps the checkbox FIRST, then a
    // dev-label span for the text), so this doesn't share the
    // label-first row skeleton the other builders use.
    function buildCheckboxRow(ctrl) {
        const row = document.createElement('div');
        row.className = 'dev-row';
        const wrapLabel = document.createElement('label');
        wrapLabel.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer;';
        // Label BEFORE the input — direct report 2026-09-28 ("you have
        // the checkbox left of the word 'Checkbox:' which doesnt match
        // the rest of the settings"): every other control type renders
        // "Label: <input>" (slider/color/select all put the descriptive
        // label first); this used to be the one exception.
        const span = document.createElement('span');
        span.className = 'dev-label';
        span.style.minWidth = 'auto';
        span.textContent = ctrl.label;
        wrapLabel.appendChild(span);
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = ctrl.id;
        wrapLabel.appendChild(input);
        row.appendChild(wrapLabel);
        return row;
    }
    // A text control (type 'text' in a control array): a text box whose value the app reads with setting(id).
    function buildTextControlRow(ctrl) {
        return buildTextInputRow({ id: ctrl.id, label: ctrl.label, inputType: 'text', value: ctrl.value, wide: true });
    }
    // {id, label, inputType: 'text'|'number', value, step?, wide?}
    function buildTextInputRow(ctrl) {
        const row = document.createElement('div');
        row.className = 'dev-row';
        const label = document.createElement('span');
        label.className = 'dev-label';
        label.textContent = ctrl.label;
        row.appendChild(label);
        const input = document.createElement('input');
        input.type = ctrl.inputType;
        input.className = 'dev-text-input' + (ctrl.wide ? ' dev-text-input-wide' : '');
        input.id = ctrl.id;
        if (ctrl.inputType === 'number' && ctrl.step !== undefined) input.step = ctrl.step;
        input.value = ctrl.value;
        if (ctrl.inputType === 'text') { // free-text values: no iPhone smart punctuation (a double space inserts ". ")
            input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false; input.setAttribute('autocorrect', 'off');
        }
        row.appendChild(input);
        return row;
    }
    // ================================================================
    // [JS-15] SAVED PRESETS UI — 'list-picker' CONTROL TYPE
    // ================================================================
    // A named-item picker for a list of independently Save/Use/Rename/
    // Delete-able snapshots (Saved Cameras, Saved Poses, Saved Lighting,
    // a Rendering Style's own saved parameter sets, etc.) — CLAUDE.md
    // §12r "Standard Saved Presets UI". Re-implemented against this
    // template's own primitives (dev-row conventions, UNIFORM_ROW_BUILDERS
    // dispatch, the shared setupDragReorder() engine, the generic
    // el.value-based Copy/Save/Reset/Undo pipeline) from HANDO's own
    // independent dev-panel lineage, which built the original — ported
    // for exact behavioral parity (button set, name-collision handling,
    // arbitrary-depth grouping, drag-reorder, export/import merge
    // semantics), not a from-scratch reinterpretation.
    //
    // Registration ({tab, group, id, type:'list-picker', ...}):
    //   label            - row label text.
    //   itemLabel        - noun used in the Save-name prompt ("Camera",
    //                      "Pose", "Preset") — defaults to "Item".
    //   value            - items array (see the live-array contract
    //                      below — this is a real, mutated reference,
    //                      not a one-time seed).
    //   defaultName      - optional; seeds the INITIAL selection (so Use/
    //                      Overwrite/Rename/Delete work without clicking a
    //                      row first) AND the initial value of the real,
    //                      runtime-settable default described next.
    //   captureCurrent() - REQUIRED. Returns a plain object snapshotting
    //                      whatever this picker represents right now.
    //   onUse(item)      - REQUIRED. Applies a saved item back to live
    //                      state.
    //   exportable       - true adds a per-item checkbox + "Export
    //                      Selected" (checked items -> clipboard JSON).
    //   importable       - true adds "Import" (clipboard/paste JSON,
    //                      merged by name — same-name overwrites in
    //                      place, everything else untouched).
    // DEFAULT (added 2026-10-15, direct request: "for all item selectors
    // that have an default selction, always indicate which is the current
    // default"). A "Set Default" button marks whichever item is currently
    // selected as entry.defaultName — just a NAME, not a separate raw
    // snapshot, so it's displayable ("Default: X" under the list, a ★ on
    // the row) and rides this control's OWN items/groupOrder persistence
    // for free. CORRECTED 2026-10-15, direct clarification: "Default just
    // means the saving set on startup... there will be a default and a
    // current in use item, they don't have to be the same" — the named
    // item is auto-applied via onUse on this control's FIRST real restore
    // after a page load ONLY (entry.defaultAutoApplyDone, see the hidden
    // input's own 'input' listener), never again on a later Reset/Undo or
    // on switching Saved Dev Settings sets via Use. "Active"/"in use" is
    // a SEPARATE, independent concept (tracked by whoever actually calls
    // onUse, e.g. buildSavedDevSettingsListPicker's own wrapper) that
    // doesn't have to match the default. This is what makes a default
    // "specific to the saved dev
    // setting set, not global": since captureFullDevPanelState() already
    // captures every registered control's value, list-pickers included,
    // each named Saved Dev Settings snapshot naturally carries its own
    // independent defaultName per list-picker with no extra plumbing.
    // Never device-mirrored (a saved-preset list isn't a per-device
    // value) — buildListPickerRow sets ctrl.skipDeviceCheckbox itself,
    // no need to pass it. Rides Copy/Save/Reset/Undo automatically: its
    // state lives in a hidden <input id=ctrl.id> whose .value is the
    // JSON-serialized {items, groupOrder, defaultName}, exactly like a
    // slider's own
    // numeric .value — no special-casing needed in the capture/apply
    // pipeline (captureAllRegisteredControlValues()/applyControlValues()).
    //
    // LIVE-ARRAY CONTRACT (changed 2026-10-11, no opt-in — this is now
    // the only behavior): `value` is not a one-time seed the control
    // privately copies — it's the REAL backing array, and this control
    // mutates it IN PLACE for the rest of the page's life, via the
    // internal lpSetItems() helper (entry.items.length = 0; entry.items
    // .push(...)) rather than ever reassigning entry.items to a new
    // array object. This matters because `entry.items === ctrl.value`
    // holds for as long as the control exists — any other code that
    // captured a direct reference to the same array (e.g. a module-level
    // `SAVED_POSES` a tween player also reads) sees every Save/Rename/
    // Delete/+Group/Import AND every Reset/Undo/Sync restore immediately,
    // with no extra wiring. This is the reason the control exists this
    // way at all — see HANDYSET's own CLAUDE.md, 2026-09-27 entry, for
    // the real incident this fixes: a hand-rolled picker that mutated
    // its array by reference worked for exactly this reason, while an
    // earlier version of THIS control (which used to `.slice()` the
    // array once at build time, and reassign entry.items to a fresh
    // array on every restore) could never give any other code a
    // reference that stayed live.
    //
    // Things to know before registering a list-picker, given this:
    //   1. Pass a real, intentional, long-lived array (a module-level
    //      `let`/`const`, not a throwaway inline `[]` literal) UNLESS you
    //      genuinely don't need anything else to read it — a fresh
    //      literal is fine too, it just gets no benefit from this.
    //   2. Never pass a frozen array (`Object.freeze(arr)`). The first
    //      Save/Rename/Delete/restore will throw — `.length = 0`/`.push()`
    //      on a frozen array is a TypeError, not a silent no-op.
    //   3. The in-place clear-then-refill on restore (`.length = 0`,
    //      then `.push(...)`) LOOKS non-atomic but isn't a real risk —
    //      JS is single-threaded and nothing else runs between those two
    //      statements, so no other code can ever observe the array in
    //      its momentarily-empty state.
    //   4. If you need the control to OWN its own independent copy
    //      instead (no external code holds a reference, or you
    //      deliberately want one-way isolation), pass `value:
    //      someArray.slice()` yourself at registration time — the
    //      control no longer does this defensively on your behalf.
    const LP_GROUP_PATH_SEP = '/';
    const lpEntries = {};

    function lpCommit(entry) {
        const hidden = document.getElementById(entry.ctrl.id);
        if (hidden) hidden.value = JSON.stringify({ items: entry.items, groupOrder: entry.groupOrder || [], defaultName: entry.defaultName || null });
    }
    // Updates the "Default: X" / "No default set" text under a list-picker
    // and the star marker on its own row — called after every mutation
    // that could change which item is default (Set Default itself, plus
    // Rename/Delete following the default item) and after every restore.
    function lpRefreshDefaultIndicator(entry) {
        if (entry.defaultIndicatorEl) {
            entry.defaultIndicatorEl.textContent = entry.defaultName ? ('Default: ' + entry.defaultName) : 'No default set';
        }
    }

    // Replaces entry.items' CONTENTS in place rather than reassigning
    // entry.items to a new array object — see the live-array contract in
    // this section's own top comment. Every internal mutation path
    // (Save/Overwrite/Rename/Delete/+Group/Import) and the external-
    // restore listener (Reset/Undo/Sync) both go through this, never a
    // bare `entry.items = ...`.
    function lpSetItems(entry, newArr) {
        entry.items.length = 0;
        Array.prototype.push.apply(entry.items, newArr);
    }

    // Renders one item row (ungrouped or inside a group body). Click
    // selects (tracked by object reference, not index — drag-reorder
    // makes indices unstable); Shift-click extends a contiguous range
    // from the last plain-clicked item, in current visual order — both
    // feed entry.multiSelected, which +Group and Export Selected act on.
    function renderLpItemRow(entry, item) {
        const row = document.createElement('div');
        row.className = 'dev-lp-row' + (entry.multiSelected.has(item) ? ' dev-lp-row-selected' : '');
        row.__item = item;
        const handle = document.createElement('span');
        handle.className = 'dev-lp-row-handle';
        handle.textContent = '⠿';
        row.appendChild(handle);
        if (entry.ctrl.exportable) {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'dev-lp-export-checkbox';
            cb.checked = entry.exportChecked.has(item);
            cb.addEventListener('click', (e) => e.stopPropagation());
            cb.addEventListener('change', () => {
                if (cb.checked) entry.exportChecked.add(item); else entry.exportChecked.delete(item);
                // Checking/unchecking one checkbox while multiple rows are
                // shift-click-selected applies the same state to every
                // selected row, so a highlighted batch can be
                // checked/unchecked together in one click.
                if (entry.multiSelected.size > 1 && entry.multiSelected.has(item)) {
                    entry.multiSelected.forEach(it => {
                        if (cb.checked) entry.exportChecked.add(it); else entry.exportChecked.delete(it);
                    });
                    entry.listEl.querySelectorAll('.dev-lp-row').forEach(r => {
                        if (r.__item !== item && entry.multiSelected.has(r.__item)) {
                            const rowCb = r.querySelector('.dev-lp-export-checkbox');
                            if (rowCb) rowCb.checked = cb.checked;
                        }
                    });
                }
                // Keep every ancestor group's own derived tri-state
                // checkbox in sync, including when a multi-select cascade
                // above just touched rows spanning multiple groups at once.
                lpRefreshExportCheckboxAncestors(row);
                if (entry.multiSelected.size > 1 && entry.multiSelected.has(item)) {
                    entry.listEl.querySelectorAll('.dev-lp-row').forEach(r => {
                        if (entry.multiSelected.has(r.__item)) lpRefreshExportCheckboxAncestors(r);
                    });
                }
            });
            row.appendChild(cb);
        }
        const label = document.createElement('span');
        label.className = 'dev-lp-row-label';
        // Star marks the current default (direct request 2026-10-15:
        // "for all item selectors that have an default selction, always
        // indicate which is the current default") — same visual
        // convention HANDYSET's own bespoke Hand/Phone Model selectors
        // already use for their own, separate default mechanism.
        label.textContent = (entry.defaultName && item.name === entry.defaultName ? '★ ' : '') + item.name;
        row.appendChild(label);
        row.addEventListener('click', (e) => {
            // Ctrl/Cmd-click (direct request 2026-10-19: "make sure I can
            // use CTRL to multi select as well") toggles just THIS item's
            // own membership, leaving every other already-selected item
            // untouched — standard OS file-manager semantics, distinct
            // from Shift-click's contiguous RANGE select below. Becomes
            // the new shift-click anchor (entry.selectedItem), same as a
            // plain click already does, so a later Shift-click ranges
            // from wherever the most recent Ctrl/plain click landed.
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
                if (entry.multiSelected.has(item)) entry.multiSelected.delete(item);
                else entry.multiSelected.add(item);
                entry.selectedItem = item;
            } else if (e.shiftKey && entry.selectedItem) {
                const ordered = Array.from(entry.listEl.querySelectorAll('.dev-lp-row')).map(r => r.__item);
                const a = ordered.indexOf(entry.selectedItem), b = ordered.indexOf(item);
                if (a >= 0 && b >= 0) entry.multiSelected = new Set(ordered.slice(Math.min(a, b), Math.max(a, b) + 1));
                else entry.multiSelected = new Set([item]);
            } else {
                entry.selectedItem = item;
                entry.multiSelected = new Set([item]);
            }
            entry.listEl.querySelectorAll('.dev-lp-row').forEach(r => {
                r.classList.toggle('dev-lp-row-selected', entry.multiSelected.has(r.__item));
            });
            // Direct request 2026-10-25: "this applies to item selectors
            // as well" — clicking/selecting an item inside a group counts
            // as interacting with that group, for +Group's own no-
            // selection placement rule below (addGroupBtn's own comment
            // has the full reasoning). Top-level/ungrouped items leave
            // this untouched (nothing meaningful to record).
            if (item.group) entry.lastInteractedGroupPath = item.group;
        });
        return row;
    }

    // Group-level export checkbox (direct request 2026-10-19: "provide
    // the left side checkboxes for all groups as well. so i can select a
    // group, then export the whole group"). A group has no export state
    // of its own — it's purely a derived tri-state view over every
    // descendant item's own entry.exportChecked membership (recursive,
    // same path-prefix match as the group-delete cascade above), so
    // there's nothing new to persist.
    function lpItemsUnderGroup(entry, path) {
        const prefix = path + LP_GROUP_PATH_SEP;
        return entry.items.filter(it => it.group === path || (it.group && it.group.startsWith(prefix)));
    }
    function lpRefreshGroupExportCheckbox(groupEl) {
        const cb = groupEl.querySelector(':scope > .dev-lp-group-header > .dev-lp-group-export-checkbox');
        if (!cb) return;
        const picker = groupEl.closest('.dev-list-picker');
        const entry = picker && picker.__lpEntry;
        if (!entry) return;
        const items = lpItemsUnderGroup(entry, groupEl.__groupName);
        const checkedCount = items.filter(it => entry.exportChecked.has(it)).length;
        cb.indeterminate = checkedCount > 0 && checkedCount < items.length;
        cb.checked = items.length > 0 && checkedCount === items.length;
    }
    // Walks every ANCESTOR group of a row/group that just changed (never
    // the element itself) so a parent's tri-state stays correct no
    // matter how deep the edit happened.
    function lpRefreshExportCheckboxAncestors(el) {
        let g = el.parentElement ? el.parentElement.closest('.dev-lp-group') : null;
        while (g) {
            lpRefreshGroupExportCheckbox(g);
            g = g.parentElement ? g.parentElement.closest('.dev-lp-group') : null;
        }
    }

    // One group's header — click toggles collapse (tracked in
    // entry.expandedGroups so a re-render preserves it); the title
    // renames (cascading to every descendant path); "x" removes the
    // group (ungroups its own direct members only, never cascades into
    // a nested subgroup's own members).
    function buildLpGroupHeader(entry, path) {
        const header = document.createElement('div');
        header.className = 'dev-lp-group-header';
        const handle = document.createElement('span');
        handle.className = 'dev-lp-group-handle';
        handle.textContent = '⠿';
        header.appendChild(handle);
        if (entry.ctrl.exportable) {
            const exportCb = document.createElement('input');
            exportCb.type = 'checkbox';
            exportCb.className = 'dev-lp-export-checkbox dev-lp-group-export-checkbox';
            exportCb.addEventListener('click', (e) => e.stopPropagation());
            exportCb.addEventListener('change', () => {
                const items = lpItemsUnderGroup(entry, path);
                items.forEach(it => { if (exportCb.checked) entry.exportChecked.add(it); else entry.exportChecked.delete(it); });
                const groupEl = header.closest('.dev-lp-group');
                // Reflect onto every visible descendant row/group checkbox
                // without a full re-render (same "sync the DOM checkboxes
                // directly" approach the item-level multi-select checkbox
                // cascade already uses, just recursive here since a group
                // can contain nested groups too).
                groupEl.querySelectorAll('.dev-lp-row').forEach(r => {
                    const rowCb = r.querySelector('.dev-lp-export-checkbox');
                    if (rowCb) rowCb.checked = exportCb.checked;
                });
                groupEl.querySelectorAll('.dev-lp-group').forEach(g => lpRefreshGroupExportCheckbox(g));
                lpRefreshExportCheckboxAncestors(groupEl);
            });
            header.appendChild(exportCb);
        }
        const arrow = document.createElement('span');
        arrow.textContent = '▼';
        header.appendChild(arrow);
        const title = document.createElement('span');
        title.className = 'dev-lp-group-title';
        title.textContent = path.split(LP_GROUP_PATH_SEP).pop();
        title.addEventListener('click', (e) => {
            e.stopPropagation();
            const oldLeaf = path.split(LP_GROUP_PATH_SEP).pop();
            const newLeaf = prompt('Rename group to:', oldLeaf);
            if (!newLeaf || newLeaf === oldLeaf) return;
            if (newLeaf.includes(LP_GROUP_PATH_SEP)) { alert('Group name can\'t contain "' + LP_GROUP_PATH_SEP + '"'); return; }
            const segments = path.split(LP_GROUP_PATH_SEP);
            segments[segments.length - 1] = newLeaf;
            const newPath = segments.join(LP_GROUP_PATH_SEP);
            const prefix = path + LP_GROUP_PATH_SEP;
            const rename = (p) => (p === path ? newPath : (p.startsWith(prefix) ? newPath + LP_GROUP_PATH_SEP + p.slice(prefix.length) : p));
            entry.items.forEach(it => { if (it.group) it.group = rename(it.group); });
            entry.pendingGroups = (entry.pendingGroups || []).map(rename);
            entry.expandedGroups = new Set(Array.from(entry.expandedGroups).map(rename));
            entry.groupOrder = (entry.groupOrder || []).map(rename);
            lpCommit(entry);
            renderLpRows(entry);
        });
        header.appendChild(title);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dev-lp-group-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Cascades into nested subgroups -- fixed 2026-10-11, direct
            // report: "I grouped some items in a new group. I deleted an
            // existing group. My new group gets deleted, and all the items
            // inside it are ungrouped again." Root cause: this only ever
            // cleared items with `.group === path` EXACTLY, never a nested
            // descendant (`.group` starting with `path + '/'`). If the new
            // group ends up nested inside the one being deleted (e.g.
            // dragged in, deliberately or by accident), its items keep a
            // dangling path like "GroupB/New Group" that no longer has a
            // real top-level parent -- the NEXT render then silently
            // resurrects "GroupB" as a bare wrapper just to hold that
            // orphaned child, collapsed by default (never in
            // expandedGroups), which is functionally invisible -- reads
            // exactly like "my new group got deleted and its items are
            // ungrouped" even though the data technically still has a
            // (now-meaningless) group path. Verified via a standalone
            // reproduction (synthetic entry, real buildLpGroupHeader/
            // syncLpFromDom) before this fix: nesting a real populated
            // group inside another, then removing the outer one, left the
            // inner group's items at the stale nested path.
            const prefix = path + LP_GROUP_PATH_SEP;
            entry.items.forEach(it => { if (it.group === path || (it.group && it.group.startsWith(prefix))) delete it.group; });
            entry.pendingGroups = (entry.pendingGroups || []).filter(p => p !== path && !p.startsWith(prefix));
            entry.groupOrder = (entry.groupOrder || []).filter(p => p !== path && !p.startsWith(prefix));
            Array.from(entry.expandedGroups).forEach(p => { if (p === path || p.startsWith(prefix)) entry.expandedGroups.delete(p); });
            lpCommit(entry);
            renderLpRows(entry);
        });
        header.appendChild(removeBtn);
        header.addEventListener('click', () => {
            const g = header.closest('.dev-lp-group');
            g.classList.toggle('collapsed');
            if (g.classList.contains('collapsed')) entry.expandedGroups.delete(path);
            else {
                entry.expandedGroups.add(path);
                // Direct request 2026-10-25 — same "expanding counts as
                // interacting with it" rule as the top-level dev-panel
                // groups (recordDevGroupInteraction()'s own comment).
                entry.lastInteractedGroupPath = path;
            }
        });
        return header;
    }

    // Rebuilds entry.items (order + each item's .group) from the LIVE
    // DOM after a drag-drop. Item identity is tracked via row.__item,
    // never index. Groups are a flat "/"-joined path on each item —
    // nesting to arbitrary depth needs no separate tree structure, only
    // a recursive DOM walk.
    function syncLpFromDom(entry) {
        const items = [];
        const pending = [];
        Array.from(entry.ungroupedBody.querySelectorAll(':scope > .dev-lp-row')).forEach(r => {
            if (!r.__item) return;
            delete r.__item.group;
            items.push(r.__item);
        });
        function walk(container, path) {
            Array.from(container.querySelectorAll(':scope > .dev-lp-row')).forEach(r => {
                if (!r.__item) return;
                r.__item.group = path;
                items.push(r.__item);
            });
            const childGroups = Array.from(container.querySelectorAll(':scope > .dev-lp-group'));
            if (container.querySelectorAll(':scope > .dev-lp-row').length === 0 && childGroups.length === 0) pending.push(path);
            childGroups.forEach(g => {
                const leaf = g.__groupName.split(LP_GROUP_PATH_SEP).pop();
                walk(g.querySelector(':scope > .dev-lp-group-body'), path + LP_GROUP_PATH_SEP + leaf);
            });
        }
        Array.from(entry.listEl.querySelectorAll(':scope > .dev-lp-group')).forEach(g => {
            walk(g.querySelector(':scope > .dev-lp-group-body'), g.__groupName);
        });
        lpSetItems(entry, items);
        entry.pendingGroups = pending;
        entry.groupOrder = Array.from(entry.listEl.querySelectorAll(':scope > .dev-lp-group')).map(g => g.__groupName);
        lpCommit(entry);
    }

    // Redraws entry.items into ungrouped-first + nested collapsible
    // groups, per each item's own .group path. Called after any
    // Save/Rename/Delete/Overwrite/+Group/Import (which mutate
    // entry.items directly) — NOT after a drag-drop, which resyncs
    // entry.items from the already-correct DOM instead (syncLpFromDom).
    // A freshly-created empty group (entry.pendingGroups) still renders
    // so it has something to drag an item into — it won't survive a
    // reload if it's still empty at Save time.
    function renderLpRows(entry) {
        entry.listEl.innerHTML = '';
        const root = { items: [], children: new Map() };
        const discoveryOrder = [];
        const ungrouped = [];
        function ensureNode(segs) {
            let node = root;
            segs.forEach(seg => {
                if (!node.children.has(seg)) node.children.set(seg, { items: [], children: new Map() });
                node = node.children.get(seg);
            });
            return node;
        }
        entry.items.forEach(item => {
            if (!item.group) { ungrouped.push(item); return; }
            const segs = item.group.split(LP_GROUP_PATH_SEP);
            if (!root.children.has(segs[0])) discoveryOrder.push(segs[0]);
            ensureNode(segs).items.push(item);
        });
        (entry.pendingGroups || []).forEach(path => {
            const segs = path.split(LP_GROUP_PATH_SEP);
            if (!root.children.has(segs[0])) discoveryOrder.push(segs[0]);
            ensureNode(segs);
        });
        // A freshly-created group (+Group, below) lands at the TOP of the
        // list — entry.groupOrder is the explicit override; any name not
        // yet in it falls back to natural discovery-order position.
        const known = new Set(entry.groupOrder || []);
        const topOrder = (entry.groupOrder || []).filter(n => root.children.has(n));
        discoveryOrder.forEach(n => { if (!known.has(n)) topOrder.push(n); });
        entry.groupOrder = topOrder.slice();

        const ungroupedBody = document.createElement('div');
        ungroupedBody.className = 'dev-lp-ungrouped-body';
        ungrouped.forEach(item => ungroupedBody.appendChild(renderLpItemRow(entry, item)));
        entry.listEl.appendChild(ungroupedBody);
        entry.ungroupedBody = ungroupedBody;

        function renderGroup(path, node) {
            const g = document.createElement('div');
            g.className = 'dev-lp-group' + (!entry.expandedGroups.has(path) ? ' collapsed' : '');
            g.__groupName = path;
            g.appendChild(buildLpGroupHeader(entry, path));
            const body = document.createElement('div');
            body.className = 'dev-lp-group-body';
            node.items.forEach(item => body.appendChild(renderLpItemRow(entry, item)));
            node.children.forEach((childNode, leaf) => body.appendChild(renderGroup(path + LP_GROUP_PATH_SEP + leaf, childNode)));
            g.appendChild(body);
            return g;
        }
        topOrder.forEach(name => entry.listEl.appendChild(renderGroup(name, root.children.get(name))));
        // Group export checkboxes are purely derived (never persisted) --
        // recomputed in one pass now that every group is actually
        // attached to entry.listEl (lpRefreshGroupExportCheckbox() needs
        // a live .closest('.dev-list-picker') to find `entry`, which
        // isn't true yet while renderGroup() is still building a detached
        // subtree). Order doesn't matter -- each call reads straight from
        // entry.items/exportChecked, never from a sibling/child
        // checkbox's own DOM state.
        if (entry.ctrl.exportable) entry.listEl.querySelectorAll('.dev-lp-group').forEach(g => lpRefreshGroupExportCheckbox(g));
    }

    // Item/group drag-reorder, set up ONCE globally (setupDragReorder
    // itself is a singleton engine — see [JS-3] above) the first time any
    // list-picker control is built, scoped by CSS class so it never
    // interferes with the main panel's own group/row dragging. Groups
    // reorder among top-level siblings by default and can also be dragged
    // into ANY other group's own body, at any depth, to nest — the only
    // real constraint is a group can never be dropped into itself or one
    // of its own descendants. Both are scoped to the DRAGGED item's own
    // .dev-list-picker ancestor, so dragging never crosses between two
    // different saved-preset lists.
    let lpDragReorderInitialized = false;
    function lpSyncAllVisibleEntries() {
        Object.values(lpEntries).forEach(entry => { if (document.body.contains(entry.listEl)) syncLpFromDom(entry); });
    }
    function ensureLpDragReorder() {
        if (lpDragReorderInitialized) return;
        lpDragReorderInitialized = true;
        setupDragReorder('.dev-lp-group-handle', '.dev-lp-group', lpSyncAllVisibleEntries, (tabRoot, dragging) => {
            const picker = dragging.closest('.dev-list-picker');
            if (!picker) return [];
            const bodies = Array.from(picker.querySelectorAll('.dev-lp-group-body')).filter(b => !dragging.contains(b));
            return [picker, ...bodies];
        });
        setupDragReorder('.dev-lp-row-handle', '.dev-lp-row', lpSyncAllVisibleEntries, (tabRoot, dragging) => {
            const picker = dragging.closest('.dev-list-picker');
            return picker ? Array.from(picker.querySelectorAll('.dev-lp-group-body, .dev-lp-ungrouped-body')) : [];
        }, (item) => {
            // Multi-select drag (direct request 2026-10-19: "if i select
            // mulptiple items, then click and drag one of their icons to
            // reorder, it will reorder all the selected items with it").
            // Only kicks in when the grabbed row's own item is itself part
            // of a real (size > 1) multi-selection — grabbing an
            // UNselected row's handle while other rows happen to be
            // selected still drags just that one row, matching how a
            // plain click elsewhere already clears/reassigns the
            // selection in every other control in this file.
            const picker = item.closest('.dev-list-picker');
            const entry = picker && picker.__lpEntry;
            if (!entry || entry.multiSelected.size <= 1 || !entry.multiSelected.has(item.__item)) return [item];
            const ordered = Array.from(entry.listEl.querySelectorAll('.dev-lp-row'));
            return ordered.filter(r => entry.multiSelected.has(r.__item));
        });
    }

    // {tab, group, id, type:'list-picker', label, itemLabel?, value?,
    //  captureCurrent, onUse, exportable?, importable?} — see this
    // section's own top comment for the full contract.
    function buildListPickerRow(ctrl) {
        ensureLpDragReorder();
        ctrl.skipDeviceCheckbox = true; // a saved-preset list is never per-device
        const row = document.createElement('div');
        row.className = 'dev-row dev-list-picker-row-container';
        const label = document.createElement('span');
        label.className = 'dev-label';
        label.textContent = ctrl.label;
        row.appendChild(label);

        // Everything below lives in its own full-width block that wraps
        // onto its own line beneath the label — same fix as the curve
        // editor/range-bar's own bodyWrap, direct report 2026-09-28
        // ("List Picker title should be in-line with the drag handle,
        // matching regular slider or checkbox settings"): the old
        // column-direction `row` itself pushed the auto-injected row-
        // drag-handle above the label instead of beside it.
        const bodyWrap = document.createElement('div');
        bodyWrap.className = 'dev-list-picker-body';
        row.appendChild(bodyWrap);

        const listEl = document.createElement('div');
        listEl.className = 'dev-list-picker';
        const btnRow = document.createElement('div');
        btnRow.className = 'dev-list-picker-actions';
        const mkBtn = (text) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; return b; };
        const saveBtn = mkBtn('Save');
        const overwriteBtn = mkBtn('Overwrite');
        const useBtn = mkBtn('Use');
        const renameBtn = mkBtn('Rename');
        const deleteBtn = mkBtn('Delete');
        const addGroupBtn = mkBtn('+ Group');
        // "Set Default" — direct request 2026-10-15 ("for all item
        // selectors that have an default selction, always indicate which
        // is the current default... make sure that the defaults selected
        // are specific to the saved dev setting sets and not a global
        // default"). entry.defaultName is just the NAME of whichever item
        // is currently marked default — not a separate raw-snapshot
        // capture — so it rides this control's OWN existing
        // items/groupOrder persistence for free (lpCommit below): once
        // this control's state is itself part of a Saved Dev Settings
        // snapshot (captureFullDevPanelState() already captures every
        // registered control's value, list-pickers included), each saved
        // settings SET naturally gets its own independent default with no
        // extra plumbing.
        const defaultBtn = mkBtn('Set Default');
        btnRow.append(saveBtn, overwriteBtn, useBtn, renameBtn, deleteBtn, defaultBtn, addGroupBtn);
        let exportBtn = null, importBtn = null;
        // Export/Import wrapped together in their own non-splitting
        // group (as ONE flex item of btnRow) — direct report 2026-09-28
        // ("when you flow to the next line, always keep import and
        // export together").
        if (ctrl.exportable || ctrl.importable) {
            const ioGroup = document.createElement('span');
            ioGroup.className = 'dev-list-picker-io-group';
            if (ctrl.exportable) { exportBtn = mkBtn('Export Selected'); ioGroup.appendChild(exportBtn); }
            if (ctrl.importable) { importBtn = mkBtn('Import'); ioGroup.appendChild(importBtn); }
            btnRow.appendChild(ioGroup);
        }

        bodyWrap.appendChild(listEl);
        bodyWrap.appendChild(btnRow);

        const defaultIndicatorEl = document.createElement('div');
        defaultIndicatorEl.className = 'dev-list-picker-default-indicator';
        bodyWrap.appendChild(defaultIndicatorEl);

        // Hidden input carries this control's serialized state so it
        // rides the generic el.value-based Copy/Save/Reset/Undo pipeline
        // exactly like any other control — no special-casing needed
        // there (see this section's own top comment). 'input' fires only
        // on an EXTERNAL restore (Reset/Undo/Load, via applyControlValues()
        // below), never on our own internal mutations (which call
        // lpCommit() directly) — it re-parses and re-renders from
        // whatever was just restored.
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.id = ctrl.id;
        // No defensive .slice() — see the live-array contract in this
        // section's own top comment. ctrl.value itself becomes
        // entry.items, mutated in place for the control's whole life.
        const initialItems = ctrl.value || [];
        const initialDefaultName = ctrl.defaultName || null;
        hidden.value = JSON.stringify({ items: initialItems, groupOrder: [], defaultName: initialDefaultName });
        row.appendChild(hidden);

        const entry = {
            ctrl, listEl, items: initialItems, groupOrder: [],
            selectedItem: null, multiSelected: new Set(), expandedGroups: new Set(),
            pendingGroups: [], exportChecked: new Set(),
            defaultName: initialDefaultName, defaultIndicatorEl,
            // "Default just means the saving set on startup" (direct
            // clarification 2026-10-15) — auto-apply fires at most ONCE
            // per page load, on this control's first real restore, never
            // again for the rest of the session (not on a later Reset/
            // Undo, and not on switching to a different Saved Dev
            // Settings set via Use). "Active" (tracked separately, see
            // buildSavedDevSettingsListPicker's own onUse) is the
            // independent "what's actually in use right now" concept —
            // the two don't have to match.
            defaultAutoApplyDone: false,
        };
        lpEntries[ctrl.id] = entry;
        listEl.__lpEntry = entry; // lets any .dev-lp-row/.dev-lp-group find its own entry via .closest('.dev-list-picker').__lpEntry

        hidden.addEventListener('input', () => {
            let parsed;
            try { parsed = JSON.parse(hidden.value || '{}'); } catch (err) { parsed = {}; }
            lpSetItems(entry, Array.isArray(parsed.items) ? parsed.items : []);
            entry.groupOrder = Array.isArray(parsed.groupOrder) ? parsed.groupOrder : [];
            entry.defaultName = typeof parsed.defaultName === 'string' ? parsed.defaultName : null;
            entry.selectedItem = null;
            entry.multiSelected = new Set();
            renderLpRows(entry);
            lpRefreshDefaultIndicator(entry);
            // CORRECTED 2026-10-15, direct clarification: "Default just
            // means the saving set on startup" — auto-apply fires on this
            // control's FIRST real restore only (the true page-load Sync
            // restore, whichever control happens to receive it first),
            // never again afterward. A later Reset/Undo, or switching to
            // a different Saved Dev Settings set via Use, restores this
            // control's own items/defaultName/star/indicator correctly
            // (all of that still happens above, unconditionally) but no
            // longer re-triggers onUse — "what's in use" after that point
            // is governed by whatever the user actually clicked (Use), or
            // by the plain per-control values every OTHER registered
            // control (sliders etc.) already restores regardless of this
            // mechanism, not by silently re-applying a default out from
            // under a deliberate later action.
            if (!entry.defaultAutoApplyDone) {
                entry.defaultAutoApplyDone = true;
                if (entry.defaultName && ctrl.onUse) {
                    const defItem = entry.items.find(it => it.name === entry.defaultName);
                    if (defItem) ctrl.onUse(defItem);
                }
            }
        });

        saveBtn.addEventListener('click', () => {
            const itemLabel = ctrl.itemLabel || 'Item';
            const name = prompt(itemLabel + ' name:', itemLabel + ' ' + (entry.items.length + 1));
            if (!name) return;
            const data = ctrl.captureCurrent ? ctrl.captureCurrent() : {};
            // Same-name Save overwrites in place rather than duplicating —
            // two different saved items sharing one name is a landmine for
            // anything that looks a saved item up BY NAME.
            const existing = entry.items.find(it => it.name === name);
            if (existing) {
                if (!confirm('"' + name + '" already exists. Overwrite it?')) return;
                lpSetItems(entry, entry.items.map(it => it === existing ? Object.assign({ name }, data, it.group ? { group: it.group } : {}) : it));
            } else {
                lpSetItems(entry, entry.items.concat([Object.assign({ name }, data)]));
            }
            lpCommit(entry);
            renderLpRows(entry);
        });
        overwriteBtn.addEventListener('click', () => {
            if (!entry.selectedItem) return;
            const target = entry.selectedItem;
            const data = ctrl.captureCurrent ? ctrl.captureCurrent() : {};
            lpSetItems(entry, entry.items.map(it => it === target ? Object.assign({ name: it.name }, data, it.group ? { group: it.group } : {}) : it));
            entry.selectedItem = entry.items.find(it => it.name === target.name && it.group === target.group) || null;
            lpCommit(entry);
            renderLpRows(entry);
        });
        useBtn.addEventListener('click', () => { if (entry.selectedItem && ctrl.onUse) ctrl.onUse(entry.selectedItem); });
        renameBtn.addEventListener('click', () => {
            if (!entry.selectedItem) return;
            const target = entry.selectedItem;
            const name = prompt('Rename to:', target.name);
            if (!name || name === target.name) return;
            lpSetItems(entry, entry.items.map(it => it === target ? Object.assign({}, it, { name }) : it));
            entry.selectedItem = entry.items.find(it => it.name === name && it.group === target.group) || null;
            // The default follows a rename of the item it points at, so
            // it doesn't silently dangle on a name that no longer exists.
            if (entry.defaultName === target.name) entry.defaultName = name;
            lpCommit(entry);
            renderLpRows(entry);
            lpRefreshDefaultIndicator(entry);
        });
        defaultBtn.addEventListener('click', () => {
            if (!entry.selectedItem) return;
            entry.defaultName = entry.selectedItem.name;
            lpCommit(entry);
            renderLpRows(entry);
            lpRefreshDefaultIndicator(entry);
        });
        deleteBtn.addEventListener('click', () => {
            // Multi-delete (2026-10-11, direct request) -- shift-click
            // several rows first (same selection entry.multiSelected
            // already used for +Group), then Delete removes all of them
            // at once. Falls back to entry.selectedItem alone when
            // nothing is multi-selected, so a plain single click-then-
            // Delete still works exactly as before.
            const toRemove = entry.multiSelected.size > 0 ? entry.multiSelected : new Set(entry.selectedItem ? [entry.selectedItem] : []);
            if (toRemove.size === 0) return;
            // Clears the default rather than leaving it pointing at a
            // name that no longer exists in entry.items.
            if (entry.defaultName && Array.from(toRemove).some(it => it.name === entry.defaultName)) entry.defaultName = null;
            lpSetItems(entry, entry.items.filter(it => !toRemove.has(it)));
            entry.selectedItem = null;
            entry.multiSelected = new Set();
            lpCommit(entry);
            renderLpRows(entry);
            lpRefreshDefaultIndicator(entry);
        });
        // Shift-click (or Ctrl-click) one or more rows first (renderLpItemRow
        // above), then +Group drops them straight into the new group
        // already populated. With no selection, falls back to an empty
        // group shell to drag items into by hand.
        // Placement, corrected 2026-10-25 (direct request, "this applies
        // to item selectors as well" — same 2 rules as the top-level
        // dev-panel groups' own addDevGroup(), adapted to this engine's
        // array/Map-based group ordering instead of raw DOM position; see
        // addDevGroup()'s own comment for the full rule statement):
        addGroupBtn.addEventListener('click', () => {
            const existingNames = new Set([].concat(entry.items.map(it => it.group).filter(Boolean), entry.pendingGroups));
            let name = 'New Group', n = 2;
            while (existingNames.has(name)) { name = 'New Group (' + n + ')'; n++; }
            if (entry.multiSelected.size > 0) {
                // WITH a selection: nest the new group as a SIBLING of the
                // FIRST selected item's own immediate containing group
                // (same parent path) — top-level if that item is
                // ungrouped — instead of always flat top-level like
                // before. multiSelected is built in on-screen/DOM order
                // (see its own range-select construction above), so
                // Array.from(...)[0] is reliably the topmost/first
                // selected item.
                const firstSelected = Array.from(entry.multiSelected)[0];
                const firstPath = firstSelected.group || null;
                const sepIdx = firstPath ? firstPath.lastIndexOf(LP_GROUP_PATH_SEP) : -1;
                const parentPath = sepIdx >= 0 ? firstPath.slice(0, sepIdx) : null;
                const fullName = parentPath ? parentPath + LP_GROUP_PATH_SEP + name : name;
                if (firstPath && parentPath === null) {
                    // First item already sits in a TOP-LEVEL group (no
                    // further nesting) — insert the new group's name into
                    // groupOrder immediately before that group's own name,
                    // landing at that exact order slot among top-level
                    // siblings ("same... order location as the first item").
                    const order = (entry.groupOrder || []).filter(n2 => n2 !== fullName);
                    const atIdx = order.indexOf(firstPath);
                    if (atIdx >= 0) order.splice(atIdx, 0, fullName); else order.unshift(fullName);
                    entry.groupOrder = order;
                } else if (!firstPath) {
                    // First item is ungrouped — ungrouped items render as
                    // one flat block before every group (renderLpRows()'s
                    // own layout), with no groupOrder slot an "order
                    // position" could target; falls back to the original
                    // top-of-groupOrder placement for this one case, a
                    // disclosed simplification rather than a precise match.
                    entry.groupOrder = [fullName].concat((entry.groupOrder || []).filter(n2 => n2 !== fullName));
                }
                // else (nested under parentPath): no separate persisted
                // order for sibling NESTED groups exists in this engine at
                // all (syncLpFromDom() only ever captures TOP-level
                // groupOrder — see its own code) — reassigning .group
                // below WITHOUT touching entry.items' own array order is
                // what gives correct position for free: renderLpRows()
                // discovers a nested group at the first entry.items index
                // that references its path, and the first selected item
                // keeps its own original index, so the new group is
                // discovered exactly where that item already was.
                entry.items.forEach(it => { if (entry.multiSelected.has(it)) it.group = fullName; });
                lpCommit(entry);
            } else {
                // WITHOUT a selection: nest under entry.lastInteractedGroupPath
                // (see renderLpItemRow's/buildLpGroupHeader's own comments
                // for what updates it) if it still names a real group,
                // prepended so it's discovered before any other PURELY-
                // EMPTY pending sibling under that same parent — not a
                // guaranteed "top" against an already-populated sibling
                // group (entry.items are discovered before pendingGroups;
                // a real persisted nested-group order doesn't exist in
                // this engine to target more precisely, same limitation
                // as the selection branch above). Falls back to the
                // original top-of-groupOrder placement when nothing
                // nested has been interacted with yet, or the tracked
                // group no longer exists.
                const tracked = entry.lastInteractedGroupPath;
                const trackedPrefix = tracked ? tracked + LP_GROUP_PATH_SEP : null;
                const trackedStillExists = !!tracked && (
                    entry.items.some(it => it.group === tracked || (it.group && it.group.startsWith(trackedPrefix))) ||
                    (entry.pendingGroups || []).some(p => p === tracked || p.startsWith(trackedPrefix))
                );
                if (trackedStillExists) {
                    entry.pendingGroups = [tracked + LP_GROUP_PATH_SEP + name].concat(entry.pendingGroups);
                } else {
                    entry.groupOrder = [name].concat((entry.groupOrder || []).filter(n2 => n2 !== name));
                    entry.pendingGroups = entry.pendingGroups.concat([name]);
                }
            }
            renderLpRows(entry);
        });
        const flashBtn = (btn, msg) => { const orig = btn.textContent; btn.textContent = msg; setTimeout(() => { btn.textContent = orig; }, 1400); };
        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                const checked = entry.items.filter(it => entry.exportChecked.has(it));
                if (checked.length === 0) { flashBtn(exportBtn, 'Check items first'); return; }
                // Retains .group on export so an item that was grouped
                // here shows the same grouping once imported elsewhere —
                // renderLpRows() already auto-creates whatever group path
                // a .group value names the first time it sees it.
                const payload = checked.map(it => Object.assign({}, it));
                try {
                    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                    flashBtn(exportBtn, 'Copied ' + checked.length + '!');
                } catch (err) { flashBtn(exportBtn, 'Copy failed'); }
            });
        }
        if (importBtn) {
            importBtn.addEventListener('click', async () => {
                let text;
                try { text = await navigator.clipboard.readText(); }
                catch (err) {
                    // Clipboard read can be blocked (permissions, insecure
                    // context) — prompt() as a manual-paste fallback.
                    text = prompt('Paste exported JSON:', '');
                    if (!text) return;
                }
                let incoming;
                try {
                    incoming = JSON.parse(text);
                    if (!Array.isArray(incoming)) throw new Error('not an array');
                } catch (err) { flashBtn(importBtn, 'Invalid JSON'); return; }
                // Same-name overwrites in place (preserving the existing
                // item's own local .group), everything else untouched —
                // an import never wipes the existing list.
                let items = entry.items.slice();
                incoming.forEach(incomingItem => {
                    if (!incomingItem || typeof incomingItem.name !== 'string') return;
                    const idx = items.findIndex(it => it.name === incomingItem.name);
                    if (idx >= 0) items[idx] = Object.assign({}, incomingItem, items[idx].group ? { group: items[idx].group } : {});
                    else items = items.concat([incomingItem]);
                });
                lpSetItems(entry, items);
                lpCommit(entry);
                renderLpRows(entry);
                flashBtn(importBtn, 'Imported ' + incoming.length + '!');
            });
        }

        // Optional ctrl.defaultName — pre-selects a named item so Use/
        // Overwrite/Rename/Delete work immediately without the user first
        // clicking a row, matching HANDO's own hand-built picker's
        // original behavior (CLAUDE.md §12r). Only affects the INITIAL
        // selection; entry.defaultName (above) is the real, runtime-
        // settable, persisted default — this just seeds it.
        if (ctrl.defaultName) entry.selectedItem = entry.items.find(it => it.name === ctrl.defaultName) || null;
        renderLpRows(entry);
        lpRefreshDefaultIndicator(entry);
        return row;
    }
    // {id, label, defaultPoints, defaultMethod?, caption?, maxPoints?,
    // hitRadiusPx?} — CLAUDE.md §12's "Component Gallery" curve editor (a
    // draggable-point curve mapping normalized X->Y, the same shape as
    // Unity's Curve Editor or a photo editor's Levels/Curves tool).
    // Re-derived from Handy Dandies' buildGenericCurveWidget()/
    // evaluateArmLengthCurve() rather than ported as-is — direct report
    // 2026-09-28 ("in Photoshop... it looks like a smooth interpolation.
    // Ours right now doesnt") identified the source's plain uniform
    // Catmull-Rom as the cause (its tangent estimate ignores each
    // segment's real X-spacing, causing visible overshoot/kinks once
    // points aren't evenly spaced — which is almost immediately, once you
    // drag one). Default interpolation here is Monotone Cubic Hermite
    // (Fritsch-Carlson — the same algorithm behind D3's curveMonotoneX),
    // mathematically guaranteed not to overshoot between points. 3
    // alternates are offered via a dropdown per direct request ("provide
    // me a drop down to select interpolation method" / "if there are
    // other interpolation methods, provide that"): Linear (exact, no
    // curvature), Catmull-Rom (the original), and Natural Cubic Spline (a
    // global tridiagonal solve — smooth but, like Catmull-Rom, can
    // overshoot, with a different curvature character). A point's own
    // explicit bezier handle (h1/h2, Alt/Shift+drag) always overrides
    // whichever method is selected for that one segment, same as the
    // source. Max point count and per-point tap-hit radius are both
    // configurable per direct request 2026-09-28 (mobile tap precision).
    const CURVE_SAMPLES = 48;
    const CURVE_MAX_POINTS_DEFAULT = 5;
    const CURVE_HIT_RADIUS_PX_DEFAULT = 16; // vs. the 5px visual dot
    const CURVE_HANDLE_REMOVE_THRESHOLD_PX = 6;
    // Add/delete/set gestures, matched to Handy Dandies (2026-10-25, direct
    // request): a single click on empty graph adds a node; double-click a
    // node (double-tap on touch) deletes it; right-click a node (triple-tap
    // on touch) sets it to 1. Touch assist: attachCurveTouchAssist().
    const CURVE_BG_OPACITY_DEFAULT = 0.15;
    function curveCatmullRomY(y0, y1, y2, y3, t) {
        const t2 = t * t, t3 = t2 * t;
        return 0.5 * ((2 * y1) + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
    }
    function curveCatmullRomSegmentY(sorted, i, x) {
        const p1 = sorted[i], p2 = sorted[i + 1];
        const p0 = sorted[i - 1] || p1;
        const p3 = sorted[i + 2] || p2;
        const segT = p2.x === p1.x ? 0 : (x - p1.x) / (p2.x - p1.x);
        return curveCatmullRomY(p0.y, p1.y, p2.y, p3.y, segT);
    }
    function curveLinearY(p1, p2, x) {
        const dx = p2.x - p1.x;
        if (dx === 0) return p1.y;
        return p1.y + (p2.y - p1.y) * (x - p1.x) / dx;
    }
    function curveCubicBezier1D(p0, p1, p2, p3, t) {
        const u = 1 - t;
        return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    }
    function curveBezierSegmentY(P0, C1, C2, P3, x) {
        let lo = 0, hi = 1;
        for (let iter = 0; iter < 24; iter++) {
            const mid = (lo + hi) / 2;
            const xm = curveCubicBezier1D(P0.x, C1.x, C2.x, P3.x, mid);
            if (xm < x) lo = mid; else hi = mid;
        }
        const t = (lo + hi) / 2;
        return curveCubicBezier1D(P0.y, C1.y, C2.y, P3.y, t);
    }
    // Monotone cubic Hermite (Fritsch-Carlson) tangent estimation — the
    // fix for the source's overshoot problem. Unlike uniform Catmull-Rom,
    // this weighs each side's slope by whether the curve is even locally
    // monotonic, and rescales tangents so the resulting curve never
    // exceeds the data's own min/max between any 2 points.
    function curveComputeMonotoneTangents(pts) {
        const n = pts.length;
        const d = new Array(n - 1);
        for (let k = 0; k < n - 1; k++) {
            const dx = pts[k + 1].x - pts[k].x;
            d[k] = dx === 0 ? 0 : (pts[k + 1].y - pts[k].y) / dx;
        }
        const m = new Array(n);
        m[0] = d[0] || 0;
        m[n - 1] = d[n - 2] || 0;
        for (let k = 1; k < n - 1; k++) {
            m[k] = (d[k - 1] === 0 || d[k] === 0 || (d[k - 1] > 0) !== (d[k] > 0)) ? 0 : (d[k - 1] + d[k]) / 2;
        }
        for (let k = 0; k < n - 1; k++) {
            if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
            const a = m[k] / d[k], b = m[k + 1] / d[k];
            if (a < 0) m[k] = 0;
            if (b < 0) m[k + 1] = 0;
            const s = a * a + b * b;
            if (s > 9) {
                const tau = 3 / Math.sqrt(s);
                m[k] = tau * a * d[k];
                m[k + 1] = tau * b * d[k];
            }
        }
        return m;
    }
    function curveHermiteY(p1, p2, m1, m2, x) {
        const dx = p2.x - p1.x;
        if (dx === 0) return p1.y;
        const t = (x - p1.x) / dx, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        return h00 * p1.y + h10 * dx * m1 + h01 * p2.y + h11 * dx * m2;
    }
    // Natural cubic spline (global tridiagonal solve, second derivative
    // zero at both endpoints) — a distinct "classic smooth spline" option
    // alongside monotone Hermite; can overshoot (like Catmull-Rom) but
    // with an evenly-distributed curvature character.
    function curveComputeNaturalSplineSecondDerivs(sorted) {
        const n = sorted.length;
        if (n < 3) return new Array(n).fill(0);
        const h = new Array(n - 1);
        for (let i = 0; i < n - 1; i++) h[i] = sorted[i + 1].x - sorted[i].x;
        const a = new Array(n).fill(0), b = new Array(n).fill(1), c = new Array(n).fill(0), d = new Array(n).fill(0);
        for (let i = 1; i < n - 1; i++) {
            a[i] = h[i - 1];
            b[i] = 2 * (h[i - 1] + h[i]);
            c[i] = h[i];
            d[i] = 6 * ((sorted[i + 1].y - sorted[i].y) / h[i] - (sorted[i].y - sorted[i - 1].y) / h[i - 1]);
        }
        const cp = new Array(n).fill(0), dp = new Array(n).fill(0);
        for (let i = 1; i < n - 1; i++) {
            const denom = b[i] - a[i] * cp[i - 1];
            cp[i] = c[i] / denom;
            dp[i] = (d[i] - a[i] * dp[i - 1]) / denom;
        }
        const M = new Array(n).fill(0);
        for (let i = n - 2; i >= 1; i--) M[i] = dp[i] - cp[i] * M[i + 1];
        return M;
    }
    function curveNaturalSplineY(sorted, M, i, x) {
        const p1 = sorted[i], p2 = sorted[i + 1];
        const h = p2.x - p1.x;
        if (h === 0) return p1.y;
        const a = (p2.x - x) / h, b = (x - p1.x) / h;
        return a * p1.y + b * p2.y + ((a * a * a - a) * M[i] + (b * b * b - b) * M[i + 1]) * (h * h) / 6;
    }
    // Per-segment EASING functions (as distinct from the spline family
    // above) — direct request 2026-09-28 ("Sine, Bezier, Linear, Constant
    // (stepped), Cubic/Spline, Exponential, Logarithmic, Elastic, etc
    // etc"). Each maps a segment-local t in [0,1] to an eased t in [0,1];
    // the curve then lerps p1.y->p2.y by that eased value — the same
    // shape family as CSS/GSAP easing, applied per-segment rather than as
    // a multi-point spline derivative. Formulas are the standard ones
    // from easings.net except logarithmic (a simple, clean, normalized
    // log10(1+9t) — no widely "standard" logarithmic easing exists to
    // match).
    function curveEaseLinear(t) { return t; }
    function curveEaseSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
    function curveEaseBezier(t) { return curveBezierSegmentY({ x: 0, y: 0 }, { x: 0.42, y: 0 }, { x: 0.58, y: 1 }, { x: 1, y: 1 }, t); }
    function curveEaseConstant(t) { return t < 1 ? 0 : 1; }
    function curveEaseExpo(t) {
        if (t === 0) return 0;
        if (t === 1) return 1;
        return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
    }
    function curveEaseLog(t) { return Math.log10(1 + 9 * t); }
    function curveEaseElastic(t) {
        const c5 = (2 * Math.PI) / 4.5;
        if (t === 0) return 0;
        if (t === 1) return 1;
        return t < 0.5
            ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
            : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
    }
    const CURVE_EASING_FNS = {
        linear: curveEaseLinear, sine: curveEaseSine, bezier: curveEaseBezier,
        constant: curveEaseConstant, exponential: curveEaseExpo,
        logarithmic: curveEaseLog, elastic: curveEaseElastic,
    };
    // Public runtime evaluator — a host project reads a saved curve's
    // JSON ({points, method}) and calls this the same way it would call
    // Handy Dandies' own evaluateArmLengthCurve(). Recomputes tangents/
    // spline coefficients per call for simplicity — cheap given the
    // CURVE_MAX_POINTS_DEFAULT cap; a host evaluating this every frame
    // for many instances should precompute once via the lower-level
    // curveComputeMonotoneTangents()/curveComputeNaturalSplineSecondDerivs()
    // helpers instead.
    function evaluateCurveEditorPoints(points, x, method) {
        if (!points || points.length === 0) return 1;
        if (points.length === 1) return points[0].y;
        const sorted = points;
        if (x <= sorted[0].x) return sorted[0].y;
        if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
        const m = method || 'monotone';
        const tangents = m === 'monotone' ? curveComputeMonotoneTangents(sorted) : null;
        const naturalM = m === 'natural' ? curveComputeNaturalSplineSecondDerivs(sorted) : null;
        for (let i = 0; i < sorted.length - 1; i++) {
            const p1 = sorted[i], p2 = sorted[i + 1];
            if (x >= p1.x && x <= p2.x) {
                if (p1.h1 || p2.h2) {
                    const C1 = p1.h1 ? { x: p1.x + p1.h1.x, y: p1.y + p1.h1.y } : p1;
                    const C2 = p2.h2 ? { x: p2.x + p2.h2.x, y: p2.y + p2.h2.y } : p2;
                    return curveBezierSegmentY(p1, C1, C2, p2, x);
                }
                if (CURVE_EASING_FNS[m]) {
                    const t = p2.x === p1.x ? 0 : (x - p1.x) / (p2.x - p1.x);
                    return p1.y + (p2.y - p1.y) * CURVE_EASING_FNS[m](t);
                }
                if (m === 'catmullrom') return curveCatmullRomSegmentY(sorted, i, x);
                if (m === 'natural') return curveNaturalSplineY(sorted, naturalM, i, x);
                return curveHermiteY(p1, p2, tangents[i], tangents[i + 1], x);
            }
        }
        return sorted[sorted.length - 1].y;
    }
    // Mirror X reverses which point is "first" (each x -> 1-x), so a
    // point's out-handle (h1, toward the next/right point) becomes the
    // new in-handle (h2, from the previous/left point) and vice versa,
    // with the handle's own x-offset sign flipped to match the reversed
    // direction. Mirror Y keeps point order/x untouched and just flips
    // y (and each handle's y-offset sign) since left-right relationships
    // don't change under a vertical flip.
    function curveMirrorX(points) {
        return points.map(p => {
            const np = { x: 1 - p.x, y: p.y };
            if (p.h2) np.h1 = { x: -p.h2.x, y: p.h2.y };
            if (p.h1) np.h2 = { x: -p.h1.x, y: p.h1.y };
            return np;
        }).sort((a, b) => a.x - b.x);
    }
    function curveMirrorY(points) {
        return points.map(p => {
            const np = { x: p.x, y: 1 - p.y };
            if (p.h1) np.h1 = { x: p.h1.x, y: -p.h1.y };
            if (p.h2) np.h2 = { x: p.h2.x, y: -p.h2.y };
            return np;
        });
    }
    const CURVE_METHOD_OPTIONS = [
        { value: 'monotone', text: 'Monotone Cubic (Smooth, No Overshoot)' },
        { value: 'catmullrom', text: 'Catmull-Rom (Classic)' },
        { value: 'natural', text: 'Natural Cubic Spline (Smooth, Global)' },
        { value: 'linear', text: 'Linear' },
        { value: 'sine', text: 'Sine (Ease In-Out)' },
        { value: 'bezier', text: 'Bezier (Ease In-Out)' },
        { value: 'constant', text: 'Constant (Stepped)' },
        { value: 'exponential', text: 'Exponential (Ease In-Out)' },
        { value: 'logarithmic', text: 'Logarithmic' },
        { value: 'elastic', text: 'Elastic (Ease In-Out)' },
    ];
    // Touch assist for the curve editor (ported from Handy Dandies'
    // attachCurveTouchAssist(), 2026-10-25, direct request "make sure SPOTTY
    // has the same"). On touch, a finger that lands a little off a node or
    // bezier handle is passed to that element as if it had hit it, a tap
    // never ADDS a node while one is within reach, two quick taps on a node
    // delete it (one double-tap window later, so a third tap can still
    // cancel it), and a third quick tap sets it to 1. Mouse input is never
    // touched. The radii are screen-px judgment calls, not measurements.
    const CURVE_TOUCH_POINT_RADIUS_PX = 30;
    const CURVE_TOUCH_POINT_CORE_PX = 14; // inside this a node always wins over a handle
    const CURVE_TOUCH_HANDLE_RADIUS_PX = 26; // a bezier handle the user has made (real)
    const CURVE_TOUCH_PREVIEW_HANDLE_RADIUS_PX = 20; // the dim preview handle, kept smaller so a tap meant for the node does not make one
    const CURVE_DOUBLE_TAP_MS = 400;
    const CURVE_TAP_MAX_MOVE_PX = 12;
    const CURVE_TAP_MAX_MS = 350;
    function attachCurveTouchAssist(svg, api) {
        // api: { points: () => [{ el, p }], handles: () => [{ el, p, kind, real }], remove: (p) => void, removable: (p) => boolean, setTop: (p) => void }
        const st = { redispatching: false, suppressClickUntil: 0, lastTouchDownAt: 0, lastTap: null, down: null, pendingDelete: null };
        const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
        function pick(x, y) {
            let best = null, bestScore = Infinity;
            api.points().forEach((h) => {
                const c = center(h.el), d = Math.hypot(x - c.x, y - c.y);
                if (d > CURVE_TOUCH_POINT_RADIUS_PX) return;
                const score = d <= CURVE_TOUCH_POINT_CORE_PX ? d / 1000 - 1 : d / CURVE_TOUCH_POINT_RADIUS_PX;
                if (score < bestScore) { bestScore = score; best = { el: h.el, p: h.p, kind: 'point' }; }
            });
            api.handles().forEach((h) => {
                const c = center(h.el), d = Math.hypot(x - c.x, y - c.y), r = h.real ? CURVE_TOUCH_HANDLE_RADIUS_PX : CURVE_TOUCH_PREVIEW_HANDLE_RADIUS_PX;
                if (d > r) return;
                const score = d / r;
                if (score < bestScore) { bestScore = score; best = { el: h.el, p: h.p, kind: 'handle' }; }
            });
            return best;
        }
        function onUp(e) {
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            const d = st.down;
            st.down = null;
            if (!d || e.type === 'pointercancel') return;
            const now = performance.now();
            const isTap = Math.hypot(e.clientX - d.x, e.clientY - d.y) <= CURVE_TAP_MAX_MOVE_PX && now - d.t <= CURVE_TAP_MAX_MS;
            if (!isTap || !d.p) { st.lastTap = null; return; }
            const prev = st.lastTap;
            if (prev && prev.p === d.p && now - prev.t <= CURVE_DOUBLE_TAP_MS) {
                if (prev.count >= 2) {
                    // third quick tap: Y = 1, and the delete the second tap scheduled is cancelled
                    if (st.pendingDelete) { clearTimeout(st.pendingDelete.timer); st.pendingDelete = null; }
                    st.lastTap = null;
                    st.suppressClickUntil = now + 600;
                    if (api.setTop) api.setTop(d.p);
                    return;
                }
                // second quick tap: delete the node, but one double-tap window later, in case a third tap follows
                st.lastTap = { p: d.p, t: now, count: 2 };
                const p2 = d.p;
                st.pendingDelete = {
                    p: p2,
                    timer: setTimeout(() => {
                        st.pendingDelete = null;
                        st.lastTap = null;
                        if (api.removable(p2)) { st.suppressClickUntil = performance.now() + 600; api.remove(p2); }
                    }, CURVE_DOUBLE_TAP_MS)
                };
                return;
            }
            st.lastTap = { p: d.p, t: now, count: 1 };
        }
        svg.addEventListener('pointerdown', (e) => {
            if (st.redispatching || e.pointerType !== 'touch' || !e.isPrimary) return;
            const now = performance.now();
            st.lastTouchDownAt = now;
            const onPoint = api.points().find((h) => h.el === e.target);
            const onHandle = api.handles().find((h) => h.el === e.target);
            let tapPoint = null;
            if (onPoint) tapPoint = onPoint.p;
            else if (!onHandle) {
                const hit = pick(e.clientX, e.clientY);
                if (hit) {
                    if (hit.kind === 'point') tapPoint = hit.p;
                    st.redispatching = true;
                    try {
                        hit.el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }));
                    } finally { st.redispatching = false; }
                    e.stopPropagation();
                    e.preventDefault();
                }
            }
            st.down = { x: e.clientX, y: e.clientY, t: now, p: tapPoint };
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        }, true);
        return {
            // true for ~0.8 s after a touch: a dblclick / contextmenu raised by that touch (a double-tap, a long-press) is not a mouse double-click / right-click
            recentTouch() { return performance.now() - st.lastTouchDownAt < 800; },
            // true when the click that follows a touch must NOT add a node
            blocksAdd(clickEv) {
                const now = performance.now();
                if (now < st.suppressClickUntil) return true;
                if (!(clickEv.pointerType === 'touch' || now - st.lastTouchDownAt < 800)) return false;
                return !!pick(clickEv.clientX, clickEv.clientY);
            }
        };
    }
    function buildCurveEditorRow(ctrl) {
        // Corrected 2026-10-20 (direct request): a curve USED to be
        // treated like list-picker (never per-device) on the reasoning
        // that a "shape" isn't a per-device value. A real HANDY DANDIES
        // bug showed that reasoning was wrong in practice -- that
        // project's own curve/range controls are implemented as a
        // blanket-excluded 'text' type, so ticking "Independent from
        // Desktop" on a startup-sequence curve silently had no effect at
        // all (the box was shown and ticked, the value never actually
        // diverged). No `skipDeviceCheckbox` here any more -- a curve now
        // gets the same universal per-device checkbox as any other
        // control. The underlying mirror/restore mechanism already
        // supports this for free: curve-editor's own hidden <input> +
        // its 'input'-event redraw listener (right below) is exactly
        // what buildVisibilityCheckbox()/buildIndependenceCheckbox()
        // already read/write for every other control type.
        const row = document.createElement('div');
        row.className = 'dev-row dev-curve-editor-row-container';
        const label = document.createElement('span');
        label.className = 'dev-label';
        label.textContent = ctrl.label;
        row.appendChild(label);

        // Everything below (dropdown, graph, buttons, caption) lives in
        // its own full-width block that wraps onto its own line beneath
        // the label — keeping `row` itself in its normal horizontal
        // layout so the auto-injected row-drag-handle sits BESIDE the
        // label, same as a plain slider row, instead of above it (direct
        // report 2026-09-28: the earlier column-direction `row` itself
        // pushed the handle above the label).
        const bodyWrap = document.createElement('div');
        bodyWrap.className = 'dev-curve-editor-body';
        row.appendChild(bodyWrap);

        const methodSelect = document.createElement('select');
        methodSelect.className = 'dev-select';
        methodSelect.style.marginTop = '4px';
        CURVE_METHOD_OPTIONS.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.text;
            methodSelect.appendChild(opt);
        });
        bodyWrap.appendChild(methodSelect);

        // Graph background opacity — direct request 2026-09-28 ("give me
        // a slider to control the opacity of the curve editor, it looks
        // a bit transparent right now, I want it to be clear"). Wired
        // below, once `bgOpacity` state exists.
        const opacityRow = document.createElement('div');
        opacityRow.className = 'dev-curve-editor-opacity-row';
        const opacityLabel = document.createElement('span');
        opacityLabel.textContent = 'Graph Opacity:';
        const opacitySlider = document.createElement('input');
        opacitySlider.type = 'range';
        opacitySlider.className = 'dev-slider';
        opacitySlider.min = '0'; opacitySlider.max = '1'; opacitySlider.step = '0.01';
        opacityRow.append(opacityLabel, opacitySlider);
        bodyWrap.appendChild(opacityRow);

        // W/H are the internal coordinate-space units (viewBox), not the
        // rendered size — the SVG itself stretches to the panel's full
        // width via CSS (see .dev-curve-editor-svg), direct request
        // 2026-09-28 ("make the curve editor reach the right edge of the
        // dev panel... it sizes with the panel"). preserveAspectRatio
        // 'none' makes the viewBox truly stretch to fill that box rather
        // than letterboxing to preserve the original 240:120 ratio.
        const W = 240, H = 120;
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('dev-curve-editor-svg');
        const axisX = document.createElementNS(svgNS, 'line');
        axisX.setAttribute('x1', 0); axisX.setAttribute('y1', H - 1); axisX.setAttribute('x2', W); axisX.setAttribute('y2', H - 1);
        axisX.setAttribute('stroke', 'rgba(255,255,255,0.25)');
        const axisY = document.createElementNS(svgNS, 'line');
        axisY.setAttribute('x1', 1); axisY.setAttribute('y1', 0); axisY.setAttribute('x2', 1); axisY.setAttribute('y2', H);
        axisY.setAttribute('stroke', 'rgba(255,255,255,0.25)');
        const curvePath = document.createElementNS(svgNS, 'path');
        curvePath.setAttribute('fill', 'none'); curvePath.setAttribute('stroke', 'var(--dev-accent-color, #0ff)'); curvePath.setAttribute('stroke-width', '2');
        svg.appendChild(axisX); svg.appendChild(axisY); svg.appendChild(curvePath);
        bodyWrap.appendChild(svg);

        const btnRow = document.createElement('div');
        btnRow.className = 'dev-list-picker-actions';
        const mirrorXBtn = document.createElement('button');
        mirrorXBtn.type = 'button'; mirrorXBtn.textContent = 'Mirror X';
        const mirrorYBtn = document.createElement('button');
        mirrorYBtn.type = 'button'; mirrorYBtn.textContent = 'Mirror Y';
        btnRow.append(mirrorXBtn, mirrorYBtn);
        bodyWrap.appendChild(btnRow);

        if (ctrl.caption) {
            const caption = document.createElement('div');
            caption.className = 'dev-curve-editor-caption';
            caption.textContent = ctrl.caption;
            bodyWrap.appendChild(caption);
        }
        // No separate instructional hint text (per direct request
        // 2026-09-28) — handles are always visible/grabbable below (see
        // redraw()'s own comment), so the Alt/Shift gesture is
        // discoverable by direct interaction instead of a caption.

        // Hidden input carries this control's serialized {points, method}
        // so it rides the generic Copy/Save/Reset/Undo pipeline exactly
        // like list-picker's own hidden input does.
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.id = ctrl.id;
        let points = (ctrl.defaultPoints || [{ x: 0, y: 0 }, { x: 1, y: 1 }]).map(p => ({ ...p }));
        let method = ctrl.defaultMethod || 'monotone';
        methodSelect.value = method;
        let bgOpacity = ctrl.defaultBgOpacity != null ? ctrl.defaultBgOpacity : CURVE_BG_OPACITY_DEFAULT;
        opacitySlider.value = String(bgOpacity);
        svg.style.background = 'rgba(255,255,255,' + bgOpacity + ')';
        hidden.value = JSON.stringify({ points, method, bgOpacity });
        row.appendChild(hidden);

        const maxPoints = ctrl.maxPoints || CURVE_MAX_POINTS_DEFAULT;
        const hitRadius = ctrl.hitRadiusPx || CURVE_HIT_RADIUS_PX_DEFAULT;

        const toPx = (p) => ({ x: p.x * W, y: (1 - p.y) * H });
        const clamp01 = (v) => Math.min(1, Math.max(0, v));
        // Divides by the SVG's REAL rendered size (getBoundingClientRect()),
        // not the fixed W/H viewBox constants — required once the SVG
        // itself became width-responsive (see its own creation comment
        // above); every call site already passes CSS-pixel offsets
        // relative to that same rect, so this makes the conversion
        // resolution-independent instead of assuming a fixed 240x120
        // render size.
        const fromPx = (px, py) => {
            const rect = svg.getBoundingClientRect();
            return { x: clamp01(px / (rect.width || W)), y: clamp01(1 - py / (rect.height || H)) };
        };
        // Direct report 2026-10-15: "when I expand the dev panel's width,
        // the curve editor does stretch, but so do the curve handles and
        // nodes. that shouldn't happen - the curve editor stretching
        // width wise should only provide me granularity in dragging."
        // Root cause: the SVG's height is fixed (120px, matching viewBox
        // H) but its width is responsive (see the SVG's own creation
        // comment above) with preserveAspectRatio="none" — so once the
        // rendered width differs from the 240-unit viewBox, X and Y scale
        // by different factors, and a circle/rect drawn with equal
        // width/height in viewBox UNITS renders as an ellipse/rectangle
        // on screen. Fixed by wrapping every node/handle MARKER shape
        // (never the curve path or handle connector lines, which are
        // SUPPOSED to stretch with the track) in its own <g> with an
        // inverse-X-scale transform, so the marker's own screen-space
        // size stays isotropic regardless of how far the track has
        // stretched. scaleX is recomputed every redraw() and whenever the
        // SVG itself resizes (see the ResizeObserver below) — Y is never
        // compensated since the SVG's height never actually changes.
        let scaleX = 1;
        function updateScaleX() {
            const rect = svg.getBoundingClientRect();
            scaleX = (rect.width || W) / W;
        }
        function markerTransform(x, y) {
            return 'translate(' + x + ',' + y + ') scale(' + (1 / scaleX) + ',1)';
        }
        let circles = [];
        let handleEls = [];
        // Rebuilt by redraw(): every node hit circle, every handle marker (real and preview). The grab logic and the touch assist read these.
        let pointHits = [];
        let allHandleHits = [];

        function pointRemovable(p) { const idx = points.indexOf(p); return points.length > 2 && idx > 0 && idx < points.length - 1; }
        function removePointObj(p) {
            if (!pointRemovable(p)) return;
            points.splice(points.indexOf(p), 1);
            redraw();
            commitPoints();
        }
        // Sets one node to 1 (top of the graph). SPOTTY's curves have no Min / Max range, so the value 1 is the top of the Y axis.
        function setPointToTop(p) {
            if (points.indexOf(p) < 0 || p.y === 1) return;
            p.y = 1;
            redraw();
            commitPoints();
        }
        const touchAssist = attachCurveTouchAssist(svg, {
            points: () => pointHits,
            handles: () => allHandleHits,
            remove: removePointObj,
            removable: pointRemovable,
            setTop: setPointToTop
        });

        function commitPoints() {
            points.sort((a, b) => a.x - b.x);
            hidden.value = JSON.stringify({ points, method, bgOpacity });
        }
        function startHandleDrag(p, i, kind, downEv) {
            downEv.stopPropagation();
            downEv.preventDefault();
            const canHave = kind === 'h1' ? i < points.length - 1 : i > 0;
            if (!canHave) return;
            if (!p[kind]) p[kind] = { x: kind === 'h1' ? 0.08 : -0.08, y: 0 };
            function onMove(moveEv) {
                const rect = svg.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                const np = fromPx(moveEv.clientX - rect.left, moveEv.clientY - rect.top);
                p[kind] = { x: np.x - p.x, y: np.y - p.y };
                redraw();
            }
            function onUp() {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                const handlePx = toPx({ x: p.x + p[kind].x, y: p.y + p[kind].y });
                const pointPx = toPx(p);
                if (Math.hypot(handlePx.x - pointPx.x, handlePx.y - pointPx.y) <= CURVE_HANDLE_REMOVE_THRESHOLD_PX) delete p[kind];
                redraw();
                commitPoints();
            }
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        }
        function redraw() {
            updateScaleX();
            let d = '';
            for (let i = 0; i <= CURVE_SAMPLES; i++) {
                const x = i / CURVE_SAMPLES;
                const y = clamp01(evaluateCurveEditorPoints(points, x, method));
                const px = toPx({ x, y });
                d += (i === 0 ? 'M' : 'L') + px.x.toFixed(2) + ',' + px.y.toFixed(2) + ' ';
            }
            curvePath.setAttribute('d', d.trim());
            handleEls.forEach(el => svg.removeChild(el));
            handleEls = [];
            circles.forEach(c => svg.removeChild(c));
            circles = [];
            pointHits = [];
            allHandleHits = [];
            points.forEach((p, i) => {
                // Handles are always shown/grabbable, per direct request
                // 2026-09-28 ("i want bezier handles to be visible at all
                // times") — replacing the source's "invisible until
                // dragged once" behavior (a real, previously-documented
                // discoverability gap in Handy Dandies). A side that has
                // no REAL p[kind] yet shows a dimmer preview marker at the
                // default offset; grabbing and dragging it is what
                // actually creates p[kind] and starts influencing the
                // curve (startHandleDrag(), unchanged) — purely visual
                // until then, so the active interpolation method above
                // still governs the curve exactly as before.
                const px = toPx(p);
                // Both the hit target and the visible dot sit at the same
                // point, so they share one counter-scaled <g> (see
                // markerTransform's own comment above) rather than two.
                const pointG = document.createElementNS(svgNS, 'g');
                pointG.setAttribute('transform', markerTransform(px.x, px.y));
                // Bigger invisible hit target UNDER the small visible dot
                // — a plain 5px dot is too small to reliably tap on
                // mobile (direct report 2026-09-28). The dot itself is
                // decorative (pointer-events:none) so every real
                // interaction routes through this larger circle
                // regardless of its own visual size.
                const hit = document.createElementNS(svgNS, 'circle');
                hit.setAttribute('cx', 0); hit.setAttribute('cy', 0); hit.setAttribute('r', hitRadius);
                hit.setAttribute('fill', 'transparent');
                hit.style.cursor = 'grab';
                pointHits.push({ el: hit, p });
                let dragged = false;
                // Delete via right-click (desktop) or triple-tap (touch —
                // no right-click gesture exists), per direct request
                // 2026-09-28. dblclick-to-delete REMOVED — double-click
                // is now reserved for ADDING a point (see svg's own
                // dblclick listener below); keeping both would make
                // double-clicking a point ambiguous between add and
                // delete.
                hit.addEventListener('pointerdown', downEv => {
                    if (downEv.altKey) { startHandleDrag(p, i, 'h1', downEv); return; }
                    if (downEv.shiftKey) { startHandleDrag(p, i, 'h2', downEv); return; }
                    // A bezier handle near this node is grabbed instead of the node (ported from Handy Dandies, same reach: 7 px mouse / 12 px touch). The node's hit circle is painted
                    // over the handle marker, so without this the circle always wins where they overlap. The handle wins when the click is nearer to it than to the node, or within the reach.
                    {
                        const hr = hit.getBoundingClientRect();
                        const pointD = Math.hypot(downEv.clientX - (hr.left + hr.width / 2), downEv.clientY - (hr.top + hr.height / 2));
                        const grabPx = downEv.pointerType === 'touch' ? 12 : 7;
                        let best = null, bestD = Infinity;
                        allHandleHits.forEach((h) => {
                            if (!h.real) return;
                            const r = h.el.getBoundingClientRect();
                            const d = Math.hypot(downEv.clientX - (r.left + r.width / 2), downEv.clientY - (r.top + r.height / 2));
                            if (d <= Math.max(grabPx, pointD) && d < bestD) { bestD = d; best = h; }
                        });
                        if (best) { startHandleDrag(best.p, best.i, best.kind, downEv); return; }
                    }
                    downEv.stopPropagation();
                    dragged = false;
                    const isEndpoint = i === 0 || i === points.length - 1;
                    function onMove(moveEv) {
                        const rect = svg.getBoundingClientRect();
                        if (rect.width <= 0 || rect.height <= 0) return;
                        dragged = true;
                        const np = fromPx(moveEv.clientX - rect.left, moveEv.clientY - rect.top);
                        if (isEndpoint) { p.y = np.y; } else { p.x = np.x; p.y = np.y; }
                        redraw();
                    }
                    function onUp() {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                        if (dragged) { commitPoints(); return; }
                    }
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                });
                function deletePointIfRemovable() { removePointObj(p); }
                // Double-click deletes (desktop); on touch the touch assist deletes on a double-tap itself, so the browser's dblclick is ignored there.
                hit.addEventListener('dblclick', dblEv => {
                    dblEv.stopPropagation();
                    if (touchAssist.recentTouch()) return;
                    deletePointIfRemovable();
                });
                // Right-click sets the node to 1 (top of the graph), ported from Handy Dandies. A touch long-press also raises contextmenu, so that is excluded.
                hit.addEventListener('contextmenu', ctxEv => {
                    ctxEv.preventDefault();
                    ctxEv.stopPropagation();
                    if (touchAssist.recentTouch()) return;
                    setPointToTop(p);
                });
                pointG.appendChild(hit);
                const dot = document.createElementNS(svgNS, 'circle');
                dot.setAttribute('cx', 0); dot.setAttribute('cy', 0); dot.setAttribute('r', 5);
                // Red, per direct request 2026-09-28 (was the accent
                // color, blending in with the curve's own line/handles).
                dot.setAttribute('fill', '#ff3b3b');
                dot.style.pointerEvents = 'none';
                pointG.appendChild(dot);
                svg.appendChild(pointG);
                circles.push(pointG);
            });
            // Handle lines/markers are built in a SEPARATE pass, AFTER
            // every node above, per direct report 2026-10-15 ("make sure
            // that if a bezier handle is very close to a node, a click
            // and drag will prioritize the bezier handle"). SVG hit-
            // testing favors whatever's painted LAST for overlapping
            // shapes - building every handle only after every node (not
            // interleaved per-point, which would only protect a handle
            // from ITS OWN node and leave it losing to a DIFFERENT,
            // later-painted point's node) guarantees a handle marker
            // always wins hit-testing against ANY node's hit circle
            // underneath it, without needing any distance math.
            points.forEach((p, i) => {
                const canHaveH1 = i < points.length - 1, canHaveH2 = i > 0;
                const px = toPx(p);
                [['h1', canHaveH1], ['h2', canHaveH2]].forEach(([kind, canHave]) => {
                    if (!canHave) return;
                    const isReal = !!p[kind];
                    const offset = p[kind] || { x: kind === 'h1' ? 0.08 : -0.08, y: 0 };
                    const hx = toPx({ x: p.x + offset.x, y: p.y + offset.y });
                    const line = document.createElementNS(svgNS, 'line');
                    line.setAttribute('x1', px.x); line.setAttribute('y1', px.y); line.setAttribute('x2', hx.x); line.setAttribute('y2', hx.y);
                    line.setAttribute('stroke', isReal ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'); line.setAttribute('stroke-width', '1');
                    svg.appendChild(line);
                    handleEls.push(line);
                    const markerG = document.createElementNS(svgNS, 'g');
                    markerG.setAttribute('transform', markerTransform(hx.x, hx.y));
                    const marker = document.createElementNS(svgNS, 'rect');
                    marker.setAttribute('x', -3.5); marker.setAttribute('y', -3.5); marker.setAttribute('width', 7); marker.setAttribute('height', 7);
                    marker.setAttribute('fill', '#e0a030');
                    marker.setAttribute('fill-opacity', isReal ? '1' : '0.35');
                    marker.style.cursor = 'grab';
                    marker.addEventListener('pointerdown', downEv => startHandleDrag(p, i, kind, downEv));
                    allHandleHits.push({ el: marker, p, i, kind, real: isReal });
                    markerG.appendChild(marker);
                    svg.appendChild(markerG);
                    handleEls.push(markerG);
                });
            });
        }
        function tryAddPointAt(clientX, clientY) {
            if (points.length >= maxPoints) return;
            const rect = svg.getBoundingClientRect();
            const np = fromPx(clientX - rect.left, clientY - rect.top);
            if (np.x <= 0 || np.x >= 1) return;
            points.push(np);
            redraw();
            commitPoints();
        }
        // Add a point: double-click (desktop) or double-tap (touch — the
        // same reasoning as the point-delete gestures above), per direct
        // request 2026-09-28. A single click/tap on empty space no
        // longer adds anything.
        // A single click on empty graph adds a point (ported from Handy Dandies). On touch, a tap within reach of a node or handle never adds one (the touch assist grabs or deletes it instead).
        svg.addEventListener('click', clickEv => {
            if (clickEv.target.tagName === 'circle') return;
            if (touchAssist.blocksAdd(clickEv)) return;
            tryAddPointAt(clickEv.clientX, clickEv.clientY);
        });
        opacitySlider.addEventListener('input', () => {
            bgOpacity = parseFloat(opacitySlider.value);
            svg.style.background = 'rgba(255,255,255,' + bgOpacity + ')';
            commitPoints();
        });
        methodSelect.addEventListener('change', () => {
            method = methodSelect.value;
            redraw();
            commitPoints();
        });
        mirrorXBtn.addEventListener('click', () => {
            points = curveMirrorX(points);
            redraw();
            commitPoints();
        });
        mirrorYBtn.addEventListener('click', () => {
            points = curveMirrorY(points);
            redraw();
            commitPoints();
        });

        // External restore (Reset/Undo/Load) re-parses and re-renders,
        // exactly like list-picker's own hidden-input 'input' listener.
        hidden.addEventListener('input', () => {
            try {
                const parsed = JSON.parse(hidden.value || '{}');
                if (Array.isArray(parsed.points) && parsed.points.length >= 2) {
                    points = parsed.points;
                    method = parsed.method || 'monotone';
                    methodSelect.value = method;
                    if (typeof parsed.bgOpacity === 'number') {
                        bgOpacity = parsed.bgOpacity;
                        opacitySlider.value = String(bgOpacity);
                        svg.style.background = 'rgba(255,255,255,' + bgOpacity + ')';
                    }
                    redraw();
                }
            } catch (e) { /* leave displayed state as-is */ }
        });

        redraw();
        // The very first redraw() above can run before the panel/row has
        // settled into its FINAL layout width (confirmed live: svgWidth
        // was already the real, correct value by the time it was
        // inspected, yet scaleX had still baked in as 1 at construction
        // time - something about this control's own construction-time
        // layout pass doesn't yet reflect the panel's eventual width).
        // requestAnimationFrame was tried first and confirmed, live, NOT
        // to reliably fire soon enough for this - setTimeout (not subject
        // to the same throttling) self-corrects it shortly after, without
        // waiting for any user interaction.
        setTimeout(() => redraw(), 0);
        setTimeout(() => redraw(), 150);
        // Keeps the marker counter-scale correct whenever the SVG's own
        // rendered width changes (a panel-width drag, a group expanding,
        // the panel being resized) - CONFIRMED LIVE that ResizeObserver
        // does not reliably fire for either case in this environment (a
        // display:none-ancestor -> visible transition, AND a genuine live
        // width change on an already-visible element), so this uses the
        // same width-polling pattern this project family already relies
        // on elsewhere for "can't get a reliable event/observer hook"
        // cases (e.g. HANDYSET's own curveWidgetResyncs). Cheap: one
        // getBoundingClientRect() read per curve editor per tick, only
        // calling the real redraw() on an actual change.
        svg.__curveEditorRedraw = redraw;
        let lastPollWidth = svg.getBoundingClientRect().width;
        setInterval(() => {
            const w = svg.getBoundingClientRect().width;
            if (w !== lastPollWidth) { lastPollWidth = w; redraw(); }
        }, 400);
        return row;
    }
    // {id, label, trackMin, trackMax, unit?, defaultValue} — a dual-
    // handle min/max range slider ("Range Bar"), re-derived from Handy
    // Dandies' buildGenericRangeBarWidget(). Min/max numbers sit at their
    // own ends (left/right of the track) rather than a single combined
    // center readout, per direct request 2026-09-28 ("Place the min on
    // the left side under the slider, and the max on the right side...
    // I dont need the words 'Min' and 'Max', just the numbers") — the
    // same left/right, no-label convention as the plain slider's own
    // click-to-type bound labels above.
    function buildRangeBarRow(ctrl) {
        // Corrected 2026-10-20, same reasoning as buildCurveEditorRow()'s
        // own correction directly above -- no `skipDeviceCheckbox` any
        // more, a range bar now gets the same universal per-device
        // checkbox as any other control.
        const row = document.createElement('div');
        row.className = 'dev-row dev-range-bar-row-container';
        const label = document.createElement('span');
        label.className = 'dev-label';
        label.textContent = ctrl.label;
        row.appendChild(label);

        // Content lives in its own full-width block that wraps onto its
        // own line beneath the label, same fix as the curve editor's own
        // bodyWrap — keeps the auto-injected row-drag-handle beside the
        // label instead of above it.
        const bodyWrap = document.createElement('div');
        bodyWrap.className = 'dev-range-bar-body';
        row.appendChild(bodyWrap);

        const trackMin = ctrl.trackMin, trackMax = ctrl.trackMax, unit = ctrl.unit || '';
        const track = document.createElement('div');
        track.className = 'dev-range-bar-track';
        const fill = document.createElement('div');
        fill.className = 'dev-range-bar-fill';
        const minHandle = document.createElement('div');
        minHandle.className = 'dev-range-bar-handle';
        const maxHandle = document.createElement('div');
        maxHandle.className = 'dev-range-bar-handle';
        track.append(fill, minHandle, maxHandle);
        bodyWrap.appendChild(track);

        const readoutRow = document.createElement('div');
        readoutRow.className = 'dev-range-bar-readouts';
        const minReadout = document.createElement('span');
        minReadout.className = 'dev-range-bar-readout dev-range-bar-readout-editable';
        minReadout.dataset.bound = 'min';
        const maxReadout = document.createElement('span');
        maxReadout.className = 'dev-range-bar-readout dev-range-bar-readout-editable';
        maxReadout.dataset.bound = 'max';
        readoutRow.append(minReadout, maxReadout);
        bodyWrap.appendChild(readoutRow);

        // Hidden input carries this control's serialized {min, max} so it
        // rides the generic Copy/Save/Reset/Undo pipeline exactly like
        // list-picker/curve-editor's own hidden inputs do.
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.id = ctrl.id;
        let current = Object.assign({ min: trackMin, max: trackMax }, ctrl.defaultValue || {});
        hidden.value = JSON.stringify(current);
        row.appendChild(hidden);

        const toPct = (v) => Math.min(100, Math.max(0, (v - trackMin) / (trackMax - trackMin) * 100));
        const fromPct = (pct) => trackMin + (pct / 100) * (trackMax - trackMin);

        function commit() { hidden.value = JSON.stringify(current); }
        function redraw() {
            const minPct = toPct(current.min), maxPct = toPct(current.max);
            fill.style.left = Math.min(minPct, maxPct) + '%';
            fill.style.right = (100 - Math.max(minPct, maxPct)) + '%';
            minHandle.style.left = minPct + '%';
            maxHandle.style.left = maxPct + '%';
            minReadout.textContent = current.min + unit;
            maxReadout.textContent = current.max + unit;
        }
        function startDrag(key) {
            return (downEv) => {
                downEv.preventDefault();
                function onMove(moveEv) {
                    const rect = track.getBoundingClientRect();
                    if (rect.width <= 0) return;
                    const pct = Math.min(100, Math.max(0, (moveEv.clientX - rect.left) / rect.width * 100));
                    current[key] = Math.round(fromPct(pct));
                    redraw();
                }
                function onUp() {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    commit();
                }
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            };
        }
        minHandle.addEventListener('pointerdown', startDrag('min'));
        maxHandle.addEventListener('pointerdown', startDrag('max'));

        // Click-to-type either readout directly, same interaction as the
        // plain slider's own bound labels.
        [minReadout, maxReadout].forEach(el => {
            el.addEventListener('click', () => {
                if (el.querySelector('input')) return;
                const kind = el.dataset.bound;
                const originalText = el.textContent;
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'dev-value-edit-input';
                input.value = current[kind];
                el.textContent = '';
                el.appendChild(input);
                input.focus(); input.select();
                let settled = false;
                function commitEdit() {
                    if (settled) return;
                    settled = true;
                    let val = parseFloat(input.value);
                    if (isNaN(val)) val = current[kind];
                    current[kind] = val;
                    input.remove();
                    redraw();
                    commit();
                }
                function cancelEdit() {
                    if (settled) return;
                    settled = true;
                    el.textContent = originalText;
                }
                input.addEventListener('blur', commitEdit);
                input.addEventListener('keydown', ev => {
                    if (ev.key === 'Enter') input.blur();
                    else if (ev.key === 'Escape') cancelEdit();
                });
                input.addEventListener('click', ev => ev.stopPropagation());
            });
        });

        // External restore (Reset/Undo/Load) re-parses and re-renders,
        // same convention as list-picker/curve-editor's own hidden input.
        hidden.addEventListener('input', () => {
            try {
                const parsed = JSON.parse(hidden.value || '{}');
                if (typeof parsed.min === 'number' && typeof parsed.max === 'number') { current = parsed; redraw(); }
            } catch (e) { /* leave displayed state as-is */ }
        });

        redraw();
        return row;
    }
    // {id, label} — a standalone action button (CLAUDE.md §12n's test/
    // utility-button pattern). Wired the same way every other uniform
    // control is (document.getElementById(ctrl.id).addEventListener('click', ...)
    // per [JS-7]'s own worked example) — no ctrl.onClick field, so it needs
    // no special-casing in the generic Copy/Save/Reset/Undo pipeline either
    // (a plain <button> has no meaningful .value to capture, and none is read).
    function buildButtonRow(ctrl) {
        const row = document.createElement('div');
        row.className = 'dev-row';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dev-action-button';
        btn.id = ctrl.id;
        btn.textContent = ctrl.label;
        row.appendChild(btn);
        return row;
    }
    // ---- Gradient editor: a multi-stop color gradient control (project addition, not in the template) ----
    // A preview bar: click it to add a stop (colored from the gradient at that point), drag a stop to move
    // it, click a stop to select it and edit its color / position below, plus Remove (keeps >= 2) and
    // Reverse. The value is {stops:[{p:0..1, c:'#rrggbb'}, ...]} in a hidden input with id = ctrl.id, so
    // Copy / Save / Reset / Undo and the Mobile/Landscape mirroring treat it like the curve editor does
    // (its id therefore starts with `curveEditor`: that prefix is what the per-device mirroring matches).
    function buildGradientEditorRow(ctrl) {
        const row = document.createElement('div');
        row.className = 'dev-row dev-gradient-row-container';
        const label = document.createElement('span');
        label.className = 'dev-label';
        label.textContent = ctrl.label;
        row.appendChild(label);
        const body = document.createElement('div');
        body.className = 'dev-gradient-body';
        row.appendChild(body);
        const bar = document.createElement('div');
        bar.className = 'dev-gradient-bar';
        body.appendChild(bar);
        const edit = document.createElement('div');
        edit.className = 'dev-gradient-edit';
        const colorIn = document.createElement('input');
        colorIn.type = 'color';
        const posIn = document.createElement('input');
        posIn.type = 'number'; posIn.min = '0'; posIn.max = '100'; posIn.step = '1';
        posIn.className = 'dev-value-edit-input';
        const posUnit = document.createElement('span');
        posUnit.textContent = '%';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button'; removeBtn.textContent = 'Remove Stop';
        const reverseBtn = document.createElement('button');
        reverseBtn.type = 'button'; reverseBtn.textContent = 'Reverse';
        edit.append(colorIn, posIn, posUnit, removeBtn, reverseBtn);
        body.appendChild(edit);

        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.id = ctrl.id;
        row.appendChild(hidden);

        const norm = (list) => list.map(s => ({ p: Math.min(1, Math.max(0, +s.p)), c: String(s.c) })).sort((a, b) => a.p - b.p);
        let stops = norm((ctrl.defaultValue && ctrl.defaultValue.stops) || [{ p: 0, c: '#1db954' }, { p: 1, c: '#0d0f12' }]);
        // Sort in place (norm() makes NEW objects, which would lose which stop is selected).
        const sortStops = () => { stops.forEach(s => { s.p = Math.min(1, Math.max(0, +s.p)); }); stops.sort((a, b) => a.p - b.p); };
        let selected = 0;
        let lastCommitted = '';
        const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
        const rgbToHex = a => '#' + a.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
        function colorAt(p) {
            if (p <= stops[0].p) return stops[0].c;
            if (p >= stops[stops.length - 1].p) return stops[stops.length - 1].c;
            for (let i = 0; i < stops.length - 1; i++) {
                const a = stops[i], b = stops[i + 1];
                if (p >= a.p && p <= b.p) {
                    const t = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p);
                    const ca = hexToRgb(a.c), cb = hexToRgb(b.c);
                    return rgbToHex(ca.map((v, k) => v + (cb[k] - v) * t));
                }
            }
            return stops[0].c;
        }
        function commit() {
            sortStops();
            lastCommitted = JSON.stringify({ stops });
            hidden.value = lastCommitted;
            hidden.dispatchEvent(new Event('input', { bubbles: true }));
        }
        function render() {
            bar.style.background = 'linear-gradient(90deg, ' + stops.map(s => s.c + ' ' + (s.p * 100) + '%').join(', ') + ')';
            bar.querySelectorAll('.dev-gradient-stop').forEach(n => n.remove());
            stops.forEach((s, i) => {
                const h = document.createElement('div');
                h.className = 'dev-gradient-stop' + (i === selected ? ' selected' : '');
                h.style.left = (s.p * 100) + '%';
                h.style.background = s.c;
                h.addEventListener('pointerdown', ev => {
                    ev.preventDefault(); ev.stopPropagation();
                    selected = i; render();
                    const move = mv => {
                        const rect = bar.getBoundingClientRect();
                        if (rect.width <= 0) return;
                        const keep = stops[selected];
                        keep.p = Math.min(1, Math.max(0, (mv.clientX - rect.left) / rect.width));
                        sortStops();
                        selected = stops.indexOf(keep);
                        render();
                    };
                    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commit(); };
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', up);
                });
                bar.appendChild(h);
            });
            const s = stops[selected] || stops[0];
            colorIn.value = /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#ffffff';
            posIn.value = Math.round(s.p * 100);
            removeBtn.disabled = stops.length <= 2;
        }
        bar.addEventListener('pointerdown', ev => {
            if (ev.target !== bar) return;
            const rect = bar.getBoundingClientRect();
            const p = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
            const added = { p, c: colorAt(p) };
            stops.push(added);
            sortStops();
            selected = stops.indexOf(added);
            render(); commit();
        });
        colorIn.addEventListener('input', () => { stops[selected].c = colorIn.value; render(); commit(); });
        posIn.addEventListener('change', () => {
            const keep = stops[selected];
            keep.p = Math.min(1, Math.max(0, (parseFloat(posIn.value) || 0) / 100));
            sortStops(); selected = stops.indexOf(keep); render(); commit();
        });
        removeBtn.addEventListener('click', () => { if (stops.length > 2) { stops.splice(selected, 1); selected = Math.min(selected, stops.length - 1); render(); commit(); } });
        reverseBtn.addEventListener('click', () => { stops = norm(stops.map(s => ({ p: 1 - s.p, c: s.c }))); selected = 0; render(); commit(); });
        // An outside write (Reset / Load / Undo / per-device mirror) sets hidden.value and fires 'input'.
        hidden.addEventListener('input', () => {
            if (hidden.value === lastCommitted) return;
            try {
                const parsed = JSON.parse(hidden.value);
                if (parsed && Array.isArray(parsed.stops) && parsed.stops.length >= 2) { stops = norm(parsed.stops); selected = Math.min(selected, stops.length - 1); lastCommitted = hidden.value; render(); }
            } catch (e) { /* ignore a malformed value */ }
        });
        lastCommitted = JSON.stringify({ stops });
        hidden.value = lastCommitted;
        render();
        return row;
    }
    const UNIFORM_ROW_BUILDERS = { text: buildTextControlRow, slider: buildSliderRow, color: buildColorRow, select: buildSelectRow, checkbox: buildCheckboxRow, button: buildButtonRow, 'list-picker': buildListPickerRow, 'curve-editor': buildCurveEditorRow, 'range-bar': buildRangeBarRow, 'gradient-editor': buildGradientEditorRow };

    // ================================================================
    // TOGGLEABLE SETTINGS GROUP
    // ================================================================
    // A group whose own title bar carries a checkbox controlling the
    // WHOLE group's on/off state — direct request 2026-09-28 ("we have
    // setting groups where the group label itself has a checkbox to turn
    // the entire group on and off. The settings within the group are
    // only applied/shown when the checkbox is turned on"), based on
    // Handy Dandies' own `${prefix}Enabled` + wrapGatedSubgroup()
    // convention. When off, the group's ENTIRE content area (including
    // any nested subgroups, at any depth) is hidden as ONE unit via
    // display:none on .dev-section-content — never per-child — so
    // nothing inside ever renders, including an otherwise-empty subgroup
    // shell (direct correction 2026-09-28: "it should show nothing when
    // expanded, even subgroups").
    //
    // Usage: register the toggle as a NORMAL checkbox control first (so
    // it rides Copy/Save/Reset/Undo exactly like any other setting, no
    // special-casing needed there), THEN call this to relocate its real,
    // already-wired <input> into the group's own title bar:
    //   registerDevControlArray([{ tab, group: 'My Group', id: 'myGroupEnabled', type: 'checkbox', label: 'Enabled', value: true }])
    //   makeDevGroupToggleable(tab, 'My Group', 'myGroupEnabled')
    // A host project reads that same checkbox's value like any other
    // registered checkbox control to decide whether to actually apply
    // that group's settings — this function only owns the UI/visibility
    // side, not the "applied" half of the request.
    function makeDevGroupToggleable(tab, groupSid, ctrlId) {
        // Descendant selector so a NESTED group can be made toggleable too.
        const titleEl = document.querySelector('#' + tab + 'TabContent .dev-section-title[data-sid="' + groupSid.replace(/"/g, '\\"') + '"]');
        const cb = document.getElementById(ctrlId);
        if (!titleEl || !cb || cb.type !== 'checkbox') { console.warn('makeDevGroupToggleable: group or checkbox control not found', groupSid, ctrlId); return; }
        const section = titleEl.closest('.dev-section');
        const originalRow = cb.closest('.dev-row');

        cb.classList.add('dev-group-toggle-checkbox');
        cb.title = 'Enable/disable this whole group';
        cb.addEventListener('click', e => e.stopPropagation()); // don't also collapse/expand the group via the title's own onclick
        titleEl.appendChild(cb); // preserved across rename/collapse by withPreservedTitleCheckbox() above
        if (originalRow) originalRow.remove(); // the control's own default row is now redundant — the checkbox lives in the title instead

        function applyState() { section.classList.toggle('dev-section-group-disabled', !cb.checked); }
        cb.addEventListener('change', applyState);
        cb.addEventListener('input', applyState); // covers whichever event a Reset/Undo/Load restore dispatches
        applyState();
    }
    // Dispatches on ctrl.type. Use this for slider/color/select/checkbox
    // controls; call buildTextInputRow(ctrl) directly for text/number
    // inputs (it has its own required fields, not just {type,...}).
    function buildUniformControlRow(ctrl) {
        const builder = UNIFORM_ROW_BUILDERS[ctrl.type];
        if (!builder) {
            console.error('buildUniformControlRow: unknown control type', ctrl.type, ctrl.id);
            const row = document.createElement('div');
            row.className = 'dev-row';
            return row;
        }
        const row = builder(ctrl);
        // Dynamic Mobile/Landscape visibility/independence checkboxes
        // ([JS-4b0] above) - UNIVERSAL as of 2026-09-17 (ported from a
        // real project, CLICKO, that made this same change), applied to
        // every uniform-type control automatically, no opt-in flag
        // needed any more. This is SAFE for a pre-existing control
        // authored the OLD way (3 separate, independently-tuned per-tab
        // array entries) because the checkbox's own DEFAULT state is
        // category-aware (hasStaticDeviceCounterpart(), just above) - a
        // control that already has a real per-tab entry defaults to
        // visible+independent (its exact pre-existing behavior,
        // unchanged unless the checkbox is deliberately toggled); a
        // control that never had one defaults to hidden/mirrors-desktop
        // (also its exact pre-existing behavior). The old `dynamicDevice`
        // opt-in flag is no longer read/required anywhere - a control
        // still carrying it from before this change is harmless (simply
        // ignored). EXCEPTION: `ctrl.skipDeviceCheckbox` opts a control
        // OUT - reserved for this engine's OWN built-in chrome controls
        // (renderDevPanelStyleControls()'s Dev-Panel-self-styling rows,
        // buildMouseLogWidget()'s interval slider), which are NOT part of
        // the registerDevControlArray()/findRegisteredControlById()
        // system this feature's category-aware default relies on, and in
        // the Dev-Panel-style case specifically already have their OWN,
        // separate, pre-existing per-device sync mechanism (devPanelStyle/
        // mobileDevPanelStyle/landscapeDevPanelStyle) that this system
        // would otherwise silently double up with or fight - found live
        // while porting this feature (a Scroll Strength independence
        // checkbox defaulted unchecked because hasStaticDeviceCounterpart()
        // can't see this unregistered system, which would have wired a
        // second, redundant mirror path on top of the existing one). A
        // real project's own controls are unaffected either way - they go
        // through registerDevControlArray(), so the category-aware
        // default is always correct for them.
        if (!ctrl.skipDeviceCheckbox) {
            // row.querySelector (not document.getElementById) - `row`
            // isn't attached to the document yet at this point (whatever
            // called buildUniformControlRow appends it somewhere AFTER
            // it returns), so only a subtree-scoped query finds
            // anything; see wireDesktopMirrorSource()'s own comment.
            const controlEl = row.querySelector('#' + CSS.escape(ctrl.id));
            if (ctrl.tab === 'desktop') row.appendChild(buildVisibilityCheckbox(controlEl, ctrl.id));
            else row.appendChild(buildIndependenceCheckbox(ctrl.tab, resolveDevControlId(ctrl.id).desktopId, controlEl));
        } else {
            // Marks the row itself, not just the (long-gone by the time
            // injectRowDeviceCheckboxes() runs) ctrl object, so that
            // generic backfill pass also respects this exclusion - see
            // its own comment.
            row.dataset.skipDeviceCheckbox = '1';
        }
        // Hotkey badge support - store control ID on row for hotkey lookup
        row.dataset.controlId = ctrl.id;
        // Render hotkey badge if one is assigned to this control
        renderHotkeyBadgesForRow(row);
        return row;
    }

    // ================================================================
    // [JS-7] REGISTRATION API (ARRAYS, VALIDATION, VALUE RESOLVERS)
    // ================================================================
    // Registration: a project calls registerDevControlArray(name, array)
    // once per config array it defines (see the worked example below).
    // This is what powers the generic validation/render-check/save-load
    // machinery without this engine needing to know your array names.
    //
    // WORKED EXAMPLE — a project's own code, NOT part of this template:
    //
    //   const MY_SLIDERS = [
    //     { group: 'Player', id: 'sliderPlayerSpeed', type: 'slider',
    //       label: 'Speed:', min: 0, max: 10, step: 0.1, value: 5 },
    //   ];
    //   function renderMySliders() {
    //     MY_SLIDERS.forEach(ctrl => {
    //       const content = findGroupContent('desktop', ctrl.group, 'renderMySliders', ctrl.id);
    //       if (content) content.appendChild(buildUniformControlRow(ctrl));
    //     });
    //   }
    //   renderMySliders();
    //   registerDevControlArray('MY_SLIDERS', MY_SLIDERS);
    //
    //   // Wire it to your actual game state (this part is inherently
    //   // yours — the engine has no idea what "player speed" means):
    //   document.getElementById('sliderPlayerSpeed').addEventListener('input', (e) => {
    //     myGameState.playerSpeed = parseFloat(e.target.value);
    //     applyPlayerSpeedToGame();
    //   });
    //
    // That's it — Copy/Save/Reset, the render-check tripwire, and (if
    // you also call registerDevControlIdValidator, see below) mapping
    // validation all now cover this control automatically.
    // ----------------------------------------------------------------
    const DEV_PANEL_REGISTERED_ARRAYS = [];
    function registerDevControlArray(name, array) {
        DEV_PANEL_REGISTERED_ARRAYS.push({ name, array });
    }

    // Optional: a project can register its own "is this control id
    // actually wired to something real" checker — (ctrl) => true | a
    // string describing the problem. Without this, validateDevControlMappings()
    // is a no-op (there's nothing generic to check — whether an id is
    // "mapped" depends entirely on your own state shape). Example: if
    // your own project keys its settings by a map like
    // MY_STATE_MAP = { sliderPlayerSpeed: 'playerSpeed' }, register
    // registerDevControlIdValidator(ctrl => (ctrl.id in MY_STATE_MAP)
    // || 'unmapped id: ' + ctrl.id).
    let devControlIdValidator = null;
    function registerDevControlIdValidator(fn) { devControlIdValidator = fn; }
    function validateDevControlMappings() {
        if (!devControlIdValidator) return 0;
        let badCount = 0;
        DEV_PANEL_REGISTERED_ARRAYS.forEach(({ name, array }) => {
            array.forEach(ctrl => {
                const result = devControlIdValidator(ctrl);
                if (result !== true) {
                    console.error('validateDevControlMappings: ' + (typeof result === 'string' ? result : 'unmapped id'), name, ctrl.id);
                    badCount++;
                }
            });
        });
        if (badCount > 0) console.error('validateDevControlMappings: ' + badCount + ' control(s) failed validation - see errors above.');
        return badCount;
    }

    // Load-order tripwire: every control from every registered array
    // must actually exist in the DOM by the time this runs (call it
    // once, near the end of your init sequence, right before your own
    // event-wiring setup — see the init block at the bottom of this
    // file). Catches a render call that's missing, misordered, or
    // whose group lookup silently failed.
    function assertDevControlsRendered() {
        let missing = 0;
        DEV_PANEL_REGISTERED_ARRAYS.forEach(({ array }) => {
            array.forEach(ctrl => { if (!document.getElementById(ctrl.id)) missing++; });
        });
        if (missing > 0) {
            console.error('assertDevControlsRendered: ' + missing + ' generated control(s) missing from the DOM at setup time - a render call may be missing, misordered, or its group lookup failed (see findGroupContent warnings above).');
        }
        return missing;
    }

    // Optional: register (id) => value resolver functions to sync every
    // slider/color's DOM value from YOUR live game state right after
    // render (closes the brief "shows the config array's own literal,
    // not the real live value" flash before any load resolves). Skip
    // this if you're fine relying on the default localStorage load
    // alone (see applyControlValues below) - it's not required.
    let devSliderValueResolver = null;
    let devColorValueResolver = null;
    function registerDevValueResolvers({ slider, color }) {
        if (slider) devSliderValueResolver = slider;
        if (color) devColorValueResolver = color;
    }
    function syncSlidersFromState() {
        if (!devSliderValueResolver) return;
        document.querySelectorAll('.dev-slider').forEach(el => {
            const value = devSliderValueResolver(el.id);
            if (value === undefined) return;
            if (typeof value === 'number') {
                const min = parseFloat(el.min), max = parseFloat(el.max);
                if (!isNaN(max) && value > max) el.max = String(value + Math.abs(value) * 0.2);
                if (!isNaN(min) && value < min) el.min = String(value - Math.abs(value) * 0.2);
            }
            el.value = value;
            // Dispatched, not a direct function call — whatever
            // project-specific 'input' listener you attached (per the
            // worked example above) fires naturally, same as a real drag.
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }
    function syncColorPickersFromState() {
        if (!devColorValueResolver) return;
        document.querySelectorAll('.dev-color-picker').forEach(el => {
            const value = devColorValueResolver(el.id);
            if (value !== undefined) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
        });
    }

    // ================================================================
    // [JS-7b] STANDARD TEXT SETTINGS
    // ================================================================
    // A drop-in registration for ONE text element's full "standard"
    // settings battery - per CLAUDE.md Section 12p, direct request ("I
    // want it so that if within another project, if I ask... for text
    // settings... the chat will know to provide all these settings
    // without me listing them out" + "include info about how we
    // implemented it... so every project's font settings are coded in
    // the same way"). This is a generalized port of Clicko's own proven,
    // live mechanism (font-size/scale-with-browser blend, edge-lock
    // anchor formula, pixel-art text-shadow border) - Clicko's OWN
    // per-element special cases (a shared 2-state DOM element, a multi-
    // part decomposed element, independent win/lose splits) are its own
    // project-specific layering on TOP of this, not part of the generic
    // version here. The 13 controls this builds are in CLAUDE.md 12p's
    // exact order - do not reorder them without updating 12p to match.
    //
    // NAMING: given a tab ('desktop'/'mobile'/'landscape'), a
    // devicePrefix (''/'Mobile'/'Landscape' - matching [JS-5]'s own
    // convention) and a nameRoot (e.g. 'StartText'), this builds ids
    // like sliderStartTextFontSize / sliderMobileStartTextFontSize /
    // colorStartTextColor / selectStartTextAlign / checkboxStartTextCaps
    // - call it 3x (once per tab, with '' / 'Mobile' / 'Landscape') the
    // same way this file's own DESKTOP/MOBILE/LANDSCAPE_UNIFORM_CONTROLS
    // arrays are 3 separate calls, per CLAUDE.md 12f (spatial/size
    // settings default to independently-tunable per device).
    //
    // ONE SIMPLIFICATION vs. Clicko's own real implementation: Clicko
    // exposes a SEPARATE, independently-tunable "Font Size (vw)" slider
    // alongside "Font Size (px)" (2 controls) so Scale With Browser can
    // blend between 2 hand-tuned values. CLAUDE.md 12p's checklist has
    // only ONE "Font Size" entry, so this version derives the vw-scaled
    // size FROM the one px value instead, relative to a reference
    // viewport width (applyStandardTextElement's own referenceVw
    // parameter, default 1280 - override per element/device, e.g. ~390
    // for a Mobile-tab element, so Scale With Browser doesn't jump the
    // instant it's checked). Add a 2nd, independently-tunable vw slider
    // yourself on top (same pattern as any other control here) if a
    // specific element needs Clicko's finer control - not the default.
    //
    // Border is Clicko's own separate "Border Thickness/Color" ring
    // effect only (buildTextBorderShadow below) - not combined with an
    // extrusion-depth layer the way Clicko's OWN buildCombinedShadow()
    // also supports, since 12p's checklist has no separate "Extrusion
    // Depth" entry. Add that yourself on top the same way if a specific
    // element wants it.
    //
    // "Capitalize" has no Clicko precedent to port - Clicko only ever
    // built this at the DEV-PANEL-CHROME level (the built-in "Dev Panel"
    // group's own 4 Capitalize-*-Text toggles, [CSS-10]/[JS-12] below),
    // never per game-text-element. This is a clean, minimal new
    // implementation (a plain text-transform toggle) for that checklist
    // entry, not a port of an existing mechanism.

    // Simple pixel-art text-stroke via text-shadow - one ring of 8
    // directional offsets at the given thickness, no extrusion depth
    // (unlike Clicko's own buildBorderRingShadow/buildCombinedShadow,
    // which also layer in a depth trail - out of scope here, see this
    // section's own top comment).
    function buildTextBorderShadow(thicknessPx, color) {
        const t = Math.round(thicknessPx);
        if (t <= 0) return 'none';
        const dirs = [[t,0],[-t,0],[0,t],[0,-t],[t,t],[t,-t],[-t,t],[-t,-t]];
        return dirs.map(([dx, dy]) => dx + 'px ' + dy + 'px 0 ' + color).join(', ');
    }
    // Shared by the Horizontal/Vertical Alignment + Edge Lock formula
    // below - same values Clicko's own EDGE_LOCK_BASE/EDGE_LOCK_SIGN/
    // VALIGN_TY use, ported as-is (these are just the 3 anchor points'
    // own %-position and direction-sign, not Clicko-specific).
    const STD_TEXT_EDGE_LOCK_BASE = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };
    const STD_TEXT_EDGE_LOCK_SIGN = { left: 1, top: 1, center: 1, right: -1, bottom: -1 };
    const STD_TEXT_VALIGN_TY = { top: '0%', center: '-50%', bottom: '-100%' };

    // {tab, devicePrefix, nameRoot, group, defaults?} -> the 13-control
    // array, in CLAUDE.md 12p's exact order. `defaults` overrides any of
    // {fontSizePx, color, borderThicknessPx, borderColor, letterSpacingPx,
    // lineSpacing, xOffsetVw, yOffsetVh, valign, align, alignEdgeLock,
    // valignEdgeLock, caps, scaleWithBrowser} - only pass what this
    // element's own defaults actually differ on.
    function buildStandardTextSettingsControls(tab, devicePrefix, nameRoot, group, defaults) {
        const d = Object.assign({
            fontSizePx: 24, color: '#ffffff', borderThicknessPx: 0, borderColor: '#000000',
            letterSpacingPx: 0, lineSpacing: 1.2, xOffsetVw: 0, yOffsetVh: 0,
            valign: 'center', align: 'center', alignEdgeLock: 0, valignEdgeLock: 0,
            caps: 0, scaleWithBrowser: 0,
        }, defaults || {});
        const n = (devicePrefix || '') + nameRoot;
        return [
            { tab, group, id: 'slider' + n + 'FontSize', type: 'slider', label: 'Font Size (px):', min: 6, max: 300, step: 1, value: d.fontSizePx },
            { tab, group, id: 'color' + n + 'Color', type: 'color', label: 'Text Color:', value: d.color },
            { tab, group, id: 'slider' + n + 'BorderThickness', type: 'slider', label: 'Border Thickness (px):', min: 0, max: 20, step: 1, value: d.borderThicknessPx },
            { tab, group, id: 'color' + n + 'BorderColor', type: 'color', label: 'Border Color:', value: d.borderColor },
            { tab, group, id: 'slider' + n + 'LetterSpacing', type: 'slider', label: 'Letter Spacing (px):', min: -10, max: 50, step: 0.5, value: d.letterSpacingPx },
            { tab, group, id: 'slider' + n + 'LineSpacing', type: 'slider', label: 'Line Spacing:', min: 0.5, max: 3, step: 0.05, value: d.lineSpacing },
            { tab, group, id: 'slider' + n + 'X', type: 'slider', label: 'X Offset (vw):', min: -50, max: 50, step: 0.1, value: d.xOffsetVw },
            { tab, group, id: 'slider' + n + 'Y', type: 'slider', label: 'Y Offset (vh):', min: -50, max: 50, step: 0.1, value: d.yOffsetVh },
            { tab, group, id: 'select' + n + 'Valign', type: 'select', label: 'Vertical Alignment:', options: [{value:'top',text:'Top'},{value:'center',text:'Center'},{value:'bottom',text:'Bottom'}], value: d.valign },
            { tab, group, id: 'select' + n + 'Align', type: 'select', label: 'Horizontal Alignment:', options: [{value:'left',text:'Left'},{value:'center',text:'Center'},{value:'right',text:'Right'}], value: d.align },
            { tab, group, id: 'checkbox' + n + 'AlignEdgeLock', type: 'checkbox', label: 'Horizontal Edge Lock', value: d.alignEdgeLock },
            { tab, group, id: 'checkbox' + n + 'ValignEdgeLock', type: 'checkbox', label: 'Vertical Edge Lock', value: d.valignEdgeLock },
            { tab, group, id: 'checkbox' + n + 'Caps', type: 'checkbox', label: 'Capitalize', value: d.caps },
            { tab, group, id: 'checkbox' + n + 'ScaleWithBrowser', type: 'checkbox', label: 'Scale With Browser', value: d.scaleWithBrowser },
        ];
    }
    // Renders any UNIFORM_ROW_BUILDERS-shaped array (not just a standard-
    // text-settings one) into its groups AND applies each row's own
    // initial value/checked for select/checkbox types -
    // buildUniformControlRow's own row builders only self-apply `value`
    // for slider/color (see buildSelectRow/buildCheckboxRow's own doc
    // comments); every existing render*Controls() below (e.g.
    // renderDevPanelStyleControls()) repeats that same select/checkbox
    // special-case by hand, per control. This is that same fix, once,
    // generically - use it for a standard-text-settings array OR any
    // other array with select/checkbox controls in it.
    function renderControlArray(array, callerName) {
        array.forEach(ctrl => {
            const content = findGroupContent(ctrl.tab, ctrl.group, callerName || 'renderControlArray', ctrl.id);
            if (!content) return;
            const row = buildUniformControlRow(ctrl);
            content.appendChild(row);
            if (ctrl.type === 'select') row.querySelector('select').value = ctrl.value;
            else if (ctrl.type === 'checkbox') row.querySelector('input').checked = !!ctrl.value;
        });
    }
    // Reads a standard-text-settings control battery straight off its OWN
    // DOM controls (no separate state object - single source of truth is
    // the control itself, same as every other setting in this file) and
    // writes the result as INLINE custom properties on the target
    // element. Deliberately unprefixed property names (--font-size-px,
    // not --startTextFontSize-px) - safe because el.style.setProperty()
    // scopes them to this one element (and its descendants), so 2
    // different standard-text elements never collide even though they
    // use the exact same property names; see this section's own worked-
    // example CSS rule below for how a project's element then reads them.
    // devicePrefix: which device's controls to read ('' / 'Mobile' /
    // 'Landscape') - the CALLER decides which is "active" (your own
    // device-detection, same as every other setting in this file per
    // step 4 of the top-of-file usage note - this file deliberately
    // doesn't invent a generic breakpoint/orientation detector). Call
    // this once on load and again on every one of this element's own
    // 14 controls' input/change event, AND whenever your own active-
    // device state changes (a resize crossing your own breakpoint).
    // referenceVw: the viewport width (px) Font Size's px value is
    // treated as "designed at" for Scale With Browser's blend - see this
    // section's own top comment on why this differs from Clicko's own
    // 2-slider approach; pass your own element's actual typical
    // viewport width per device (e.g. ~1280 desktop, ~390 mobile) so
    // checking the box doesn't visibly jump the size.
    function applyStandardTextElement(nameRoot, elId, devicePrefix, referenceVw) {
        const el = document.getElementById(elId);
        if (!el) return;
        const n = (devicePrefix || '') + nameRoot;
        const ref = referenceVw || 1280;
        const get = (type, suffix) => document.getElementById(type + n + suffix);
        const fontSizeEl = get('slider', 'FontSize');
        const fontSizePx = fontSizeEl ? parseFloat(fontSizeEl.value) : 24;
        const color = get('color', 'Color')?.value || '#ffffff';
        const borderThickness = parseFloat(get('slider', 'BorderThickness')?.value || 0);
        const borderColor = get('color', 'BorderColor')?.value || '#000000';
        const letterSpacing = parseFloat(get('slider', 'LetterSpacing')?.value || 0);
        const lineSpacing = parseFloat(get('slider', 'LineSpacing')?.value || 1.2);
        const xOffset = parseFloat(get('slider', 'X')?.value || 0);
        const yOffset = parseFloat(get('slider', 'Y')?.value || 0);
        const valign = get('select', 'Valign')?.value || 'center';
        const align = get('select', 'Align')?.value || 'center';
        const alignEdgeLock = !!get('checkbox', 'AlignEdgeLock')?.checked;
        const valignEdgeLock = !!get('checkbox', 'ValignEdgeLock')?.checked;
        const caps = !!get('checkbox', 'Caps')?.checked;
        const scaleWithBrowser = !!get('checkbox', 'ScaleWithBrowser')?.checked;

        el.style.setProperty('--font-size-px', fontSizePx);
        el.style.setProperty('--font-size-reference-vw', ref);
        el.style.setProperty('--scale-with-browser', scaleWithBrowser ? 1 : 0);
        el.style.setProperty('--color', color);
        el.style.setProperty('--border-shadow', buildTextBorderShadow(borderThickness, borderColor));
        el.style.setProperty('--letter-spacing-px', letterSpacing);
        el.style.setProperty('--line-spacing', lineSpacing);
        el.style.setProperty('--x-offset', xOffset);
        el.style.setProperty('--y-offset', yOffset);
        el.style.setProperty('--anchor-ty', STD_TEXT_VALIGN_TY[valign] || STD_TEXT_VALIGN_TY.center);
        el.classList.remove('std-text-align-left', 'std-text-align-center', 'std-text-align-right');
        el.classList.add('std-text-align-' + align);
        el.style.setProperty('--x-base', alignEdgeLock ? STD_TEXT_EDGE_LOCK_BASE[align] : '50%');
        el.style.setProperty('--x-sign', alignEdgeLock ? STD_TEXT_EDGE_LOCK_SIGN[align] : 1);
        el.style.setProperty('--x-unit', alignEdgeLock ? '1px' : '1vw');
        el.style.setProperty('--y-base', valignEdgeLock ? STD_TEXT_EDGE_LOCK_BASE[valign] : '50%');
        el.style.setProperty('--y-sign', valignEdgeLock ? STD_TEXT_EDGE_LOCK_SIGN[valign] : 1);
        el.style.setProperty('--y-unit', valignEdgeLock ? '1px' : '1vh');
        el.style.setProperty('--caps', caps ? 'uppercase' : 'none');
    }
    // WORKED EXAMPLE - copy this whole pattern per text element you add:
    //
    //   const START_TEXT_DESKTOP = buildStandardTextSettingsControls('desktop', '', 'StartText', 'Start Button', { fontSizePx: 40 });
    //   const START_TEXT_MOBILE  = buildStandardTextSettingsControls('mobile', 'Mobile', 'StartText', 'Start Button', { fontSizePx: 28 });
    //   const START_TEXT_LANDSCAPE = buildStandardTextSettingsControls('landscape', 'Landscape', 'StartText', 'Start Button', { fontSizePx: 28 });
    //
    //   // Inside ensureDevPanelBuilt() (same placement rule as every
    //   // other render call - see top-of-file usage step 3):
    //   registerDevControlArray('startTextDesktop', START_TEXT_DESKTOP);
    //   registerDevControlArray('startTextMobile', START_TEXT_MOBILE);
    //   registerDevControlArray('startTextLandscape', START_TEXT_LANDSCAPE);
    //   renderControlArray(START_TEXT_DESKTOP, 'startText');
    //   renderControlArray(START_TEXT_MOBILE, 'startText');
    //   renderControlArray(START_TEXT_LANDSCAPE, 'startText');
    //   // Wiring (also inside ensureDevPanelBuilt(), right after the
    //   // render calls above - same placement rule, step 4):
    //   function applyStartText() {
    //       const active = isMobileActive() ? 'Mobile' : (isLandscapeActive() ? 'Landscape' : '');
    //       // your own device detection - see this function's own
    //       // devicePrefix param comment above
    //       applyStandardTextElement('StartText', 'startButtonLabel', active, active === 'Mobile' ? 390 : 1280);
    //   }
    //   [...START_TEXT_DESKTOP, ...START_TEXT_MOBILE, ...START_TEXT_LANDSCAPE].forEach(ctrl => {
    //       const el = document.getElementById(ctrl.id);
    //       if (el) el.addEventListener(ctrl.type === 'checkbox' ? 'change' : 'input', applyStartText);
    //   });
    //   applyStartText(); // once, so it's correct before any control is touched
    //
    //   // Your own CSS rule for #startButtonLabel - copy this verbatim,
    //   // every standard-text element's own rule looks the same:
    //   //   #startButtonLabel {
    //   //     position: absolute;
    //   //     left: calc(var(--x-base, 50%) + var(--x-sign, 1) * var(--x-offset, 0) * var(--x-unit, 1vw));
    //   //     top: calc(var(--y-base, 50%) + var(--y-sign, 1) * var(--y-offset, 0) * var(--y-unit, 1vh));
    //   //     transform: translate(-50%, var(--anchor-ty, -50%));
    //   //     font-size: calc(var(--font-size-px, 24) * 1px * (1 + var(--scale-with-browser, 0) * (100vw / (var(--font-size-reference-vw, 1280) * 1px) - 1)));
    //   //     color: var(--color, #fff);
    //   //     text-shadow: var(--border-shadow, none);
    //   //     letter-spacing: calc(var(--letter-spacing-px, 0) * 1px);
    //   //     line-height: var(--line-spacing, 1.2);
    //   //     text-transform: var(--caps, none);
    //   //   }
    //   //   #startButtonLabel.std-text-align-left { text-align: left; }
    //   //   #startButtonLabel.std-text-align-center { text-align: center; }
    //   //   #startButtonLabel.std-text-align-right { text-align: right; }

    // ================================================================
    // [JS-8] CLICK-TO-EDIT VALUES
    // ================================================================
    // Slider bound locking (direct request 2026-10-11): "when I click a
    // min max number to edit it, provide a toggle to lock or unlock the
    // number. By lock I mean that even if I set the toggle value beyond,
    // it will just clamp the toggle value to the min max...The locking
    // is just to clamp the toggle value." Keyed "sliderId:min"/
    // "sliderId:max" - independent per bound, same Set-of-keys pattern
    // as lockedGroups above. Persisted the same way lockedGroups is
    // (captureFullDevPanelState/applyFullDevPanelState below).
    let lockedSliderBounds = new Set();
    function isSliderBoundLocked(sliderId, kind) { return lockedSliderBounds.has(sliderId + ':' + kind); }
    function setSliderBoundLocked(sliderId, kind, locked) {
        const key = sliderId + ':' + kind;
        if (locked) lockedSliderBounds.add(key); else lockedSliderBounds.delete(key);
        refreshSliderBoundLockDisplay(sliderId, kind);
    }
    // Re-applies the persistent (outside-of-edit) locked highlight to a
    // bound label from current lockedSliderBounds state - called right
    // after a toggle flips, and once for every bound at panel-build/
    // Reset time (lockedSliderBounds itself may have just been restored
    // from saved state, with no edit UI open to have set the class
    // live). Omitting id/kind refreshes every bound label in the panel.
    function refreshSliderBoundLockDisplay(sliderId, kind) {
        const sel = sliderId
            ? '.dev-slider-bound-editable[data-slider-id="' + sliderId + '"][data-bound="' + kind + '"]'
            : '.dev-slider-bound-editable[data-slider-id]';
        document.querySelectorAll(sel).forEach(el => {
            el.classList.toggle('dev-slider-bound-locked', isSliderBoundLocked(el.dataset.sliderId, el.dataset.bound));
        });
    }
    // Click-to-type exact value (CLAUDE.md Section 12h) — click a
    // slider's own value readout to type an exact number, including one
    // outside the slider's current range (auto-expands the crossed
    // bound to typed-value ± 20%, so the new value isn't left pinned at
    // the extreme).
    // ----------------------------------------------------------------
    function makeDevValuesEditable() {
        document.querySelectorAll('.dev-value[id]').forEach(valueEl => {
            const sliderId = valueEl.id.replace(/^value/, 'slider');
            const slider = document.getElementById(sliderId);
            if (!slider || slider.type !== 'range') return;
            valueEl.classList.add('dev-value-editable');
        });

        document.addEventListener('click', (e) => {
            const valueEl = e.target.closest('.dev-value-editable');
            if (!valueEl || valueEl.querySelector('input')) return;
            const slider = document.getElementById(valueEl.id.replace(/^value/, 'slider'));
            if (!slider) return;

            const originalText = valueEl.textContent;
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'dev-value-edit-input';
            // Bug fixed 2026-09-24: a plain <input type=number> with no
            // step attribute defaults to step=1 -- meaning a decimal-step
            // slider's click-to-type box wouldn't respect its own
            // slider's actual precision. Inherit it directly.
            input.step = slider.step || 'any';
            input.min = slider.min;
            input.max = slider.max;
            input.value = slider.value;
            valueEl.textContent = '';
            valueEl.appendChild(input);
            input.focus();
            input.select();

            let settled = false;
            function commit() {
                if (settled) return;
                settled = true;
                let val = parseFloat(input.value);
                if (isNaN(val)) val = parseFloat(slider.value);
                const min = parseFloat(slider.min), max = parseFloat(slider.max);
                // Locked bound (2026-10-11): clamp to it instead of the
                // normal ±20% auto-expand (CLAUDE.md §12h) - "even if I
                // set the toggle value beyond, it will just clamp the
                // toggle value to the min max."
                if (val > max) {
                    if (isSliderBoundLocked(slider.id, 'max')) {
                        val = max;
                    } else {
                        slider.max = String(val + Math.abs(val) * 0.2);
                        const maxLabelEl = document.querySelector('.dev-slider-bound-editable[data-slider-id="' + slider.id + '"][data-bound="max"]');
                        if (maxLabelEl) maxLabelEl.textContent = slider.max;
                    }
                }
                if (val < min) {
                    if (isSliderBoundLocked(slider.id, 'min')) {
                        val = min;
                    } else {
                        slider.min = String(val - Math.abs(val) * 0.2);
                        const minLabelEl = document.querySelector('.dev-slider-bound-editable[data-slider-id="' + slider.id + '"][data-bound="min"]');
                        if (minLabelEl) minLabelEl.textContent = slider.min;
                    }
                }
                slider.value = val;
                // Remove the temporary <input> BEFORE dispatching -
                // otherwise the value-readout update your own 'input'
                // listener does (if any) can't repaint this span, since
                // it's still occupied by the (about-to-be-removed) input.
                input.remove();
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
            function cancel() {
                if (settled) return;
                settled = true;
                valueEl.textContent = originalText;
            }
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') input.blur();
                else if (ev.key === 'Escape') cancel();
            });
            input.addEventListener('click', (ev) => ev.stopPropagation());
        });
    }

    // Click-to-type a slider's own MIN or MAX bound (as opposed to its
    // current value, above) — the 2 small labels at each end of the
    // track, per direct request 2026-09-28. Parallel structure to
    // makeDevValuesEditable() but keyed by data-slider-id/data-bound
    // rather than an id-prefix swap, since a bound label isn't itself
    // "the value" of anything with its own id.
    function makeDevSliderBoundsEditable() {
        document.addEventListener('click', (e) => {
            const boundEl = e.target.closest('.dev-slider-bound-editable');
            if (!boundEl || boundEl.querySelector('input')) return;
            const slider = document.getElementById(boundEl.dataset.sliderId);
            if (!slider) return;
            const kind = boundEl.dataset.bound;
            const originalText = boundEl.textContent;
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'dev-value-edit-input';
            input.step = slider.step || 'any';
            input.value = kind === 'min' ? slider.min : slider.max;
            boundEl.textContent = '';
            boundEl.appendChild(input);
            // Lock/unlock toggle (direct request 2026-10-11) - always
            // shown while editing a bound, regardless of its current
            // lock state. Toggling takes effect immediately on change,
            // independent of whether the numeric edit itself is
            // committed or cancelled below - "I just click the number
            // to edit it, the toggle appears, then I switch the
            // toggle." Editing the bound's own number stays possible
            // either way; locking only changes how a later VALUE edit
            // that overshoots this bound behaves (clamp vs. auto-expand,
            // see makeDevValuesEditable()'s own commit()).
            const lockLabel = document.createElement('label');
            lockLabel.className = 'dev-slider-bound-lock-toggle';
            const lockCb = document.createElement('input');
            lockCb.type = 'checkbox';
            lockCb.checked = isSliderBoundLocked(slider.id, kind);
            lockLabel.appendChild(lockCb);
            lockLabel.appendChild(document.createTextNode('🔒'));
            lockLabel.title = 'Lock: clamp the value to this bound instead of expanding it';
            boundEl.appendChild(lockLabel);
            lockLabel.addEventListener('click', (ev) => ev.stopPropagation());
            // Clicking the checkbox would otherwise steal focus from
            // `input` first, firing its 'blur' -> commit() -> wiping
            // boundEl's own children (including this checkbox) via
            // textContent before the click/change events even reach it.
            // preventDefault() on mousedown blocks the focus-steal
            // without blocking the click/change that follows, so the
            // toggle still registers and the number edit stays open.
            lockLabel.addEventListener('mousedown', (ev) => ev.preventDefault());
            lockCb.addEventListener('change', () => setSliderBoundLocked(slider.id, kind, lockCb.checked));
            input.focus();
            input.select();

            let settled = false;
            function commit() {
                if (settled) return;
                settled = true;
                let val = parseFloat(input.value);
                if (isNaN(val)) val = parseFloat(kind === 'min' ? slider.min : slider.max);
                if (kind === 'min') slider.min = String(val); else slider.max = String(val);
                // Clamp the current value into the new range, same as a
                // direct value-edit's own overshoot handling.
                const curVal = parseFloat(slider.value);
                const newMin = parseFloat(slider.min), newMax = parseFloat(slider.max);
                if (curVal < newMin) slider.value = slider.min;
                if (curVal > newMax) slider.value = slider.max;
                input.remove();
                boundEl.textContent = val;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
            function cancel() {
                if (settled) return;
                settled = true;
                boundEl.textContent = originalText;
            }
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') input.blur();
                else if (ev.key === 'Escape') cancel();
            });
            input.addEventListener('click', (ev) => ev.stopPropagation());
        });
    }

    // ================================================================
    // [JS-9] TEXT EDIT MODE (GROUP/LABEL RENAME)
    // ================================================================
    // Text Edit Mode — right-click-free inline rename of any group
    // title or setting label. Toggle textEditModeEnabled (a checkbox in
    // the "Dev Panel" built-in group does this by default, see below) to enable.
    // ----------------------------------------------------------------
    let textEditModeEnabled = false;
    let devTextOverrides = {};
    // Tracks which devTextOverrides keys were typed directly into THAT
    // tab, as opposed to carried over automatically by
    // syncTabOrderToDesktop() ([JS-4b] above) - needed so a sync can
    // tell "this Mobile group has never been touched, keep mirroring
    // Desktop's rename" apart from "this Mobile group was deliberately
    // given its own different name, leave it alone" - both look
    // identical as a bare non-null devTextOverrides entry otherwise.
    // Ported from a real project's own dev panel (MAINTENANCE note at
    // the top of this file), which shipped without this the first time
    // and found 2 real bugs as a result: a rename only ever carried
    // over the FIRST time a group synced (the naive "does the target
    // already have an override" check was true forever after that
    // first carry-over, since carrying over IS what set it), and
    // individual row/setting labels never synced at all, only group
    // titles.
    let devTextOverridesManual = new Set();
    const devTextOriginals = {};
    function getDevLabelKey(labelEl) {
        const row = labelEl.closest('.dev-row');
        const control = row ? row.querySelector('[id]') : null;
        return control ? control.id : null;
    }
    function devTextOriginalFor(key, currentText) {
        if (!(key in devTextOriginals)) devTextOriginals[key] = currentText;
        return devTextOriginals[key];
    }
    function applyDevTextOverrides() {
        document.querySelectorAll('.dev-section-title').forEach(titleEl => {
            const key = getSectionKey(titleEl);
            const arrow = titleEl.textContent.slice(0, 2);
            const original = devTextOriginalFor(key, titleEl.textContent.slice(2));
            withPreservedTitleCheckbox(titleEl, () => {
                titleEl.textContent = arrow + (devTextOverrides[key] != null ? devTextOverrides[key] : original);
            });
        });
        document.querySelectorAll('.dev-label').forEach(labelEl => {
            const key = getDevLabelKey(labelEl);
            if (!key) return;
            const original = devTextOriginalFor(key, labelEl.textContent);
            labelEl.textContent = devTextOverrides[key] != null ? devTextOverrides[key] : original;
        });
    }
    function openDevTextEditFor(el, key, isTitle) {
        if (!key || el.querySelector('textarea')) return;
        // A group title created by createDevGroupElement() carries a
        // trailing cascade checkbox as a real DOM child, not just text -
        // detached HERE, before originalHTML is even captured, so it's
        // never part of the wiped/restored markup below at all (an
        // innerHTML round-trip on cancel() would otherwise silently
        // rebuild it as a fresh, listener-less node - see
        // buildGroupCascadeCheckbox()'s own comment). Re-appended (the
        // SAME node, listeners and all) at the end of both commit() and
        // cancel() below.
        const preservedCheckbox = isTitle ? el.querySelector(':scope > .dev-group-cascade-checkbox') : null;
        if (preservedCheckbox) preservedCheckbox.remove();
        const arrow = isTitle ? el.textContent.slice(0, 2) : '';
        const original = devTextOriginalFor(key, isTitle ? el.textContent.slice(2) : el.textContent);
        const currentValue = devTextOverrides[key] != null ? devTextOverrides[key] : original;
        const originalHTML = el.innerHTML;
        const input = document.createElement('textarea');
        input.rows = 1;
        input.value = currentValue;
        el.textContent = '';
        if (isTitle) el.appendChild(document.createTextNode(arrow));
        el.appendChild(input);
        input.focus();
        input.select();
        // Stop this element's own document-level drag-reorder listener
        // from seeing events that originate inside the textarea.
        input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        input.addEventListener('click', (ev) => ev.stopPropagation());
        let settled = false;
        function commit() {
            if (settled) return;
            settled = true;
            const typed = input.value;
            devTextOverrides[key] = (typed === '' || typed === original) ? null : typed;
            // A rename typed directly into THIS element marks it manual
            // (survives future syncTabOrderToDesktop() calls untouched)
            // - clearing it back to the original (null) un-marks it too,
            // so it goes back to mirroring Desktop again - see
            // devTextOverridesManual's own comment above.
            if (devTextOverrides[key] != null) devTextOverridesManual.add(key);
            else devTextOverridesManual.delete(key);
            el.textContent = arrow + (devTextOverrides[key] != null ? devTextOverrides[key] : original);
            if (preservedCheckbox) el.appendChild(preservedCheckbox);
        }
        function cancel() {
            if (settled) return;
            settled = true;
            el.innerHTML = originalHTML;
            if (preservedCheckbox) el.appendChild(preservedCheckbox);
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); input.blur(); }
            else if (ev.key === 'Escape') cancel();
        });
    }
    // Delegated single listener (not one per label) — capture phase +
    // preventDefault so clicking a checkbox row's label text doesn't
    // also toggle the checkbox (native <label> click-through behavior).
    function setupDevPanelTextEdit() {
        devPanel.addEventListener('click', (e) => {
            if (!textEditModeEnabled) return;
            const label = e.target.closest('.dev-label');
            if (!label) return;
            if (label.querySelector('textarea')) return;
            if (sectionJustDragged) { sectionJustDragged = false; return; }
            e.preventDefault();
            e.stopPropagation();
            openDevTextEditFor(label, getDevLabelKey(label), false);
        }, true);
    }

    // ================================================================
    // [JS-10] PANEL MOVE / RESIZE / COLLAPSE / HIDE CHROME
    // ================================================================
    // Panel move/resize/collapse/hide chrome.
    // DEV_PANEL_LAYOUT is this engine's OWN internal state for the
    // panel's position/size — deliberately not tied to any project's
    // settings object, so this engine has zero dependency on how a
    // project stores its state. It's included by default in the
    // localStorage save/load (see saveDevPanelSettings/loadDevPanelSettings
    // below) — a project doing its own save/load instead should persist
    // this object too if it wants the panel to remember where it was.
    // ----------------------------------------------------------------
    const DEV_PANEL_LAYOUT = { left: 20, top: 20, width: 340, height: 520 };
    const DEV_PANEL_HANDLE_OVERHANG_PX = 6;
    // Extra clamp margin from the left/right viewport edge, mobile only
    // — keeps the panel's drag/resize hit-zones off the physical screen
    // edge, where an OS edge-swipe-back gesture can capture a touch
    // before it ever reaches the page.
    const DEV_PANEL_MOBILE_EDGE_GESTURE_MARGIN_PX = 20;
    function devPanelEdgeMarginX() {
        return DEV_PANEL_HANDLE_OVERHANG_PX + (isNarrowViewport() ? DEV_PANEL_MOBILE_EDGE_GESTURE_MARGIN_PX : 0);
    }
    function setDevPanelLayoutVar(key, cssVarName, value) {
        DEV_PANEL_LAYOUT[key] = value;
        document.documentElement.style.setProperty(cssVarName, value);
    }
    function applyDevPanelLayout() {
        document.documentElement.style.setProperty('--dev-panel-left-px', DEV_PANEL_LAYOUT.left);
        document.documentElement.style.setProperty('--dev-panel-top-px', DEV_PANEL_LAYOUT.top);
        document.documentElement.style.setProperty('--dev-panel-width-px', DEV_PANEL_LAYOUT.width);
        document.documentElement.style.setProperty('--dev-panel-height-px', DEV_PANEL_LAYOUT.height);
    }
    function clampDevPanelPosition() {
        const rect = devPanel.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return; // hidden - nothing to clamp yet
        const o = DEV_PANEL_HANDLE_OVERHANG_PX;
        const ox = devPanelEdgeMarginX();
        const maxLeft = Math.max(ox, window.innerWidth - rect.width - ox);
        const maxTop = Math.max(o, window.innerHeight - rect.height - o);
        const clampedLeft = Math.min(Math.max(ox, DEV_PANEL_LAYOUT.left), maxLeft);
        const clampedTop = Math.min(Math.max(o, DEV_PANEL_LAYOUT.top), maxTop);
        if (clampedLeft !== DEV_PANEL_LAYOUT.left) setDevPanelLayoutVar('left', '--dev-panel-left-px', clampedLeft);
        if (clampedTop !== DEV_PANEL_LAYOUT.top) setDevPanelLayoutVar('top', '--dev-panel-top-px', clampedTop);
    }

    const devPanelHeader = document.getElementById('devPanelHeader');
    let isDraggingDevPanel = false;
    let devPanelDragStart = { pointerX: 0, pointerY: 0, panelLeft: 0, panelTop: 0 };
    devPanelHeader.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return; // Collapse/Hide keep their own click behavior
        e.preventDefault();
        const rect = devPanel.getBoundingClientRect();
        devPanelDragStart = { pointerX: e.clientX, pointerY: e.clientY, panelLeft: rect.left, panelTop: rect.top };
        isDraggingDevPanel = true;
        devPanelHeader.classList.add('dragging');
        try { devPanelHeader.setPointerCapture(e.pointerId); } catch (err) { /* best-effort only */ }
    });
    document.addEventListener('pointermove', (e) => {
        if (!isDraggingDevPanel) return;
        // Recovery for a dropped gesture (a touch-drag whose pointerdown
        // fired but no further pointermove/up/cancel ever arrived) -
        // without this, isDraggingDevPanel gets stuck true forever,
        // which would break every subsequent pointer interaction (this
        // flag unconditionally gates this handler).
        if (e.buttons === 0) { endDevPanelDrag(e); return; }
        const dx = e.clientX - devPanelDragStart.pointerX;
        const dy = e.clientY - devPanelDragStart.pointerY;
        const panelRect = devPanel.getBoundingClientRect();
        const o = DEV_PANEL_HANDLE_OVERHANG_PX;
        const ox = devPanelEdgeMarginX();
        const newLeft = Math.max(ox, Math.min(window.innerWidth - panelRect.width - ox, devPanelDragStart.panelLeft + dx));
        const newTop = Math.max(o, Math.min(window.innerHeight - panelRect.height - o, devPanelDragStart.panelTop + dy));
        setDevPanelLayoutVar('left', '--dev-panel-left-px', Math.round(newLeft));
        setDevPanelLayoutVar('top', '--dev-panel-top-px', Math.round(newTop));
    });
    function endDevPanelDrag(e) {
        if (!isDraggingDevPanel) return;
        isDraggingDevPanel = false;
        devPanelHeader.classList.remove('dragging');
        if (e && e.pointerId !== undefined && devPanelHeader.hasPointerCapture(e.pointerId)) {
            devPanelHeader.releasePointerCapture(e.pointerId);
        }
    }
    document.addEventListener('pointerup', endDevPanelDrag);
    document.addEventListener('pointercancel', endDevPanelDrag);
    // lostpointercapture fires whenever the browser/OS revokes capture
    // for any reason (including a native gesture recognizer stepping in
    // mid-touch) - a more direct signal than waiting for pointerup/
    // pointercancel, which can both simply never arrive.
    devPanelHeader.addEventListener('lostpointercapture', endDevPanelDrag);

    function toggleDevPanelCollapsed() {
        const collapsed = devPanel.classList.toggle('panel-collapsed');
        document.getElementById('devCollapseBtn').textContent = collapsed ? '▢' : '▁';
        if (collapsed) {
            const headerHeight = devPanelHeader.getBoundingClientRect().height;
            const panelPadding = parseFloat(getComputedStyle(devPanel).paddingTop) + parseFloat(getComputedStyle(devPanel).paddingBottom);
            devPanel.style.setProperty('height', (headerHeight + panelPadding) + 'px', 'important');
        } else {
            devPanel.style.removeProperty('height');
        }
    }

    // Custom resize handles (native CSS `resize` isn't reliably touch-
    // draggable). Generic factory, not 8 near-duplicate handlers -
    // xEdge/yEdge say which side(s) this handle moves. 'right'/'bottom'
    // grow from the fixed opposite side; 'left'/'top' also shift the
    // panel's own left/top by however much the size changed (post-
    // clamp), so the OPPOSITE edge stays visually fixed, matching how
    // an OS window resize behaves. `setLeftTop(key, value)` (optional,
    // 2026-09-19 - added for the Undock feature's own floating panels,
    // see createUndockPanel()) lets a caller other than the main dev
    // panel persist a left/top change its OWN way - defaults to the
    // original devPanel-specific CSS-custom-property behavior when
    // omitted, so every existing call site (the main panel's own 8
    // handles) is completely unaffected by this generalization.
    function setupPanelResizeHandle(panel, handle, xEdge, yEdge, setLeftTop) {
        setLeftTop = setLeftTop || ((key, value) => setDevPanelLayoutVar(key, '--dev-panel-' + key + '-px', value));
        let dragging = false;
        let start = { pointerX: 0, pointerY: 0, left: 0, top: 0, width: 0, height: 0 };

        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const rect = panel.getBoundingClientRect();
            start = { pointerX: e.clientX, pointerY: e.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            dragging = true;
            try { handle.setPointerCapture(e.pointerId); } catch (err) { /* best-effort only */ }
        });

        document.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            if (e.buttons === 0) { end(e); return; }
            const cs = getComputedStyle(panel);
            const minW = parseFloat(cs.minWidth) || 0, maxW = parseFloat(cs.maxWidth) || Infinity;
            const minH = parseFloat(cs.minHeight) || 0, maxH = parseFloat(cs.maxHeight) || Infinity;
            const dx = e.clientX - start.pointerX;
            const dy = e.clientY - start.pointerY;

            let newWidth = start.width, newLeft = start.left;
            if (xEdge === 'right') {
                newWidth = Math.max(minW, Math.min(maxW, start.width + dx));
                const maxWidthFromEdge = window.innerWidth - start.left - devPanelEdgeMarginX();
                newWidth = Math.min(newWidth, Math.max(minW, maxWidthFromEdge));
            } else if (xEdge === 'left') {
                newWidth = Math.max(minW, Math.min(maxW, start.width - dx));
                newLeft = start.left + (start.width - newWidth);
                const clampedLeft = Math.max(devPanelEdgeMarginX(), newLeft);
                if (clampedLeft !== newLeft) { newWidth = newWidth - (clampedLeft - newLeft); newLeft = clampedLeft; }
            }
            let newHeight = start.height, newTop = start.top;
            if (yEdge === 'bottom') {
                newHeight = Math.max(minH, Math.min(maxH, start.height + dy));
            } else if (yEdge === 'top') {
                newHeight = Math.max(minH, Math.min(maxH, start.height - dy));
                newTop = start.top + (start.height - newHeight);
                const clampedTop = Math.max(DEV_PANEL_HANDLE_OVERHANG_PX, newTop);
                if (clampedTop !== newTop) { newHeight = newHeight - (clampedTop - newTop); newTop = clampedTop; }
            }

            panel.style.width = newWidth + 'px';
            panel.style.height = newHeight + 'px';
            // NOT also panel.style.left/top for the right/bottom-only
            // case - a direct inline write there would permanently
            // shadow the CSS rule (left: calc(var(--dev-panel-left-px)
            // * 1px)) regardless of the custom property's later value,
            // which would silently break the header drag-to-move
            // afterward. setProperty() below already re-renders the
            // position immediately for the left/top-moving cases.
            if (xEdge === 'left') setLeftTop('left', Math.round(newLeft));
            if (yEdge === 'top') setLeftTop('top', Math.round(newTop));
        });

        function end(e) {
            if (!dragging) return;
            dragging = false;
            if (e && e.pointerId !== undefined && handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
        }
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
        handle.addEventListener('lostpointercapture', end);
    }

    // ================================================================
    // [JS-11] TAB SWITCHING
    // ================================================================
    // Tab switching. Mobile/Landscape's own group/setting order always
    // mirrors Desktop's CURRENT order the moment that tab is opened -
    // see syncTabOrderToDesktop()'s own comment ([JS-4b] above). Runs
    // BEFORE the 'hidden' class toggle below so the tab's content is
    // already in its correct order the instant it becomes visible, not
    // reordering visibly after the fact.
    function switchDevPanelTab(tab) {
        syncTabOrderToDesktop(tab);
        // Re-syncs checkbox .checked display, group cascade indeterminate
        // display, and empty-group hiding for whichever tab is about to
        // show - state can change while a tab isn't active, and none of
        // that is otherwise guaranteed to have refreshed THIS tab's own
        // display yet. Ported from CLICKO, direct request: "the checkboxes
        // for groups and settings in different tabs should also auto
        // update appropriately."
        if (devPanelBuilt) {
            syncDeviceCheckboxesFromState();
            if (tab === 'mobile' || tab === 'landscape') refreshEmptyGroupVisibility(tab);
            refreshAllGroupCascadeCheckboxes();
        }
        DEV_PANEL_TABS.forEach(t => {
            document.getElementById(t + 'TabContent').classList.toggle('hidden', t !== tab);
            const btn = document.getElementById('devTab' + t[0].toUpperCase() + t.slice(1) + 'Btn');
            if (btn) btn.classList.toggle('active', t === tab);
        });
        // The panel's OWN styling (below) is independent per tab, not
        // tied to the real device viewport - re-apply whichever tab's
        // own saved look now that it's the one showing.
        applyDevPanelOwnStyling(tab);
        // Host extension point -- see devOnTabChanged's own declaration
        // comment, near the top of [JS-9]/wherever a host's own project
        // code lives in this file, for why this exists and what it's for.
        devOnTabChanged(tab);
    }

    // ================================================================
    // [JS-12] BUILT-IN "DEV PANEL" SELF-STYLING GROUP
    // ================================================================
    // Built-in "Dev Panel" self-styling group (CLAUDE.md Section 12i) -
    // font sizes/colors/opacity/capitalize-toggles for the PANEL'S OWN
    // text, independent of the actual game. Fully generic - not tied to
    // any project's settings.
    // ----------------------------------------------------------------
    // Defaults below are this template's own deliberately-tuned,
    // lived-with starting look (a blue accent, Verdana, capitalized
    // button/tab/group text) rather than arbitrary placeholder values -
    // change them freely, this is just a sensible starting point.
    const devPanelStyle = {
        titleFontSize: 17, tabFontSize: 12, groupTitleFontSize: 14, settingTitleFontSize: 12,
        buttonTextBorder: 0, scrollStrength: 0.2, opacity: 1,
        bgColor: '#000000', titleTextColor: '#ffffff', nonTitleTextColor: '#ffffff',
        accentColor: '#005f8f', sliderColor: '#ffffff', fontFamily: 'Helvetica, Arial, sans-serif',
        // Added 2026-09-28, direct request — 3 new independently-tunable
        // colors, decoupled from the general Accent Color: accentColor2
        // is the Dev Panel Label's (the outer panel header bar's) own
        // background, previously just inheriting through from the panel
        // body's own Background Color since the header had no background
        // of its own; buttonColor decouples every button's background
        // from Accent Color; accentColor3 decouples checkbox
        // accent-color (and the group undock arrow's own color, per a
        // follow-up request the same day) from Accent Color too.
        accentColor2: '#26253a', buttonColor: '#3a3a4a', accentColor3: '#7ec8e3',
        capsButtonText: true, capsTabText: true, capsGroupNames: true, capsSettingsText: false,
        buttonTextLetterSpacing: 0, tabTextLetterSpacing: 0, groupTextLetterSpacing: 0.8, settingsTextLetterSpacing: 0,
        buttonHeight: 21, valueFontSize: 12,
        // Also drives the "+ Add Group" button's own background (styled
        // like a tab button otherwise - see .dev-add-group-btn) so both
        // stay visually tied to the same color, per direct request.
        groupLabelBgColor: '#005f8f',
        // Added 2026-09-14, porting Clicko's own current Dev Panel group
        // as this template's new standard (direct request: "our current
        // Dev Panel settings will be the standard") - the per-category
        // Title/Group/Settings/Tab/Button text battery (Bold, Capitalize,
        // Letter Spacing, Line Spacing, Text Color) plus Button Font Size
        // and Title's own Letter Spacing/Line Spacing. Boolean defaults
        // (titleBold/tabBold/buttonBold/groupBold true, settingsBold/
        // titleCapitalize false) match Clicko's own current live values
        // exactly. Corrected 2026-09-14 (2nd pass, direct request "I want
        // you to set the color fields as defaults... our settings should
        // be default"): every color above (accentColor/sliderColor/
        // groupLabelBgColor here, groupTextColor/buttonTextColor/
        // settingNumberColor/tabTextColor below) now matches Clicko's own
        // real, live-fetched current values exactly too, superseding this
        // comment's own earlier "follow the template's own palette
        // instead" reasoning - re-fetched fresh rather than reused from
        // memory, since colors had already drifted from what an earlier
        // pass in this same session once read (tabTextColor, in
        // particular, had changed from black to white since).
        titleLetterSpacing: 2.3, titleLineHeight: 1.2, tabLineHeight: 1.2, buttonLineHeight: 1.2, settingsLineHeight: 1.2, groupLineHeight: 1.2,
        buttonFontSize: 10,
        titleBold: true, tabBold: true, buttonBold: true, settingsBold: false, groupBold: true, titleCapitalize: false,
        groupTextColor: '#ffffff', buttonTextColor: '#ffffff', settingNumberColor: '#5cc9ff', tabTextColor: '#ffffff',
    };
    const mobileDevPanelStyle = { ...devPanelStyle };
    const landscapeDevPanelStyle = { ...devPanelStyle };
    const DEV_PANEL_STYLE_VAR_MAP = {
        titleFontSize: '--dev-panel-title-font-size-px', tabFontSize: '--dev-tab-font-size-px',
        groupTitleFontSize: '--dev-group-title-font-size-px', settingTitleFontSize: '--dev-setting-title-font-size-px',
        buttonTextBorder: '--dev-button-text-border-px', scrollStrength: '--dev-scroll-strength',
        opacity: '--dev-panel-opacity', bgColor: '--dev-panel-bg-color', titleTextColor: '--dev-panel-title-text-color',
        nonTitleTextColor: '--dev-panel-non-title-text-color', accentColor: '--dev-accent-color', sliderColor: '--dev-slider-color',
        fontFamily: '--dev-panel-font-family', buttonHeight: '--dev-button-height-px',
        buttonTextLetterSpacing: '--dev-button-text-letter-spacing-px', tabTextLetterSpacing: '--dev-tab-text-letter-spacing-px',
        groupTextLetterSpacing: '--dev-group-text-letter-spacing-px', settingsTextLetterSpacing: '--dev-settings-text-letter-spacing-px',
        valueFontSize: '--dev-value-font-size-px', groupLabelBgColor: '--dev-group-label-bg-color',
        // Added 2026-09-14, porting Clicko's own current Dev Panel group.
        titleLetterSpacing: '--dev-panel-title-letter-spacing-px', titleLineHeight: '--dev-panel-title-line-height',
        tabLineHeight: '--dev-tab-line-height', buttonLineHeight: '--dev-button-text-line-height',
        settingsLineHeight: '--dev-settings-line-height', groupLineHeight: '--dev-group-text-line-height',
        buttonFontSize: '--dev-button-text-font-size-px',
        groupTextColor: '--dev-panel-group-text-color', buttonTextColor: '--dev-panel-button-text-color',
        settingNumberColor: '--dev-value-text-color', tabTextColor: '--dev-tab-text-color',
        // Added 2026-09-28, direct request.
        accentColor2: '--dev-accent-color-2', buttonColor: '--dev-button-color', accentColor3: '--dev-accent-color-3',
    };
    // Opacity/colors/font/caps toggles are desktop-only by default
    // (always resolve from devPanelStyle regardless of active tab) -
    // font sizes and button height stay genuinely per-tab. This mirrors
    // CLAUDE.md Section 12f: cosmetic/non-spatial settings default to
    // shared across tabs, spatial/size settings default to independent.
    // groupLabelBgColor is a color, not a size - shared, like every other
    // color here. valueFontSize stays OUT of this list deliberately - a
    // real size, per-tab like every other font size above.
    // Added 2026-09-14 to the shared-keys list: groupTextColor/buttonTextColor/
    // settingNumberColor/tabTextColor (colors - same "desktop-only cosmetic"
    // bucket as every other color here) and titleBold/tabBold/buttonBold/
    // settingsBold/groupBold/titleCapitalize (booleans - same bucket as the
    // 4 existing caps toggles). Matches Clicko's own current Dev Panel group.
    const DEV_PANEL_STYLE_SHARED_KEYS = ['opacity', 'bgColor', 'titleTextColor', 'nonTitleTextColor', 'accentColor', 'sliderColor', 'fontFamily', 'capsButtonText', 'capsTabText', 'capsGroupNames', 'capsSettingsText', 'buttonTextLetterSpacing', 'tabTextLetterSpacing', 'groupTextLetterSpacing', 'settingsTextLetterSpacing', 'groupLabelBgColor', 'groupTextColor', 'buttonTextColor', 'settingNumberColor', 'tabTextColor', 'titleBold', 'tabBold', 'buttonBold', 'settingsBold', 'groupBold', 'titleCapitalize', 'accentColor2', 'buttonColor', 'accentColor3'];
    const DEV_PANEL_CAPS_CLASS_MAP = {
        capsButtonText: 'dev-caps-button-text', capsTabText: 'dev-caps-tab-text',
        capsGroupNames: 'dev-caps-group-names', capsSettingsText: 'dev-caps-settings-text',
        titleCapitalize: 'dev-caps-title-text', titleBold: 'dev-bold-title',
        tabBold: 'dev-bold-tab', buttonBold: 'dev-bold-button',
        settingsBold: 'dev-bold-settings', groupBold: 'dev-bold-group',
    };
    function applyDevPanelOwnStyling(tab) {
        const style = tab === 'desktop' ? devPanelStyle : tab === 'mobile' ? mobileDevPanelStyle : landscapeDevPanelStyle;
        for (const [key, varName] of Object.entries(DEV_PANEL_STYLE_VAR_MAP)) {
            const value = DEV_PANEL_STYLE_SHARED_KEYS.includes(key) ? devPanelStyle[key] : style[key];
            document.documentElement.style.setProperty(varName, value);
        }
        for (const [key, className] of Object.entries(DEV_PANEL_CAPS_CLASS_MAP)) {
            devPanel.classList.toggle(className, !!devPanelStyle[key]);
        }
    }

    const DEVPANEL_STYLE_CONTROLS = (() => {
        const perTab = (tab, idPrefix, sharedOnly) => {
            const rows = [
                { tab, group: 'Dev Panel', id: idPrefix + 'TitleFontSize', type: 'slider', label: 'Title Font Size (px):', min: 6, max: 30, step: 1, value: 17 },
                { tab, group: 'Dev Panel', id: idPrefix + 'TabFontSize', type: 'slider', label: 'Tab Font Size (px):', min: 6, max: 30, step: 1, value: 12 },
                { tab, group: 'Dev Panel', id: idPrefix + 'GroupTitleFontSize', type: 'slider', label: 'Group Title Font Size (px):', min: 6, max: 30, step: 1, value: 14 },
                { tab, group: 'Dev Panel', id: idPrefix + 'SettingTitleFontSize', type: 'slider', label: 'Setting Title Font Size (px):', min: 6, max: 30, step: 1, value: 12 },
                { tab, group: 'Dev Panel', id: idPrefix + 'ButtonTextBorder', type: 'slider', label: 'Button Text Border (px):', min: 0, max: 20, step: 1, value: 0 },
                { tab, group: 'Dev Panel', id: idPrefix + 'ScrollStrength', type: 'slider', label: 'Dev Panel Scroll Strength (x):', min: 0.2, max: 5, step: 0.1, value: 0.2 },
                { tab, group: 'Dev Panel', id: idPrefix + 'ButtonHeight', type: 'slider', label: 'Button Height (px):', min: 12, max: 60, step: 1, value: 21 },
                { tab, group: 'Dev Panel', id: idPrefix + 'ValueFontSize', type: 'slider', label: 'Setting Number Font Size (px):', min: 6, max: 30, step: 1, value: 12 },
                { tab, group: 'Dev Panel', id: idPrefix + 'TitleLetterSpacing', type: 'slider', label: 'Dev Panel Title Letter Spacing (px):', min: -2, max: 10, step: 0.1, value: 2.3 },
                { tab, group: 'Dev Panel', id: idPrefix + 'TitleLineHeight', type: 'slider', label: 'Dev Panel Title Line Spacing (x):', min: 0.8, max: 3, step: 0.05, value: 1.2 },
                { tab, group: 'Dev Panel', id: idPrefix + 'TabLineHeight', type: 'slider', label: 'Tab Line Spacing (x):', min: 0.8, max: 3, step: 0.05, value: 1.2 },
                { tab, group: 'Dev Panel', id: idPrefix + 'GroupLineHeight', type: 'slider', label: 'Group Text Line Spacing (x):', min: 0.8, max: 3, step: 0.05, value: 1.2 },
                { tab, group: 'Dev Panel', id: idPrefix + 'SettingsLineHeight', type: 'slider', label: 'Settings Text Line Spacing (x):', min: 0.8, max: 3, step: 0.05, value: 1.2 },
                { tab, group: 'Dev Panel', id: idPrefix + 'ButtonLineHeight', type: 'slider', label: 'Button Text Line Spacing (x):', min: 0.8, max: 3, step: 0.05, value: 1.2 },
                { tab, group: 'Dev Panel', id: idPrefix + 'ButtonFontSize', type: 'slider', label: 'Button Text Font Size (px):', min: 6, max: 30, step: 1, value: 10 },
            ];
            if (sharedOnly) return rows;
            return [
                ...rows,
                { tab, group: 'Dev Panel', id: idPrefix + 'Opacity', type: 'slider', label: 'Opacity:', min: 0.1, max: 1, step: 0.01, value: 1 },
                { tab, group: 'Dev Panel', id: 'colorDevPanelBg', type: 'color', label: 'Background Color:', value: '#000000' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelTitleText', type: 'color', label: 'Title Text Color:', value: '#ffffff' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelNonTitleText', type: 'color', label: 'Settings Title Text Color:', value: '#ffffff' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelAccent', type: 'color', label: 'Accent Color (Buttons/UI):', value: '#005f8f' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelAccent2', type: 'color', label: 'Accent Color #2 (Dev Panel Label):', value: '#26253a' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelAccent3', type: 'color', label: 'Accent Color #3 (Checkboxes):', value: '#7ec8e3' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelButtonColor', type: 'color', label: 'Button Color:', value: '#3a3a4a' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelSliderColor', type: 'color', label: 'Slider Color:', value: '#ffffff' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelGroupLabelBg', type: 'color', label: 'Group Label Background Color:', value: '#005f8f' },
                { tab, group: 'Dev Panel', id: 'selectDevPanelFontFamily', type: 'select', label: 'Font (All Text):', options: [
                    { value: 'monospace', text: 'Monospace' }, { value: 'Arial, Helvetica, sans-serif', text: 'Arial' },
                    // Matches Clicko's own current live fontFamily value exactly
                    // (Clicko is the Gold Standard for this group's defaults -
                    // CLAUDE.md §12i) - kept as its own option rather than
                    // reusing the pre-existing 'Arial, Helvetica, sans-serif'
                    // entry above, since the font STACK ORDER differs and the
                    // select's value must match devPanelStyle.fontFamily
                    // byte-for-byte for the initial selection to resolve
                    // correctly (added 2026-09-14).
                    { value: 'Helvetica, Arial, sans-serif', text: 'Helvetica' },
                    { value: "'Segoe UI', Arial, sans-serif", text: 'Segoe UI' }, { value: 'Verdana, Geneva, sans-serif', text: 'Verdana' },
                    { value: "'Trebuchet MS', Arial, sans-serif", text: 'Trebuchet MS' }, { value: 'Calibri, Arial, sans-serif', text: 'Calibri' },
                ] },
                { tab, group: 'Dev Panel', id: 'checkboxDevCapsButtonText', type: 'checkbox', label: 'Capitalize Button Text' },
                { tab, group: 'Dev Panel', id: 'checkboxDevCapsTabText', type: 'checkbox', label: 'Capitalize Tab Text' },
                { tab, group: 'Dev Panel', id: 'checkboxDevCapsGroupNames', type: 'checkbox', label: 'Capitalize Group Names' },
                { tab, group: 'Dev Panel', id: 'checkboxDevCapsSettingsText', type: 'checkbox', label: 'Capitalize Settings Text' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelGroupText', type: 'color', label: 'Group Text Color:', value: '#ffffff' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelButtonText', type: 'color', label: 'Button Text Color:', value: '#ffffff' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelSettingNumber', type: 'color', label: 'Setting Number Text Color:', value: '#5cc9ff' },
                { tab, group: 'Dev Panel', id: 'colorDevPanelTabText', type: 'color', label: 'Tab Text Color:', value: '#ffffff' },
                { tab, group: 'Dev Panel', id: 'sliderDevTabTextLetterSpacing', type: 'slider', label: 'Tab Letter Spacing (px):', min: -2, max: 10, step: 0.1, value: 0 },
                { tab, group: 'Dev Panel', id: 'sliderDevGroupTextLetterSpacing', type: 'slider', label: 'Group Letter Spacing (px):', min: -2, max: 10, step: 0.1, value: 0.8 },
                { tab, group: 'Dev Panel', id: 'sliderDevSettingsTextLetterSpacing', type: 'slider', label: 'Settings Letter Spacing (px):', min: -2, max: 10, step: 0.1, value: 0 },
                { tab, group: 'Dev Panel', id: 'sliderDevButtonTextLetterSpacing', type: 'slider', label: 'Buttons Letter Spacing (px):', min: -2, max: 10, step: 0.1, value: 0 },
                { tab, group: 'Dev Panel', id: 'checkboxDevCapsTitleText', type: 'checkbox', label: 'Capitalize Title' },
                { tab, group: 'Dev Panel', id: 'checkboxDevBoldTitle', type: 'checkbox', label: 'Bold Title' },
                { tab, group: 'Dev Panel', id: 'checkboxDevBoldGroup', type: 'checkbox', label: 'Bold Group Text' },
                { tab, group: 'Dev Panel', id: 'checkboxDevBoldSettings', type: 'checkbox', label: 'Bold Settings Text' },
                { tab, group: 'Dev Panel', id: 'checkboxDevBoldTab', type: 'checkbox', label: 'Bold Tab' },
                { tab, group: 'Dev Panel', id: 'checkboxDevBoldButton', type: 'checkbox', label: 'Bold Button' },
            ];
        };
        return [
            ...perTab('desktop', 'sliderDevPanel', false),
            ...perTab('mobile', 'sliderMobileDevPanel', true),
            ...perTab('landscape', 'sliderLandscapeDevPanel', true),
        ];
    })();
    // Select/checkbox rows (font family, the 4 caps toggles, text-edit
    // mode) don't have their own `.dev-select`/`.dev-color-picker`-style
    // generic post-render sync (syncSlidersFromState/syncColorPickersFromState
    // only cover sliders/colors) - synced here, once, right after each
    // is built, so their initial DOM state actually matches devPanelStyle's
    // real defaults instead of silently falling back to "first option"/
    // "unchecked" on a fresh load.
    const DEV_PANEL_CAPS_CHECKBOX_KEYS = {
        checkboxDevCapsButtonText: 'capsButtonText', checkboxDevCapsTabText: 'capsTabText',
        checkboxDevCapsGroupNames: 'capsGroupNames', checkboxDevCapsSettingsText: 'capsSettingsText',
        checkboxDevCapsTitleText: 'titleCapitalize', checkboxDevBoldTitle: 'titleBold',
        checkboxDevBoldTab: 'tabBold', checkboxDevBoldButton: 'buttonBold',
        checkboxDevBoldSettings: 'settingsBold', checkboxDevBoldGroup: 'groupBold',
    };
    // Hoisted out of setupDevPanelStyleControls() (which still owns
    // WIRING the change listeners) so syncDevPanelStyleControlsFromState()
    // below can reuse the exact same id/key mapping for the opposite
    // direction (state -> DOM) without a 2nd, drift-prone copy of it.
    const DEV_PANEL_STYLE_SLIDER_KEYS = [
        ['titleFontSize', 'sliderDevPanelTitleFontSize', 'sliderMobileDevPanelTitleFontSize', 'sliderLandscapeDevPanelTitleFontSize'],
        ['tabFontSize', 'sliderDevPanelTabFontSize', 'sliderMobileDevPanelTabFontSize', 'sliderLandscapeDevPanelTabFontSize'],
        ['groupTitleFontSize', 'sliderDevPanelGroupTitleFontSize', 'sliderMobileDevPanelGroupTitleFontSize', 'sliderLandscapeDevPanelGroupTitleFontSize'],
        ['settingTitleFontSize', 'sliderDevPanelSettingTitleFontSize', 'sliderMobileDevPanelSettingTitleFontSize', 'sliderLandscapeDevPanelSettingTitleFontSize'],
        ['buttonTextBorder', 'sliderDevPanelButtonTextBorder', 'sliderMobileDevPanelButtonTextBorder', 'sliderLandscapeDevPanelButtonTextBorder'],
        ['scrollStrength', 'sliderDevPanelScrollStrength', 'sliderMobileDevPanelScrollStrength', 'sliderLandscapeDevPanelScrollStrength'],
        ['buttonHeight', 'sliderDevPanelButtonHeight', 'sliderMobileDevPanelButtonHeight', 'sliderLandscapeDevPanelButtonHeight'],
        ['valueFontSize', 'sliderDevPanelValueFontSize', 'sliderMobileDevPanelValueFontSize', 'sliderLandscapeDevPanelValueFontSize'],
        // Added 2026-09-14, porting Clicko's own current Dev Panel group.
        ['titleLetterSpacing', 'sliderDevPanelTitleLetterSpacing', 'sliderMobileDevPanelTitleLetterSpacing', 'sliderLandscapeDevPanelTitleLetterSpacing'],
        ['titleLineHeight', 'sliderDevPanelTitleLineHeight', 'sliderMobileDevPanelTitleLineHeight', 'sliderLandscapeDevPanelTitleLineHeight'],
        ['tabLineHeight', 'sliderDevPanelTabLineHeight', 'sliderMobileDevPanelTabLineHeight', 'sliderLandscapeDevPanelTabLineHeight'],
        ['groupLineHeight', 'sliderDevPanelGroupLineHeight', 'sliderMobileDevPanelGroupLineHeight', 'sliderLandscapeDevPanelGroupLineHeight'],
        ['settingsLineHeight', 'sliderDevPanelSettingsLineHeight', 'sliderMobileDevPanelSettingsLineHeight', 'sliderLandscapeDevPanelSettingsLineHeight'],
        ['buttonLineHeight', 'sliderDevPanelButtonLineHeight', 'sliderMobileDevPanelButtonLineHeight', 'sliderLandscapeDevPanelButtonLineHeight'],
        ['buttonFontSize', 'sliderDevPanelButtonFontSize', 'sliderMobileDevPanelButtonFontSize', 'sliderLandscapeDevPanelButtonFontSize'],
    ];
    const DEV_PANEL_STYLE_COLOR_KEYS = [
        ['bgColor', 'colorDevPanelBg'], ['titleTextColor', 'colorDevPanelTitleText'], ['nonTitleTextColor', 'colorDevPanelNonTitleText'],
        ['accentColor', 'colorDevPanelAccent'], ['sliderColor', 'colorDevPanelSliderColor'], ['groupLabelBgColor', 'colorDevPanelGroupLabelBg'],
        ['groupTextColor', 'colorDevPanelGroupText'], ['buttonTextColor', 'colorDevPanelButtonText'],
        ['settingNumberColor', 'colorDevPanelSettingNumber'], ['tabTextColor', 'colorDevPanelTabText'],
        // Added 2026-09-28, direct request.
        ['accentColor2', 'colorDevPanelAccent2'], ['buttonColor', 'colorDevPanelButtonColor'], ['accentColor3', 'colorDevPanelAccent3'],
    ];
    // Restores every Dev-Panel-style control's own DOM state (slider
    // handle position + its .dev-value readout, color picker swatch,
    // font <select>, every checkbox) from devPanelStyle/mobile.../
    // landscape... - a real, pre-existing gap found while building
    // [JS-13b]: applyDevPanelOwnStyling() only ever pushes these into
    // CSS custom properties, never into the CONTROLS' own DOM (confirmed
    // live - Reset, and now Use/Set-as-Default, changed the panel's
    // actual rendered look correctly but left every Dev-Panel-style
    // slider/color/checkbox showing its PRE-reset position/value until
    // separately touched). Call this anywhere devPanelStyle-family state
    // just changed out from under the DOM (applyFullDevPanelState()
    // below) - safe to call even before the panel's been built at all
    // (ensureDevPanelBuilt() lazy-build), since every lookup here already
    // no-ops on a missing element.
    function syncDevPanelStyleControlsFromState() {
        DEV_PANEL_STYLE_SLIDER_KEYS.forEach(([key, deskId, mobId, landId]) => {
            [[deskId, devPanelStyle], [mobId, mobileDevPanelStyle], [landId, landscapeDevPanelStyle]].forEach(([id, store]) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.value = store[key];
                const valEl = document.getElementById(id.replace('slider', 'value'));
                if (valEl && !valEl.querySelector('input')) valEl.textContent = el.value;
            });
        });
        // Opacity is shared/desktop-only (see DEV_PANEL_STYLE_SHARED_KEYS)
        // and wired as its own standalone case in setupDevPanelStyleControls()
        // - never part of the per-tab DEV_PANEL_STYLE_SLIDER_KEYS loop above,
        // so it needs the same standalone treatment here too.
        const opacityEl = document.getElementById('sliderDevPanelOpacity');
        if (opacityEl) {
            opacityEl.value = devPanelStyle.opacity;
            const valEl = document.getElementById('valueDevPanelOpacity');
            if (valEl && !valEl.querySelector('input')) valEl.textContent = opacityEl.value;
        }
        DEV_PANEL_STYLE_COLOR_KEYS.forEach(([key, id]) => {
            const el = document.getElementById(id);
            if (el) el.value = devPanelStyle[key];
        });
        const fontEl = document.getElementById('selectDevPanelFontFamily');
        if (fontEl) fontEl.value = devPanelStyle.fontFamily;
        Object.entries(DEV_PANEL_CAPS_CHECKBOX_KEYS).forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!devPanelStyle[key];
        });
        // Text Edit Mode's own visual sync moved to
        // setupDevHeaderIconButtons() (it's a header icon button now, not
        // a checkbox rendered by this function).
    }
    function renderDevPanelStyleControls() {
        DEVPANEL_STYLE_CONTROLS.forEach(ctrl => {
            const content = findGroupContent(ctrl.tab, ctrl.group, 'renderDevPanelStyleControls', ctrl.id);
            if (!content) return;
            // skipDeviceCheckbox: true - see buildUniformControlRow()'s
            // own comment for why the Dev-Panel-self-styling system is
            // excluded from the universal checkbox feature.
            const row = buildUniformControlRow(Object.assign({}, ctrl, { skipDeviceCheckbox: true }));
            content.appendChild(row);
            if (ctrl.id === 'selectDevPanelFontFamily') row.querySelector('select').value = devPanelStyle.fontFamily;
            else if (ctrl.id in DEV_PANEL_CAPS_CHECKBOX_KEYS) row.querySelector('input').checked = !!devPanelStyle[DEV_PANEL_CAPS_CHECKBOX_KEYS[ctrl.id]];
        });
    }
    // Default nested subgroup arrangement for the built-in "Dev Panel"
    // group - per direct request (2026-09-14): "I want this specifically
    // integrated into the Dev Panel Template... our current Dev Panel
    // settings will be the standard", porting Clicko's own current live
    // organization (group names, nesting, and row order - confirmed live
    // via its own devTextOverrides/sectionOrder after the user renamed
    // every group). Every control is still REGISTERED flat under the
    // top-level "Dev Panel" group (findGroupContent only ever resolves a
    // TOP-LEVEL group - see its own comment - nesting is always a runtime
    // construct, built by relocating already-rendered rows, exactly how
    // Clicko's own structure was actually built via drag-and-drop, never
    // hardcoded HTML). This reuses createDevGroupElement() (the same
    // function "+ Add Group"/applySectionOrder() use) to build 3 top-
    // level subgroups - MECHANICS (Scroll Speed), PANEL UI (background/
    // accent/slider color, opacity), and TEXT (font family) - with TEXT
    // itself nesting 5 further subgroups, one per text category (Dev
    // Panel Title, Group Title, Setting Title, TABS, BUTTONS), each
    // holding that category's own Bold/Capitalize/Font-Size/Letter-
    // Spacing/Line-Spacing/Color battery. Idempotent - checks for its own
    // MECHANICS marker group before doing anything, so a later real
    // reorganization (the user dragging things around, or a saved/synced
    // order loading afterward) is never clobbered by a repeat call.
    function applyDefaultDevPanelSubgroupOrder(tab) {
        const tabEl = document.getElementById(tab + 'TabContent');
        if (!tabEl) return;
        const devPanelSec = Array.from(tabEl.querySelectorAll(':scope > .dev-section')).find(s => {
            const t = s.querySelector(':scope > .dev-section-title');
            return t && (t.dataset.sid || t.textContent.replace(/^[\u25bc\u25b6]\s*/, '')) === 'Dev Panel';
        });
        if (!devPanelSec) return;
        const content = devPanelSec.querySelector(':scope > .dev-section-content');
        if (!content || content.querySelector(':scope > .dev-section[data-sid="MECHANICS"]')) return;
        const rowsByKey = {};
        content.querySelectorAll(':scope > .dev-row [id]').forEach(el => { rowsByKey[el.id] = el.closest('.dev-row'); });
        function makeGroup(name, ids, parentContent) {
            const g = createDevGroupElement(name, tab);
            parentContent.appendChild(g);
            const gc = g.querySelector(':scope > .dev-section-content');
            ids.forEach(id => { const row = rowsByKey[id]; if (row) gc.appendChild(row); });
            return g;
        }
        const p = tab === 'desktop' ? 'sliderDevPanel' : tab === 'mobile' ? 'sliderMobileDevPanel' : 'sliderLandscapeDevPanel';
        makeGroup('MECHANICS', [p + 'ScrollStrength'], content);
        makeGroup('PANEL UI', ['colorDevPanelBg', 'colorDevPanelAccent', 'colorDevPanelAccent2', 'colorDevPanelAccent3', 'colorDevPanelButtonColor', 'colorDevPanelSliderColor', p + 'Opacity'], content);
        const text = makeGroup('TEXT', ['selectDevPanelFontFamily'], content);
        const textContent = text.querySelector(':scope > .dev-section-content');
        makeGroup('Dev Panel Title', ['checkboxDevBoldTitle', 'checkboxDevCapsTitleText', p + 'TitleFontSize', p + 'TitleLetterSpacing', p + 'TitleLineHeight', p + 'ButtonTextBorder', 'colorDevPanelTitleText'], textContent);
        makeGroup('Group Title', ['checkboxDevBoldGroup', 'checkboxDevCapsGroupNames', p + 'GroupTitleFontSize', 'sliderDevGroupTextLetterSpacing', p + 'GroupLineHeight', 'colorDevPanelGroupText', 'colorDevPanelGroupLabelBg'], textContent);
        makeGroup('Setting Title', ['checkboxDevCapsSettingsText', 'checkboxDevBoldSettings', p + 'SettingTitleFontSize', p + 'ValueFontSize', p + 'SettingsLineHeight', 'sliderDevSettingsTextLetterSpacing', 'colorDevPanelNonTitleText', 'colorDevPanelSettingNumber'], textContent);
        makeGroup('TABS', ['checkboxDevBoldTab', 'checkboxDevCapsTabText', p + 'TabFontSize', 'sliderDevTabTextLetterSpacing', p + 'TabLineHeight', 'colorDevPanelTabText'], textContent);
        makeGroup('BUTTONS', ['checkboxDevBoldButton', 'checkboxDevCapsButtonText', p + 'ButtonFontSize', 'sliderDevButtonTextLetterSpacing', p + 'ButtonLineHeight', 'colorDevPanelButtonText', p + 'ButtonHeight'], textContent);
    }

    function setupDevPanelStyleControls() {
        DEV_PANEL_STYLE_SLIDER_KEYS.forEach(([key, deskId, mobId, landId]) => {
            [[deskId, devPanelStyle, 'desktop'], [mobId, mobileDevPanelStyle, 'mobile'], [landId, landscapeDevPanelStyle, 'landscape']].forEach(([id, store, tab]) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('input', (e) => {
                    store[key] = parseFloat(e.target.value);
                    applyDevPanelOwnStyling(tab);
                    const valEl = document.getElementById(id.replace('slider', 'value'));
                    if (valEl) valEl.textContent = e.target.value;
                });
            });
        });
        const opacityEl = document.getElementById('sliderDevPanelOpacity');
        if (opacityEl) opacityEl.addEventListener('input', (e) => {
            devPanelStyle.opacity = parseFloat(e.target.value);
            applyDevPanelOwnStyling('desktop');
            const valEl = document.getElementById('valueDevPanelOpacity');
            if (valEl) valEl.textContent = e.target.value;
        });
        DEV_PANEL_STYLE_COLOR_KEYS.forEach(([key, id]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', (e) => { devPanelStyle[key] = e.target.value; applyDevPanelOwnStyling('desktop'); });
        });
        const fontEl = document.getElementById('selectDevPanelFontFamily');
        if (fontEl) fontEl.addEventListener('change', (e) => { devPanelStyle.fontFamily = e.target.value; applyDevPanelOwnStyling('desktop'); });
        [['capsButtonText', 'checkboxDevCapsButtonText'], ['capsTabText', 'checkboxDevCapsTabText'],
         ['capsGroupNames', 'checkboxDevCapsGroupNames'], ['capsSettingsText', 'checkboxDevCapsSettingsText'],
         ['titleCapitalize', 'checkboxDevCapsTitleText'], ['titleBold', 'checkboxDevBoldTitle'],
         ['tabBold', 'checkboxDevBoldTab'], ['buttonBold', 'checkboxDevBoldButton'],
         ['settingsBold', 'checkboxDevBoldSettings'], ['groupBold', 'checkboxDevBoldGroup']].forEach(([key, id]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', (e) => { devPanelStyle[key] = e.target.checked; applyDevPanelOwnStyling('desktop'); });
        });
        // Text Edit Mode's own wiring moved to setupDevHeaderIconButtons()
        // (2026-09-16) - it's a header icon button now, always present
        // regardless of ensureDevPanelBuilt()'s lazy build, so it's set up
        // once from initDevPanelEngine() instead of here.

        const scrollContent = document.querySelector('.dev-panel-scroll-content');
        if (scrollContent) scrollContent.addEventListener('wheel', (e) => {
            const activeTab = DEV_PANEL_TABS.find(t => !document.getElementById(t + 'TabContent').classList.contains('hidden')) || 'desktop';
            const strength = (activeTab === 'desktop' ? devPanelStyle : activeTab === 'mobile' ? mobileDevPanelStyle : landscapeDevPanelStyle).scrollStrength;
            if (strength === 1) return;
            e.preventDefault();
            scrollContent.scrollTop += e.deltaY * strength;
        }, { passive: false });
    }

    // ================================================================
    // [JS-13] COPY / SAVE / RESET
    // ================================================================
    // Copy / Save / Reset — generic by default, backed by localStorage.
    // Captures/restores every control from every array registered via
    // registerDevControlArray(), by id, generically (works for any
    // slider/color/checkbox/select/text input regardless of what
    // project-specific state it's wired to) — plus this panel's own
    // layout/style/order/text-override/text-edit-mode state.
    //
    // Swap this out for a project-specific backend (e.g. the git-synced
    // Vercel pipeline, CLAUDE.md Section 12l) by replacing
    // saveDevPanelSettings()/loadDevPanelSettings() - the shape of
    // captureAllRegisteredControlValues()'s output (a flat {id: value}
    // object) is a reasonable wire format to keep either way.
    // ----------------------------------------------------------------
    const DEV_PANEL_LOCALSTORAGE_KEY = 'devPanelSettings';

    // ---- Remote (git-tracked) Save: CLAUDE.md S12l -----------------------------
    // Sync (Save) POSTs the whole panel state to /api/save-settings, which commits it to
    // data/processed/dev-panel-settings.json in GitHub; page load and Reset GET it back.
    // Behaviour ported from HANDO / HANDY DANDIES (their working save): SINGLE-TIER --
    // when the endpoint is unreachable or misconfigured Save shows an honest error rather
    // than silently writing to localStorage, so a broken remote save is never mistaken
    // for a working one. localStorage only holds a pre-existing local copy for boot.
    const DEV_PANEL_REMOTE_ENDPOINT = '/api/save-settings';
    // The anti-abuse shared token: must equal the DEV_PANEL_SAVE_SECRET environment variable on Vercel.
    // Same arrangement as HANDO / HANDY DANDIES (their working save), at the owner's explicit request:
    //   - reference copy: J:\CLAUDE\PROJECTS\keyps.txt, label DEV_PANEL_SAVE_SECRET (untracked, outside this repo)
    //   - Vercel environment variable DEV_PANEL_SAVE_SECRET (read by api/save-settings.js)
    //   - this client constant (sent with every Save). It is visible to anyone who opens the page source;
    //     it only gates commits to the settings file, it is not a GitHub credential.
    // The GitHub token (keyps.txt label GOTHOT = env var GITHUB_TOKEN) is NEVER in client code: only the Vercel function uses it.
    const DEV_PANEL_SAVE_SECRET = 'PkrbMti03M6xm3FEThYXa8gGW_08BOGj';
    const DEV_PANEL_SECRET_LS_KEY = 'devPanelSaveSecret';
    function getDevPanelSaveSecret(forcePrompt) {
        if (DEV_PANEL_SAVE_SECRET) return DEV_PANEL_SAVE_SECRET;
        let s = '';
        try { if (!forcePrompt) s = localStorage.getItem(DEV_PANEL_SECRET_LS_KEY) || ''; } catch (e) { /* storage blocked */ }
        if (!s) {
            s = (window.prompt('Dev panel save secret (the DEV_PANEL_SAVE_SECRET value set on Vercel). It is stored in this browser only, never in the repo:') || '').trim();
            if (s) { try { localStorage.setItem(DEV_PANEL_SECRET_LS_KEY, s); } catch (e) { /* storage blocked */ } }
        }
        return s;
    }
    // gzip + base64 transport (Vercel caps bodies at 4.5 MB); plain JSON when CompressionStream is missing.
    async function devPanelGzipBase64(text) {
        const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    }
    async function devPanelGunzipBase64(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text());
    }
    // Resolves { ok, settings, status, error }; status 0 = network failure. Never throws.
    async function fetchRemoteDevSettings() {
        try {
            const resp = await fetch(DEV_PANEL_REMOTE_ENDPOINT + '?gz=1', { cache: 'no-store' });
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok || body.ok !== true) return { ok: false, settings: null, status: resp.status, error: body.error };
            if (typeof body.gz === 'string') return { ok: true, settings: await devPanelGunzipBase64(body.gz), status: 200 };
            return { ok: true, settings: body.settings || null, status: 200 };
        } catch (e) { return { ok: false, settings: null, status: 0, error: 'offline/unreachable' }; }
    }
    // Resolves { ok, status, error }. Never throws.
    async function postRemoteDevSettings(secret, obj) {
        try {
            const json = JSON.stringify(obj);
            const payload = (typeof CompressionStream === 'function') ? JSON.stringify({ gz: await devPanelGzipBase64(json) }) : json;
            const resp = await fetch(DEV_PANEL_REMOTE_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Dev-Panel-Secret': secret },
                body: payload,
            });
            const body = await resp.json().catch(() => ({}));
            if (resp.ok && body.ok === true) return { ok: true, status: resp.status };
            return { ok: false, status: resp.status, error: body.error || ('HTTP ' + resp.status) };
        } catch (e) { return { ok: false, status: 0, error: 'offline/unreachable' }; }
    }
    // Boot-time restore: retries (500 ms doubling to a 10 s cap) ONLY while the network
    // itself is failing -- the fetch can lose to a flaky mobile connection. Once the
    // server answers at all (even "not configured" or "nothing saved yet") it stops, so a
    // local dev server without GitHub credentials doesn't poll forever.
    async function fetchRemoteDevSettingsWhenReachable(onDone) {
        if (location.protocol === 'file:') return;
        let delay = 500;
        for (;;) {
            const got = await fetchRemoteDevSettings();
            if (got.status !== 0) { onDone(got); return; }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 2, 10000);
        }
    }

    function captureAllRegisteredControlValues() {
        const out = {};
        DEV_PANEL_REGISTERED_ARRAYS.forEach(({ array }) => {
            array.forEach(ctrl => {
                const el = document.getElementById(ctrl.id);
                if (!el) return;
                out[ctrl.id] = el.type === 'checkbox' ? el.checked : (el.type === 'range' || el.type === 'number') ? parseFloat(el.value) : el.value;
            });
        });
        return out;
    }
    function applyControlValues(values) {
        if (!values) return;
        Object.entries(values).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
            el.dispatchEvent(new Event(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
        });
    }
    function captureFullDevPanelState() {
        // Undock is session-only/never persisted (see dockAllUndockedGroups()'s
        // own comment) - dock everything back first so nothing captured
        // below is silently missing a group that currently lives inside a
        // floating panel instead of its normal tab location.
        dockAllUndockedGroups();
        return {
            controls: captureAllRegisteredControlValues(),
            layout: { ...DEV_PANEL_LAYOUT },
            devPanelStyle: { ...devPanelStyle },
            mobileDevPanelStyle: { ...mobileDevPanelStyle },
            landscapeDevPanelStyle: { ...landscapeDevPanelStyle },
            sectionOrder: captureSectionOrder(),
            sectionCollapseState: captureSectionCollapseState(),
            devTextOverrides: { ...devTextOverrides },
            devTextOverridesManual: Array.from(devTextOverridesManual),
            lockedGroups: Array.from(lockedGroups),
            lockedSliderBounds: Array.from(lockedSliderBounds),
            textEditModeEnabled,
            // Assigned hotkeys (added 2026-10-04: they used to be lost on every reload).
            hotkeys: { ...devHotkeys },
            // Dynamic Mobile/Landscape visibility/independence state
            // ([JS-4b0] above) - NOT covered by `controls` above (a
            // dynamically-created row's own ctrl object is never passed
            // to registerDevControlArray(), so captureAllRegisteredControlValues()
            // never sees it) - deliberately: a non-independent row's
            // live value is always just Desktop's own (already captured
            // normally, via `controls`), and an independent row's is
            // devDeviceValues below, so nothing is actually missing.
            devVisibility: { ...devVisibility },
            devIndependence: { mobile: { ...devIndependence.mobile }, landscape: { ...devIndependence.landscape } },
            devDeviceValues: { mobile: { ...devDeviceValues.mobile }, landscape: { ...devDeviceValues.landscape } },
            // Per-mode memory of shared sliders (SPOTTY EXPOTTY, see "Per-mode settings memory" in renderSpottyDevControls):
            // rides along with Copy / Sync / Reset / Undo / Saved Dev Settings like every other captured field.
            perMode: typeof window.spxCapturePerMode === 'function' ? window.spxCapturePerMode() : undefined,
        };
    }
    function applyFullDevPanelState(state) {
        if (!state) return;
        window.__spxPerModeRestoring = true; // restore events must not be recorded as the user changing a mode's values
        setTimeout(() => { window.__spxPerModeRestoring = false; }, 1000); // safety net if anything below throws
        applyControlValues(state.controls);
        // Restore BEFORE syncTabOrderToDesktop() runs below (via
        // applySectionOrder() -> nothing yet, this is a separate call) -
        // devVisibility/devIndependence/devDeviceValues must already be
        // in place before rows get dynamically rebuilt, or every dynamic
        // row would rebuild against stale (default) flags.
        if (state.devVisibility) devVisibility = { ...state.devVisibility };
        if (state.devIndependence) devIndependence = { mobile: { ...(state.devIndependence.mobile || {}) }, landscape: { ...(state.devIndependence.landscape || {}) } };
        if (state.devDeviceValues) devDeviceValues = { mobile: { ...(state.devDeviceValues.mobile || {}) }, landscape: { ...(state.devDeviceValues.landscape || {}) } };
        if (state.layout) { Object.assign(DEV_PANEL_LAYOUT, state.layout); applyDevPanelLayout(); }
        if (state.devPanelStyle) Object.assign(devPanelStyle, state.devPanelStyle);
        if (state.mobileDevPanelStyle) Object.assign(mobileDevPanelStyle, state.mobileDevPanelStyle);
        if (state.landscapeDevPanelStyle) Object.assign(landscapeDevPanelStyle, state.landscapeDevPanelStyle);
        applyDevPanelOwnStyling(DEV_PANEL_TABS.find(t => !document.getElementById(t + 'TabContent').classList.contains('hidden')) || 'desktop');
        if (state.devTextOverrides) devTextOverrides = { ...state.devTextOverrides };
        // Defaults to empty for state saved before this field existed -
        // see devTextOverridesManual's own comment above.
        if (state.devTextOverridesManual) devTextOverridesManual = new Set(state.devTextOverridesManual);
        applyDevTextOverrides();
        if (state.lockedGroups) lockedGroups = new Set(state.lockedGroups);
        if (devPanelBuilt) injectGroupLockIcons();
        if (state.lockedSliderBounds) lockedSliderBounds = new Set(state.lockedSliderBounds);
        if (devPanelBuilt) refreshSliderBoundLockDisplay();
        if (typeof state.textEditModeEnabled === 'boolean') textEditModeEnabled = state.textEditModeEnabled;
        // Only when the saved state carries hotkeys: an older save must not wipe the current ones.
        if (state.hotkeys && typeof state.hotkeys === 'object') { devHotkeys = { ...state.hotkeys }; if (devPanelBuilt) renderAllHotkeyBadges(); }
        // Pushes everything just reassigned above (devPanelStyle/mobile/
        // landscape, textEditModeEnabled) into the CONTROLS' own DOM -
        // applyDevPanelOwnStyling() above only ever updated CSS custom
        // properties, never the sliders/colors/checkboxes themselves -
        // see this function's own comment for the bug this closes.
        syncDevPanelStyleControlsFromState();
        applySectionOrder(state.sectionOrder);
        applySectionCollapseState(state.sectionCollapseState);
        // Re-derives Mobile/Landscape from Desktop's now-restored order +
        // the devVisibility/devIndependence/devDeviceValues just restored
        // above - creates any dynamic row that doesn't exist in the DOM
        // yet (e.g. a fresh page load) and seeds its value correctly,
        // same call switchDevPanelTab() already makes on every tab open -
        // just needed here too since a restore isn't necessarily
        // followed by opening either tab.
        syncTabOrderToDesktop('mobile');
        syncTabOrderToDesktop('landscape');
        // Re-syncs row checkboxes' own .checked from the just-restored
        // devVisibility/devIndependence BEFORE recomputing group cascade
        // state from them - see syncDeviceCheckboxesFromState()'s own
        // comment ([JS-4b0] above) for the bug this closes.
        syncDeviceCheckboxesFromState();
        refreshEmptyGroupVisibility('mobile');
        refreshEmptyGroupVisibility('landscape');
        refreshAllGroupCascadeCheckboxes();
        if (state.perMode && typeof window.spxApplyPerMode === 'function') window.spxApplyPerMode(state.perMode);
        window.__spxPerModeRestoring = false;
        // The Mobile/Landscape twin rows exist only now, after the restore above. Anything the app reads through a twin (e.g. the cover's
        // Y offset on a phone) was computed while they were missing, so the app re-applies its look once they exist.
        document.dispatchEvent(new Event('spx-devrows-ready'));
    }
    function copyDevPanelSettings() {
        const text = JSON.stringify(captureFullDevPanelState(), null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => window.prompt('Copy:', text));
        } else {
            window.prompt('Copy:', text);
        }
    }
    // Same data as copyDevPanelSettings() (the whole panel's own captured
    // state) but downloaded as a .json file instead of put on the
    // clipboard — direct request 2026-10-06, for the Saved Dev Settings
    // group's own Save/Use/Delete/Set Default row ("provide a new button
    // export button which is the same as the copy button, but it exports
    // the settings in a text or json or whatever file").
    function exportDevPanelSettings() {
        const text = JSON.stringify(captureFullDevPanelState(), null, 2);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dev-panel-settings.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
    // Flashes the HEADER Sync button itself (devHeaderSyncBtn) with a
    // temporary checkmark/X and tooltip - ported from Clicko (2026-09-19,
    // "for the save button on the top panel, shwo some sort of indication
    // of 'Saved' after i click it"). The original bottom SYNC button
    // already has feedback via #devSaveSyncStatus below, but that status
    // text lives at the BOTTOM of the panel - not visible without
    // scrolling back up, defeating the whole point of the header button
    // existing (see its own "add a Sync button in the header too"
    // comment).
    function flashDevHeaderSyncStatus(success, message) {
        const btn = document.getElementById('devHeaderSyncBtn');
        if (!btn) return;
        if (btn._syncFlashTimeout) clearTimeout(btn._syncFlashTimeout);
        btn.textContent = success ? '✅' : '❌';
        btn.title = message || (success ? 'Saved!' : 'Save failed');
        btn._syncFlashTimeout = setTimeout(() => {
            btn.textContent = '💾';
            btn.title = 'Sync (Save)';
        }, 1800);
    }
    async function saveDevPanelSettings() {
        const status = document.getElementById('devSaveSyncStatus');
        try {
            const payload = captureFullDevPanelState();
            // Folds in any host state OUTSIDE the dev panel's own
            // registered controls (devSaveCaptureExtra, above) so Save
            // captures it too, not just Undo/Redo.
            if (devSaveCaptureExtra) payload.extra = devSaveCaptureExtra();
            // Remote save (see the [Remote Save] block above): GitHub via /api/save-settings,
            // NOT localStorage. A 401 means the stored secret is wrong: ask again once.
            if (status) status.textContent = 'saving...';
            let secret = getDevPanelSaveSecret(false);
            if (!secret) throw new Error('no save secret entered');
            let result = await postRemoteDevSettings(secret, payload);
            if (!result.ok && result.status === 401) {
                secret = getDevPanelSaveSecret(true);
                if (!secret) throw new Error('no save secret entered');
                result = await postRemoteDevSettings(secret, payload);
            }
            if (!result.ok) throw new Error(result.error || 'save failed');
            // Saved remotely: drop any stale local copy so it can't override the GitHub one on boot.
            try { localStorage.removeItem(DEV_PANEL_LOCALSTORAGE_KEY); } catch (e) { /* storage blocked */ }
            // A real gap, found and fixed 2026-09-28: this function was
            // ALWAYS meant to draw a hard undo/redo line at every Save
            // ("until i click save, then it starts new again" — see
            // clearDevPanelUndoStack()'s own doc comment), but nothing
            // ever actually called it — Save was, in practice, fully
            // undoable the whole time. Direct confirmation of the
            // intended behavior: "saving should be irreversible, minus
            // the fact that we have a log of the settings history" (the
            // git-tracked settings log, §12l, is that history — Undo/Redo
            // are session-only and were never meant to reach past a Save).
            clearDevPanelUndoStack();
            if (status) { status.textContent = 'saved to GitHub'; setTimeout(() => { status.textContent = ''; }, 2500); }
            flashDevHeaderSyncStatus(true, 'Saved to GitHub!');
        } catch (e) {
            const msg = (e && e.message) || 'save failed';
            if (status) status.textContent = 'save failed: ' + msg;
            flashDevHeaderSyncStatus(false, 'Save failed: ' + msg);
        }
    }
    function loadDevPanelSettings() {
        try {
            const raw = localStorage.getItem(DEV_PANEL_LOCALSTORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }
    // Single shared restore path for both the Reset button and the
    // boot-time load below — applies the panel's own state, then the
    // host's own extra state (devSaveApplyExtra) if any was saved.
    function applyDevPanelStateWithExtra(data) {
        applyFullDevPanelState(data);
        if (data && data.extra !== undefined && devSaveApplyExtra) devSaveApplyExtra(data.extra);
    }
    async function resetDevPanelSettings() {
        // Restore from GitHub (the saved source of truth); fall back to a local copy only
        // when the server can't be reached or has nothing saved yet.
        const got = await fetchRemoteDevSettings();
        applyDevPanelStateWithExtra(got.ok && got.settings ? got.settings : loadDevPanelSettings());
        renderAllHotkeyBadges();
    }

    // ================================================================
    // [JS-13b] NAMED SETTING STATES (SAVE / USE / RENAME / DELETE / SET DEFAULT)
    // ================================================================
    // Multiple named, full-panel-state snapshots to switch between
    // without losing your actual synced settings - direct request
    // ("I want to try different UI settings but dont want to overwrite
    // old settings... Refer to Hando project for this Save Use Delete
    // Set Default functionality"). Generalizes Hando's own
    // buildListPickerRow() (Save/Use/Rename/Delete for ONE named-item
    // control, e.g. its Camera/Pose presets - see devPanel.js) up to the
    // WHOLE PANEL's state instead - "different setting states" (plural,
    // whole states), not a per-control preset list, so this reuses
    // captureFullDevPanelState()/applyFullDevPanelState() (the exact
    // snapshot Copy/Sync/Reset already use) as what gets saved/restored.
    //
    // CORRECTED 2026-10-15, direct request ("allow me to rename the saved
    // settings... mobile, landscape, and desktop should share a common
    // list... Indicate the setting set in use and the default one... for
    // all item selectors with a delete button, allow me to select
    // multiple items then click delete"). Was a bespoke <select> + 5
    // onclick-wired functions with none of Rename/multi-delete/Default -
    // rebuilt as a REAL type:'list-picker' registered control
    // (buildSavedDevSettingsListPicker() below), reusing the exact same
    // generic engine every Saved Poses/Cameras/etc. instance already
    // does, instead of re-deriving Rename/multi-delete/Default a second
    // time for this one control. Already shared across all 3 tabs by
    // construction (this whole group sits outside #desktopTabContent/
    // #mobileTabContent/#landscapeTabContent - see the HTML's own
    // comment), and already above the tab buttons in DOM order - both
    // requirements were free consequences of this group's existing
    // placement, not new work.
    //
    // Save/Use/Rename/Delete behave exactly as the generic engine already
    // does (overwrite-confirm on a duplicate name, multi-select delete,
    // etc.) Default (new, CLAUDE.md-equivalent to every other list-
    // picker's own): auto-applies on every restore (Reset/Undo/Sync-load)
    // - this is what actually makes a marked default "load automatically",
    // replacing the OLD setNamedDevPanelStateAsDefault()'s manual
    // apply-then-saveDevPanelSettings() call (no longer needed: restoring
    // the regular synced settings now ITSELF restores this list-picker's
    // own items/defaultName, whose own restore handler then auto-applies
    // the named default - one mechanism covers both).
    //
    // SELF-REFERENCE GUARD: captureCurrent() strips this control's OWN id
    // out of the controls blob it captures, or saving a settings-set
    // would recursively embed every previously-saved set inside itself,
    // growing unboundedly on each further Save.
    let SAVED_DEV_SETTINGS_ITEMS = [];
    let activeDevSettingsSetName = null;
    function updateActiveDevSettingsIndicator() {
        const el = document.getElementById('devSavedSettingsActiveIndicator');
        if (el) el.textContent = activeDevSettingsSetName ? ('Active: ' + activeDevSettingsSetName) : 'Active: (unsaved/custom)';
    }
    // One-time migration from the OLD bespoke storage key (devPanelSavedStates,
    // a plain {name: capturedState} object) so an existing user's already-
    // saved settings-sets aren't silently lost by this rebuild. Safe to
    // leave in indefinitely — a no-op once migrated (the old key is left
    // in place, unread, rather than deleted, in case anything else ever
    // needs to recover from it).
    function migrateLegacySavedDevPanelStates() {
        if (SAVED_DEV_SETTINGS_ITEMS.length > 0) return; // only if the new list is genuinely empty
        try {
            const raw = localStorage.getItem('devPanelSavedStates');
            if (!raw) return;
            const old = JSON.parse(raw);
            Object.entries(old).forEach(([name, data]) => {
                if (data && typeof data === 'object') SAVED_DEV_SETTINGS_ITEMS.push(Object.assign({ name }, data));
            });
        } catch (e) { /* ignore - nothing to migrate */ }
    }
    let savedDevSettingsListPickerBuilt = false;
    function buildSavedDevSettingsListPicker() {
        if (savedDevSettingsListPickerBuilt) return;
        const container = document.getElementById('devSavedSettingsGroupContent');
        if (!container) return;
        savedDevSettingsListPickerBuilt = true;
        migrateLegacySavedDevPanelStates();
        const activeIndicator = document.createElement('div');
        activeIndicator.id = 'devSavedSettingsActiveIndicator';
        activeIndicator.className = 'dev-list-picker-default-indicator';
        container.appendChild(activeIndicator);
        const ctrl = {
            tab: 'desktop', group: 'Saved Dev Settings', id: 'listPickerSavedDevSettings',
            type: 'list-picker', label: 'Settings Set:', itemLabel: 'Settings Set',
            value: SAVED_DEV_SETTINGS_ITEMS,
            captureCurrent: () => {
                const full = captureFullDevPanelState();
                if (full.controls) delete full.controls['listPickerSavedDevSettings'];
                return full;
            },
            onUse: (item) => {
                applyFullDevPanelState(item);
                activeDevSettingsSetName = item.name;
                updateActiveDevSettingsIndicator();
            },
        };
        // buildUniformControlRow(), not buildListPickerRow() directly -
        // same entry point every other control in this file goes
        // through, so this one picks up whatever else that wrapper does
        // (it also sets ctrl.skipDeviceCheckbox itself, same end result
        // either way, but going through the conventional path is safer
        // than assuming nothing else depends on it).
        const row = buildUniformControlRow(ctrl);
        container.appendChild(row);
        registerDevControlArray('savedDevSettingsControls', [ctrl]);
        const exportCurrentBtn = document.createElement('button');
        exportCurrentBtn.type = 'button';
        exportCurrentBtn.textContent = 'Export Current Settings';
        exportCurrentBtn.className = 'dev-action-button';
        exportCurrentBtn.style.marginTop = '4px';
        exportCurrentBtn.addEventListener('click', exportDevPanelSettings);
        container.appendChild(exportCurrentBtn);
        updateActiveDevSettingsIndicator();
    }

    // ================================================================
    // [JS-13c] MOUSE LOG (built-in "Debug" group feature)
    // ================================================================
    // Per direct request (2026-09-14): a live log of mouse/touch position,
    // click type, and what it hit - lives inside the built-in "Debug"
    // group (CLAUDE.md 12i-1), a SIBLING of "Dev Panel", both mandatory
    // built-in groups now. Referenced DickoClicko's own "CLICK LOG"
    // (structured {event, data} pairs, DOM-per-line, clipboard-only) and
    // Handy Dandies' own "Mouse Tracking Log" (Debug-group placement, a
    // sampling-interval slider for an optional continuous position
    // stream, array-backed) per direct pointer to both - this version
    // extends past either: touch gesture classification (tap/double-tap/
    // long-press/swipe/pinch, neither reference has any), device/viewport
    // context entries, and a Save-to-file export (both references are
    // clipboard-only).
    //
    // SINGLE INSTANCE, not tripled per tab: there is exactly one real
    // mouse/touch input stream in the browser regardless of which Desktop/
    // Mobile/Landscape tab happens to be showing, so the widget (checkbox,
    // slider, buttons, live display) is only ever built once, inside
    // Desktop's own Debug group - Mobile/Landscape still get their own
    // built-in Debug group (per the "must include" mandate), just without
    // their own separate copy of this specific widget.
    //
    // Unified mouse+touch capture via Pointer Events (pointerdown/move/up/
    // cancel on window) - e.pointerType ('mouse'/'touch'/'pen') is the
    // input-source axis; isNarrowViewport() is the separate device/layout
    // axis (a touch-capable laptop at a wide viewport still logs as
    // "desktop" device context) - CLAUDE.md 12i-1 documents why both are
    // tracked, not merged into one field.
    const MOUSE_LOG_MAX_ENTRIES = 500;
    const MOUSE_LOG_HOLD_MS = 500;
    const MOUSE_LOG_MULTICLICK_MS = 350;
    const MOUSE_LOG_MOVE_THRESHOLD_PX = 10;
    let mouseLog = [];
    let mouseLogEl = null;
    let mouseLogPositionEnabled = false;
    let mouseLogPositionIntervalMs = 1000;
    let mouseLogPositionTimer = null;
    // Both default OFF (opt-in), matching Log Mouse Position's own
    // default - per direct request (Clicko project, 2026-09-15:
    // "provide a checkbox to turn on and off scroll logging" / "provide
    // a checkbox to log keystrokes too"). Scroll events are high-volume/
    // noisy the same way continuous position sampling is; keystrokes are
    // additionally privacy-sensitive (could capture real typed text in a
    // rename/text box), so opt-in is the more conservative default there
    // too.
    let mouseLogScrollEnabled = false;
    let mouseLogKeystrokesEnabled = false;
    let mouseLogLastPointerPos = null;
    let mouseLogLastViewport = null;
    const mouseLogActivePointers = new Map();
    let mouseLogClickCount = 0;
    let mouseLogClickTimer = null;
    let mouseLogHoldTimer = null;
    let mouseLogPinchStartDist = null;
    let mouseLogPinchActive = false;

    function mouseLogDeviceContext() { return isNarrowViewport() ? 'mobile' : 'desktop'; }
    function formatMouseLogTime(d) {
        const pad2 = n => String(n).padStart(2, '0');
        const pad3 = n => String(n).padStart(3, '0');
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' + pad3(d.getMilliseconds());
    }
    // Resolves WHAT a mouse/touch action hit - a Dev Panel control (by its
    // own .dev-label text, or a button's own text) vs. something in the
    // project's own app/game area (by id, else tag+first-class, else
    // "(background)") - and a best-effort "triggered" guess: true for any
    // genuinely interactive element (button/input/select/textarea/a[href]/
    // [onclick]/label), false otherwise. Per the request's own "(maybe)"
    // hedge on this part - a real success/failure signal isn't generically
    // knowable here, this is a structural guess, not app-logic awareness.
    // Reads back the CURRENT value of a form control for the Mouse Log's
    // own "what input" detail - per direct request ("when it logs what
    // function was triggered. I need more information than just 'set
    // dev panel setting'. I need it to say what setting and what
    // input."). Only meaningful for actual form controls (range/color/
    // text/number inputs, checkboxes, selects) - null for anything
    // else (a button, a group title bar), which describeMouseLogTarget
    // below then leaves off the log line entirely rather than printing
    // a hollow "= null".
    function describeMouseLogControlValue(el) {
        if (!el || !el.tagName) return null;
        const tag = el.tagName;
        if (tag === 'SELECT') {
            const opt = el.options[el.selectedIndex];
            return opt ? opt.text : el.value;
        }
        if (tag === 'INPUT') {
            const type = (el.type || '').toLowerCase();
            if (type === 'checkbox') return el.checked ? 'checked' : 'unchecked';
            if (type === 'range' || type === 'number' || type === 'color') return el.value;
            if (type === 'text') return '"' + el.value.slice(0, 30) + '"';
        }
        if (tag === 'TEXTAREA') return '"' + el.value.slice(0, 30) + '"';
        return null;
    }
    function describeMouseLogTarget(el) {
        if (!el || el === document.documentElement || el === document.body) return { target: '(background)', triggered: false };
        const inPanel = el.closest && el.closest('.dev-panel');
        if (inPanel) {
            const row = el.closest('.dev-row');
            const label = row && row.querySelector('.dev-label');
            const btn = el.closest('button');
            const titleEl = el.closest('.dev-section-title');
            const name = label ? label.textContent.trim() : btn ? btn.textContent.trim() : titleEl ? '(group) ' + titleEl.textContent.replace(/^[▼▶]\s*/, '').trim() : (el.id || el.tagName.toLowerCase());
            const interactive = !!(btn || titleEl || el.matches('input, select, textarea, [onclick]'));
            // The actual form control a row's own value lives on isn't
            // always e.target itself (a slider's wheel/click can land on
            // its .dev-label instead) - fall back to the row's own
            // control when el itself isn't one.
            const control = el.matches('input, select, textarea') ? el : (row && row.querySelector('input, select, textarea'));
            const value = describeMouseLogControlValue(control);
            return { target: 'Dev Panel: ' + name + (value !== null ? ' = ' + value : ''), triggered: interactive };
        }
        const interactiveEl = el.closest && el.closest('button, a[href], input, select, textarea, [onclick], label');
        if (interactiveEl) {
            const id = interactiveEl.id ? '#' + interactiveEl.id : '';
            const text = (interactiveEl.textContent || '').trim().slice(0, 30);
            return { target: 'App: ' + interactiveEl.tagName.toLowerCase() + id + (text ? ' "' + text + '"' : ''), triggered: true };
        }
        const id = el.id ? '#' + el.id : '';
        const cls = el.className && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
        return { target: 'App: ' + el.tagName.toLowerCase() + id + cls, triggered: false };
    }
    function renderMouseLogEntry(entry) {
        if (!mouseLogEl) return;
        const empty = mouseLogEl.querySelector('.dev-mouse-log-empty');
        if (empty) empty.remove();
        const line = document.createElement('div');
        let text = entry.time + '  [' + entry.device + '/' + entry.pointerType + ']  ' + entry.type + '  (' + entry.x + ', ' + entry.y + ')';
        if (entry.target) text += '  -> ' + entry.target;
        if (entry.triggered === true) text += '  [OK]';
        else if (entry.triggered === false) text += '  [no-op]';
        if (entry.detail) text += '  ' + entry.detail;
        line.textContent = text;
        mouseLogEl.appendChild(line);
        while (mouseLogEl.children.length > MOUSE_LOG_MAX_ENTRIES) mouseLogEl.removeChild(mouseLogEl.firstChild);
        mouseLogEl.scrollTop = mouseLogEl.scrollHeight;
    }
    function pushMouseLogEntry(entry) {
        if (window.spxLogsPaused) return; // Debug > Pause Logs
        entry.time = formatMouseLogTime(new Date());
        mouseLog.push(entry);
        if (mouseLog.length > MOUSE_LOG_MAX_ENTRIES) mouseLog.shift();
        renderMouseLogEntry(entry);
    }
    // Context entries (device + viewport dims + pixel ratio) - logged once
    // when logging starts, and again whenever the viewport actually
    // changes size (resize/orientation change) while the log has content -
    // per direct request ("include information about whether its desktop
    // or mobile, as well as browser dimensions"), without repeating full
    // viewport info on every single move/click entry (each entry still
    // carries its own compact device tag - see renderMouseLogEntry above).
    function logMouseLogContext(reason) {
        const w = window.innerWidth, h = window.innerHeight;
        if (reason === 'resize' && mouseLogLastViewport && mouseLogLastViewport.w === w && mouseLogLastViewport.h === h) return;
        mouseLogLastViewport = { w, h };
        pushMouseLogEntry({
            type: 'context', x: '-', y: '-', device: mouseLogDeviceContext(), pointerType: '-',
            target: null, triggered: null,
            detail: reason + ': ' + w + 'x' + h + ' dpr:' + (window.devicePixelRatio || 1).toFixed(2),
        });
    }
    function clearMouseLog() {
        mouseLog = [];
        if (mouseLogEl) {
            mouseLogEl.innerHTML = '';
            const empty = document.createElement('div');
            empty.className = 'dev-mouse-log-empty';
            empty.textContent = '(no mouse activity logged yet)';
            mouseLogEl.appendChild(empty);
        }
        mouseLogLastViewport = null;
    }
    function mouseLogEntryToLine(e) {
        let text = e.time + '  [' + e.device + '/' + e.pointerType + ']  ' + e.type + '  (' + e.x + ', ' + e.y + ')';
        if (e.target) text += '  -> ' + e.target;
        if (e.triggered === true) text += '  [OK]';
        else if (e.triggered === false) text += '  [no-op]';
        if (e.detail) text += '  ' + e.detail;
        return text;
    }
    function copyMouseLog(btn) {
        const text = mouseLog.map(mouseLogEntryToLine).join('\n');
        const flash = (msg) => { const orig = btn.textContent; btn.textContent = msg; setTimeout(() => { btn.textContent = orig; }, 900); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => flash('Copied!')).catch(() => flash('Copy failed'));
        } else {
            flash('Copy failed');
        }
    }
    // Save as a .md file - neither reference implementation has a file
    // export (clipboard-only in both), added per direct request ("a Save
    // button (to save an exported text or md file)"). A plain in-page
    // Blob + <a download> - works fine for a real dev session in an
    // actual browser (this is NOT an Artifact/sandboxed context).
    function saveMouseLog() {
        const header = '# Mouse Log\n\n' + mouseLog.filter(e => e.type === 'context').map(mouseLogEntryToLine).join('\n') + '\n\n';
        const body = mouseLog.map(e => '- ' + mouseLogEntryToLine(e)).join('\n');
        const md = header + body + '\n';
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = 'mouse-log-' + stamp + '.md';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
    function restartMouseLogPositionTimer() {
        clearInterval(mouseLogPositionTimer);
        mouseLogPositionTimer = null;
        if (!mouseLogPositionEnabled) return;
        mouseLogPositionTimer = setInterval(() => {
            if (!mouseLogLastPointerPos) return;
            pushMouseLogEntry({
                type: 'position', x: mouseLogLastPointerPos.x, y: mouseLogLastPointerPos.y,
                device: mouseLogDeviceContext(), pointerType: mouseLogLastPointerPos.pointerType || '-',
                target: null, triggered: null,
            });
        }, mouseLogPositionIntervalMs);
    }
    // ----------------------------------------------------------------
    // [JS-13d] GENERIC COLLAPSIBLE LOG BOX
    // ----------------------------------------------------------------
    // Direct request 2026-10-11: "all log type text boxes are
    // inherently collapsible." Inserts a small chevron header directly
    // before `logEl` and toggles `.dev-log-collapsed` on it - separate
    // from the group's own collapse (toggleSection()), so collapsing
    // the log output leaves the rest of that group's controls (e.g.
    // Mouse Log's checkboxes/buttons) visible and usable. Call this
    // once, right after appending any future log-type display element
    // to its group, the same way buildMouseLogWidget() does below -
    // this is meant to be the one, reused mechanism every log box gets,
    // not something built per-widget.
    function makeLogBoxCollapsible(logEl, label) {
        const header = document.createElement('div');
        header.className = 'dev-log-box-header';
        header.textContent = '▼ ' + label;
        logEl.parentElement.insertBefore(header, logEl);
        header.addEventListener('click', () => {
            const collapsed = logEl.classList.toggle('dev-log-collapsed');
            header.textContent = (collapsed ? '▶ ' : '▼ ') + label;
        });
        return header;
    }
    function buildMouseLogWidget() {
        const debugContent = findGroupContent('desktop', 'Debug', 'buildMouseLogWidget', 'mouseLogWidget');
        if (!debugContent || mouseLogEl) return;
        const section = createDevGroupElement('Mouse Log', 'desktop');
        debugContent.appendChild(section);
        const content = section.querySelector(':scope > .dev-section-content');

        const posRow = document.createElement('div');
        posRow.className = 'dev-row';
        posRow.dataset.skipDeviceCheckbox = '1'; // Mouse Log is Desktop-tab-only (one real input stream): no "Show in Mobile/Landscape" checkbox
        const posCheckbox = document.createElement('input');
        posCheckbox.type = 'checkbox';
        posCheckbox.id = 'checkboxMouseLogPosition';
        const posLabel = document.createElement('span');
        posLabel.className = 'dev-label';
        posLabel.textContent = 'Log Mouse Position (continuous)';
        posRow.append(posCheckbox, posLabel);
        content.appendChild(posRow);
        posCheckbox.addEventListener('change', (e) => {
            mouseLogPositionEnabled = e.target.checked;
            restartMouseLogPositionTimer();
        });

        // skipDeviceCheckbox: true - Mouse Log is Desktop-tab-only, no
        // Mobile/Landscape counterpart concept at all (explicitly excluded
        // from tab-mirroring by name - see this widget's own top comment)
        // - and has no `tab` field, which would otherwise make
        // buildUniformControlRow()'s `ctrl.tab === 'desktop'` check false
        // and wrongly append a Mobile/Landscape-style independence
        // checkbox to a control that isn't on either of those tabs.
        const intervalCtrl = { id: 'sliderMouseLogInterval', type: 'slider', label: 'Position Log Interval (Ms):', min: 100, max: 5000, step: 50, value: mouseLogPositionIntervalMs, skipDeviceCheckbox: true };
        const intervalRow = buildUniformControlRow(intervalCtrl);
        content.appendChild(intervalRow);
        document.getElementById('sliderMouseLogInterval').addEventListener('input', (e) => {
            mouseLogPositionIntervalMs = parseFloat(e.target.value);
            restartMouseLogPositionTimer();
        });

        const scrollRow = document.createElement('div');
        scrollRow.className = 'dev-row';
        scrollRow.dataset.skipDeviceCheckbox = '1';
        const scrollCheckbox = document.createElement('input');
        scrollCheckbox.type = 'checkbox';
        scrollCheckbox.id = 'checkboxMouseLogScroll';
        const scrollLabel = document.createElement('span');
        scrollLabel.className = 'dev-label';
        scrollLabel.textContent = 'Log Scroll';
        scrollRow.append(scrollCheckbox, scrollLabel);
        content.appendChild(scrollRow);
        scrollCheckbox.addEventListener('change', (e) => { mouseLogScrollEnabled = e.target.checked; });

        const keyRow = document.createElement('div');
        keyRow.className = 'dev-row';
        keyRow.dataset.skipDeviceCheckbox = '1';
        const keyCheckbox = document.createElement('input');
        keyCheckbox.type = 'checkbox';
        keyCheckbox.id = 'checkboxMouseLogKeystrokes';
        const keyLabel = document.createElement('span');
        keyLabel.className = 'dev-label';
        keyLabel.textContent = 'Log Keystrokes';
        keyRow.append(keyCheckbox, keyLabel);
        content.appendChild(keyRow);
        keyCheckbox.addEventListener('change', (e) => { mouseLogKeystrokesEnabled = e.target.checked; });

        const btnRow = document.createElement('div');
        btnRow.className = 'dev-buttons';
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = 'COPY';
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.textContent = 'SAVE';
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'CLEAR';
        btnRow.append(copyBtn, saveBtn, clearBtn);
        content.appendChild(btnRow);
        copyBtn.addEventListener('click', () => copyMouseLog(copyBtn));
        saveBtn.addEventListener('click', saveMouseLog);
        clearBtn.addEventListener('click', clearMouseLog);

        mouseLogEl = document.createElement('div');
        mouseLogEl.className = 'dev-mouse-log';
        content.appendChild(mouseLogEl);
        makeLogBoxCollapsible(mouseLogEl, 'Log');
        clearMouseLog();
        logMouseLogContext('start');
    }
    function setupMouseLog() {
        // Registered so the Debug group's global tools (Copy All / Clear All / Export Logs / Snapshot) include this log.
        window.spxDebugLogRegistry = window.spxDebugLogRegistry || [];
        if (!window.spxDebugLogRegistry.some(l => l.key === 'mouseLog')) window.spxDebugLogRegistry.push({ key: 'mouseLog', title: 'Mouse Log', active: () => true, lines: () => mouseLog.map(mouseLogEntryToLine), clear: clearMouseLog });
        window.addEventListener('pointermove', (e) => {
            mouseLogLastPointerPos = { x: Math.round(e.clientX), y: Math.round(e.clientY), pointerType: e.pointerType };
            const info = mouseLogActivePointers.get(e.pointerId);
            if (!info) return;
            info.curX = e.clientX; info.curY = e.clientY;
            if (!info.moved && Math.hypot(e.clientX - info.startX, e.clientY - info.startY) > MOUSE_LOG_MOVE_THRESHOLD_PX) info.moved = true;
        });
        window.addEventListener('pointerdown', (e) => {
            mouseLogActivePointers.set(e.pointerId, { startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY, startTime: performance.now(), moved: false, target: e.target });
            if (e.pointerType === 'touch' && mouseLogActivePointers.size === 2) {
                const pts = Array.from(mouseLogActivePointers.values());
                mouseLogPinchStartDist = Math.hypot(pts[0].curX - pts[1].curX, pts[0].curY - pts[1].curY);
                mouseLogPinchActive = true;
                clearTimeout(mouseLogHoldTimer);
                return;
            }
            if (e.button === 2 || mouseLogActivePointers.size > 1) return;
            clearTimeout(mouseLogHoldTimer);
            // Multi-click-hold detection, direct request 2026-09-28
            // ("differentiate between a click, clickhold, as well as
            // multi click/multiclick holds"): if a prior click's own
            // multi-click debounce is still pending when THIS press
            // starts, this press continues that same sequence (a 2nd/3rd
            // press-and-hold), not an independent single hold — cancel
            // the pending plain-click log (it never resolves as a lone
            // click now; it's the Nth press of a click-hold sequence
            // instead) and count this hold into the sequence.
            const continuingClickSequence = !!mouseLogClickTimer;
            if (continuingClickSequence) { clearTimeout(mouseLogClickTimer); mouseLogClickTimer = null; }
            const holdSequenceCount = continuingClickSequence ? mouseLogClickCount + 1 : 1;
            mouseLogHoldTimer = setTimeout(() => {
                const info2 = mouseLogActivePointers.get(e.pointerId);
                if (info2 && !info2.moved) {
                    const { target, triggered } = describeMouseLogTarget(e.target);
                    // 'hold' here is the START of the gesture (the press
                    // crossing the hold threshold) — the matching release
                    // is always its OWN separate log entry, below, never
                    // merged into this one.
                    const holdType = holdSequenceCount >= 3 ? 'tripleclickhold' : holdSequenceCount === 2 ? 'doubleclickhold' : 'hold';
                    info2.holdType = holdType; // read by pointerup below to log the matching release with the same label
                    pushMouseLogEntry({ type: holdType, x: Math.round(e.clientX), y: Math.round(e.clientY), device: mouseLogDeviceContext(), pointerType: e.pointerType, target, triggered });
                }
            }, MOUSE_LOG_HOLD_MS);
        });
        window.addEventListener('pointerup', (e) => {
            clearTimeout(mouseLogHoldTimer);
            const info = mouseLogActivePointers.get(e.pointerId);
            const wasPinching = mouseLogPinchActive && mouseLogActivePointers.size === 2;
            mouseLogActivePointers.delete(e.pointerId);
            if (!info) return;
            const x = Math.round(e.clientX), y = Math.round(e.clientY);
            const device = mouseLogDeviceContext();
            if (wasPinching) {
                mouseLogPinchActive = false;
                const remaining = Array.from(mouseLogActivePointers.values())[0];
                if (remaining && mouseLogPinchStartDist) {
                    const endDist = Math.hypot(x - remaining.curX, y - remaining.curY);
                    const scale = mouseLogPinchStartDist > 0 ? endDist / mouseLogPinchStartDist : 1;
                    pushMouseLogEntry({ type: 'pinch', x, y, device, pointerType: 'touch', target: null, triggered: null, detail: (scale > 1 ? 'out' : 'in') + ' scale:' + scale.toFixed(2) });
                }
                return;
            }
            const heldMs = performance.now() - info.startTime;
            // Deferred one macrotask (setTimeout 0), not called
            // synchronously here - per direct request (Clicko project,
            // 2026-09-14/15) for the log to include the actual value/
            // input a setting was changed to, not just its name. A
            // checkbox's own `checked` flip (and a native <select>'s
            // selection) happens as part of the browser's default click
            // handling, which runs AFTER 'pointerup' has already fired -
            // reading el.checked/value synchronously at this point would
            // still show the OLD, pre-click state. Range/color/text
            // inputs update .value live as you interact, so this costs
            // them nothing; it's what makes checkbox/select values come
            // out correct.
            setTimeout(() => {
            const { target, triggered } = describeMouseLogTarget(info.target);
            if (e.pointerType === 'touch') {
                if (info.moved) {
                    const dx = e.clientX - info.startX, dy = e.clientY - info.startY;
                    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
                    pushMouseLogEntry({ type: 'swipe', x, y, device, pointerType: 'touch', target, triggered, detail: 'dir:' + dir + ' dist:' + Math.round(Math.hypot(dx, dy)) });
                    return;
                }
                if (heldMs > MOUSE_LOG_HOLD_MS) return;
                mouseLogClickCount++;
                clearTimeout(mouseLogClickTimer);
                mouseLogClickTimer = setTimeout(() => {
                    pushMouseLogEntry({ type: mouseLogClickCount >= 2 ? 'doubletap' : 'tap', x, y, device, pointerType: 'touch', target, triggered });
                    mouseLogClickCount = 0;
                }, MOUSE_LOG_MULTICLICK_MS);
                return;
            }
            if (e.button === 2) {
                pushMouseLogEntry({ type: 'rightclick', x, y, device, pointerType: e.pointerType, target, triggered });
                return;
            }
            if (info.moved) {
                pushMouseLogEntry({ type: 'drag-release', x, y, device, pointerType: e.pointerType, target, triggered, detail: 'heldMs:' + Math.round(heldMs) });
                return;
            }
            if (heldMs > MOUSE_LOG_HOLD_MS) {
                // Its own separate entry from the 'hold'/'doubleclickhold'/
                // 'tripleclickhold' start entry above — never merged, per
                // direct request 2026-09-28. Labeled to match whichever
                // hold sequence actually started (info.holdType, set by
                // the pointerdown hold-timer callback above).
                const holdType = info.holdType || 'hold';
                const releaseType = holdType === 'hold' ? 'release' : holdType + '-release';
                pushMouseLogEntry({ type: releaseType, x, y, device, pointerType: e.pointerType, target, triggered, detail: 'heldMs:' + Math.round(heldMs) });
                mouseLogClickCount = 0; // a completed hold ends the click-counting sequence
                return;
            }
            mouseLogClickCount++;
            clearTimeout(mouseLogClickTimer);
            mouseLogClickTimer = setTimeout(() => {
                const kind = mouseLogClickCount >= 3 ? 'tripleclick' : mouseLogClickCount === 2 ? 'dblclick' : 'click';
                pushMouseLogEntry({ type: kind, x, y, device, pointerType: e.pointerType, target, triggered });
                mouseLogClickCount = 0;
            }, MOUSE_LOG_MULTICLICK_MS);
            }, 0);
        });
        window.addEventListener('pointercancel', (e) => {
            clearTimeout(mouseLogHoldTimer);
            mouseLogActivePointers.delete(e.pointerId);
            mouseLogPinchActive = false;
        });
        window.addEventListener('wheel', (e) => {
            if (!mouseLogScrollEnabled) return;
            const { target, triggered } = describeMouseLogTarget(e.target);
            pushMouseLogEntry({ type: 'scroll', x: Math.round(e.clientX), y: Math.round(e.clientY), device: mouseLogDeviceContext(), pointerType: 'wheel', target, triggered, detail: 'deltaY:' + Math.round(e.deltaY) });
        }, { passive: true });
        window.addEventListener('keydown', (e) => {
            if (!mouseLogKeystrokesEnabled) return;
            const { target, triggered } = describeMouseLogTarget(e.target);
            pushMouseLogEntry({ type: 'keydown', x: '-', y: '-', device: mouseLogDeviceContext(), pointerType: 'keyboard', target, triggered, detail: 'key:' + e.key });
        });
        window.addEventListener('resize', () => { if (mouseLogEl) logMouseLogContext('resize'); });
    }


    // ================================================================
    // [JS-14] INIT SEQUENCE  (LAZY-BUILD)
    // ================================================================
    // LAZY-BUILD: the panel's actual CONTROLS (every render*Controls()
    // call — this engine's own built-in Dev Panel group AND your own
    // project settings) are only ever built the FIRST time the panel is
    // actually needed — on first D-press, first DEV-button click, or
    // (see initDevPanelEngine() below) once, eagerly, for a dev-allowed
    // visitor, since the panel is visible-by-default for them with no
    // click needed (see the CSS html.dev-mode rules). A REAL PLAYER on
    // a real deployed site never triggers any of these three paths, so
    // their page never pays the cost of constructing however many
    // hundred DOM elements your project's own settings add up to.
    //
    // Ported from a real project's own dev panel (MAINTENANCE note at
    // the top of this file), which measured a genuine ~780-880ms
    // domInteractive delay from doing this unconditionally at the top
    // level for every visitor — 686 controls across 3 device tabs, none
    // of which a real player ever opens. After lazy-building, that gap
    // measured 63-79ms on a real player's load. The real project also
    // hit — and this template's own structure below already avoids —
    // 2 sharp edges worth knowing about if you ever restructure this
    // yourself: (1) devPanelBuilt has to be declared at the very TOP of
    // this script, not here, or an early click on a statically-parsed
    // button can read it before its own declaration line has executed
    // (a real temporal-dead-zone crash, reproduced and fixed this exact
    // way); (2) devPanelBuilt must be set true at the very END of this
    // function, not the start — setting it early means a mid-build
    // exception leaves the flag permanently true while the panel stays
    // genuinely half-built, with no way to recover short of a full
    // reload.
    // ----------------------------------------------------------------
    // ensureDevPanelBuilt() — ORDER MATTERS inside here, same as this
    // section always required, now just deferred behind a guard instead
    // of running unconditionally at load:
    //   1. Your own render*Controls() calls (create the DOM) — these
    //      now belong INSIDE this function too, not before it — see the
    //      PROJECT comment below.
    //   2. renderDevPanelStyleControls() (this engine's own built-in
    //      group).
    //   3. Your own event-wiring (each control's 'input'/'change'
    //      listener) — also moves inside this function, in your own code.
    //   4. setupDevPanelStyleControls(), makeDevValuesEditable(),
    //      setupDevPanelTextEdit(), assertDevControlsRendered(),
    //      validateDevControlMappings() — this engine's own generic
    //      wiring + safety nets, once every control genuinely exists.
    //   5. setupDragReorder() (x2 — groups, then settings).
    //   6. Load saved state (localStorage by default) and apply it.
    // ----------------------------------------------------------------
    // Turns "Album & Date" into "AlbumDate" for use inside a control id -- ids
    // must be unique per element, camelCase/PascalCase per this file's own
    // convention, never raw spaces/punctuation. Ported from the shared
    // .claude/TEMPLATE_DEV_PANEL.html (its own buildTextElementControls()
    // section), 2026-10-25.
    function sanitizeIdPart(name) {
        return name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    }
    // Same "a checkbox in the title bar gates this whole group's content"
    // mechanic as makeDevGroupToggleable() elsewhere in this file, but taking
    // the section/checkbox elements directly instead of looking them up by
    // data-sid -- makeDevGroupToggleable()'s own lookup is top-level-only
    // (a direct-child selector), which the per-element Text groups and their
    // nested Outline subgroup below can't use (UI Layout > Text > <element> >
    // Outline is 3 levels deep). Ported from the template, same section.
    function wireNestedGroupToggle(sectionEl, cb) {
        cb.classList.add('dev-group-toggle-checkbox');
        cb.title = 'Enable/disable this whole group';
        cb.addEventListener('click', e => e.stopPropagation());
        const titleEl = sectionEl.querySelector(':scope > .dev-section-title');
        const originalRow = cb.closest('.dev-row');
        titleEl.appendChild(cb);
        if (originalRow) originalRow.remove();
        function applyState() { sectionEl.classList.toggle('dev-section-group-disabled', !cb.checked); }
        cb.addEventListener('change', applyState);
        cb.addEventListener('input', applyState);
        applyState();
    }
    // Full per-text-element battery, ported from the shared .claude/TEMPLATE_DEV_PANEL.html
    // (its own buildTextElementControls()) and adapted for this project, 2026-10-25:
    //  - No font-family dropdown of its own. SPOTTY EXPOTTY keeps ONE global font
    //    selector (UI Layout > Font > selectUiFont) -- the owner's explicit choice when
    //    this was ported, so this battery only ever gets Font SIZE, not family.
    //  - Nested under the EXISTING "UI Layout" group's own new "Text" subgroup, not the
    //    template's separate mandatory "UI" group -- this project has no such group, and
    //    "UI Layout" already holds every other visual setting (Background, Buttons, etc.).
    //  - Drop Shadow / Extrusion (opt-in in the template) are left out entirely -- not
    //    requested for this port.
    //  - REPLACES the old sliderTitleScale/ArtistScale/MetaScale + per-element
    //    SizeMin/Pref/Max clamp system (3 elements x 4 sliders = 12 controls, a
    //    clamp(min,pref vw,max)*scale formula) with this battery's own Font Size: a
    //    literal px value, not a vw-responsive clamp. A disclosed tradeoff -- this loses
    //    continuous in-between-breakpoint growth as the viewport resizes; a phone still
    //    gets its own size via the existing Mobile/Landscape independence checkbox, the
    //    same mechanism every other control in this file already uses for a per-device
    //    value, just no longer a continuous vw curve.
    function buildSpottyTextElementGroup(tab, uiLayoutContent, elementName, d) {
        let textSec = uiLayoutContent.querySelector(':scope > .dev-section > .dev-section-title[data-sid="Text"]')?.closest('.dev-section');
        if (!textSec) { textSec = createDevGroupElement('Text', tab); uiLayoutContent.appendChild(textSec); }
        const textContent = textSec.querySelector(':scope > .dev-section-content');
        const elemSec = createDevGroupElement(elementName, tab);
        textContent.appendChild(elemSec);
        const elemContent = elemSec.querySelector(':scope > .dev-section-content');
        const p = sanitizeIdPart(elementName);
        const allCtrls = [];
        function add(ctrl, targetContent) {
            allCtrls.push(ctrl);
            const row = buildUniformControlRow(ctrl);
            if (ctrl.type === 'select') row.querySelector('select').value = ctrl.value;
            else if (ctrl.type === 'checkbox') row.querySelector('input').checked = !!ctrl.value;
            targetContent.appendChild(row);
            return row;
        }
        const enabledRow = add({ tab, id: 'checkboxTxt' + p + 'Enabled', type: 'checkbox', label: 'Enabled', value: true }, elemContent);
        wireNestedGroupToggle(elemSec, enabledRow.querySelector('input'));
        add({ tab, id: 'sliderTxt' + p + 'FontSize', type: 'slider', label: 'Font Size (Px):', min: 6, max: 140, step: 1, value: d.size }, elemContent);
        add({ tab, id: 'colorTxt' + p + 'Color', type: 'color', label: 'Font Color:', value: d.color }, elemContent);
        add({ tab, id: 'checkboxTxt' + p + 'Bold', type: 'checkbox', label: 'Bold', value: d.bold }, elemContent);
        add({ tab, id: 'checkboxTxt' + p + 'Italic', type: 'checkbox', label: 'Italic', value: false }, elemContent);
        add({ tab, id: 'checkboxTxt' + p + 'Underline', type: 'checkbox', label: 'Underline', value: false }, elemContent);
        add({ tab, id: 'sliderTxt' + p + 'LetterSpacing', type: 'slider', label: 'Letter Spacing (Px):', min: -5, max: 30, step: 0.1, value: 0 }, elemContent);
        add({ tab, id: 'sliderTxt' + p + 'LineSpacing', type: 'slider', label: 'Line Spacing (x):', min: 0.5, max: 3, step: 0.05, value: d.lineSpacing }, elemContent);
        add({ tab, id: 'sliderTxt' + p + 'Opacity', type: 'slider', label: 'Opacity:', min: 0, max: 1, step: 0.01, value: 1 }, elemContent);
        add({ tab, id: 'checkboxTxt' + p + 'WordWrap', type: 'checkbox', label: 'Word Wrap', value: true }, elemContent);
        add({ tab, id: 'sliderTxt' + p + 'MaxWidth', type: 'slider', label: 'Max Width (Px):', min: 20, max: 2400, step: 1, value: 900 }, elemContent);
        add({
            tab, id: 'selectTxt' + p + 'Overflow', type: 'select', label: 'Overflow:', value: 'wrap',
            options: [{ value: 'wrap', text: 'Wrap' }, { value: 'truncate', text: 'Truncate (…)' }, { value: 'clip', text: 'Clip' }, { value: 'scale', text: 'Shrink to Fit' }],
        }, elemContent);
        // Artist only: the separator used when a track has several artists (the data stores them joined with ';')
        if (elementName === 'Artist') add({ tab, id: 'textArtistSeparator', type: 'text', label: 'Artist Name Separator:', value: ';' }, elemContent);
        if (elementName === 'Artist') add({ tab, id: 'sliderArtistSeparatorPct', type: 'slider', label: 'Separator Font Size (% Of Artist):', min: 10, max: 300, step: 1, value: 100 }, elemContent);
        // Scale Down If Multiline (Song Title and Artist): the line limit is only shown while the checkbox is on
        const MULTI_KEYS = { 'Song Title': 'Title', 'Artist': 'Artist', 'Album & Date': 'AlbumDate' };
        if (MULTI_KEYS[elementName]) {
            const k = MULTI_KEYS[elementName];
            const multiRow = add({ tab, id: 'checkboxScale' + k + 'Multiline', type: 'checkbox', label: 'Scale Down If Multiline:', value: false }, elemContent);
            const maxRow = add({ tab, id: 'slider' + k + 'MaxLines', type: 'slider', label: 'Max Lines (Scales Down Past This):', min: 1, max: 8, step: 1, value: 2 }, elemContent);
            const multiBox = multiRow.querySelector('input');
            const syncMaxLines = () => { maxRow.style.display = multiBox.checked ? '' : 'none'; };
            multiBox.addEventListener('change', syncMaxLines);
            setInterval(syncMaxLines, 700); // catches the saved state restored after the panel is built
            syncMaxLines();
        }
        // Scale Down to Match: this element's font size is capped at the size of the element above it (Artist -> Song Title, Album & Date -> Artist)
        if (elementName === 'Artist') add({ tab, id: 'checkboxScaleArtistToMatch', type: 'checkbox', label: 'Scale Down to Match Song Title', value: false }, elemContent);
        if (elementName === 'Album & Date') add({ tab, id: 'checkboxScaleAlbumDateToMatch', type: 'checkbox', label: 'Scale Down to Match Artist', value: false }, elemContent);
        const outlineSec = createDevGroupElement('Outline', tab);
        elemContent.appendChild(outlineSec);
        const outlineContent = outlineSec.querySelector(':scope > .dev-section-content');
        const outlineEnabledRow = add({ tab, id: 'checkboxTxt' + p + 'OutlineEnabled', type: 'checkbox', label: 'Enabled', value: false }, elemContent);
        add({ tab, id: 'colorTxt' + p + 'OutlineColor', type: 'color', label: 'Outline Color:', value: '#000000' }, outlineContent);
        add({ tab, id: 'sliderTxt' + p + 'OutlineThickness', type: 'slider', label: 'Outline Thickness (Px):', min: 0, max: 20, step: 0.5, value: 2 }, outlineContent);
        wireNestedGroupToggle(outlineSec, outlineEnabledRow.querySelector('input'));
        registerDevControlArray('textElem_' + p, allCtrls);
    }
    // SPOTTY EXPOTTY's own settings. The app (src/app/settings.js) reads these
    // controls' live DOM values by id -- no separate state copy. Mobile/Landscape
    // twins are created by the template's dynamic per-device mechanism, so every
    // id keeps the `slider|color|checkbox` prefix that mechanism relies on.
    function renderSpottyDevControls() {
        const tab = 'desktop';
        const TL = 'Timeline Look', AC = 'Album Cover Colors';
        ['Scrub Audio', 'Scrub Preload', 'Scrub Input', 'Spotify Handoff', TL, 'UI Layout'].forEach(g =>
            document.getElementById('desktopTabContent').appendChild(createDevGroupElement(g, tab)));
        // The UI Layout Engine's saved element layouts ride along with Sync/Reset as `extra.uiLayout`.
        devSaveCaptureExtra = () => ({ uiLayout: typeof window.spxCaptureLayout === 'function' ? window.spxCaptureLayout() : undefined });
        devSaveApplyExtra = extra => {
            if (!extra || !extra.uiLayout) return;
            if (typeof window.spxApplyLayout === 'function') window.spxApplyLayout(extra.uiLayout); else window.__spxPendingLayout = extra.uiLayout;
        };
        const FEATURES = [
            { value: 'valence', text: 'Valence (mood)' },
            { value: 'energy', text: 'Energy' },
            { value: 'danceability', text: 'Danceability' },
        ];
        const SPOTTY_CONTROLS = [
            { tab, group: 'Scrub Audio', id: 'checkboxScrubAudioEnabled', type: 'checkbox', label: 'Play Clips While Scrubbing:', value: true },
            { tab, group: 'Scrub Audio', id: 'checkboxPlayPreviewClips', type: 'checkbox', label: 'Play Preview Clips (Off = Spotify Song Only, Once Logged In):', value: true },
            { tab, group: 'Scrub Audio', id: 'sliderScrubVolume', type: 'slider', label: 'Clip Volume (x):', min: 0, max: 1, step: 0.05, value: 0.7 },
            { tab, group: 'Scrub Audio', id: 'sliderClipStartMin', type: 'slider', label: 'Clip Start Min (S):', min: 0, max: 28, step: 0.5, value: 2 },
            { tab, group: 'Scrub Audio', id: 'sliderClipStartMax', type: 'slider', label: 'Clip Start Max (S):', min: 0, max: 28, step: 0.5, value: 22 },
            { tab, group: 'Scrub Audio', id: 'checkboxStartAtBuffer', type: 'checkbox', label: 'Start At Buffer:', value: true },
            { tab, group: 'Scrub Audio', id: 'sliderClipFadeOut', type: 'slider', label: 'Clip Fade Out (Ms):', min: 0, max: 500, step: 5, value: 30 },
            { tab, group: 'Scrub Audio', id: 'checkboxColdStartClips', type: 'checkbox', label: 'Play Clips Not Yet Preloaded:', value: true },
            { tab, group: 'Scrub Audio', id: 'checkboxRandomStartSong', type: 'checkbox', label: 'Randomize Starting Song:', value: false },
            { tab, group: 'Scrub Audio', id: 'checkboxLoopPreview', type: 'checkbox', label: 'Loop Preview:', value: true },
            { tab, group: 'Scrub Preload', id: 'sliderPreloadAhead', type: 'slider', label: 'Preload Ahead (Songs):', min: 0, max: 30, step: 1, value: 8 },
            { tab, group: 'Scrub Preload', id: 'sliderPreloadBehind', type: 'slider', label: 'Preload Behind (Songs):', min: 0, max: 30, step: 1, value: 3 },
            { tab, group: 'Scrub Preload', id: 'checkboxShowPoolOverlay', type: 'checkbox', label: 'Show Preload Pool Overlay:', value: false },
            { tab, group: 'Scrub Input', id: 'sliderWheelScrubPixels', type: 'slider', label: 'Wheel Scrub Per Notch (Px):', min: 2, max: 300, step: 1, value: 40 },
            { tab, group: 'Scrub Input', id: 'checkboxInvertScroll', type: 'checkbox', label: 'Invert Wheel / Touch Scrub Direction:', value: false },
            { tab, group: 'Scrub Input', id: 'sliderTimelineZoomSpeed', type: 'slider', label: 'Drag Zoom Speed (x):', min: 0.1, max: 5, step: 0.1, value: 1 },
            { tab, group: 'Scrub Input', id: 'checkboxInvertZoomDrag', type: 'checkbox', label: 'Invert Drag Zoom Direction:', value: false },
            { tab, group: 'Scrub Input', id: 'sliderDefaultTimelineSpanDays', type: 'slider', label: 'Starting Timeline Span (Days):', min: 1, max: 5000, step: 1, value: 120 },
            { tab, group: 'Scrub Input', id: 'checkboxFullScaleOnStartup', type: 'checkbox', label: 'Full Scale on Startup:', value: false },
            { tab, group: 'Spotify Handoff', id: 'checkboxHandoffEnabled', type: 'checkbox', label: 'Play Real Song When Scrubbing Stops:', value: true },
            { tab, group: 'Spotify Handoff', id: 'checkboxSpotifyLoginOnStart', type: 'checkbox', label: 'Open Spotify Login On First Click (Until Logged In):', value: true },
            { tab, group: 'Spotify Handoff', id: 'buttonSpotifyLogin', type: 'button', label: 'Log In With Spotify', skipDeviceCheckbox: true },
            { tab, group: 'Spotify Handoff', id: 'checkboxShowSpotifyPlayer', type: 'checkbox', label: 'Show Spotify Player (To Log In Inside It):', value: false },
            { tab, group: 'Spotify Handoff', id: 'sliderHandoffCrossfade', type: 'slider', label: 'Handoff Crossfade, Preview To Full Song (Ms, 0 = Hard Cut):', min: 0, max: 2000, step: 10, value: 250 },
            { tab, group: 'Spotify Handoff', id: 'sliderHandoffDelay', type: 'slider', label: 'Handoff Delay After Scrubbing Stops (Ms):', min: 100, max: 3000, step: 50, value: 600 },
            { tab, group: 'Spotify Handoff', id: 'sliderHandoffStartOffset', type: 'slider', label: 'Full Song Start Offset From Preview (S):', min: -30, max: 30, step: 0.5, value: 0 },
            { tab, group: TL, id: 'colorTimelineAccent', type: 'color', label: 'Timeline Accent Color:', value: '#1db954' },
            { tab, group: TL, id: 'colorTimelinePlayhead', type: 'color', label: 'Playhead Color:', value: '#ffffff' },
            { tab, group: TL, id: 'sliderTimelineBarOpacity', type: 'slider', label: 'Timeline Bar Opacity (x):', min: 0.1, max: 1, step: 0.05, value: 0.8 },
            { tab, group: TL, id: 'sliderBarWidth', type: 'slider', label: 'Bar Width / Granularity (Px):', min: 1, max: 40, step: 1, value: 3 },
            // Only the bars stretch (upward); nothing else moves, the cover is positioned independently of the timeline.
            { tab, group: TL, id: 'sliderTimelineHeight', type: 'slider', label: 'Timeline Height (Px):', min: 60, max: 900, step: 5, value: 200 },
            // Off: bars snap to the new height when the zoom changes. On: they ease to it over the duration below (shown only while on).
            { tab, group: TL, id: 'checkboxTimelineHeightTransition', type: 'checkbox', label: 'Height Transition:', value: false },
            { tab, group: TL, id: 'sliderTimelineHeightTransitionMs', type: 'slider', label: 'Height Transition Duration (Ms):', min: 0, max: 2000, step: 10, value: 300 },
            { tab, group: TL, id: 'sliderTimelineScaleGap', type: 'slider', label: 'Space Between Graph And Scale Text (Px):', min: -18, max: 120, step: 1, value: 0 },
            { tab, group: TL, id: 'sliderPlayheadWidth', type: 'slider', label: 'Scrub Line Width (Px):', min: 1, max: 24, step: 0.5, value: 2 },
            { tab, group: TL, id: 'sliderPlayheadHeight', type: 'slider', label: 'Scrub Line Height (% Of Timeline):', min: 5, max: 100, step: 1, value: 100 },
            { tab, group: TL, id: 'sliderPlayheadOpacity', type: 'slider', label: 'Scrub Line Opacity (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: TL, id: 'sliderPlayheadStartHeight', type: 'slider', label: 'Scrub Line Start Height (Px Above The Scale Line):', min: 0, max: 400, step: 1, value: 0 },
            // Integer-valued dual-handle control, so it is a 0-100 % log scale: 0 = 2 minutes visible, 100 = the whole timeline.
            { tab, group: TL, id: 'rangeBarTimelineZoomLimits', type: 'range-bar', label: 'Zoom Limits (% zoomed out, log scale):', trackMin: 0, trackMax: 100, unit: '%', defaultValue: { min: 0, max: 100 } },
            { tab, group: 'UI Layout', id: 'buttonOpenLayoutInspector', type: 'button', label: 'Open UI Layout Inspector', skipDeviceCheckbox: true },
        ];
        renderControlArray(SPOTTY_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_CONTROLS', SPOTTY_CONTROLS);
        // Click and Drag (Scrub Line): a toggle group with the same animation settings as a standard button animation group
        const CD = 'Click and Drag';
        const CD_CONTROLS = [
            { tab, group: CD, id: 'checkboxScrubLineDrag', type: 'checkbox', label: 'Enabled', value: false },
            { tab, group: CD, id: 'sliderScrubLineAnimTime', type: 'slider', label: 'Animation Time (Ms):', min: 0, max: 1500, step: 10, value: 160 },
            { tab, group: CD, id: 'sliderScrubLineHoverWidth', type: 'slider', label: 'Width On Hover (Px):', min: 1, max: 24, step: 0.5, value: 4 },
            { tab, group: CD, id: 'sliderScrubLineClickWidth', type: 'slider', label: 'Width On Click (Px):', min: 1, max: 24, step: 0.5, value: 6 },
            { tab, group: CD, id: 'sliderScrubLineReleaseWidth', type: 'slider', label: 'Width On Release (Px):', min: 1, max: 24, step: 0.5, value: 3 },
            { tab, group: CD, id: 'sliderScrubLineHoverOpacity', type: 'slider', label: 'Opacity On Hover (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: CD, id: 'sliderScrubLineClickOpacity', type: 'slider', label: 'Opacity On Click (%):', min: 0, max: 100, step: 1, value: 100 },
        ];
        findGroupContent(tab, TL, 'renderSpottyDevControls', 'sliderPlayheadStartHeight').appendChild(createDevGroupElement(CD, tab));
        renderControlArray(CD_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_SCRUBLINE_DRAG', CD_CONTROLS);
        makeDevGroupToggleable(tab, CD, 'checkboxScrubLineDrag');

        // Visual Style: the timeline's style dropdown and the settings that belong to each style, in their own subgroup of Timeline Look
        const VS = 'Visual Style';
        findGroupContent(tab, TL, 'renderSpottyDevControls', VS).appendChild(createDevGroupElement(VS, tab));
        const VS_CONTROLS = [
            {
                tab, group: VS, id: 'selectTimelineStyle', type: 'select', label: 'Timeline Visual Style:', value: 'none',
                options: [
                    { value: 'none', text: 'None (plain bars)' },
                    { value: 'glow', text: 'Glow Stems' },
                    { value: 'density', text: 'Smooth Density' },
                    { value: 'line', text: 'Feature Line' },
                    { value: 'ribbon', text: 'Mood Ribbon' },
                ],
            },
            // settings shown only while their style is selected (see refreshSpottyModeVisibility)
            { tab, group: VS, id: 'sliderGlowStemWidth', type: 'slider', label: 'Glow Stem Width (Px):', min: 1, max: 10, step: 0.5, value: 2 },
            { tab, group: VS, id: 'sliderGlowRadius', type: 'slider', label: 'Glow Radius (Px):', min: 0, max: 50, step: 1, value: 12 },
            { tab, group: VS, id: 'sliderGlowDotSize', type: 'slider', label: 'Glow Dot Size (Px):', min: 0, max: 14, step: 0.5, value: 4 },
            { tab, group: VS, id: 'sliderGlowIntensity', type: 'slider', label: 'Glow Intensity (x):', min: 0, max: 1, step: 0.05, value: 0.8 },
            { tab, group: VS, id: 'sliderDensitySmoothing', type: 'slider', label: 'Density Smoothing (Px):', min: 2, max: 80, step: 1, value: 14 },
            { tab, group: VS, id: 'sliderDensityFillOpacity', type: 'slider', label: 'Density Fill Opacity (x):', min: 0, max: 1, step: 0.05, value: 0.55 },
            { tab, group: VS, id: 'sliderDensityOutlineWidth', type: 'slider', label: 'Density Outline Width (Px):', min: 0, max: 8, step: 0.5, value: 2 },
            { tab, group: VS, id: 'sliderDensityColorBlend', type: 'slider', label: 'Color Blend Before Add Time (% Of Gap To Previous Datapoint):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: VS, id: 'checkboxDensityGradientFill', type: 'checkbox', label: 'Fade Fill Toward Baseline:', value: true },
            { tab, group: VS, id: 'selectLineFeature', type: 'select', label: 'Line Height Shows:', value: 'valence', options: FEATURES },
            { tab, group: VS, id: 'sliderLineWidth', type: 'slider', label: 'Line Width (Px):', min: 1, max: 8, step: 0.5, value: 2 },
            { tab, group: VS, id: 'sliderLineDotSize', type: 'slider', label: 'Line Dot Size (Px):', min: 0, max: 10, step: 0.5, value: 3 },
            { tab, group: VS, id: 'sliderLineFillOpacity', type: 'slider', label: 'Line Area Fill Opacity (x):', min: 0, max: 1, step: 0.05, value: 0.2 },
            { tab, group: VS, id: 'checkboxLineSmooth', type: 'checkbox', label: 'Smooth Line Curves:', value: true },
            { tab, group: VS, id: 'selectRibbonFeature', type: 'select', label: 'Ribbon Color Shows:', value: 'valence', options: FEATURES },
            { tab, group: VS, id: 'sliderRibbonThickness', type: 'slider', label: 'Ribbon Thickness (Px):', min: 6, max: 120, step: 1, value: 28 },
            { tab, group: VS, id: 'sliderRibbonSmoothing', type: 'slider', label: 'Ribbon Smoothing (Px):', min: 2, max: 120, step: 1, value: 24 },
            { tab, group: VS, id: 'sliderRibbonBarsOpacity', type: 'slider', label: 'Ribbon Underlay Bars Opacity (x):', min: 0, max: 1, step: 0.05, value: 0.25 },
        ];
        renderControlArray(VS_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_VISUAL_STYLE_CONTROLS', VS_CONTROLS);

        // Timeline Scale: the scale numbers and tick marks under the graph, and the Song Add Date line
        const TSC = 'Timeline Scale', SN = 'Scale Numbers', TK = 'Ticks', SAD = 'Song Add Date';
        findGroupContent(tab, TL, 'renderSpottyDevControls', TSC).appendChild(createDevGroupElement(TSC, tab));
        findGroupContent(tab, TSC, 'renderSpottyDevControls', SN).appendChild(createDevGroupElement(SN, tab));
        findGroupContent(tab, TSC, 'renderSpottyDevControls', TK).appendChild(createDevGroupElement(TK, tab));
        const TS_CONTROLS = [
            { tab, group: SN, id: 'sliderScaleNumbersFontSize', type: 'slider', label: 'Font Size (Px):', min: 6, max: 60, step: 1, value: 11 },
            { tab, group: SN, id: 'checkboxScaleNumbersBold', type: 'checkbox', label: 'Bold', value: false },
            { tab, group: SN, id: 'colorScaleNumbers', type: 'color', label: 'Font Color:', value: '#ffffff' },
            { tab, group: SN, id: 'sliderScaleNumbersLetterSpacing', type: 'slider', label: 'Letter Spacing (Px):', min: -5, max: 30, step: 0.1, value: 0 },
            { tab, group: SN, id: 'sliderScaleNumbersOpacity', type: 'slider', label: 'Opacity:', min: 0, max: 1, step: 0.01, value: 0.6 },
            { tab, group: SN, id: 'sliderScaleNumbersOffsetX', type: 'slider', label: 'X Offset From Tick (Px):', min: -50, max: 50, step: 1, value: 3 },
            { tab, group: TK, id: 'colorTickMark', type: 'color', label: 'Color:', value: '#ffffff' },
            { tab, group: TK, id: 'sliderTickOpacity', type: 'slider', label: 'Opacity:', min: 0, max: 1, step: 0.01, value: 0.6 },
            { tab, group: TK, id: 'sliderTickWidth', type: 'slider', label: 'Width (Px):', min: 1, max: 10, step: 0.5, value: 1 },
            { tab, group: TK, id: 'sliderTickHeight', type: 'slider', label: 'Height (Px, Rises Up From Start Height):', min: 1, max: 60, step: 1, value: 5 },
            { tab, group: TK, id: 'sliderTickStartHeight', type: 'slider', label: 'Start Height (Px Above The Scale Line, Bottom Of Tick; Negative Goes Below):', min: -100, max: 100, step: 1, value: 0 },
        ];
        renderControlArray(TS_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_TIMELINE_SCALE_CONTROLS', TS_CONTROLS);
        findGroupContent(tab, TL, 'renderSpottyDevControls', SAD).appendChild(createDevGroupElement(SAD, tab));
        const SAD_CONTROLS = [
            { tab, group: SAD, id: 'checkboxSongAddDateEnabled', type: 'checkbox', label: 'Enabled', value: true },
            { tab, group: SAD, id: 'sliderSongAddDateFontSize', type: 'slider', label: 'Font Size (Px):', min: 6, max: 60, step: 1, value: 13 },
            { tab, group: SAD, id: 'checkboxSongAddDateBold', type: 'checkbox', label: 'Bold', value: true },
            { tab, group: SAD, id: 'colorSongAddDate', type: 'color', label: 'Font Color:', value: '#ffffff' },
            { tab, group: SAD, id: 'sliderSongAddDateLetterSpacing', type: 'slider', label: 'Letter Spacing (Px):', min: -5, max: 30, step: 0.1, value: 0 },
            { tab, group: SAD, id: 'sliderSongAddDateOpacity', type: 'slider', label: 'Opacity:', min: 0, max: 1, step: 0.01, value: 1 },
        ];
        renderControlArray(SAD_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_SONG_ADD_DATE_CONTROLS', SAD_CONTROLS);
        makeDevGroupToggleable(tab, SAD, 'checkboxSongAddDateEnabled');

        // "Album Cover Colors": a toggleable group nested inside Timeline Look (created after
        // Timeline Look's own rows so it sits below them).
        findGroupContent(tab, TL, 'renderSpottyDevControls', AC).appendChild(createDevGroupElement(AC, tab));
        const ALBUM_CONTROLS = [
            { tab, group: AC, id: 'checkboxAlbumColorsEnabled', type: 'checkbox', label: 'Enabled', value: false },
            {
                tab, group: AC, id: 'selectAlbumColorMode', type: 'select', label: 'Color Mode:', value: 'stacked',
                options: [
                    { value: 'stacked', text: 'Stacked Albums (one segment per song)' },
                    { value: 'average', text: 'Average Color (mean of covers)' },
                    { value: 'vivid', text: 'Vivid Dominant (most common hue)' },
                    { value: 'vividAverage', text: 'Vivid Dominant Average (mean of the dominant color of every album)' },
                    { value: 'vividGradient', text: 'Vivid Dominant Gradient (through the dominant color of every album)' },
                    { value: 'vividFirst', text: 'Vivid Dominant Color Of First Album' },
                    { value: 'palette', text: 'Palette Gradient (top 3 colors)' },
                ],
            },
            { tab, group: AC, id: 'sliderAlbumColorSaturation', type: 'slider', label: 'Saturation Boost (x):', min: 0, max: 2.5, step: 0.05, value: 1 },
            { tab, group: AC, id: 'sliderAlbumColorBrightness', type: 'slider', label: 'Brightness (x):', min: 0.4, max: 1.8, step: 0.05, value: 1 },
            { tab, group: AC, id: 'checkboxAlbumColorTransition', type: 'checkbox', label: 'Color Transition:', value: false },
            { tab, group: AC, id: 'sliderAlbumColorTransitionMs', type: 'slider', label: 'Color Transition Duration (Ms):', min: 0, max: 3000, step: 50, value: 300 },
        ];
        renderControlArray(ALBUM_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_ALBUM_CONTROLS', ALBUM_CONTROLS);
        makeDevGroupToggleable(tab, AC, 'checkboxAlbumColorsEnabled');

        // "No Preview": a nested subgroup of Scrub Audio, for songs that have no preview clip.
        const NP = 'No Preview';
        findGroupContent(tab, 'Scrub Audio', 'renderSpottyDevControls', NP).appendChild(createDevGroupElement(NP, tab));
        const NOPREVIEW_CONTROLS = [
            { tab, group: NP, id: 'checkboxAutoNextSong', type: 'checkbox', label: 'Auto Next Song:', value: false },
            { tab, group: NP, id: 'sliderNoPreviewHoldSeconds', type: 'slider', label: 'Hold Time On A Song With No Preview (S):', min: 1, max: 60, step: 0.5, value: 5 },
        ];
        renderControlArray(NOPREVIEW_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_NOPREVIEW_CONTROLS', NOPREVIEW_CONTROLS);

        // ---- Scrub Input: two toggleable curve groups --------------------------------------------------
        const WC = 'Wheel Scrub Per Notch Curve', SC = 'Starting Timeline Span Curve';
        const scrubInputContent = findGroupContent(tab, 'Scrub Input', 'renderSpottyDevControls', WC);
        scrubInputContent.appendChild(createDevGroupElement(WC, tab));
        scrubInputContent.appendChild(createDevGroupElement(SC, tab));
        const TS = 'Touch Scrub And Pinch';
        scrubInputContent.appendChild(createDevGroupElement(TS, tab));
        const CURVE_CONTROLS = [
            { tab, group: WC, id: 'checkboxWheelCurveEnabled', type: 'checkbox', label: 'Enabled', value: false },
            { tab, group: WC, id: 'curveEditorWheelScrubCurve', type: 'curve-editor', label: 'Curve (X: Zoom Scale, Y: Px Per Notch):', defaultPoints: [{ x: 0, y: 0.2 }, { x: 1, y: 0.7 }], defaultMethod: 'monotone' },
            {
                tab, group: WC, id: 'selectWheelCurveXRange', type: 'select', label: 'X Axis (Zoom Scale) Spans:', value: 'limits',
                options: [{ value: 'limits', text: 'Zoom Limits Min to Max' }, { value: 'full', text: 'Whole Range (2 Min to Full Timeline)' }],
            },
            { tab, group: WC, id: 'sliderWheelCurveMinPx', type: 'slider', label: 'Y Bottom: Px Per Notch At Curve 0 (Px):', min: 1, max: 400, step: 1, value: 4 },
            { tab, group: WC, id: 'sliderWheelCurveMaxPx', type: 'slider', label: 'Y Top: Px Per Notch At Curve 1 (Px):', min: 1, max: 800, step: 1, value: 160 },
            { tab, group: SC, id: 'checkboxStartSpanCurveEnabled', type: 'checkbox', label: 'Enabled', value: false },
            { tab, group: SC, id: 'curveEditorStartSpanCurve', type: 'curve-editor', label: 'Curve (X: Timeline Position, Y: Starting Span):', defaultPoints: [{ x: 0, y: 0.55 }, { x: 1, y: 0.55 }], defaultMethod: 'monotone' },
            { tab, group: SC, id: 'sliderStartSpanCurveMinDays', type: 'slider', label: 'Y Bottom: Span At Curve 0 (Days):', min: 0.01, max: 4805, step: 0.01, value: 7 },
            { tab, group: SC, id: 'sliderStartSpanCurveMaxDays', type: 'slider', label: 'Y Top: Span At Curve 1 (Days):', min: 0.01, max: 4805, step: 0.01, value: 1200 },
            { tab, group: SC, id: 'checkboxStartSpanApplyOnJump', type: 'checkbox', label: 'Also Apply On Double-Click, Home And End:', value: true },
            // Phones have no wheel: one finger and a two-finger pinch have their own settings, separate from the wheel's.
            { tab, group: TS, id: 'sliderTouchScrubSpeed', type: 'slider', label: 'One-Finger Scrub Speed (x):', min: 0.05, max: 10, step: 0.05, value: 1 },
            { tab, group: TS, id: 'sliderTouchScrubAcceleration', type: 'slider', label: 'Scrub Acceleration With Finger Speed (x):', min: 0, max: 5, step: 0.05, value: 0 },
            { tab, group: TS, id: 'sliderTouchStartThreshold', type: 'slider', label: 'Drag Start Threshold (Px):', min: 0, max: 40, step: 1, value: 4 },
            { tab, group: TS, id: 'checkboxInvertTouchScrub', type: 'checkbox', label: 'Invert One-Finger Scrub Direction:', value: false },
            { tab, group: TS, id: 'sliderPinchZoomSpeed', type: 'slider', label: 'Pinch Zoom Speed (x):', min: 0.1, max: 5, step: 0.05, value: 1 },
            { tab, group: TS, id: 'checkboxInvertPinch', type: 'checkbox', label: 'Invert Pinch Direction:', value: false },
        ];
        renderControlArray(CURVE_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_CURVE_CONTROLS', CURVE_CONTROLS);
        makeDevGroupToggleable(tab, WC, 'checkboxWheelCurveEnabled');
        makeDevGroupToggleable(tab, SC, 'checkboxStartSpanCurveEnabled');

        // ---- UI Layout: Track Title Button Animation (toggleable) + Background (subgroup) ------------------
        const TA = 'Track Title Button Animation', BG = 'Background';
        const uiLayoutContent = findGroupContent(tab, 'UI Layout', 'renderSpottyDevControls', TA);
        uiLayoutContent.appendChild(createDevGroupElement(TA, tab));
        uiLayoutContent.appendChild(createDevGroupElement(BG, tab));
        const FT = 'Font';
        uiLayoutContent.appendChild(createDevGroupElement(FT, tab));
        const FONT_CONTROLS = [{
            tab, group: FT, id: 'selectUiFont', type: 'select', label: 'Font For All Text:', value: 'system',
            options: [
                ['system', 'System Default'], ['Inter', 'Inter'], ['Roboto', 'Roboto'], ['Montserrat', 'Montserrat'], ['Poppins', 'Poppins'],
                ['Lato', 'Lato'], ['Raleway', 'Raleway'], ['Nunito', 'Nunito'], ['Space Grotesk', 'Space Grotesk'], ['Oswald', 'Oswald'],
                ['Bebas Neue', 'Bebas Neue'], ['Playfair Display', 'Playfair Display'], ['Merriweather', 'Merriweather'], ['Lora', 'Lora'],
                ['DM Serif Display', 'DM Serif Display'], ['Pacifico', 'Pacifico (Script)'], ['Permanent Marker', 'Permanent Marker'],
                ['Caveat', 'Caveat (Handwriting)'], ['Orbitron', 'Orbitron (Futuristic)'], ['Space Mono', 'Space Mono (Monospace)'],
            ].map(([value, text]) => ({ value, text })),
        }];
        renderControlArray(FONT_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_FONT_CONTROLS', FONT_CONTROLS);

        // UI Layout > Text: per-element Font Size/Color/Bold/Italic/Underline/Letter
        // Spacing/Line Spacing/Opacity/Wrap/Outline/Enabled, ported 2026-10-25 -- see
        // buildSpottyTextElementGroup()'s own top comment for the full account. Replaces
        // the old Title/Artist/Meta Text Scale + Min/Pref/Max clamp sliders (now removed).
        buildSpottyTextElementGroup(tab, uiLayoutContent, 'Song Title', { size: 44, color: '#f2f2f2', bold: true, lineSpacing: 1.1 });
        buildSpottyTextElementGroup(tab, uiLayoutContent, 'Artist', { size: 22, color: '#c9d1d9', bold: false, lineSpacing: 1.2 });
        buildSpottyTextElementGroup(tab, uiLayoutContent, 'Album & Date', { size: 14, color: '#8b94a1', bold: false, lineSpacing: 1.2 });

        // ---- UI Layout: Volume Button (toggleable) + Album Cover ------------------------------------------------
        const ICON_STYLE_OPTIONS = Array.from({ length: 15 }, (_, i) => ({ value: String(i), text: 'Style ' + (i + 1) }));
        const VB = 'Volume Button', AC2 = 'Album Cover';
        uiLayoutContent.appendChild(createDevGroupElement(VB, tab));
        uiLayoutContent.appendChild(createDevGroupElement(AC2, tab));
        // Global Override: a toggle group. Tick the buttons it applies to, then set one colour and opacity, and optionally the standard animation.
        const GO = 'Global Override', GOA = 'Standard Button Animation';
        const GO_CONTROLS = [
            { tab, group: GO, id: 'checkboxGlobalOverrideEnabled', type: 'checkbox', label: 'Enabled', value: false },
            { tab, group: GO, id: 'checkboxOverridePlay', type: 'checkbox', label: 'Play Button', value: false },
            { tab, group: GO, id: 'checkboxOverrideNext', type: 'checkbox', label: 'Next Button', value: false },
            { tab, group: GO, id: 'checkboxOverrideLast', type: 'checkbox', label: 'Last Button', value: false },
            { tab, group: GO, id: 'checkboxOverrideShuffle', type: 'checkbox', label: 'Shuffle Button', value: false },
            { tab, group: GO, id: 'checkboxOverrideVolume', type: 'checkbox', label: 'Volume Button', value: false },
            { tab, group: GO, id: 'colorGlobalOverride', type: 'color', label: 'Color:', value: '#ffffff' },
            { tab, group: GO, id: 'sliderGlobalOverrideOpacity', type: 'slider', label: 'Opacity (%):', min: 0, max: 100, step: 1, value: 100 },
        ];
        uiLayoutContent.insertBefore(createDevGroupElement(GO, tab), uiLayoutContent.firstChild);
        renderControlArray(GO_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_GLOBAL_OVERRIDE', GO_CONTROLS);
        makeDevGroupToggleable(tab, GO, 'checkboxGlobalOverrideEnabled');
        const GOA_CONTROLS = [
            { tab, group: GOA, id: 'checkboxGlobalOverrideAnim', type: 'checkbox', label: 'Enabled', value: false },
            { tab, group: GOA, id: 'sliderGlobalAnimTime', type: 'slider', label: 'Animation Time (Ms):', min: 0, max: 1500, step: 10, value: 150 },
            { tab, group: GOA, id: 'sliderGlobalAnimHoverSize', type: 'slider', label: 'Scale On Hover (%):', min: 10, max: 300, step: 1, value: 115 },
            { tab, group: GOA, id: 'sliderGlobalAnimClickSize', type: 'slider', label: 'Scale On Click (%):', min: 10, max: 300, step: 1, value: 85 },
            { tab, group: GOA, id: 'sliderGlobalAnimReleaseSize', type: 'slider', label: 'Scale On Release (%):', min: 10, max: 300, step: 1, value: 120 },
            { tab, group: GOA, id: 'sliderGlobalAnimHoverOpacity', type: 'slider', label: 'Opacity On Hover (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: GOA, id: 'sliderGlobalAnimClickOpacity', type: 'slider', label: 'Opacity On Click (%):', min: 0, max: 100, step: 1, value: 70 },
        ];
        findGroupContent(tab, GO, 'renderSpottyDevControls', 'checkboxGlobalOverrideEnabled').appendChild(createDevGroupElement(GOA, tab));
        renderControlArray(GOA_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_GLOBAL_OVERRIDE_ANIM', GOA_CONTROLS);
        makeDevGroupToggleable(tab, GOA, 'checkboxGlobalOverrideAnim');
        // Song Timeline: the playback bar along the album cover's bottom edge (a toggle group; its animation settings are a sub-group)
        const SONG = 'Song Timeline', SONGA = 'Song Timeline Animation';
        uiLayoutContent.appendChild(createDevGroupElement(SONG, tab));
        const SONG_CONTROLS = [
            { tab, group: SONG, id: 'checkboxSongBarEnabled', type: 'checkbox', label: 'Enabled', value: false },
            { tab, group: SONG, id: 'sliderSongBarHeight', type: 'slider', label: 'Timeline Width (Px):', min: 1, max: 60, step: 1, value: 4 },
            { tab, group: SONG, id: 'colorSongBarFill', type: 'color', label: 'Bar Fill Color:', value: '#1db954' },
            { tab, group: SONG, id: 'colorSongBarEmpty', type: 'color', label: 'Bar Empty Color:', value: '#3a3f47' },
            { tab, group: SONG, id: 'sliderSongBarClickTol', type: 'slider', label: 'Click Tolerance Above Bar (Px):', min: 0, max: 100, step: 1, value: 6 },
            { tab, group: SONG, id: 'sliderSongBarOpacity', type: 'slider', label: 'Opacity (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: SONG, id: 'checkboxSongBarMarker', type: 'checkbox', label: 'Progress Marker Circle:', value: false },
            { tab, group: SONG, id: 'sliderSongBarMarkerRadius', type: 'slider', label: 'Marker Radius (Px):', min: 1, max: 40, step: 0.5, value: 6 },
            { tab, group: SONG, id: 'sliderSongBarMarkerOpacity', type: 'slider', label: 'Marker Opacity (%):', min: 0, max: 100, step: 1, value: 100 },
        ];
        renderControlArray(SONG_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_SONGBAR', SONG_CONTROLS);
        makeDevGroupToggleable(tab, SONG, 'checkboxSongBarEnabled');
        const SONGA_CONTROLS = [
            { tab, group: SONGA, id: 'sliderSongBarHoverOpacity', type: 'slider', label: 'Opacity On Album Cover Hover (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: SONGA, id: 'sliderSongBarClickOpacity', type: 'slider', label: 'Opacity On Click (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: SONGA, id: 'sliderSongBarAnimTime', type: 'slider', label: 'Animation Duration (Ms):', min: 0, max: 1500, step: 10, value: 160 },
        ];
        findGroupContent(tab, SONG, 'renderSpottyDevControls', 'checkboxSongBarEnabled').appendChild(createDevGroupElement(SONGA, tab));
        renderControlArray(SONGA_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_SONGBAR_ANIM', SONGA_CONTROLS);
        // The marker's radius and opacity show only while the marker circle is on
        const sbMarkerBox = document.getElementById('checkboxSongBarMarker');
        const sbSync = () => {
            const on = !!(sbMarkerBox && sbMarkerBox.checked);
            ['sliderSongBarMarkerRadius', 'sliderSongBarMarkerOpacity'].forEach(id => { const r = document.getElementById(id); if (r && r.closest('.dev-row')) r.closest('.dev-row').style.display = on ? '' : 'none'; });
        };
        setInterval(sbSync, 700);
        sbSync();
        const VB_CONTROLS = [
            { tab, group: VB, id: 'checkboxVolumeButtonEnabled', type: 'checkbox', label: 'Enabled (Off = Click The Icon, Default Look)', value: true },
            { tab, group: VB, id: 'sliderVolMutedOpacity', type: 'slider', label: 'Muted Icon Opacity (%):', min: 0, max: 100, step: 1, value: 40 },
            { tab, group: VB, id: 'sliderVolIconOpacity', type: 'slider', label: 'Icon Opacity When Not Muted (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: VB, id: 'sliderVolHoverOpacity', type: 'slider', label: 'Icon Opacity On Hover (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: VB, id: 'sliderVolEdgeOffset', type: 'slider', label: 'Offset From Left Edge (Px):', min: 0, max: 300, step: 1, value: 14 },
            { tab, group: VB, id: 'sliderVolIconSize', type: 'slider', label: 'Icon Size (Px):', min: 10, max: 120, step: 1, value: 24 },
            { tab, group: VB, id: 'sliderVolIconOffsetX', type: 'slider', label: 'Icon X Offset (Px):', min: -300, max: 300, step: 1, value: 0 },
            { tab, group: VB, id: 'sliderVolCircleRadius', type: 'slider', label: 'Slider Circle Radius (Px):', min: 2, max: 30, step: 0.5, value: 7 },
            { tab, group: VB, id: 'sliderVolBarWidth', type: 'slider', label: 'Slider Bar Width (Px):', min: 2, max: 40, step: 0.5, value: 8 },
            { tab, group: VB, id: 'sliderVolBarLength', type: 'slider', label: 'Slider Bar Length (Px):', min: 40, max: 500, step: 1, value: 130 },
            { tab, group: VB, id: 'colorVolBarFill', type: 'color', label: 'Slider Bar Fill Color:', value: '#1db954' },
            { tab, group: VB, id: 'colorVolBarTrack', type: 'color', label: 'Slider Bar Empty Color (Shown At 20%):', value: '#ffffff' },
            { tab, group: VB, id: 'colorVolCircle', type: 'color', label: 'Slider Circle Color:', value: '#ffffff' },
            { tab, group: VB, id: 'sliderVolHoverTolerance', type: 'slider', label: 'Hover Tolerance Outside Icon And Slider (Px):', min: 0, max: 200, step: 1, value: 30 },
            { tab, group: VB, id: 'sliderVolClickTolerance', type: 'slider', label: 'Click Tolerance Outside Slider (Px):', min: 0, max: 200, step: 1, value: 12 },
            { tab, group: VB, id: 'selectVolIconStyle', type: 'select', label: 'Icon Style:', value: '0', options: ICON_STYLE_OPTIONS },
            { tab, group: VB, id: 'sliderVolAnimDuration', type: 'slider', label: 'Drop Down / Rise Up Animation Time At Speed 1 (Ms):', min: 0, max: 3000, step: 10, value: 350 },
            { tab, group: VB, id: 'curveEditorVolAnimSpeedCurve', type: 'curve-editor', label: 'Animation Speed Curve (X: Progress Of The Drop / Rise, Y: Speed, 1 = The Time Slider):', defaultPoints: [{ x: 0, y: 1 }, { x: 1, y: 0.35 }], defaultMethod: 'monotone' },
        ];
        const AC2_CONTROLS = [
            { tab, group: AC2, id: 'sliderCoverScale', type: 'slider', label: 'Album Cover Scale (x):', min: 0.2, max: 4, step: 0.05, value: 1 },
            { tab, group: AC2, id: 'sliderCoverOffsetX', type: 'slider', label: 'Album Cover X Offset (Px):', min: -1500, max: 1500, step: 1, value: 0 },
            { tab, group: AC2, id: 'sliderCoverOffsetY', type: 'slider', label: 'Album Cover Y Offset (Px):', min: -1500, max: 1500, step: 1, value: 0 },
            // Shows the cover's real box (the outline) and its centre (the small ring): for checking where the cover sits.
            { tab, group: AC2, id: 'checkboxCoverBoundingBox', type: 'checkbox', label: 'Bounding Box:', value: false },
        ];
        renderControlArray(VB_CONTROLS, 'renderSpottyDevControls');
        renderControlArray(AC2_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_VB_CONTROLS', VB_CONTROLS);
        registerDevControlArray('SPOTTY_AC2_CONTROLS', AC2_CONTROLS);
        makeDevGroupToggleable(tab, VB, 'checkboxVolumeButtonEnabled');

        // Shuffle Button: the same settings as Volume Button, minus the slider and animation ones
        const SHB = 'Shuffle Button';
        uiLayoutContent.appendChild(createDevGroupElement(SHB, tab));
        const SHB_CONTROLS = [
            { tab, group: SHB, id: 'checkboxShuffleButtonEnabled', type: 'checkbox', label: 'Enabled', value: true },
            { tab, group: SHB, id: 'sliderShuffleIconSize', type: 'slider', label: 'Icon Size (Px):', min: 10, max: 120, step: 1, value: 20 },
            { tab, group: SHB, id: 'sliderShuffleIconOffsetX', type: 'slider', label: 'Icon X Offset (Px):', min: -300, max: 300, step: 1, value: 0 },
            { tab, group: SHB, id: 'sliderShuffleOffOpacity', type: 'slider', label: 'Off Icon Opacity (%):', min: 0, max: 100, step: 1, value: 45 },
            { tab, group: SHB, id: 'sliderShuffleOnOpacity', type: 'slider', label: 'On Icon Opacity (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: SHB, id: 'sliderShuffleEdgeOffset', type: 'slider', label: 'Offset From Right Edge (Px):', min: 0, max: 300, step: 1, value: 14 },
            { tab, group: SHB, id: 'sliderShuffleClickTolerance', type: 'slider', label: 'Click Tolerance Outside Button (Px):', min: 0, max: 200, step: 1, value: 0 },
            { tab, group: SHB, id: 'sliderShuffleHoverTolerance', type: 'slider', label: 'Hover Tolerance Outside Button (Px):', min: 0, max: 200, step: 1, value: 0 },
            { tab, group: SHB, id: 'colorShuffleIcon', type: 'color', label: 'Icon Color (Off):', value: '#f2f2f2' },
            { tab, group: SHB, id: 'colorShuffleOn', type: 'color', label: 'Icon Color (On):', value: '#1db954' },
            { tab, group: SHB, id: 'selectShuffleIconStyle', type: 'select', label: 'Icon Style:', value: '0', options: ICON_STYLE_OPTIONS },
        ];
        renderControlArray(SHB_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_SHUFFLE_CONTROLS', SHB_CONTROLS);
        makeDevGroupToggleable(tab, SHB, 'checkboxShuffleButtonEnabled');
        // Shuffle Button Animation: the same hover / click / release animation as the Play and Next/Last buttons
        const SHBA = 'Shuffle Button Animation';
        const SHBA_CONTROLS = [
            { tab, group: SHBA, id: 'checkboxShuffleAnimEnabled', type: 'checkbox', label: 'Enabled', value: false },
            { tab, group: SHBA, id: 'sliderShuffleAnimTime', type: 'slider', label: 'Animation Time (Ms):', min: 0, max: 1500, step: 10, value: 160 },
            { tab, group: SHBA, id: 'sliderShuffleAnimHoverSize', type: 'slider', label: 'Size On Hover (Px):', min: 8, max: 120, step: 1, value: 24 },
            { tab, group: SHBA, id: 'sliderShuffleAnimClickSize', type: 'slider', label: 'Size On Click (Px):', min: 8, max: 120, step: 1, value: 18 },
            { tab, group: SHBA, id: 'sliderShuffleAnimReleaseSize', type: 'slider', label: 'Size On Release (Px):', min: 8, max: 120, step: 1, value: 20 },
            { tab, group: SHBA, id: 'sliderShuffleAnimHoverOpacity', type: 'slider', label: 'Opacity On Hover (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: SHBA, id: 'sliderShuffleAnimClickOpacity', type: 'slider', label: 'Opacity On Click (%):', min: 0, max: 100, step: 1, value: 100 },
        ];
        findGroupContent(tab, SHB, 'renderSpottyDevControls', 'checkboxShuffleButtonEnabled').appendChild(createDevGroupElement(SHBA, tab));
        renderControlArray(SHBA_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_SHUFFLE_ANIM', SHBA_CONTROLS);
        makeDevGroupToggleable(tab, SHBA, 'checkboxShuffleAnimEnabled');
        // Filter Button (under Shuffle): the button, the grayed-out look of filtered songs, what filtering does to playback, and the filter panel.
        const FILTER_ICON_OPTIONS = ['Funnel', 'Sliders', 'Equalizer', 'Magnifier', 'Checklist', 'Tuner Dials', 'Sort Bars', 'Sieve', 'Toggle', 'Eye', 'Tag', 'Star', 'Target', 'Magic Wand', 'Layers'].map((text, i) => ({ value: String(i), text }));
        const FLB = 'Filter Button';
        uiLayoutContent.appendChild(createDevGroupElement(FLB, tab));
        const FLB_CONTROLS = [
            { tab, group: FLB, id: 'checkboxFilterButtonEnabled', type: 'checkbox', label: 'Enabled (Off Also Turns The Filter Off)', value: true },
            { tab, group: FLB, id: 'sliderFilterIconSize', type: 'slider', label: 'Icon Size (Px):', min: 10, max: 120, step: 1, value: 20 },
            { tab, group: FLB, id: 'sliderFilterIconOffsetX', type: 'slider', label: 'Icon X Offset (Px):', min: -300, max: 300, step: 1, value: 0 },
            { tab, group: FLB, id: 'sliderFilterGapBelowShuffle', type: 'slider', label: 'Gap Below Shuffle (Px):', min: -40, max: 200, step: 1, value: 0 },
            { tab, group: FLB, id: 'sliderFilterEdgeOffset', type: 'slider', label: 'Offset From Right Edge (Px):', min: 0, max: 300, step: 1, value: 14 },
            { tab, group: FLB, id: 'sliderFilterOffOpacity', type: 'slider', label: 'Off Icon Opacity (%):', min: 0, max: 100, step: 1, value: 45 },
            { tab, group: FLB, id: 'sliderFilterOnOpacity', type: 'slider', label: 'On Icon Opacity (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: FLB, id: 'colorFilterIcon', type: 'color', label: 'Icon Color (Off):', value: '#f2f2f2' },
            { tab, group: FLB, id: 'colorFilterOn', type: 'color', label: 'Icon Color (On):', value: '#1db954' },
            { tab, group: FLB, id: 'sliderFilterClickTolerance', type: 'slider', label: 'Click Tolerance Outside Button (Px):', min: 0, max: 200, step: 1, value: 0 },
            { tab, group: FLB, id: 'sliderFilterHoverTolerance', type: 'slider', label: 'Hover Tolerance Outside Button (Px):', min: 0, max: 200, step: 1, value: 0 },
            // what a filtered-out song looks like and how it behaves
            { tab, group: FLB, id: 'colorFilterGray', type: 'color', label: 'Filtered-Out Bar Color:', value: '#8a8f98' },
            { tab, group: FLB, id: 'sliderFilterGrayOpacity', type: 'slider', label: 'Filtered-Out Bar Opacity (%):', min: 0, max: 100, step: 1, value: 35 },
            { tab, group: FLB, id: 'selectFilterMissing', type: 'select', label: 'Songs With No Audio Data:', value: 'hide', options: [{ value: 'hide', text: 'Filter Out' }, { value: 'keep', text: 'Keep' }] },
            { tab, group: FLB, id: 'checkboxFilterSkipOnStep', type: 'checkbox', label: 'Next / Last / Scrolling Skip Filtered-Out Songs', value: true },
            { tab, group: FLB, id: 'selectFilterIconStyle', type: 'select', label: 'Icon Style:', value: '0', options: FILTER_ICON_OPTIONS },
            // a filtered-out song shown on the timeline (clicked): grayscale cover, plays nothing, then the playhead returns to the playing song
            { tab, group: FLB, id: 'sliderFilterCoverGrayscale', type: 'slider', label: 'Filtered-Out Cover Grayscale (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: FLB, id: 'sliderFilterCoverBrightness', type: 'slider', label: 'Filtered-Out Cover Brightness (%):', min: 10, max: 200, step: 1, value: 100 },
            { tab, group: FLB, id: 'sliderFilterCoverTransitionMs', type: 'slider', label: 'Cover Grayscale Fade (Ms):', min: 0, max: 2000, step: 10, value: 250 },
            { tab, group: FLB, id: 'sliderFilterGraphGrayscale', type: 'slider', label: 'Graph: Filtered-Out Album Color Grayscale (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: FLB, id: 'checkboxFilterReturnEnabled', type: 'checkbox', label: 'Return To Playing Song After A Filtered-Out Click', value: true },
            { tab, group: FLB, id: 'sliderFilterReturnDelay', type: 'slider', label: 'Return Delay (S):', min: 0, max: 60, step: 0.1, value: 3 },
            { tab, group: FLB, id: 'sliderFilterReturnDuration', type: 'slider', label: 'Return Animation Time (Ms):', min: 0, max: 5000, step: 10, value: 600 },
            { tab, group: FLB, id: 'selectFilterReturnEasing', type: 'select', label: 'Return Animation Easing:', value: 'ease-in-out', options: [{ value: 'ease-in-out', text: 'Ease In Out' }, { value: 'ease-out', text: 'Ease Out' }, { value: 'ease-in', text: 'Ease In' }, { value: 'linear', text: 'Linear' }] },
            { tab, group: FLB, id: 'selectFilterReturnRestore', type: 'select', label: 'Text And Cover Change Back:', value: 'end', options: [{ value: 'end', text: 'When The Playhead Arrives' }, { value: 'start', text: 'When It Starts Moving' }] },
            // timeline scale: a tick or number whose time span has no song passing the filter
            { tab, group: FLB, id: 'checkboxFilterGrayTicks', type: 'checkbox', label: 'Gray Out Scale Ticks And Numbers With No Matching Song', value: true },
            { tab, group: FLB, id: 'colorFilterTickGray', type: 'color', label: 'Grayed Tick And Number Color:', value: '#6b7280' },
            { tab, group: FLB, id: 'sliderFilterTickGrayOpacity', type: 'slider', label: 'Grayed Tick Opacity (%):', min: 0, max: 100, step: 1, value: 25 },
            { tab, group: FLB, id: 'sliderFilterNumberGrayOpacity', type: 'slider', label: 'Grayed Number Opacity (%):', min: 0, max: 100, step: 1, value: 25 },
            // the panel
            { tab, group: FLB, id: 'checkboxFilterCloseOnOutside', type: 'checkbox', label: 'Panel: Close When Clicking Elsewhere', value: true },
            { tab, group: FLB, id: 'sliderFilterPanelWidth', type: 'slider', label: 'Panel Default Width (Px):', min: 160, max: 600, step: 1, value: 260 },
            { tab, group: FLB, id: 'sliderFilterPanelFontSize', type: 'slider', label: 'Panel Font Size (Px):', min: 8, max: 32, step: 1, value: 12 },
            { tab, group: FLB, id: 'sliderFilterPanelOffsetX', type: 'slider', label: 'Panel X Offset (Px):', min: -400, max: 400, step: 1, value: 0 },
            { tab, group: FLB, id: 'sliderFilterPanelOffsetY', type: 'slider', label: 'Panel Y Offset (Px):', min: -100, max: 400, step: 1, value: 6 },
            { tab, group: FLB, id: 'colorFilterPanelBg', type: 'color', label: 'Panel Background Color:', value: '#14161a' },
            { tab, group: FLB, id: 'sliderFilterPanelBgOpacity', type: 'slider', label: 'Panel Background Opacity (%):', min: 0, max: 100, step: 1, value: 92 },
            { tab, group: FLB, id: 'colorFilterPanelAccent', type: 'color', label: 'Panel Slider Color:', value: '#1db954' },
        ];
        renderControlArray(FLB_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_FILTER_CONTROLS', FLB_CONTROLS);
        // Volume Button Animation: the same hover / click / release animation as the other buttons. Separate from the slider's open/close animation.
        const VBA = 'Volume Button Animation';
        const VBA_CONTROLS = [
            { tab, group: VBA, id: 'checkboxVolBtnAnimEnabled', type: 'checkbox', label: 'Enabled', value: false },
            { tab, group: VBA, id: 'sliderVolBtnAnimTime', type: 'slider', label: 'Animation Time (Ms):', min: 0, max: 1500, step: 10, value: 160 },
            { tab, group: VBA, id: 'sliderVolBtnAnimHoverSize', type: 'slider', label: 'Size On Hover (Px):', min: 8, max: 120, step: 1, value: 24 },
            { tab, group: VBA, id: 'sliderVolBtnAnimClickSize', type: 'slider', label: 'Size On Click (Px):', min: 8, max: 120, step: 1, value: 18 },
            { tab, group: VBA, id: 'sliderVolBtnAnimReleaseSize', type: 'slider', label: 'Size On Release (Px):', min: 8, max: 120, step: 1, value: 20 },
            { tab, group: VBA, id: 'sliderVolBtnAnimHoverOpacity', type: 'slider', label: 'Opacity On Hover (%):', min: 0, max: 100, step: 1, value: 100 },
            { tab, group: VBA, id: 'sliderVolBtnAnimClickOpacity', type: 'slider', label: 'Opacity On Click (%):', min: 0, max: 100, step: 1, value: 100 },
        ];
        findGroupContent(tab, VB, 'renderSpottyDevControls', 'checkboxVolumeButtonEnabled').appendChild(createDevGroupElement(VBA, tab));
        renderControlArray(VBA_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_VOLBTN_ANIM', VBA_CONTROLS);
        makeDevGroupToggleable(tab, VBA, 'checkboxVolBtnAnimEnabled');

        // ---- UI Layout: Play Button + Next And Last Song Buttons (same settings; each toggleable, each with a toggleable Button Animation subgroup) ----
        // The button controls (Play / Pause, Next Song, Last Song) exist so a hotkey can be assigned to them in the dev panel.
        const BTN_DEF = {
            Play: { on: false, color: '#ffffff', size: 56, op: 90, hoverOp: 100, time: 150, hoverSize: 64, clickSize: 48, animHoverOp: 100, animClickOp: 70, releaseSize: 70 },
            Nav: { on: true, color: '#f2f2f2', size: 26, op: 100, hoverOp: 100, time: 150, hoverSize: 30, clickSize: 22, animHoverOp: 100, animClickOp: 70, releaseSize: 32 },
        };
        [
            ['Play', 'Play Button', 'Play Button Animation', [['buttonPlayPause', 'Play / Pause (Left-Click To Set A Hotkey)']]],
            ['Nav', 'Next And Last Song Buttons', 'Next And Last Button Animation', [['buttonNextSong', 'Next Song (Left-Click To Set A Hotkey)'], ['buttonPrevSong', 'Last Song (Left-Click To Set A Hotkey)']]],
        ].forEach(([P, G, A, keys]) => {
            const d = BTN_DEF[P];
            uiLayoutContent.appendChild(createDevGroupElement(G, tab));
            const main = [
                ...(P === 'Play' ? [
                    { tab, group: G, id: 'sliderPlayGlyphOpacityPlaying', type: 'slider', label: 'Icon Opacity When Playing (%):', min: 0, max: 100, step: 1, value: 100 },
                    { tab, group: G, id: 'sliderPlayGlyphOpacityPaused', type: 'slider', label: 'Icon Opacity When Paused (%):', min: 0, max: 100, step: 1, value: 100 },
                    { tab, group: G, id: 'selectPlayIconStyle', type: 'select', label: 'Play Icon Style:', value: '0', options: ICON_STYLE_OPTIONS },
                    { tab, group: G, id: 'selectPauseIconStyle', type: 'select', label: 'Pause Icon Style:', value: '0', options: ICON_STYLE_OPTIONS },
                    { tab, group: G, id: 'sliderPlayClickTolerance', type: 'slider', label: 'Click Tolerance Outside Button (Px):', min: 0, max: 200, step: 1, value: 0 },
                    { tab, group: G, id: 'sliderPlayHoverTolerance', type: 'slider', label: 'Hover Tolerance Outside Button (Px):', min: 0, max: 200, step: 1, value: 0 },
                ] : []),
                ...(P === 'Nav' ? [{ tab, group: G, id: 'selectNavIconStyle', type: 'select', label: 'Icon Style:', value: '0', options: ICON_STYLE_OPTIONS }] : []),
                ...(P === 'Nav' ? [
                    { tab, group: G, id: 'sliderLastButtonEdgeOffset', type: 'slider', label: 'Last Button Offset From Left Edge (Px):', min: 0, max: 300, step: 1, value: 14 },
                    { tab, group: G, id: 'sliderNextButtonEdgeOffset', type: 'slider', label: 'Next Button Offset From Right Edge (Px):', min: 0, max: 300, step: 1, value: 14 },
                    { tab, group: G, id: 'sliderNavClickTolerance', type: 'slider', label: 'Click Tolerance Outside Button (Px):', min: 0, max: 200, step: 1, value: 0 },
                    { tab, group: G, id: 'sliderNavHoverTolerance', type: 'slider', label: 'Hover Tolerance Outside Button (Px):', min: 0, max: 200, step: 1, value: 0 },
                ] : []),
                { tab, group: G, id: 'checkbox' + P + 'ButtonEnabled', type: 'checkbox', label: 'Enabled', value: d.on },
                { tab, group: G, id: 'color' + P + 'Button', type: 'color', label: 'Color:', value: d.color },
                { tab, group: G, id: 'slider' + P + 'ButtonSize', type: 'slider', label: 'Size (Px):', min: 8, max: 300, step: 1, value: d.size },
                { tab, group: G, id: 'slider' + P + 'ButtonOpacity', type: 'slider', label: 'Opacity (%):', min: 0, max: 100, step: 1, value: d.op },
                { tab, group: G, id: 'slider' + P + 'ButtonHoverOpacity', type: 'slider', label: 'Opacity On Hover (%):', min: 0, max: 100, step: 1, value: d.hoverOp },
                ...keys.map(([id, label]) => ({ tab, group: G, id, type: 'button', label, skipDeviceCheckbox: true })),
            ];
            renderControlArray(main, 'renderSpottyDevControls');
            registerDevControlArray('SPOTTY_BTN_' + P, main);
            findGroupContent(tab, G, 'renderSpottyDevControls', 'checkbox' + P + 'ButtonEnabled').appendChild(createDevGroupElement(A, tab));
            const anim = [
                { tab, group: A, id: 'checkbox' + P + 'AnimEnabled', type: 'checkbox', label: 'Enabled', value: false },
                { tab, group: A, id: 'slider' + P + 'AnimTime', type: 'slider', label: 'Animation Time (Ms):', min: 0, max: 1500, step: 10, value: d.time },
                { tab, group: A, id: 'slider' + P + 'AnimHoverSize', type: 'slider', label: 'Size On Hover (Px):', min: 8, max: 300, step: 1, value: d.hoverSize },
                { tab, group: A, id: 'slider' + P + 'AnimClickSize', type: 'slider', label: 'Size On Click (Px):', min: 8, max: 300, step: 1, value: d.clickSize },
                { tab, group: A, id: 'slider' + P + 'AnimHoverOpacity', type: 'slider', label: 'Opacity On Hover (%):', min: 0, max: 100, step: 1, value: d.animHoverOp },
                { tab, group: A, id: 'slider' + P + 'AnimClickOpacity', type: 'slider', label: 'Opacity On Click (%):', min: 0, max: 100, step: 1, value: d.animClickOp },
                { tab, group: A, id: 'slider' + P + 'AnimReleaseSize', type: 'slider', label: 'Size On Release (Px):', min: 8, max: 300, step: 1, value: d.releaseSize },
            ];
            renderControlArray(anim, 'renderSpottyDevControls');
            registerDevControlArray('SPOTTY_BTNANIM_' + P, anim);
            makeDevGroupToggleable(tab, G, 'checkbox' + P + 'ButtonEnabled');
            makeDevGroupToggleable(tab, A, 'checkbox' + P + 'AnimEnabled');
        });

        // ---- Debug group: global tools ported from HANDY DANDIES (logic in src/app/debugTools.js, log lines in debugLog.js) ----
        const DBG = 'Debug';
        const dbgBtn = (id, label) => ({ tab, group: DBG, id, type: 'button', label, skipDeviceCheckbox: true });
        const DEBUG_CONTROLS = [
            dbgBtn('buttonDebugPause', 'PAUSE'),
            { tab, group: DBG, id: 'checkboxExportLogsUiButton', type: 'checkbox', label: 'ADD UI BUTTON (On-Screen Export Logs, Top Left)', value: false },
            { tab, group: DBG, id: 'checkboxShowFrameRate', type: 'checkbox', label: 'Show Frame Rate', value: false },
            { tab, group: DBG, id: 'colorFrameRateText', type: 'color', label: 'Frame Rate Text Color:', value: '#ffffff' },
            { tab, group: DBG, id: 'sliderFrameRateRefreshMs', type: 'slider', label: 'Frame Rate Refresh Rate (Ms Between Updates):', min: 100, max: 5000, step: 50, value: 500 },
            { tab, group: DBG, id: 'checkboxLogPlayback', type: 'checkbox', label: 'Log Playback Timing (Songs, Clips, Handoff, Spotify Embed)', value: false },
            { tab, group: DBG, id: 'checkboxLogPreload', type: 'checkbox', label: 'Log Preloading (Batches, URL And Audio Arrival Times)', value: false },
        ];
        renderControlArray(DEBUG_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_DEBUG_CONTROLS', DEBUG_CONTROLS);

        // Log Tools: Pause Logs/Copy All Logs/Clear All Logs/Export Logs, merged into ONE .dev-row
        // (direct report, 2026-10-25: "they each have their own drag icon right now... their title
        // isnt capitilized") -- matches the convention just built into the canonical template
        // (.claude/TEMPLATE_DEV_PANEL.html's own Debug Log Tools cluster): ALL CAPS labels, a single
        // shared drag handle (one .dev-row -> injectRowDragHandles() gives it exactly one, same as
        // every other row -- no new drag mechanism needed, just not splitting these into 4 rows).
        // Inserted right after PAUSE's own row, where these 4 buttons used to individually sit.
        {
            const logToolsRow = document.createElement('div');
            logToolsRow.className = 'dev-row dev-log-tools-row';
            logToolsRow.dataset.skipDeviceCheckbox = '1'; // Desktop-only buttons: a "Show in Mobile/Landscape" checkbox here would do nothing
            const mkLogToolBtn = (id, label) => {
                const b = document.createElement('button');
                b.type = 'button'; b.id = id; b.className = 'dev-action-button'; b.textContent = label;
                return b;
            };
            logToolsRow.append(
                mkLogToolBtn('buttonDebugPauseLogs', 'PAUSE LOGS'),
                mkLogToolBtn('buttonDebugCopyAll', 'COPY ALL LOGS'),
                mkLogToolBtn('buttonDebugClearAll', 'CLEAR ALL LOGS'),
                mkLogToolBtn('buttonDebugExport', 'EXPORT LOGS'),
            );
            document.getElementById('buttonDebugPause').closest('.dev-row').after(logToolsRow);
        }

        // Snapshot: its own subgroup within Debug (direct request, 2026-10-25, matching Handy Dandies'
        // own Debug > Snapshot group) -- was flat alongside the other Debug buttons above. Built directly
        // (not via renderControlArray(), which only resolves TOP-LEVEL groups) so it can nest.
        {
            const debugContentForSnapshot = findGroupContent(tab, DBG, 'renderSpottyDevControls', 'buttonDebugPause');
            const snapSec = createDevGroupElement('Snapshot', tab);
            debugContentForSnapshot.appendChild(snapSec);
            const snapContent = snapSec.querySelector(':scope > .dev-section-content');
            const SNAPSHOT_CONTROLS = [
                { tab, group: 'Snapshot', id: 'checkboxSnapshotViewport', type: 'checkbox', label: 'Snapshot: Viewport And Cursor', value: true },
                { tab, group: 'Snapshot', id: 'checkboxSnapshotMouse', type: 'checkbox', label: 'Snapshot: Mouse Tracking', value: true },
                { tab, group: 'Snapshot', id: 'checkboxSnapshotPlayback', type: 'checkbox', label: 'Snapshot: Playback', value: true },
                { tab, group: 'Snapshot', id: 'checkboxSnapshotAudio', type: 'checkbox', label: 'Snapshot: Audio Clips', value: true },
                { tab, group: 'Snapshot', id: 'checkboxSnapshotTimeline', type: 'checkbox', label: 'Snapshot: Timeline', value: true },
                { tab, group: 'Snapshot', id: 'checkboxSnapshotSettings', type: 'checkbox', label: 'Snapshot: Settings Changed From Default', value: true },
                dbgBtn('buttonDebugSnapshot', 'Take Snapshot'),
            ];
            SNAPSHOT_CONTROLS.forEach(ctrl => {
                const row = buildUniformControlRow(ctrl);
                if (ctrl.type === 'checkbox') row.querySelector('input').checked = !!ctrl.value;
                snapContent.appendChild(row);
            });
            registerDevControlArray('SPOTTY_DEBUG_SNAPSHOT_CONTROLS', SNAPSHOT_CONTROLS);
        }
        // A log box (Copy / Save / Clear + a collapsible scrolling display) placed right after a control's row. The log module
        // feeds it through window.spxDebugLogViews[key].append(line); Copy / Save / Clear use the registry entry for that key.
        window.spxDebugLogViews = window.spxDebugLogViews || {};
        function buildDebugLogBox(afterId, key, title) {
            const anchor = document.getElementById(afterId);
            const row = anchor && anchor.closest('.dev-row');
            if (!row || window.spxDebugLogViews[key]) return;
            const wrap = document.createElement('div');
            const btns = document.createElement('div');
            btns.className = 'dev-buttons';
            const mk = t => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; return b; };
            const copyB = mk('COPY'), saveB = mk('SAVE'), clearB = mk('CLEAR');
            btns.append(copyB, saveB, clearB);
            const pre = document.createElement('div');
            pre.className = 'dev-mouse-log';
            wrap.append(btns, pre);
            row.after(wrap);
            makeLogBoxCollapsible(pre, title);
            const entry = () => (window.spxDebugLogRegistry || []).find(l => l.key === key);
            const text = () => (key === 'snapshot' ? (window.spxDebug ? window.spxDebug.getSnapshot() : '') : ((entry() && entry().lines()) || []).join('\n'));
            copyB.addEventListener('click', () => {
                const flash = m => { const o = copyB.textContent; copyB.textContent = m; setTimeout(() => { copyB.textContent = o; }, 900); };
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text()).then(() => flash('Copied!')).catch(() => flash('Copy failed')); else flash('Copy failed');
            });
            saveB.addEventListener('click', () => {
                const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
                const a = document.createElement('a');
                a.href = url; a.download = key + '-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            });
            clearB.addEventListener('click', () => { if (key === 'snapshot') { if (window.spxDebug) window.spxDebug.clearSnapshot(); pre.textContent = ''; } else if (entry()) entry().clear(); });
            window.spxDebugLogViews[key] = {
                append: line => { pre.appendChild(Object.assign(document.createElement('div'), { textContent: line })); while (pre.children.length > 600) pre.removeChild(pre.firstChild); pre.scrollTop = pre.scrollHeight; },
                clear: () => { pre.textContent = ''; },
                set: t => { pre.textContent = t; pre.scrollTop = 0; },
            };
        }
        buildDebugLogBox('checkboxLogPlayback', 'playback', 'Playback Timing Log');
        buildDebugLogBox('checkboxLogPreload', 'preload', 'Preload Log');
        buildDebugLogBox('buttonDebugSnapshot', 'snapshot', 'Snapshot');
        window.spxDebugShowSnapshot = t => { const v = window.spxDebugLogViews.snapshot; if (v) v.set(t); };
        // the new tools (and the Snapshot subgroup) sit ABOVE the Mouse Log subgroup, not below it
        try {
            const dbgContent = findGroupContent(tab, DBG, 'renderSpottyDevControls', 'buttonDebugPause');
            const mouseSection = dbgContent && [...dbgContent.children].find(c => c.querySelector && c.querySelector(':scope > .dev-section-title[data-sid="Mouse Log"]'));
            if (mouseSection) {
                const mine = [...dbgContent.children].filter(c => c !== mouseSection && !c.classList.contains('dev-section'));
                mine.forEach(c => dbgContent.insertBefore(c, mouseSection));
                // The Snapshot subgroup is its own .dev-section, excluded from "mine" above (that filter exists so this
                // loop never accidentally relocates an unrelated pre-existing subgroup) -- moved explicitly instead.
                const snapshotSection = [...dbgContent.children].find(c => c.querySelector && c.querySelector(':scope > .dev-section-title[data-sid="Snapshot"]'));
                if (snapshotSection) dbgContent.insertBefore(snapshotSection, mouseSection);
            }
        } catch (e) { /* ordering only */ }

        // ---- UI Layout: Shadows (one on/off checkbox for everything that has a drop shadow) -----------------------
        const SH = 'Shadows';
        uiLayoutContent.appendChild(createDevGroupElement(SH, tab));
        const SH_CONTROLS = [
            { tab, group: SH, id: 'checkboxShadowCover', type: 'checkbox', label: 'Album Cover Shadow:', value: true },
            { tab, group: SH, id: 'checkboxShadowVolume', type: 'checkbox', label: 'Volume Icon, Slider Bar And Circle Shadow:', value: true },
            { tab, group: SH, id: 'checkboxShadowNav', type: 'checkbox', label: 'Previous / Next Button Shadow:', value: true },
            { tab, group: SH, id: 'checkboxShadowTitleLift', type: 'checkbox', label: 'Song Title Lift Animation Shadow:', value: true },
        ];
        renderControlArray(SH_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_SHADOW_CONTROLS', SH_CONTROLS);

        // Each shadow gets its own subgroup under Shadows. Cover has Size (spread); the filter shadows do not
        // (CSS drop-shadow has no spread); the title lift keeps its offset from the animation, so only its colour is here.
        // Values here are the same defaults as settings.js (the panel's value wins in dev mode).
        const SHADOW_SUBGROUPS = [
            { g: 'Album Cover Shadow', k: 'Cover', spread: true, op: 0.53, blur: 28, spreadPx: 0, angle: 90, depth: 8 },
            { g: 'Volume Shadow', k: 'Volume', op: 0.67, blur: 3, angle: 90, depth: 1 },
            { g: 'Previous / Next Shadow', k: 'Nav', op: 0.67, blur: 3, angle: 90, depth: 1 },
            { g: 'Title Lift Shadow', k: 'TitleLift', colorOnly: true },
        ];
        SHADOW_SUBGROUPS.forEach(({ g, k, spread, colorOnly, op, blur, spreadPx, angle, depth }) => {
            findGroupContent(tab, SH, 'renderSpottyDevControls', g).appendChild(createDevGroupElement(g, tab));
            const controls = [{ tab, group: g, id: 'colorShadow' + k, type: 'color', label: 'Color:', value: '#000000' }];
            if (!colorOnly) {
                controls.push({ tab, group: g, id: 'sliderShadow' + k + 'Opacity', type: 'slider', label: 'Opacity (x):', min: 0, max: 1, step: 0.01, value: op });
                controls.push({ tab, group: g, id: 'sliderShadow' + k + 'Blur', type: 'slider', label: 'Blur (Px):', min: 0, max: 80, step: 1, value: blur });
                if (spread) controls.push({ tab, group: g, id: 'sliderShadow' + k + 'Spread', type: 'slider', label: 'Size (Px, Negative Shrinks):', min: -40, max: 80, step: 1, value: spreadPx });
                controls.push({ tab, group: g, id: 'sliderShadow' + k + 'Angle', type: 'slider', label: 'Angle (Deg, 90 Is Straight Down):', min: 0, max: 360, step: 1, value: angle });
                controls.push({ tab, group: g, id: 'sliderShadow' + k + 'Depth', type: 'slider', label: 'Depth (Px):', min: 0, max: 60, step: 0.5, value: depth });
            }
            renderControlArray(controls, 'renderSpottyDevControls');
            registerDevControlArray('SPOTTY_SHADOW_' + k.toUpperCase(), controls);
        });

        // Brackets Smaller Text: a toggle group in UI Layout (drag it into Text > TRACK TITLE in the panel).
        const BR = 'Brackets Smaller Text';
        uiLayoutContent.appendChild(createDevGroupElement(BR, tab));
        const BR_CONTROLS = [
            { tab, group: BR, id: 'checkboxBracketsSmaller', type: 'checkbox', label: 'Brackets Smaller Text:', value: false },
            { tab, group: BR, id: 'sliderBracketsFontPct', type: 'slider', label: 'Bracket Font Size (% Of Title):', min: 10, max: 150, step: 1, value: 60 },
        ];
        renderControlArray(BR_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_BRACKET_CONTROLS', BR_CONTROLS);
        makeDevGroupToggleable(tab, BR, 'checkboxBracketsSmaller');
        const EASINGS = [
            { value: 'ease-out', text: 'Ease Out' }, { value: 'ease', text: 'Ease' }, { value: 'ease-in-out', text: 'Ease In-Out' },
            { value: 'linear', text: 'Linear' }, { value: 'spring', text: 'Spring (Overshoot)' }, { value: 'snap', text: 'Snap (Fast Start)' },
        ];
        const GRAD_TYPES = [{ value: 'linear', text: 'Linear' }, { value: 'radial', text: 'Radial' }, { value: 'conic', text: 'Conic' }];
        const TITLE_BG_CONTROLS = [
            { tab, group: TA, id: 'checkboxTitleAnimEnabled', type: 'checkbox', label: 'Enabled', value: false },
            {
                tab, group: TA, id: 'selectTitleAnimMode', type: 'select', label: 'Animation:', value: 'bold',
                options: [
                    { value: 'bold', text: 'A: Bold On Hover (Unbolds On Press)' },
                    { value: 'pulse', text: 'B: Pulse On Click' },
                    { value: 'grow', text: 'C: Grow On Hover (Normal On Press)' },
                    { value: 'glow', text: 'D: Glow On Hover (Dims On Press)' },
                    { value: 'tracking', text: 'E: Letter-Spacing Expand On Hover' },
                    { value: 'lift', text: 'F: Lift On Hover, Push Down On Press' },
                ],
            },
            { tab, group: TA, id: 'sliderTitleAnimDuration', type: 'slider', label: 'Transition Duration (Ms):', min: 0, max: 1500, step: 10, value: 160 },
            { tab, group: TA, id: 'selectTitleAnimEasing', type: 'select', label: 'Easing:', value: 'ease-out', options: EASINGS },
            // A: bold
            { tab, group: TA, id: 'sliderTitleBoldRestWeight', type: 'slider', label: 'Rest Font Weight (100-900):', min: 100, max: 900, step: 100, value: 500 },
            { tab, group: TA, id: 'sliderTitleBoldHoverWeight', type: 'slider', label: 'Hover Font Weight (100-900):', min: 100, max: 900, step: 100, value: 800 },
            { tab, group: TA, id: 'sliderTitleBoldPressWeight', type: 'slider', label: 'Pressed Font Weight (100-900):', min: 100, max: 900, step: 100, value: 500 },
            // B: pulse
            { tab, group: TA, id: 'sliderTitlePulseScale', type: 'slider', label: 'Pulse Scale On Click (x):', min: 1, max: 2, step: 0.01, value: 1.08 },
            { tab, group: TA, id: 'sliderTitlePulseInDuration', type: 'slider', label: 'Grow Duration On Press (Ms):', min: 0, max: 800, step: 5, value: 90 },
            { tab, group: TA, id: 'sliderTitlePulseOutDuration', type: 'slider', label: 'Return Duration On Release (Ms):', min: 0, max: 1200, step: 5, value: 180 },
            // C: grow
            { tab, group: TA, id: 'sliderTitleGrowScale', type: 'slider', label: 'Hover Scale (x):', min: 1, max: 2, step: 0.01, value: 1.1 },
            { tab, group: TA, id: 'sliderTitleGrowPressScale', type: 'slider', label: 'Pressed Scale (x):', min: 0.6, max: 1.5, step: 0.01, value: 1 },
            // D: glow
            { tab, group: TA, id: 'sliderTitleGlowRadius', type: 'slider', label: 'Glow Radius On Hover (Px):', min: 0, max: 80, step: 1, value: 18 },
            { tab, group: TA, id: 'sliderTitleGlowOpacity', type: 'slider', label: 'Glow Opacity (x):', min: 0, max: 1, step: 0.05, value: 0.8 },
            { tab, group: TA, id: 'colorTitleGlowColor', type: 'color', label: 'Glow Color:', value: '#1db954' },
            { tab, group: TA, id: 'sliderTitleGlowPressRadius', type: 'slider', label: 'Glow Radius While Pressed (Px):', min: 0, max: 80, step: 1, value: 4 },
            // E: letter-spacing
            { tab, group: TA, id: 'sliderTitleTrackingHover', type: 'slider', label: 'Letter Spacing On Hover (Em):', min: -0.1, max: 0.5, step: 0.005, value: 0.05 },
            { tab, group: TA, id: 'sliderTitleTrackingPress', type: 'slider', label: 'Letter Spacing While Pressed (Em):', min: -0.1, max: 0.5, step: 0.005, value: 0 },
            // F: lift
            { tab, group: TA, id: 'sliderTitleLiftPx', type: 'slider', label: 'Lift On Hover (Px):', min: 0, max: 40, step: 0.5, value: 6 },
            { tab, group: TA, id: 'sliderTitleLiftPressPx', type: 'slider', label: 'Push Down While Pressed (Px):', min: 0, max: 30, step: 0.5, value: 2 },
            { tab, group: TA, id: 'sliderTitleLiftShadowBlur', type: 'slider', label: 'Lift Shadow Blur (Px):', min: 0, max: 60, step: 1, value: 14 },
            { tab, group: TA, id: 'sliderTitleLiftShadowOpacity', type: 'slider', label: 'Lift Shadow Opacity (x):', min: 0, max: 1, step: 0.05, value: 0.5 },

            {
                tab, group: BG, id: 'selectBackgroundMode', type: 'select', label: 'Background Mode:', value: 'none',
                options: [
                    { value: 'none', text: 'None (Default Dark)' },
                    { value: 'color', text: 'A: Color' },
                    { value: 'gradient', text: 'B: Gradient' },
                    { value: 'albumAverage', text: 'C: Album Cover Average Color' },
                    { value: 'borderRadial', text: 'D: Album Cover Border Radial' },
                    { value: 'borderAverage', text: 'E: Album Cover Border Average' },
                    { value: 'albumChroma', text: 'F: Album Cover Average Color Only (Ignore Grays)' },
                    { value: 'blurCover', text: 'G: Blurred Cover Art' },
                    { value: 'palette', text: 'H: Cover Palette Gradient (Top 3 Colors)' },
                    { value: 'spotlight', text: 'I: Cover Spotlight Glow' },
                ],
            },
            { tab, group: BG, id: 'sliderBackgroundOpacity', type: 'slider', label: 'Opacity (x):', min: 0, max: 1, step: 0.01, value: 1 },
            { tab, group: BG, id: 'sliderBackgroundBrightness', type: 'slider', label: 'Brightness (x):', min: 0.1, max: 2.5, step: 0.01, value: 1 },
            { tab, group: BG, id: 'sliderBackgroundSaturation', type: 'slider', label: 'Saturation (x):', min: 0, max: 3, step: 0.01, value: 1 },
            { tab, group: BG, id: 'sliderBackgroundTransition', type: 'slider', label: 'Crossfade Between Songs (Ms):', min: 0, max: 3000, step: 10, value: 400 },
            // A: color
            { tab, group: BG, id: 'colorBackgroundColor', type: 'color', label: 'Background Color:', value: '#0d0f12' },
            // B: gradient
            { tab, group: BG, id: 'curveEditorBackgroundGradient', type: 'gradient-editor', label: 'Gradient Stops (Click Bar To Add):', defaultValue: { stops: [{ p: 0, c: '#1db954' }, { p: 1, c: '#0d0f12' }] } },
            { tab, group: BG, id: 'selectBackgroundGradientType', type: 'select', label: 'Gradient Type:', value: 'linear', options: GRAD_TYPES },
            { tab, group: BG, id: 'sliderBackgroundGradientRotation', type: 'slider', label: 'Gradient Rotation (Deg):', min: 0, max: 360, step: 1, value: 135 },
            { tab, group: BG, id: 'sliderBackgroundGradientScale', type: 'slider', label: 'Gradient Scale (x):', min: 0.1, max: 6, step: 0.05, value: 1 },
            { tab, group: BG, id: 'sliderBackgroundGradientCenterX', type: 'slider', label: 'Gradient Center X, Radial/Conic (%):', min: -50, max: 150, step: 1, value: 50 },
            { tab, group: BG, id: 'sliderBackgroundGradientCenterY', type: 'slider', label: 'Gradient Center Y, Radial/Conic (%):', min: -50, max: 150, step: 1, value: 50 },
            // D + E: cover border
            { tab, group: BG, id: 'sliderBorderDepth', type: 'slider', label: 'Border Sample Depth (% Of Cover):', min: 1, max: 40, step: 0.5, value: 8 },
            { tab, group: BG, id: 'sliderBorderRadialRays', type: 'slider', label: 'Ray Count (Angular Resolution):', min: 8, max: 720, step: 1, value: 180 },
            { tab, group: BG, id: 'sliderBorderRadialGranularity', type: 'slider', label: 'Stripe Granularity (Color Bands Around Cover):', min: 4, max: 720, step: 1, value: 180 },
            { tab, group: BG, id: 'checkboxBorderRadialSmooth', type: 'checkbox', label: 'Completely Smooth Colors (No Stripes)', value: false },
            { tab, group: BG, id: 'sliderBorderRadialSmoothing', type: 'slider', label: 'Ray Smoothing (Deg):', min: 0, max: 90, step: 0.5, value: 4 },
            { tab, group: BG, id: 'sliderBorderRadialStart', type: 'slider', label: 'Rays Start At (% Of Cover Radius):', min: 0, max: 150, step: 1, value: 100 },
            { tab, group: BG, id: 'sliderBorderRadialFade', type: 'slider', label: 'Fade Rays Toward Edge (%):', min: 0, max: 100, step: 1, value: 0 },
            { tab, group: BG, id: 'colorBorderRadialFadeColor', type: 'color', label: 'Fade Color:', value: '#0d0f12' },
            {
                tab, group: BG, id: 'selectBorderAverageEdges', type: 'select', label: 'Average Which Edges:', value: 'all',
                options: [
                    { value: 'all', text: 'All Four Edges' }, { value: 'top', text: 'Top Only' }, { value: 'bottom', text: 'Bottom Only' },
                    { value: 'left', text: 'Left Only' }, { value: 'right', text: 'Right Only' },
                    { value: 'topBottom', text: 'Top And Bottom' }, { value: 'leftRight', text: 'Left And Right' },
                ],
            },
            // F: chroma average
            { tab, group: BG, id: 'sliderChromaMinSaturation', type: 'slider', label: 'Ignore Pixels Below Saturation (x):', min: 0, max: 1, step: 0.01, value: 0.2 },
            { tab, group: BG, id: 'sliderChromaMinBrightness', type: 'slider', label: 'Ignore Pixels Below Brightness (x):', min: 0, max: 1, step: 0.01, value: 0.12 },
            { tab, group: BG, id: 'sliderChromaGrayscaleThreshold', type: 'slider', label: 'Treat Cover As Grayscale Above (% Gray Pixels):', min: 0, max: 100, step: 1, value: 85 },
            // G: blurred cover
            { tab, group: BG, id: 'sliderBlurRadius', type: 'slider', label: 'Blur Radius (Px):', min: 0, max: 250, step: 1, value: 60 },
            { tab, group: BG, id: 'sliderBlurScale', type: 'slider', label: 'Cover Zoom (x):', min: 0.5, max: 6, step: 0.05, value: 1.6 },
            { tab, group: BG, id: 'sliderBlurOffsetX', type: 'slider', label: 'Blur Image X Offset (% Of Screen Width):', min: -100, max: 100, step: 0.5, value: 0 },
            { tab, group: BG, id: 'sliderBlurOffsetY', type: 'slider', label: 'Blur Image Y Offset (% Of Screen Height):', min: -100, max: 100, step: 0.5, value: 0 },
            { tab, group: BG, id: 'sliderBlurDarken', type: 'slider', label: 'Darken (x):', min: 0, max: 1, step: 0.01, value: 0.45 },
            // H: palette gradient
            { tab, group: BG, id: 'selectPaletteGradientType', type: 'select', label: 'Palette Gradient Type:', value: 'linear', options: GRAD_TYPES },
            { tab, group: BG, id: 'sliderPaletteRotation', type: 'slider', label: 'Palette Rotation (Deg):', min: 0, max: 360, step: 1, value: 160 },
            { tab, group: BG, id: 'sliderPaletteScale', type: 'slider', label: 'Palette Scale (x):', min: 0.1, max: 6, step: 0.05, value: 1 },
            // I: spotlight
            {
                tab, group: BG, id: 'selectSpotlightColorSource', type: 'select', label: 'Spotlight Color From:', value: 'vivid',
                options: [{ value: 'vivid', text: 'Vivid Dominant Color' }, { value: 'average', text: 'Average Color' }, { value: 'palette1', text: 'Most Common Color' }],
            },
            { tab, group: BG, id: 'sliderSpotlightRadius', type: 'slider', label: 'Spotlight Radius (% Of Screen):', min: 5, max: 200, step: 1, value: 70 },
            { tab, group: BG, id: 'sliderSpotlightIntensity', type: 'slider', label: 'Spotlight Intensity (x):', min: 0, max: 1, step: 0.01, value: 0.9 },
            { tab, group: BG, id: 'sliderSpotlightMaxBrightness', type: 'slider', label: 'Spotlight Max Brightness (%):', min: 5, max: 100, step: 1, value: 100 },
            { tab, group: BG, id: 'checkboxSpotlightFollowCover', type: 'checkbox', label: 'Center On The Album Cover:', value: true },
            { tab, group: BG, id: 'sliderSpotlightCenterX', type: 'slider', label: 'Spotlight Center X (%):', min: -50, max: 150, step: 1, value: 50 },
            { tab, group: BG, id: 'sliderSpotlightCenterY', type: 'slider', label: 'Spotlight Center Y (%):', min: -50, max: 150, step: 1, value: 40 },
            { tab, group: BG, id: 'colorSpotlightEdgeColor', type: 'color', label: 'Spotlight Edge Color:', value: '#0d0f12' },
        ];
        renderControlArray(TITLE_BG_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_TITLE_BG_CONTROLS', TITLE_BG_CONTROLS);

        // Background > Animation (bgAnimation.js): one mode select; only the selected mode's settings show (MODE_MAPS below). The speed,
        // centre, start / stop and quality settings are shared by every mode.
        const BGA = 'Animation';
        findGroupContent(tab, BG, 'renderSpottyDevControls', 'selectBackgroundMode').appendChild(createDevGroupElement(BGA, tab));
        const BLEND_OPTIONS = ['normal', 'screen', 'overlay', 'soft-light', 'hard-light', 'multiply', 'difference', 'exclusion', 'color-dodge', 'lighten', 'darken', 'hue', 'color', 'luminosity']
            .map(v => ({ value: v, text: v.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }));
        const BGA_CONTROLS = [
            { tab, group: BGA, id: 'selectBgAnimMode', type: 'select', label: 'Animation Mode:', value: 'none', options: [
                { value: 'none', text: 'None (Off)' }, { value: 'rotation', text: 'Background Rotation' }, { value: 'patches', text: 'Patches (Rotating In Areas)' },
                { value: 'breathing', text: 'Breathing Fade' }, { value: 'rings', text: 'Ring Bands' }, { value: 'swirl', text: 'Swirl' },
                { value: 'warp', text: 'Domain Warp (Octave Noise)' }, { value: 'overlay', text: '2nd Background Overlay' }] },
            // shared by every mode
            { tab, group: BGA, id: 'sliderBgAnimSpeed', type: 'slider', label: 'Rotation Speed (Deg/S):', min: -180, max: 180, step: 0.5, value: 6 },
            { tab, group: BGA, id: 'sliderBgAnimCenterX', type: 'slider', label: 'Rotation Center X Offset From Album Cover (Px):', min: -1500, max: 1500, step: 1, value: 0 },
            { tab, group: BGA, id: 'sliderBgAnimCenterY', type: 'slider', label: 'Rotation Center Y Offset From Album Cover (Px):', min: -1500, max: 1500, step: 1, value: 0 },
            { tab, group: BGA, id: 'sliderBgAnimStartStopMs', type: 'slider', label: 'Start / Stop Duration (Ms):', min: 0, max: 30000, step: 50, value: 2000 },
            { tab, group: BGA, id: 'curveEditorBgAnimStartStop', type: 'curve-editor', label: 'Start / Stop Easing Curve (X: Progress Of The Start / Stop Duration, Y: Speed, 1 = Full Speed):', defaultPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }], defaultMethod: 'monotone' },
            { tab, group: BGA, id: 'sliderBgAnimZoom', type: 'slider', label: 'Zoom (%):', min: 50, max: 400, step: 1, value: 100 },
            { tab, group: BGA, id: 'sliderBgAnimResolution', type: 'slider', label: 'Render Resolution (% Of Screen):', min: 10, max: 100, step: 1, value: 60 },
            { tab, group: BGA, id: 'sliderBgAnimMaxFps', type: 'slider', label: 'Max Frame Rate (Fps):', min: 5, max: 120, step: 1, value: 60 },
            // Patches, Breathing Fade and 2nd Background Overlay lie over the background: how
            { tab, group: BGA, id: 'selectBgAnimBlend', type: 'select', label: 'Blend Mode:', value: 'normal', options: BLEND_OPTIONS },
            { tab, group: BGA, id: 'sliderBgAnimOpacity', type: 'slider', label: 'Overlay Opacity (%):', min: 0, max: 100, step: 1, value: 70 },
            // Patches
            { tab, group: BGA, id: 'sliderBgAnimPatchScale', type: 'slider', label: 'Patch Size (Px):', min: 40, max: 3000, step: 5, value: 500 },
            { tab, group: BGA, id: 'sliderBgAnimPatchCoverage', type: 'slider', label: 'Patch Coverage (%):', min: 0, max: 100, step: 1, value: 50 },
            { tab, group: BGA, id: 'sliderBgAnimPatchSoftness', type: 'slider', label: 'Patch Edge Softness (%):', min: 1, max: 100, step: 1, value: 40 },
            { tab, group: BGA, id: 'sliderBgAnimPatchDrift', type: 'slider', label: 'Patch Drift Speed (Px/S):', min: 0, max: 600, step: 1, value: 30 },
            { tab, group: BGA, id: 'sliderBgAnimPatchOctaves', type: 'slider', label: 'Patch Noise Octaves:', min: 1, max: 6, step: 1, value: 3 },
            // Breathing Fade
            { tab, group: BGA, id: 'sliderBgAnimBreathPeriod', type: 'slider', label: 'Breathing Period (S):', min: 0.5, max: 120, step: 0.5, value: 8 },
            { tab, group: BGA, id: 'sliderBgAnimBreathMin', type: 'slider', label: 'Breathing Minimum Opacity (%):', min: 0, max: 100, step: 1, value: 0 },
            { tab, group: BGA, id: 'sliderBgAnimBreathMax', type: 'slider', label: 'Breathing Maximum Opacity (%):', min: 0, max: 100, step: 1, value: 100 },
            // Ring Bands
            { tab, group: BGA, id: 'sliderBgAnimRingWidth', type: 'slider', label: 'Ring Width (Px):', min: 10, max: 1200, step: 1, value: 120 },
            { tab, group: BGA, id: 'sliderBgAnimRingSpeedStep', type: 'slider', label: 'Speed Change Per Ring (x):', min: -2, max: 2, step: 0.05, value: 0.5 },
            { tab, group: BGA, id: 'checkboxBgAnimRingAlternate', type: 'checkbox', label: 'Alternate Direction Per Ring', value: true },
            // Swirl
            { tab, group: BGA, id: 'sliderBgAnimSwirlRadius', type: 'slider', label: 'Swirl Radius (Px):', min: 50, max: 4000, step: 5, value: 700 },
            { tab, group: BGA, id: 'sliderBgAnimSwirlFalloff', type: 'slider', label: 'Swirl Falloff (Power):', min: 0.2, max: 6, step: 0.05, value: 1.5 },
            { tab, group: BGA, id: 'checkboxBgAnimSwirlInvert', type: 'checkbox', label: 'Edges Turn Instead Of The Center', value: false },
            { tab, group: BGA, id: 'sliderBgAnimSwirlTwist', type: 'slider', label: 'Static Twist (Deg):', min: -720, max: 720, step: 1, value: 0 },
            // Domain Warp
            { tab, group: BGA, id: 'sliderBgAnimWarpStrength', type: 'slider', label: 'Warp Strength (Px):', min: 0, max: 800, step: 1, value: 120 },
            { tab, group: BGA, id: 'sliderBgAnimWarpScale', type: 'slider', label: 'Warp Noise Scale (Px):', min: 40, max: 3000, step: 5, value: 420 },
            { tab, group: BGA, id: 'sliderBgAnimWarpOctaves', type: 'slider', label: 'Warp Octaves:', min: 1, max: 6, step: 1, value: 4 },
            { tab, group: BGA, id: 'sliderBgAnimWarpLacunarity', type: 'slider', label: 'Warp Lacunarity (x):', min: 1.1, max: 4, step: 0.05, value: 2 },
            { tab, group: BGA, id: 'sliderBgAnimWarpGain', type: 'slider', label: 'Warp Gain (x):', min: 0.1, max: 0.9, step: 0.01, value: 0.5 },
            { tab, group: BGA, id: 'sliderBgAnimWarpDrift', type: 'slider', label: 'Warp Drift Speed (Px/S):', min: 0, max: 600, step: 1, value: 40 },
        ];
        renderControlArray(BGA_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_BG_ANIM_CONTROLS', BGA_CONTROLS);
        makeDevGroupToggleable(tab, TA, 'checkboxTitleAnimEnabled');

        // ---- Startup: the darkening over the app until the first input, and the play icon (no text, no background) ----
        const SU = 'Startup', SB = 'Start Button', SBA = 'Start Button Animation';
        uiLayoutContent.appendChild(createDevGroupElement(SU, tab));
        const SU_CONTROLS = [
            { tab, group: SU, id: 'buttonRunStartup', type: 'button', label: 'Run Startup', skipDeviceCheckbox: true },
            { tab, group: SU, id: 'sliderStartOverlayOpacity', type: 'slider', label: 'Darkening Opacity (x):', min: 0, max: 1, step: 0.01, value: 0.8 },
            { tab, group: SU, id: 'sliderStartFadeMs', type: 'slider', label: 'Fade Time (Ms):', min: 0, max: 3000, step: 10, value: 300 },
            { tab, group: SU, id: 'colorStartOverlay', type: 'color', label: 'Darkening Color:', value: '#0d0f12' },
            { tab, group: SU, id: 'checkboxStartCenterOnCover', type: 'checkbox', label: 'Center Button on Album Cover:', value: false },
        ];
        renderControlArray(SU_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_STARTUP_CONTROLS', SU_CONTROLS);
        findGroupContent(tab, SU, 'renderSpottyDevControls', SB).appendChild(createDevGroupElement(SB, tab));
        const SB_CONTROLS = [
            { tab, group: SB, id: 'checkboxStartButtonEnabled', type: 'checkbox', label: 'Enabled', value: true },
            { tab, group: SB, id: 'sliderStartPlaySize', type: 'slider', label: 'Play Icon Size (Px):', min: 16, max: 200, step: 1, value: 64 },
            { tab, group: SB, id: 'checkboxStartTransitionAfterRelease', type: 'checkbox', label: 'Transition After Release:', value: false },
        ];
        renderControlArray(SB_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_START_BUTTON_CONTROLS', SB_CONTROLS);
        findGroupContent(tab, SB, 'renderSpottyDevControls', SBA).appendChild(createDevGroupElement(SBA, tab));
        // The same controls as Track Title Button Animation (TITLE_BG_CONTROLS above), with 'Title' replaced by 'StartPlay'
        const START_ANIM_CONTROLS = TITLE_BG_CONTROLS.filter(c => c.group === TA).map(c => ({ ...c, group: SBA, id: c.id.replace('Title', 'StartPlay') }));
        renderControlArray(START_ANIM_CONTROLS, 'renderSpottyDevControls');
        registerDevControlArray('SPOTTY_START_ANIM_CONTROLS', START_ANIM_CONTROLS);
        makeDevGroupToggleable(tab, SBA, 'checkboxStartPlayAnimEnabled');
        makeDevGroupToggleable(tab, SB, 'checkboxStartButtonEnabled');

        // Show only the settings that belong to the selected mode of the title animation / background.
        // A control used by several modes (e.g. Border Sample Depth) is shown when ANY of them is selected.
        const MODE_MAPS = [
            {
                select: 'selectBgAnimMode', map: {
                    rotation: [],
                    patches: ['selectBgAnimBlend', 'sliderBgAnimOpacity', 'sliderBgAnimPatchScale', 'sliderBgAnimPatchCoverage', 'sliderBgAnimPatchSoftness', 'sliderBgAnimPatchDrift', 'sliderBgAnimPatchOctaves'],
                    breathing: ['selectBgAnimBlend', 'sliderBgAnimBreathPeriod', 'sliderBgAnimBreathMin', 'sliderBgAnimBreathMax'],
                    rings: ['sliderBgAnimRingWidth', 'sliderBgAnimRingSpeedStep', 'checkboxBgAnimRingAlternate'],
                    swirl: ['sliderBgAnimSwirlRadius', 'sliderBgAnimSwirlFalloff', 'checkboxBgAnimSwirlInvert', 'sliderBgAnimSwirlTwist'],
                    warp: ['sliderBgAnimWarpStrength', 'sliderBgAnimWarpScale', 'sliderBgAnimWarpOctaves', 'sliderBgAnimWarpLacunarity', 'sliderBgAnimWarpGain', 'sliderBgAnimWarpDrift'],
                    overlay: ['selectBgAnimBlend', 'sliderBgAnimOpacity'],
                },
                // shown for every mode except "none"
                always: ['sliderBgAnimSpeed', 'sliderBgAnimCenterX', 'sliderBgAnimCenterY', 'sliderBgAnimStartStopMs', 'curveEditorBgAnimStartStop', 'sliderBgAnimZoom', 'sliderBgAnimResolution', 'sliderBgAnimMaxFps'],
            },
            {
                select: 'selectTitleAnimMode', map: {
                    bold: ['sliderTitleBoldRestWeight', 'sliderTitleBoldHoverWeight', 'sliderTitleBoldPressWeight'],
                    pulse: ['sliderTitlePulseScale', 'sliderTitlePulseInDuration', 'sliderTitlePulseOutDuration'],
                    grow: ['sliderTitleGrowScale', 'sliderTitleGrowPressScale'],
                    glow: ['sliderTitleGlowRadius', 'sliderTitleGlowOpacity', 'colorTitleGlowColor', 'sliderTitleGlowPressRadius'],
                    tracking: ['sliderTitleTrackingHover', 'sliderTitleTrackingPress'],
                    lift: ['sliderTitleLiftPx', 'sliderTitleLiftPressPx', 'sliderTitleLiftShadowBlur', 'sliderTitleLiftShadowOpacity'],
                },
            },
            {
                // Start Button Animation: the same modes as the title's, with 'Title' replaced by 'StartPlay'
                select: 'selectStartPlayAnimMode', map: {
                    bold: ['sliderStartPlayBoldRestWeight', 'sliderStartPlayBoldHoverWeight', 'sliderStartPlayBoldPressWeight'],
                    pulse: ['sliderStartPlayPulseScale', 'sliderStartPlayPulseInDuration', 'sliderStartPlayPulseOutDuration'],
                    grow: ['sliderStartPlayGrowScale', 'sliderStartPlayGrowPressScale'],
                    glow: ['sliderStartPlayGlowRadius', 'sliderStartPlayGlowOpacity', 'colorStartPlayGlowColor', 'sliderStartPlayGlowPressRadius'],
                    tracking: ['sliderStartPlayTrackingHover', 'sliderStartPlayTrackingPress'],
                    lift: ['sliderStartPlayLiftPx', 'sliderStartPlayLiftPressPx', 'sliderStartPlayLiftShadowBlur', 'sliderStartPlayLiftShadowOpacity'],
                },
            },
            {
                select: 'selectBackgroundMode', map: {
                    color: ['colorBackgroundColor'],
                    gradient: ['curveEditorBackgroundGradient', 'selectBackgroundGradientType', 'sliderBackgroundGradientRotation', 'sliderBackgroundGradientScale', 'sliderBackgroundGradientCenterX', 'sliderBackgroundGradientCenterY'],
                    borderRadial: ['sliderBorderDepth', 'sliderBorderRadialRays', 'sliderBorderRadialGranularity', 'checkboxBorderRadialSmooth', 'sliderBorderRadialSmoothing', 'sliderBorderRadialStart', 'sliderBorderRadialFade', 'colorBorderRadialFadeColor'],
                    borderAverage: ['sliderBorderDepth', 'selectBorderAverageEdges'],
                    albumChroma: ['sliderChromaMinSaturation', 'sliderChromaMinBrightness', 'sliderChromaGrayscaleThreshold'],
                    blurCover: ['sliderBlurRadius', 'sliderBlurScale', 'sliderBlurOffsetX', 'sliderBlurOffsetY', 'sliderBlurDarken'],
                    palette: ['selectPaletteGradientType', 'sliderPaletteRotation', 'sliderPaletteScale'],
                    spotlight: ['selectSpotlightColorSource', 'sliderSpotlightRadius', 'sliderSpotlightIntensity', 'sliderSpotlightMaxBrightness', 'checkboxSpotlightFollowCover', 'sliderSpotlightCenterX', 'sliderSpotlightCenterY', 'colorSpotlightEdgeColor'],
                },
                // controls shown for every mode except "none"
                always: ['sliderBackgroundOpacity', 'sliderBackgroundBrightness', 'sliderBackgroundSaturation', 'sliderBackgroundTransition'],
            },
        ];
        const wd = (id, dev) => id.replace(/^(slider|color|select|checkbox|rangeBar|curveEditor)(.+)$/, '$1' + dev + '$2');
        function refreshSpottyModeVisibility2() {
            ['', 'Mobile', 'Landscape'].forEach(dev => {
                MODE_MAPS.forEach(({ select, map, always }) => {
                    const sel = document.getElementById(wd(select, dev)) || document.getElementById(select);
                    if (!sel) return;
                    const show = new Set(map[sel.value] || []);
                    if (always && sel.value !== 'none') always.forEach(id => show.add(id));
                    const all = new Set([...Object.values(map).flat(), ...(always || [])]);
                    all.forEach(id => {
                        const el = document.getElementById(wd(id, dev));
                        const r = el && el.closest('.dev-row');
                        if (r) r.style.display = show.has(id) ? '' : 'none';
                    });
                });
            });
        }
        document.addEventListener('change', refreshSpottyModeVisibility2);
        document.addEventListener('input', refreshSpottyModeVisibility2);
        setInterval(refreshSpottyModeVisibility2, 700);
        refreshSpottyModeVisibility2();

        // ---- Per-mode settings memory ---------------------------------------------------------------------------
        // Wherever a mode select drives settings that several modes SHARE (Background's opacity / brightness / saturation /
        // crossfade / border depth, the bar colour mode's saturation / brightness, the title animation's time / easing),
        // each mode keeps its OWN values for them: switching mode loads that mode's values into the sliders, and editing a
        // slider records it for the mode that is showing. A mode visited for the first time inherits the current values and
        // diverges from then on. Settings that only one mode uses already have their own controls, so they need nothing.
        // Per device: a Mobile / Landscape twin is remembered under the same mode. Saved with every captured panel state
        // (captureFullDevPanelState().perMode), so Copy / Sync / Reset / Undo carry it.
        const PER_MODE = [
            { select: 'selectBackgroundMode', ids: ['sliderBackgroundOpacity', 'sliderBackgroundBrightness', 'sliderBackgroundSaturation', 'sliderBackgroundTransition', 'sliderBorderDepth'] },
            { select: 'selectAlbumColorMode', ids: ['sliderAlbumColorSaturation', 'sliderAlbumColorBrightness'] },
            { select: 'selectTitleAnimMode', ids: ['sliderTitleAnimDuration', 'selectTitleAnimEasing'] },
        ];
        let perModeStore = {}; // { selectId: { mode: { elementId: value } } }
        const PM_DEVS = ['', 'Mobile', 'Landscape'];
        const pmRead = el => (el.type === 'checkbox' ? el.checked : el.value);
        const pmWrite = (el, v) => {
            if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const pmSplit = id => { const m = id.match(/^(slider|color|select|checkbox)(Mobile|Landscape)?(.+)$/); return m ? { base: m[1] + m[3], dev: m[2] || '' } : null; };
        const pmModeOf = (pm, dev) => { const s = document.getElementById(wd(pm.select, dev)) || document.getElementById(pm.select); return s ? s.value : null; };
        document.addEventListener('input', e => {
            const el = e.target;
            if (window.__spxPerModeRestoring || !el || !el.id) return;
            const sp = pmSplit(el.id);
            if (!sp) return;
            PER_MODE.forEach(pm => {
                if (!pm.ids.includes(sp.base)) return;
                const mode = pmModeOf(pm, sp.dev);
                if (mode) ((perModeStore[pm.select] = perModeStore[pm.select] || {})[mode] = perModeStore[pm.select][mode] || {})[el.id] = pmRead(el);
            });
        });
        document.addEventListener('change', e => {
            const selEl = e.target;
            if (window.__spxPerModeRestoring || !selEl || selEl.tagName !== 'SELECT') return;
            const pm = PER_MODE.find(p => PM_DEVS.some(d => wd(p.select, d) === selEl.id));
            if (!pm) return;
            const dev = PM_DEVS.find(d => wd(pm.select, d) === selEl.id);
            // devices this select governs: its own, plus (for Desktop) any twin that has no select of its own
            const devs = [dev, ...(dev === '' ? PM_DEVS.slice(1).filter(d => !document.getElementById(wd(pm.select, d))) : [])];
            const mode = selEl.value;
            const entry = (perModeStore[pm.select] || {})[mode];
            if (entry) {
                Object.entries(entry).forEach(([elId, val]) => {
                    const sp = pmSplit(elId), el = document.getElementById(elId);
                    if (el && sp && devs.includes(sp.dev) && pmRead(el) !== val) pmWrite(el, val);
                });
            } else { // first visit: this mode starts as a copy of what is showing now
                const store = ((perModeStore[pm.select] = perModeStore[pm.select] || {})[mode] = {});
                devs.forEach(d => pm.ids.forEach(id => { const el = document.getElementById(wd(id, d)); if (el) store[el.id] = pmRead(el); }));
            }
        });
        window.spxCapturePerMode = () => JSON.parse(JSON.stringify(perModeStore));
        window.spxApplyPerMode = obj => { perModeStore = obj && typeof obj === 'object' ? JSON.parse(JSON.stringify(obj)) : {}; };

        // Show only the settings that belong to the selected Timeline Visual Style.
        const STYLE_CONTROLS = {
            glow: ['sliderGlowStemWidth', 'sliderGlowRadius', 'sliderGlowDotSize', 'sliderGlowIntensity'],
            density: ['sliderDensitySmoothing', 'sliderDensityFillOpacity', 'sliderDensityOutlineWidth', 'sliderDensityColorBlend', 'checkboxDensityGradientFill'],
            line: ['selectLineFeature', 'sliderLineWidth', 'sliderLineDotSize', 'sliderLineFillOpacity', 'checkboxLineSmooth'],
            ribbon: ['selectRibbonFeature', 'sliderRibbonThickness', 'sliderRibbonSmoothing', 'sliderRibbonBarsOpacity'],
        };
        const withDevice = (id, dev) => id.replace(/^(slider|color|select|checkbox|rangeBar)(.+)$/, '$1' + dev + '$2');
        function refreshSpottyModeVisibility() {
            ['', 'Mobile', 'Landscape'].forEach(dev => {
                const sel = document.getElementById(withDevice('selectTimelineStyle', dev)) || document.getElementById('selectTimelineStyle');
                if (!sel) return;
                Object.entries(STYLE_CONTROLS).forEach(([style, ids]) => ids.forEach(id => {
                    const el = document.getElementById(withDevice(id, dev));
                    const row = el && el.closest('.dev-row');
                    if (row) row.style.display = style === sel.value ? '' : 'none';
                }));
                // The Height Transition duration shows only while Height Transition is on.
                const tr = document.getElementById(withDevice('checkboxTimelineHeightTransition', dev)) || document.getElementById('checkboxTimelineHeightTransition');
                const trRow = (document.getElementById(withDevice('sliderTimelineHeightTransitionMs', dev)) || document.getElementById('sliderTimelineHeightTransitionMs'));
                if (tr && trRow && trRow.closest('.dev-row')) trRow.closest('.dev-row').style.display = tr.checked ? '' : 'none';
            });
        }
        document.addEventListener('change', refreshSpottyModeVisibility);
        document.addEventListener('input', refreshSpottyModeVisibility);
        setInterval(refreshSpottyModeVisibility, 700); // catches the per-device rows created later and restored state
        refreshSpottyModeVisibility();
    }
    function ensureDevPanelBuilt() {
        if (devPanelBuilt) return;

        renderDevPanelStyleControls();
        // Built-in "Debug" group's own Mouse Log feature ([JS-13c]) -
        // buildMouseLogWidget() finds the static "Debug" group and
        // appends its own nested "Mouse Log" subgroup; setupMouseLog()
        // wires the (global, only-ever-registered-once thanks to this
        // whole function's own devPanelBuilt guard) window-level pointer/
        // wheel listeners.
        buildMouseLogWidget();
        setupMouseLog();

        // PROJECT: call your own render*Controls() functions here too,
        // BEFORE the wiring below — see the worked example above
        // registerDevControlArray(). This is the one integration point
        // that moved as part of lazy-build: previously these were
        // called once, unconditionally, before initDevPanelEngine() —
        // now they belong HERE, inside the guarded function, so they
        // only ever run when the panel is actually being built.
        renderSpottyDevControls();

        setupDevPanelStyleControls();
        makeDevValuesEditable();
        makeDevSliderBoundsEditable();
        setupDevPanelTextEdit();
        assertDevControlsRendered();
        validateDevControlMappings();
        // Dynamic Mobile/Landscape visibility/independence ([JS-4b0]) -
        // creates every control's own Mobile/Landscape row for the first
        // time (universal as of 2026-09-17; a fresh page load has none
        // yet), and gives every group's own cascade checkbox its correct
        // initial checked/indeterminate display (see refreshAllGroupCascadeCheckboxes()'s
        // own comment on why this can't just be left to react to a real
        // checkbox change). Order matters: AFTER every render*Controls()
        // call above (Desktop rows must exist first) and BEFORE
        // syncTabOrderToDesktop() would otherwise be the only thing
        // creating them, i.e. not until the user opens that tab.
        syncTabOrderToDesktop('mobile');
        syncTabOrderToDesktop('landscape');
        // Backfills checkboxes onto any hand-authored control OUTSIDE the
        // registerDevControlArray() system, and applies its correct
        // initial hide/show - see injectRowDeviceCheckboxes()'s own
        // comment ([JS-4b0] above) for the CLICKO-found bug this closes.
        // Must run before refreshAllGroupCascadeCheckboxes() just below,
        // same reasoning as syncDeviceCheckboxesFromState()'s own ordering.
        injectRowDeviceCheckboxes();
        refreshEmptyGroupVisibility('mobile');
        refreshEmptyGroupVisibility('landscape');
        refreshAllGroupCascadeCheckboxes();

        // Groups within groups, UNLIMITED depth (ported from a real
        // project's own dev panel - MAINTENANCE note at the top of this
        // file). Eligible drop targets: tabRoot itself (drag a nested
        // group back out to the top level) plus every group's own content
        // ANYWHERE in the tab, at any depth (nest a group INTO it, or
        // INTO an already-nested group). Excludes the dragged group's own
        // content AND every one of its descendants' content
        // (dragging.contains(content)) - can't nest a group inside itself
        // or inside its own child.
        //
        // devGroupNestingDepth() below sorts candidates DEEPEST-first,
        // with tabRoot always last - this is not optional. setupDragReorder's
        // own direct hit-test is `containers.find(c => pointerY is within
        // c's own rect)`, and an outer container's rect always
        // geometrically CONTAINS every one of its descendants' own
        // smaller rects (a group's content fully encloses any group
        // nested inside it, which fully encloses anything nested inside
        // THAT). With candidates in any other order, Array.prototype.
        // find() matches whichever shallower container happens to come
        // first - typically tabRoot itself - before a real, more specific
        // target ever gets a chance, making it structurally impossible to
        // ever hit-test into a nested group, 100% of the time, regardless
        // of pointer precision. Sorting deepest-first makes find() always
        // prefer the most specific match, falling through to a shallower
        // match (and eventually tabRoot) only when the pointer is
        // genuinely outside every deeper candidate - exactly the un-nest
        // case this ordering exists to support.
        function devGroupNestingDepth(contentEl, tabRoot) {
            let depth = 0;
            let cur = contentEl.parentElement;
            while (cur && cur !== tabRoot) {
                if (cur.classList.contains('dev-section')) depth++;
                cur = cur.parentElement;
            }
            return depth;
        }
        // Handle narrowed from the whole title bar ('.dev-section-title')
        // to the dedicated '.dev-group-drag-handle' icon - see its own
        // comment (§12n's far-left-icon-only convention). The title keeps
        // its own separate onclick="toggleSection(this)" (collapse/
        // expand), now completely unaffected by dragging since it's a
        // different element from the handle entirely.
        setupDragReorder('.dev-group-drag-handle', '.dev-section', () => {}, (tabRoot, dragging) => {
            const groupContents = Array.from(tabRoot.querySelectorAll('.dev-section > .dev-section-content'))
                .filter(content => !dragging.contains(content));
            groupContents.sort((a, b) => devGroupNestingDepth(b, tabRoot) - devGroupNestingDepth(a, tabRoot));
            return [...groupContents, tabRoot];
        });
        // Settings-row cross-group drag - same deepest-first ordering as
        // the group-drag call above (no cycle check needed here: a
        // setting row is never itself a container, so it can never
        // contain the group it's being dropped into). Handle likewise
        // narrowed from '.dev-label' to the dedicated '.dev-row-drag-
        // handle' icon - injectRowDragHandles() (see its own comment)
        // adds it uniformly to every .dev-row.
        setupDragReorder('.dev-row-drag-handle', '.dev-row', () => {}, (tabRoot, dragging) => {
            const groupContents = Array.from(tabRoot.querySelectorAll('.dev-section-content'));
            groupContents.sort((a, b) => devGroupNestingDepth(b, tabRoot) - devGroupNestingDepth(a, tabRoot));
            return groupContents;
        });
        // Must run before a user can actually drag anything, but ordering
        // relative to the setupDragReorder() calls above doesn't matter -
        // those only register a document-level listener that checks the
        // handle selector at CLICK time, not at registration time, and
        // everything here runs synchronously before the panel is
        // interactive either way.
        injectGroupDragHandles();
        injectRowDragHandles();
        // Runs BEFORE applyFullDevPanelState() below on purpose - gives a
        // fresh template (no saved settings yet) this nice default
        // structure immediately; a project with its OWN saved Dev Panel
        // order still wins, since applySectionOrder() (called from
        // applyFullDevPanelState() via the loaded state's sectionOrder)
        // relocates rows by their own stable key regardless of whatever
        // parent this default pass already put them in.
        DEV_PANEL_TABS.forEach(applyDefaultDevPanelSubgroupOrder);
        ensureHotkeysSubgroup();

        syncSlidersFromState();
        syncColorPickersFromState();

        // Any pre-existing local copy first (instant), then the GitHub copy replaces it as soon
        // as it arrives (it is the source of truth; ported from HANDO's boot restore).
        applyDevPanelStateWithExtra(loadDevPanelSettings());
        fetchRemoteDevSettingsWhenReachable(got => {
            if (got.ok && got.settings) { applyDevPanelStateWithExtra(got.settings); renderAllHotkeyBadges(); }
        });

        // Render hotkey badges for all controls once panel is built
        renderAllHotkeyBadges();

        // Set LAST, not first - see this section's own top comment
        // (sharp edge #2) for why.
        devPanelBuilt = true;
    }

    // Always runs on page load, regardless of dev status - this is
    // deliberately everything that DOESN'T depend on the panel's
    // generated controls existing: positioning/sizing the panel itself,
    // its own resize-handle chrome (8 static <div>s already in the HTML
    // above, not generated), and the D-key listener that's the whole
    // reason ensureDevPanelBuilt() needs to be callable before the
    // panel has ever been opened.
    function initDevPanelEngine() {
        applyDevPanelLayout();
        applyDevPanelOwnStyling('desktop');
        // Static/eager, same as the Copy/Sync/Reset row above it - not
        // gated behind ensureDevPanelBuilt()'s lazy build.
        buildSavedDevSettingsListPicker();
        ensureStaticGroupCascadeCheckboxes();
        ensureStaticGroupUndockButtons();
        injectGroupLockIcons();
        refreshSliderBoundLockDisplay();

        setupPanelResizeHandle(devPanel, document.getElementById('devPanelResizeTop'), null, 'top');
        setupPanelResizeHandle(devPanel, document.getElementById('devPanelResizeBottom'), null, 'bottom');
        setupPanelResizeHandle(devPanel, document.getElementById('devPanelResizeLeft'), 'left', null);
        setupPanelResizeHandle(devPanel, document.getElementById('devPanelResizeRight'), 'right', null);
        setupPanelResizeHandle(devPanel, document.getElementById('devPanelResizeTL'), 'left', 'top');
        setupPanelResizeHandle(devPanel, document.getElementById('devPanelResizeTR'), 'right', 'top');
        setupPanelResizeHandle(devPanel, document.getElementById('devPanelResizeBL'), 'left', 'bottom');
        setupPanelResizeHandle(devPanel, document.getElementById('devPanelResizeBR'), 'right', 'bottom');
        new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = Math.round(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
                const h = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
                if (w > 0 && h > 0) { DEV_PANEL_LAYOUT.width = w; DEV_PANEL_LAYOUT.height = h; }
            }
        }).observe(devPanel);

        window.addEventListener('resize', clampDevPanelPosition);

        // 'D' key toggles the panel, matching CLAUDE.md Section 12c -
        // triggers the lazy build on its own first press, same as the
        // DEV button's onclick does (see the HTML above).
        document.addEventListener('keydown', (e) => {
            const activeTag = document.activeElement && document.activeElement.tagName;
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
            if (e.key === 'd' || e.key === 'D') {
                ensureDevPanelBuilt();
                devPanel.classList.toggle('hidden');
            }
            else if (e.key === 'r' || e.key === 'R') {
                resetDevPanelSettings();
            }
        });

        // Shift+click multi-select - always on, same reasoning as the
        // D-key listener above (works even before the panel's own
        // controls are built, and doesn't need to be re-armed per tab).
        setupDevGroupSelection();
        setupDevGroupInteractionTracking();
        // Text Edit Mode / Add Group / Collapse All header icon buttons -
        // always on, same reasoning (they live in the header, which is
        // static markup present from first paint, unlike the lazily-built
        // tab content).
        setupDevHeaderIconButtons();
        // Delete Group/Setting - same "always on" reasoning.
        setupDevDeleteGroup();
        // Undo - same "always on" reasoning (Ctrl+Z must work regardless
        // of whether the panel's own lazy controls are built yet).
        setupDevPanelUndo();
        // Search bar - same "always on" reasoning (static header markup).
        setupDevSearch();
        // Custom hotkey assignment system - same "always on" reasoning
        // (single-letter hotkeys like 'R' for Reset must work from first paint).
        setupSetHotkeyButton();
        setupHotkeyAssignmentCapture();
        setupHotkeySequenceListener();

        // The panel is visible-by-default for a dev-allowed visitor
        // (html.dev-mode CSS, no click needed) - build it eagerly for
        // them specifically, so they don't see an empty panel shell
        // with none of its rows until they happen to press D or click
        // DEV (a real gap, caught via a live screenshot showing exactly
        // this, in the real project this pattern was ported from).
        if (isDevAllowed) ensureDevPanelBuilt();
    }

    // PROJECT: call initDevPanelEngine() once, after your own
    // event-wiring for controls OTHER than your dev-panel settings
    // (initDevPanelEngine() itself doesn't need your render*Controls()
    // calls to have run yet - those now belong inside
    // ensureDevPanelBuilt() above, not before this call). Example:
    //
    //   /* ... your own non-dev-panel setup ... */
    //   initDevPanelEngine();
    //
    // For a quick standalone test of just this template (no project
    // settings yet), uncomment the line below:
    initDevPanelEngine();
