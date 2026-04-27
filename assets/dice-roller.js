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
  const ROLL_MS     = 2600;   // physics runs for this long
  const SETTLE_MS   = 350;    // pause after physics stops
  const SIZE        = 280;    // canvas px (square)
  const TRAY        = 3.2;    // half-width of invisible walls
  const FLOOR_Y     = -2.0;

  // geo: Three.js shape  |  proxy: label used for cylinder radialSegments
  const DIE_CONFIG = {
    '2':        { geo: 'cylinder', proxy: 32  },  // coin
    '3':        { geo: 'tetra',    proxy: null },
    '4':        { geo: 'tetra',    proxy: null },
    '5':        { geo: 'cylinder', proxy: 5   },
    '6':        { geo: 'box',      proxy: null },
    '7':        { geo: 'cylinder', proxy: 7   },
    '8':        { geo: 'octa',     proxy: null },
    '10':       { geo: 'penta',    proxy: null },
    '12':       { geo: 'dodeca',   proxy: null },
    '14':       { geo: 'octa',     proxy: null },  // closest = D8 shape
    '16':       { geo: 'icosa',    proxy: null },  // closest = D20 shape
    '20':       { geo: 'icosa',    proxy: null },
    '100':      { geo: 'sphere',   proxy: null },
    'hopefear': { geo: 'box',      proxy: null },  // two D6s
  };

  /* ═══════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════ */
  let selectedDie = null;
  let rolling     = false;
  let rafId       = null;
  let scene, camera, renderer, world, dieMat;
  let meshA, bodyA, meshB, bodyB;  // B only for hopefear

  /* ═══════════════════════════════════════════════════
     DOM
  ═══════════════════════════════════════════════════ */
  const rollBtn    = document.getElementById('rollBtn');
  const rollResult = document.getElementById('rollResult');
  const historyLog = document.getElementById('historyLog');
  const clearBtn   = document.getElementById('clearBtn');
  const dieWrap    = document.getElementById('dieWrap');

  /* ═══════════════════════════════════════════════════
     BOOTSTRAP — wait for libs, then set up canvas
  ═══════════════════════════════════════════════════ */
  function boot() {
    if (!window.THREE || !window.CANNON) { setTimeout(boot, 50); return; }
    setupCanvas();
    setupThree();
    setupCannon();
    renderer.render(scene, camera);
  }

  function setupCanvas() {
    // Hide legacy SVG elements
    dieWrap.querySelectorAll('svg, .hope-fear-wrap').forEach(el => {
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
     THREE.JS
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const sun = new THREE.DirectionalLight(0xfff5dd, 1.2);
    sun.position.set(5, 10, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xaaccff, 0.35);
    fill.position.set(-4, 6, -4);
    scene.add(fill);

    // Shadow-receiving floor plane (invisible)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.28 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  /* ═══════════════════════════════════════════════════
     CANNON.JS
  ═══════════════════════════════════════════════════ */
  function setupCannon() {
    const CANNON = window.CANNON;

    world = new CANNON.World();
    world.gravity.set(0, -30, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 20;

    const groundMat = new CANNON.Material('ground');
    dieMat          = new CANNON.Material('die');

    world.addContactMaterial(new CANNON.ContactMaterial(groundMat, dieMat, {
      friction: 0.35, restitution: 0.35,
    }));

    // Floor
    const floor = new CANNON.Body({ mass: 0, material: groundMat });
    floor.addShape(new CANNON.Plane());
    floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    floor.position.y = FLOOR_Y;
    world.addBody(floor);

    // Four invisible walls
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
     GEOMETRY
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
      case 'tetra':
        return convexPair(new THREE.TetrahedronGeometry(1.3));
      case 'octa':
        return convexPair(new THREE.OctahedronGeometry(1.3));
      case 'dodeca':
        return convexPair(new THREE.DodecahedronGeometry(1.3));
      case 'icosa':
        return convexPair(new THREE.IcosahedronGeometry(1.3));
      case 'penta': {
        // Pentagonal dipyramid (double cone) — good D10 stand-in
        //const g = new THREE.CylinderGeometry(0.01, 1.25, 2.2, 5);
        //return { three: g, cannon: new CANNON.Cylinder(0.01, 1.25, 2.2, 5) };
        return createD10Assets();
      }
      case 'cylinder': {
        const seg = proxy || 32;
        const thick = (seg <= 7) ? 0.7 : 0.45;  // coin vs multi-side
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

  /**
 * Creates both Three.js geometry and a Cannon.js ConvexPolyhedron shape.
 */
function createD10Assets(radius = 1, height = 1.5) {
    // --- 1. Define Vertices (Common to both) ---
    const vertices = [];
    const ringHeight = radius * 0.3;
    vertices.push(0, 0, height);  // Top Pole
    vertices.push(0, 0, -height); // Bottom Pole

    for (let i = 0; i < 5; i++) {
        const angle = (i * 2 * Math.PI) / 5;
        vertices.push(Math.cos(angle) * radius, Math.sin(angle) * radius, ringHeight);
    }
    for (let i = 0; i < 5; i++) {
        const angle = (i * 2 * Math.PI) / 5 + (Math.PI / 5);
        vertices.push(Math.cos(angle) * radius, Math.sin(angle) * radius, -ringHeight);
    }

    // --- 2. Create Three.js Geometry ---
    // (Indices calculation omitted for brevity - see previous steps)
    let threeGeo = new THREE.PolyhedronGeometry(vertices, indices, radius, 0);
    
    // --- 3. Convert to Cannon.js Shape ---
    // Merge vertices first so Cannon sees a solid object
    const mergedGeo = mergeVertices(threeGeo);
    const position = mergedGeo.attributes.position.array;
    const index = mergedGeo.index.array;

    const cannonVertices = [];
    for (let i = 0; i < position.length; i += 3) {
        cannonVertices.push(new CANNON.Vec3(position[i], position[i + 1], position[i + 2]));
    }

    const cannonFaces = [];
    for (let i = 0; i < index.length; i += 3) {
        cannonFaces.push([index[i], index[i + 1], index[i + 2]]);
    }

    const cannonShape = new CANNON.ConvexPolyhedron({
        vertices: cannonVertices,
        faces: cannonFaces
    });

    return { three: threeGeo, cannon: cannonShape };
}

  // Build matching Three + Cannon convex pair from a BufferGeometry
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
     VISUAL MATERIALS
  ═══════════════════════════════════════════════════ */
  function mat(color, emissive) {
    return new THREE.MeshStandardMaterial({
      color, emissive: emissive || 0x110e1a,
      emissiveIntensity: 0.18, roughness: 0.42, metalness: 0.58,
    });
  }
  const matDefault = () => mat(0x2a2538);
  const matHope    = () => mat(0x0e2d47, 0x07131e);
  const matFear    = () => mat(0x3d1010, 0x1a0707);

  /* ═══════════════════════════════════════════════════
     SPAWN ONE DIE
  ═══════════════════════════════════════════════════ */
  function spawnDie(geoType, proxy, visMat, offsetX, fastSpin) {
    const THREE  = window.THREE;
    const CANNON = window.CANNON;
    const { three: geo, cannon: shape } = makeGeo(geoType, proxy);

    const mesh = new THREE.Mesh(geo, visMat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 1, material: dieMat });
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
     CLEAR PREVIOUS DICE
  ═══════════════════════════════════════════════════ */
  function clearDice() {
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
    setTimeout(stopLoop, 1400);  // settle and freeze
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
      // Brake to a stop
      [bodyA, bodyB].forEach(b => {
        if (b) { b.velocity.set(0,0,0); b.angularVelocity.set(0,0,0); }
      });

      setTimeout(() => {
        stopLoop();
        rolling = false;
        rollBtn.classList.remove('rolling');
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
      const a = getAudio('/assets/dice.mp3');
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
     GO
  ═══════════════════════════════════════════════════ */
  boot();

})();