/* Manual floor-plan-image calibration.

   The real SentiArch layout (rpgarchitecture-layout.js) is the BACKEND
   truth: engine + which-zone hit-test in world mm (invisible).
   floorplan.jpg is the VISUAL, positioned/scaled here so its rooms
   sit over the (hidden) geometry. Re-export from the demo's
   "calibrate" mode to update.

   { x, y } = translate as % of the plan frame; { sx, sy } = scale.

   Baked from the user's calibrate export {x:0,y:0,sx:0.62,sy:0.65},
   rescaled ×1.25 for the reduced computeFit padding (0.15→0.02) so
   the plan fills the frame (less whitespace) with alignment kept. */
window.MHC_CALIB = { "x": 0, "y": 0, "sx": 0.78, "sy": 0.81 };
