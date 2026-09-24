// Pocket: placeholder while the real visualizer is built.
registerVisualizer({
  key: "pocket",
  name: "Pocket",
  order: 3,
  create() {
    const canvas = createVisualCanvas();
    const context = canvas.getContext("2d");
    let song = null;
    return {
      canvas,
      setSong(model) { song = model; },
      setActive(on) { canvas.hidden = !on; },
      resize(width, height, ratio) {
        const [w, h] = canvasPixels(width, height, ratio, 1920 * 1080);
        canvas.width = w; canvas.height = h;
      },
      render(time, frame) {
        context.setTransform(canvas.width / frame.width, 0, 0, canvas.height / frame.height, 0, 0);
        context.fillStyle = "#e8b62c";
        context.fillRect(0, 0, frame.width, frame.height);
        context.fillStyle = "#141414";
        context.font = "600 40px 'IBM Plex Mono'";
        context.fillText("Pocket " + time.toFixed(2) + (song ? " " + song.scene(time).kind : " (no song)"), 80, frame.height - 300);
        if (song) {
          const beat = song.beatPosition(time);
          context.fillRect(80 + (beat % 4) * 200, frame.height / 2, 150 * (1 - (beat % 1)), 150);
        }
      },
    };
  },
});
