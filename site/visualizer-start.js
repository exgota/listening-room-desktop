// Picks the remembered visualizer before the first track is chosen, and redraws once the
// inlined fonts are ready for canvas text.
startVisualizers();
visualFontsReady.then(() => {
  measureVisualizer();
  drawVisualizer();
});
