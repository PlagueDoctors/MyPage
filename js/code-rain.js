(function () {
  const canvas = document.getElementById("code-rain");
  const ctx = canvas.getContext("2d");

  const LATIN =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>{}[]();=+-*/&|!~#@$%^&*";
  const KATAKANA =
    "ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾ" +
    "タダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポ" +
    "マミムメモャヤュユョヨラリルレロワヲンヴヵヶー";
  const chars = LATIN + KATAKANA;

  const fontSize = 11;
  const trailLength = 70;
  const fallSpeed = 0.30;
  const minAlpha = 0.12;
  const FPS_REF = 60;
  const MUTATE_RATIO = 0.3;
  const FONT_FAMILY =
    '"BIZ UDPGothic", "Yu Gothic UI", "MS Gothic", "Consolas", monospace';

  let columns = 0;
  let rows = 0;
  let drops = [];
  let grid = [];
  let mutable = [];
  let mutateTimer = [];
  let lastTime = 0;

  function randomChar() {
    return chars[Math.floor(Math.random() * chars.length)];
  }

  function randomMutateDelay() {
    return 0.25 + Math.random() * 1.75;
  }

  function initCellState(i, r, prevChar) {
    grid[i][r] = prevChar || randomChar();
    mutable[i][r] = Math.random() < MUTATE_RATIO;
    mutateTimer[i][r] = mutable[i][r]
      ? Math.random() * randomMutateDelay()
      : Infinity;
  }

  function updateMutations(delta) {
    for (let i = 0; i < columns; i++) {
      for (let r = 0; r < rows; r++) {
        if (!mutable[i][r]) continue;

        mutateTimer[i][r] -= delta;
        if (mutateTimer[i][r] <= 0) {
          grid[i][r] = randomChar();
          mutateTimer[i][r] = randomMutateDelay();
        }
      }
    }
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    columns = Math.floor(canvas.width / fontSize);
    rows = Math.ceil(canvas.height / fontSize) + 2;

    const prevGrid = grid;
    grid = [];
    mutable = [];
    mutateTimer = [];

    for (let i = 0; i < columns; i++) {
      grid[i] = [];
      mutable[i] = [];
      mutateTimer[i] = [];
      for (let r = 0; r < rows; r++) {
        initCellState(i, r, prevGrid[i] && prevGrid[i][r]);
      }
    }

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

    updateMutations(delta);

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontSize + "px " + FONT_FAMILY;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const bottomRow = rows - 1;
    const cellCenterX = fontSize / 2;

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
        ctx.fillText(grid[i][r], i * fontSize + cellCenterX, r * fontSize);
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
