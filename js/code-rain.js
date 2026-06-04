(function () {
  const canvas = document.getElementById("code-rain");
  const ctx = canvas.getContext("2d");

  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>{}[]();=+-*/&|!~#@$%^&*";
  const fontSize = 11;
  const trailLength = 70;
  const fallSpeed = 0.30;
  const minAlpha = 0.12;
  const FPS_REF = 60;

  let columns = 0;
  let rows = 0;
  let drops = [];
  let grid = [];
  let lastTime = 0;

  function randomChar() {
    return chars[Math.floor(Math.random() * chars.length)];
  }

  function createColumn() {
    return Array.from({ length: rows }, randomChar);
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    columns = Math.floor(canvas.width / fontSize);
    rows = Math.ceil(canvas.height / fontSize) + 2;

    const prevGrid = grid;
    grid = Array.from({ length: columns }, (_, i) => {
      const prev = prevGrid[i];
      return Array.from({ length: rows }, (_, r) =>
        prev && prev[r] ? prev[r] : randomChar()
      );
    });

    drops = Array.from({ length: columns }, () =>
      -Math.random() * trailLength
    );
    lastTime = 0;
  }

  function draw(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const delta = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    const move = fallSpeed * FPS_REF * delta;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontSize + "px monospace";

    const bottomRow = rows - 1;

    for (let i = 0; i < columns; i++) {
      drops[i] += move;
      const head = drops[i];

      const startRow = Math.max(0, Math.ceil(head - trailLength + 1));
      const endRow = Math.min(bottomRow, Math.floor(head));

      for (let r = startRow; r <= endRow; r++) {
        const t = head - r;
        if (t < 0 || t >= trailLength) continue;

        const fade = 1 - t / trailLength;
        const alpha = fade * fade * fade;
        if (alpha < minAlpha) continue;

        const gray = Math.floor(80 + fade * 175);
        ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, ${alpha})`;
        ctx.fillText(grid[i][r], i * fontSize, r * fontSize);
      }

      if (head - trailLength > bottomRow) {
        drops[i] = -Math.random() * trailLength;
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(draw);
})();
