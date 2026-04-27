/**
 * dice-roller.js  —  3D physics dice with Three.js + Cannon.js
 * Place in /assets/dice-roller.js
 *
 * Requires in dice-roller.html (before this script):
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js"></script>
 *
 * Audio files expected in /assets/:
 *   dice-roll.mp3
 *   number-1.mp3 … number-100.mp3
 *   number-hope.mp3 / number-fear.mp3
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════════════ */
  const ROLL_MS   = 2600;
  const SETTLE_MS = 400;
  const SIZE      = 280;
  const TRAY      = 3.2;
  const FLOOR_Y   = -2.0;

  const DIE_CONFIG = {
    '2':        { geo: 'cylinder', proxy: 32  },
    '3':        { geo: 'tetra',    proxy: null },
    '4':        { geo: 'tetra',    proxy: null },
    '5':        { geo: 'cylinder', proxy: 5   },
    '6':        { geo: 'box',      proxy: null },
    '7':        { geo: 'cylinder', proxy: 7   },
    '8':        { geo: 'octa',     proxy: null },
    '10':       { geo: 'd10',      proxy: null },  // true pentagonal trapezohedron
    '12':       { geo: 'dodeca',   proxy: null },
    '14':       { geo: 'octa',     proxy: null },
    '16':       { geo: 'icosa',    proxy: null },
    '20':       { geo: 'icosa',    proxy: null },
    '100':      { geo: 'sphere',   proxy: null },
    'hopefear': { geo: 'box',      proxy: null },
  };

  /* ═══════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════ */
  let selectedDie = null;
  let rolling     = false;
  let rafId       = null;
  let scene, camera, renderer, world, cannonDieMat;
  let meshA, bodyA, meshB, bodyB;
  let labelSpriteA = null, labelSpriteB = null;

  /* ═══════════════════════════════════════════════════
     DOM
  ═══════════════════════════════════════════════════ */
  const rollBtn    = document.getElementById('rollBtn');
  const rollResult = document.getElementById('rollResult');
  const historyLog = document.getElementById('historyLog');
  const clearBtn   = document.getElementById('clearBtn');
  const dieWrap    = document.getElementById('dieWrap');

  /* ═══════════════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════════════ */
  function boot() {
    if (!window.THREE || !window.CANNON) { setTimeout(boot, 50); return; }
    setupCanvas();
    setupThree();
    setupCannon();
    renderer.render(scene, camera);
  }

  function setupCanvas() {
    dieWrap.querySelectorAll('svg, .hope-fear-wrap, .canvas-placeholder').forEach(el => {
      el.style.display = 'none';
    });
    dieWrap.style.width  = SIZE + 'px';
    dieWrap.style.height = SIZE + 'px';
    const cv = document.createElement('canvas');
    cv.id = 'diceCanvas';
    cv.width = SIZE; cv.height = SIZE;
    cv.style.cssText = 'width:' + SIZE + 'px;height:' + SIZE + 'px;border-radius:12px;display:block;';
    dieWrap.appendChild(cv);
  }

  /* ═══════════════════════════════════════════════════
     THREE.JS SCENE
  ═══════════════════════════════════════════════════ */
  function setupThree() {
    const THREE = window.THREE;
    const cv    = document.getElementById('diceCanvas');

    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    renderer.setSize(SIZE, SIZE);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 9, 6);
    camera.lookAt(0, 0, 0);

    // Brighter ambient so ivory dice pop against dark bg
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const sun = new THREE.DirectionalLight(0xfff8ee, 1.6);
    sun.position.set(5, 10, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(-5, 4, -5);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  /* ═══════════════════════════════════════════════════
     CANNON.JS WORLD
  ═══════════════════════════════════════════════════ */
  function setupCannon() {
    const CANNON = window.CANNON;
    world = new CANNON.World();
    world.gravity.set(0, -30, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 20;

    const groundMat = new CANNON.Material('ground');
    cannonDieMat    = new CANNON.Material('die');
    world.addContactMaterial(new CANNON.ContactMaterial(groundMat, cannonDieMat, {
      friction: 0.35, restitution: 0.35,
    }));

    const floor = new CANNON.Body({ mass: 0, material: groundMat });
    floor.addShape(new CANNON.Plane());
    floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    floor.position.y = FLOOR_Y;
    world.addBody(floor);

    [
      { pos: [ TRAY, 0, 0], ax: [0,0,1], ang:  Math.PI/2 },
      { pos: [-TRAY, 0, 0], ax: [0,0,1], ang: -Math.PI/2 },
      { pos: [0, 0,  TRAY], ax: [1,0,0], ang: -Math.PI/2 },
      { pos: [0, 0, -TRAY], ax: [1,0,0], ang:  Math.PI/2 },
    ].forEach(w => {
      const b = new CANNON.Body({ mass: 0, material: groundMat });
      b.addShape(new CANNON.Plane());
      b.position.set(...w.pos);
      b.quaternion.setFromAxisAngle(new CANNON.Vec3(...w.ax), w.ang);
      world.addBody(b);
    });
  }

  /* ═══════════════════════════════════════════════════
     VISUAL MATERIALS  — ivory dice on dark background
  ═══════════════════════════════════════════════════ */
  function matDefault() {
    return new THREE.MeshStandardMaterial({
      color:     0xf5f0e8,   // warm ivory
      emissive:  0x2a2010,
      emissiveIntensity: 0.04,
      roughness: 0.35,
      metalness: 0.08,
    });
  }
  function matHope() {
    return new THREE.MeshStandardMaterial({
      color: 0xd0eeff, emissive: 0x001830,
      emissiveIntensity: 0.1, roughness: 0.3, metalness: 0.15,
    });
  }
  function matFear() {
    return new THREE.MeshStandardMaterial({
      color: 0xffe0d8, emissive: 0x300000,
      emissiveIntensity: 0.1, roughness: 0.3, metalness: 0.15,
    });
  }

  /* ═══════════════════════════════════════════════════
     NUMBER LABEL SPRITE
     Rendered onto a canvas texture, placed above the die
  ═══════════════════════════════════════════════════ */
  function makeNumberSprite(text, color) {
    const THREE = window.THREE;
    const cv    = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, 256, 256);

    // Dark pill background for readability
    ctx.fillStyle = 'rgba(10, 8, 20, 0.78)';
    ctx.beginPath();
    ctx.roundRect(28, 78, 200, 100, 18);
    ctx.fill();

    // Number text
    ctx.fillStyle   = color || '#f5f0e8';
    ctx.font        = 'bold 96px "Fira Sans", sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 128);

    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.2, 2.2, 1);
    return sprite;
  }

  function removeLabelSprites() {
    [labelSpriteA, labelSpriteB].forEach(s => { if (s) scene.remove(s); });
    labelSpriteA = labelSpriteB = null;
  }

  function showLabel(mesh, text, color) {
    const THREE  = window.THREE;
    const sprite = makeNumberSprite(text, color);
    // Float the sprite above wherever the die settled
    sprite.position.set(
      mesh.position.x,
      mesh.position.y + 2.2,
      mesh.position.z
    );
    scene.add(sprite);
    return sprite;
  }

  /* ═══════════════════════════════════════════════════
     PENTAGONAL TRAPEZOHEDRON  (real D10 geometry)
     10 kite-shaped faces, 5 upper + 5 lower, twist-offset
  ═══════════════════════════════════════════════════ */
  function makeD10() {
    const THREE  = window.THREE;
    const CANNON = window.CANNON;

    const n   = 5;         // pentagonal
    const r   = 1.1;       // equatorial radius
    const top = 1.3;       // apex height
    const bot = -1.3;
    const eq  = 0.22;      // equatorial band height offset
    const twist = Math.PI / n;   // half-step twist between upper/lower ring

    // Vertices:
    //  0        = top apex
    //  1..5     = upper ring  (angled at +eq)
    //  6..10    = lower ring  (angled at -eq, twisted by twist)
    //  11       = bottom apex
    const verts = [];
    verts.push(new THREE.Vector3(0, top, 0));  // 0

    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      verts.push(new THREE.Vector3(r * Math.cos(a), eq, r * Math.sin(a)));  // 1-5
    }
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + twist;
      verts.push(new THREE.Vector3(r * Math.cos(a), -eq, r * Math.sin(a))); // 6-10
    }
    verts.push(new THREE.Vector3(0, bot, 0));  // 11

    // 10 kite faces: each face = top-apex OR bot-apex + two upper + two lower ring verts
    // Upper kites (top apex, upper[i], lower[i], upper[i+1])
    // Lower kites (bot apex, lower[i], upper[i+1], lower[i+1])
    const faces = [];
    for (let i = 0; i < n; i++) {
      const u0 = 1 + i;
      const u1 = 1 + (i + 1) % n;
      const l0 = 6 + i;
      const l1 = 6 + (i + 1) % n;
      // Upper kite — split into 2 triangles
      faces.push([0,  u0, l0]);
      faces.push([0,  l0, u1]);
      // Lower kite
      faces.push([11, l0, u1]);
      faces.push([11, u1, l1]);
    }

    // Build BufferGeometry from triangles
    const positions = [];
    const normals   = [];
    const uvs       = [];

    faces.forEach(([a, b, c]) => {
      const va = verts[a], vb = verts[b], vc = verts[c];
      [va, vb, vc].forEach(v => positions.push(v.x, v.y, v.z));

      // Flat normal
      const ab = new THREE.Vector3().subVectors(vb, va);
      const ac = new THREE.Vector3().subVectors(vc, va);
      const n3 = new THREE.Vector3().crossVectors(ab, ac).normalize();
      for (let k = 0; k < 3; k++) normals.push(n3.x, n3.y, n3.z);

      uvs.push(0,0, 1,0, 0.5,1);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));

    // Cannon convex hull from unique verts
    const cVerts = verts.map(v => new CANNON.Vec3(v.x, v.y, v.z));
    const cFaces = [];
    for (let i = 0; i < n; i++) {
      const u0 = 1 + i, u1 = 1 + (i+1)%n;
      const l0 = 6 + i, l1 = 6 + (i+1)%n;
      cFaces.push([0, u0, l0], [0, l0, u1]);
      cFaces.push([11, l0, u1], [11, u1, l1]);
    }
    const cannon = new CANNON.ConvexPolyhedron(cVerts, cFaces);

    return { three: geo, cannon };
  }

  /* ═══════════════════════════════════════════════════
     GEOMETRY FACTORY
  ═══════════════════════════════════════════════════ */
  function makeGeo(geoType, proxy) {
    const THREE  = window.THREE;
    const CANNON = window.CANNON;

    switch (geoType) {
      case 'box':
        return {
          three:  new THREE.BoxGeometry(1.6, 1.6, 1.6),
          cannon: new CANNON.Box(new CANNON.Vec3(0.8, 0.8, 0.8)),
        };
      case 'tetra':   return convexPair(new THREE.TetrahedronGeometry(1.3));
      case 'octa':    return convexPair(new THREE.OctahedronGeometry(1.3));
      case 'dodeca':  return convexPair(new THREE.DodecahedronGeometry(1.3));
      case 'icosa':   return convexPair(new THREE.IcosahedronGeometry(1.3));
      case 'd10':     return makeD10();
      case 'cylinder': {
        const seg   = proxy || 32;
        const thick = seg <= 7 ? 0.65 : 0.4;
        return {
          three:  new THREE.CylinderGeometry(1.05, 1.05, thick, seg),
          cannon: new CANNON.Cylinder(1.05, 1.05, thick, seg),
        };
      }
      case 'sphere':
        return {
          three:  new THREE.SphereGeometry(1.15, 32, 32),
          cannon: new CANNON.Sphere(1.15),
        };
      default:
        return convexPair(new THREE.IcosahedronGeometry(1.3));
    }
  }

  function convexPair(bufGeo) {
    const CANNON = window.CANNON;
    const pos    = bufGeo.attributes.position;
    const vMap   = new Map();
    const verts  = [];
    const faces  = [];

    function vid(i) {
      const x = +pos.getX(i).toFixed(4);
      const y = +pos.getY(i).toFixed(4);
      const z = +pos.getZ(i).toFixed(4);
      const k = x + ',' + y + ',' + z;
      if (!vMap.has(k)) { vMap.set(k, verts.length); verts.push(new CANNON.Vec3(x, y, z)); }
      return vMap.get(k);
    }

    const idx = bufGeo.index;
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        const a = vid(idx.getX(i)), b = vid(idx.getX(i+1)), c = vid(idx.getX(i+2));
        if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        const a = vid(i), b = vid(i+1), c = vid(i+2);
        if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
      }
    }
    return { three: bufGeo, cannon: new CANNON.ConvexPolyhedron(verts, faces) };
  }

  /* ═══════════════════════════════════════════════════
     SPAWN A DIE
  ═══════════════════════════════════════════════════ */
  function spawnDie(geoType, proxy, visMat, offsetX, fastSpin) {
    const THREE  = window.THREE;
    const CANNON = window.CANNON;
    const { three: geo, cannon: shape } = makeGeo(geoType, proxy);

    const mesh = new THREE.Mesh(geo, visMat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 1, material: cannonDieMat });
    body.addShape(shape);
    body.position.set(
      offsetX + (Math.random() - 0.5) * 0.6,
      4.5 + Math.random(),
      (Math.random() - 0.5) * 0.6
    );
    const spin = fastSpin ? 40 : 14;
    body.angularVelocity.set(
      (Math.random() - 0.5) * spin,
      (Math.random() - 0.5) * spin,
      (Math.random() - 0.5) * spin
    );
    body.velocity.set((Math.random()-0.5)*3, -3, (Math.random()-0.5)*3);
    body.angularDamping = 0.2;
    body.linearDamping  = 0.15;
    world.addBody(body);
    return { mesh, body };
  }

  /* ═══════════════════════════════════════════════════
     CLEAR DICE + LABELS
  ═══════════════════════════════════════════════════ */
  function clearDice() {
    removeLabelSprites();
    [meshA, meshB].forEach(m => { if (m) { scene.remove(m); m.geometry.dispose(); } });
    [bodyA, bodyB].forEach(b => { if (b) world.remove(b); });
    meshA = meshB = bodyA = bodyB = null;
  }

  /* ═══════════════════════════════════════════════════
     RENDER LOOP
  ═══════════════════════════════════════════════════ */
  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    (function tick() {
      rafId = requestAnimationFrame(tick);
      world.step(1 / 60);
      if (meshA && bodyA) { meshA.position.copy(bodyA.position); meshA.quaternion.copy(bodyA.quaternion); }
      if (meshB && bodyB) { meshB.position.copy(bodyB.position); meshB.quaternion.copy(bodyB.quaternion); }
      renderer.render(scene, camera);
    })();
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (renderer) renderer.render(scene, camera);
  }

  /* ═══════════════════════════════════════════════════
     DIE SELECTION
  ═══════════════════════════════════════════════════ */
  document.querySelectorAll('.die-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (rolling) return;
      selectedDie = btn.dataset.sides;
      document.querySelectorAll('.die-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rollBtn.disabled = false;
      rollBtn.querySelector('.roll-btn-label').textContent = 'Roll ' + btn.dataset.label;
      setResult('', '');
      if (window.THREE && window.CANNON) previewDie(selectedDie);
    });
  });

  function previewDie(die) {
    clearDice();
    if (rafId) stopLoop();
    const cfg = DIE_CONFIG[die];
    if (!die || !cfg) return;

    if (die === 'hopefear') {
      const h = spawnDie('box', null, matHope(), -1.3, false);
      const f = spawnDie('box', null, matFear(),  1.3, false);
      meshA = h.mesh; bodyA = h.body;
      meshB = f.mesh; bodyB = f.body;
    } else {
      const d = spawnDie(cfg.geo, cfg.proxy, matDefault(), 0, false);
      meshA = d.mesh; bodyA = d.body;
    }
    startLoop();
    setTimeout(stopLoop, 1400);
  }

  /* ═══════════════════════════════════════════════════
     ROLL
  ═══════════════════════════════════════════════════ */
  rollBtn.addEventListener('click', doRoll);
  document.addEventListener('keydown', e => {
    if ((e.code === 'Space' || e.code === 'Enter') && !rolling && selectedDie) {
      e.preventDefault(); doRoll();
    }
  });

  function rand(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  function doRoll() {
    if (!selectedDie || rolling || !window.THREE || !window.CANNON) return;
    rolling = true;
    rollBtn.classList.add('rolling');
    setResult('', '');
    removeLabelSprites();
    playRollSound();

    const result = computeRoll(selectedDie);
    const cfg    = DIE_CONFIG[selectedDie];

    clearDice();
    if (rafId) stopLoop();

    if (selectedDie === 'hopefear') {
      const h = spawnDie('box', null, matHope(), -1.3, true);
      const f = spawnDie('box', null, matFear(),  1.3, true);
      meshA = h.mesh; bodyA = h.body;
      meshB = f.mesh; bodyB = f.body;
    } else {
      const d = spawnDie(cfg.geo, cfg.proxy, matDefault(), 0, true);
      meshA = d.mesh; bodyA = d.body;
    }

    startLoop();

    setTimeout(() => {
      [bodyA, bodyB].forEach(b => {
        if (b) { b.velocity.set(0,0,0); b.angularVelocity.set(0,0,0); }
      });

      setTimeout(() => {
        stopLoop();
        rolling = false;
        rollBtn.classList.remove('rolling');

        // Show number on / above the settled die
        if (selectedDie === 'hopefear') {
          labelSpriteA = showLabel(meshA, String(result.hope),  '#6bbde8');
          labelSpriteB = showLabel(meshB, String(result.fear),  '#e07070');
        } else {
          const color = result.modifier === 'crit'   ? '#ffe066'
                      : result.modifier === 'fumble' ? '#e07070'
                      : '#f5f0e8';
          labelSpriteA = showLabel(meshA, String(result.value), color);
        }
        renderer.render(scene, camera);

        const { label, modifier } = result;
        setResult(label, modifier);
        addHistory(label, modifier);
        setTimeout(() => speakResult(result), 200);
      }, SETTLE_MS);

    }, ROLL_MS);
  }

  /* ═══════════════════════════════════════════════════
     COMPUTE / SPEAK / DISPLAY
  ═══════════════════════════════════════════════════ */
  function computeRoll(die) {
    if (die === 'hopefear') {
      const hope = rand(1, 12), fear = rand(1, 12);
      const total = hope + fear;
      const outcome = hope >= fear ? 'hope' : 'fear';
      return { type: 'hopefear', hope, fear, total, outcome,
               label: total + ' with ' + outcome, modifier: outcome };
    }
    const sides = parseInt(die, 10);
    const value = rand(1, sides);
    const crit  = (die === '20' && value === 20) ? 'crit'
                : (die === '20' && value === 1)  ? 'fumble' : '';
    return { type: 'normal', sides, value, label: 'D' + sides + ': ' + value, modifier: crit };
  }

  function speakResult(result) {
    if (result.type === 'hopefear') {
      playNumberSound(result.total);
      setTimeout(() => playNumberSound(result.outcome), 900);
    } else {
      playNumberSound(result.value);
    }
  }

  function setResult(text, modifier) {
    rollResult.textContent = text;
    rollResult.className   = 'roll-result';
    if (text) {
      rollResult.classList.add('visible');
      if (modifier) rollResult.classList.add(modifier);
    }
  }

  /* ═══════════════════════════════════════════════════
     HISTORY
  ═══════════════════════════════════════════════════ */
  function addHistory(label, modifier) {
    const empty = historyLog.querySelector('.history-empty');
    if (empty) empty.remove();
    const chip = document.createElement('span');
    chip.className = 'history-chip' + (modifier ? ' ' + modifier : '');
    chip.textContent = label;
    historyLog.insertBefore(chip, historyLog.firstChild);
  }

  clearBtn.addEventListener('click', () => {
    historyLog.innerHTML = '<span class="history-empty">No rolls yet</span>';
  });

  /* ═══════════════════════════════════════════════════
     AUDIO
  ═══════════════════════════════════════════════════ */
  const audioCache = {};
  function getAudio(src) {
    if (!audioCache[src]) { const a = new Audio(src); a.preload = 'auto'; audioCache[src] = a; }
    return audioCache[src];
  }
  function playRollSound() {
    try {
      const a = getAudio('/assets/dice-roll.mp3');
      a.currentTime = 0;
      const p = a.play();
      if (p) p.then(() => setTimeout(() => { a.pause(); a.currentTime = 0; }, 900)).catch(() => {});
    } catch (_) {}
  }
  function playNumberSound(n) {
    try { const a = getAudio('/assets/number-' + n + '.mp3'); a.currentTime = 0; a.play().catch(() => {}); }
    catch (_) {}
  }

  /* ═══════════════════════════════════════════════════
     STREAMER MODE
  ═══════════════════════════════════════════════════ */
  const streamerBtn = document.getElementById('streamerToggle');
  const STREAMER_KEY = 'diceroller-streamer';

  function setStreamerMode(on) {
    document.body.classList.toggle('streamer-mode', on);
    streamerBtn.classList.toggle('active', on);
    streamerBtn.querySelector('.streamer-label').textContent = on ? 'Exit' : 'Streamer';
    try { localStorage.setItem(STREAMER_KEY, on ? '1' : ''); } catch (_) {}
  }

  streamerBtn.addEventListener('click', () => {
    setStreamerMode(!document.body.classList.contains('streamer-mode'));
  });

  // Restore preference across page loads
  try { if (localStorage.getItem(STREAMER_KEY)) setStreamerMode(true); } catch (_) {}

  boot();

})();