// SPOTTY EXPOTTY -- host entry point.
// PROJECT: your app's own code goes here. This stub only wires up the
// vendored UI Layout Engine (CLAUDE.md S13) so the scaffold is runnable
// immediately -- replace/extend freely.
import { createUIElement, resolveAndApplyAll } from '../lib/ui-engine/registry.mjs';

// Example registration for the #appStage placeholder div in index.html.
// See lib/ui-engine/../../HTML UI ENGINE/docs/ENGINE_API.md (or this
// project's own copy once vendored) before registering real elements.
const appStage = document.getElementById('appStage');
if (appStage) {
    createUIElement({
        id: 'appStage',
        role: 'container',
        layout: {
            position: { mode: 'fixed', viewportAnchor: 'top-left', offset: { x: '0px', y: '0px' } },
            size: {
                width: { mode: 'fixed', value: '100vw' },
                height: { mode: 'fixed', value: '100vh' },
            },
        },
        domNode: appStage,
    });
    resolveAndApplyAll();
}
