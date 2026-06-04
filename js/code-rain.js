(function () {
  const canvas = document.getElementById("code-rain");
  const ctx = canvas.getContext("2d");

  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>{}[]();=+-*/&|!~#@$%^&*";
  const fontSize = 14;
  const trailLength = 20;
  const fallSpeed = 0.28;
  const minAlpha = 0.22;

  let columns = 0;
  let drops = [];
  let trails = [];

  function randomChar() {
    return chars[Math.floor(Math.random() * chars.length)];
  }

  function createTrail() {
    return Array.from({ length: trailLength }, randomChar);
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    columns = Math.floor(canvas.width / fontSize);
    drops = Array.from({ length: columns }, () =>
      -Math.random() * (canvas.height / fontSize)
    );
    trails = Array.from({ length: columns }, createTrail);
  }

  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = fontSize + "px monospace";

    for (let i = 0; i < columns; i++) {
      const x = i * fontSize;
      const prevHead = Math.floor(drops[i]);

      drops[i] += fallSpeed;

      const headRow = Math.floor(drops[i]);
      const steps = headRow - prevHead;
      if (steps > 0) {
        for (let s = 0; s < steps; s++) {
          trails[i].unshift(randomChar());
          trails[i].pop();
        }
      }

      for (let t = 0; t < trailLength; t++) {
        const y = (headRow - t) * fontSize;
        if (y < -fontSize || y > canvas.height) continue;

        const fade = 1 - t / trailLength;
        const alpha = fade * fade * fade;
        if (alpha < minAlpha) continue;

        const gray = Math.floor(80 + fade * 175);

        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, ${alpha})`;
        ctx.fillText(trails[i][t], x, y);
      }

      if (headRow * fontSize > canvas.height && Math.random() > 0.985) {
        drops[i] = -trailLength * Math.random();
        trails[i] = createTrail();
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  draw();
})();
