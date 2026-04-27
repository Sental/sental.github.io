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
  const MAX_ROLL_MS  = 4000;  // max wait before we force-settle
  const SETTLE_MS    = 600;   // pause after motion stops before showing number
  const SIZE         = 280;
  const TRAY         = 5.5;   // wider tray = more room to tumble
  const FLOOR_Y      = -2.2;
  const SUBSTEPS     = 5;     // physics substeps per frame for accuracy

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
    world.gravity.set(0, -50, 0);   // stronger gravity = snappier settle
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 40;   // more iterations = more stable contacts

    const groundMat = new CANNON.Material('ground');
    cannonDieMat    = new CANNON.Material('die');
    world.addContactMaterial(new CANNON.ContactMaterial(groundMat, cannonDieMat, {
      friction:    0.6,    // high friction = rolling not sliding
      restitution: 0.25,   // low restitution = bounce dies out quickly
    }));
    // die-vs-die contact (hopefear)
    world.addContactMaterial(new CANNON.ContactMaterial(cannonDieMat, cannonDieMat, {
      friction: 0.4, restitution: 0.2,
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

    // Ceiling — stops dice flying off the top
    const ceil = new CANNON.Body({ mass: 0, material: groundMat });
    ceil.addShape(new CANNON.Plane());
    ceil.position.set(0, 7, 0);
    ceil.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), Math.PI/2);
    world.addBody(ceil);
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

    const n     = 5;
    const r     = 1.15;        // equatorial radius
    const topY  =  1.35;       // top apex
    const botY  = -1.35;       // bottom apex
    const upY   =  0.25;       // upper ring height
    const loY   = -0.25;       // lower ring height
    const twist = Math.PI / n; // half-turn twist between rings

    // 12 unique vertices
    // 0 = top apex, 1-5 = upper ring, 6-10 = lower ring, 11 = bottom apex
    const V = [];
    V.push(new THREE.Vector3(0, topY, 0)); // 0
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      V.push(new THREE.Vector3(r * Math.cos(a), upY, r * Math.sin(a))); // 1-5
    }
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + twist;
      V.push(new THREE.Vector3(r * Math.cos(a), loY, r * Math.sin(a))); // 6-10
    }
    V.push(new THREE.Vector3(0, botY, 0)); // 11

    // Helper: compute outward normal for a triangle, flip if pointing inward
    function triNormal(a, b, c) {
      const ab  = new THREE.Vector3().subVectors(b, a);
      const ac  = new THREE.Vector3().subVectors(c, a);
      const nor = new THREE.Vector3().crossVectors(ab, ac).normalize();
      // centroid of this face
      const cen = new THREE.Vector3()
        .addVectors(a, b).add(c).multiplyScalar(1 / 3);
      // if normal points toward origin, flip it
      if (nor.dot(cen) < 0) nor.negate();
      return nor;
    }

    // Each kite = 2 triangles
    // Upper kite i: apex(0), upper[i], lower[i], upper[i+1]
    // Lower kite i: apex(11), lower[i], upper[i+1], lower[i+1]
    const tris = [];
    for (let i = 0; i < n; i++) {
      const u0 = 1 + i, u1 = 1 + (i + 1) % n;
      const l0 = 6 + i, l1 = 6 + (i + 1) % n;
      tris.push([0,  u0, l0]);
      tris.push([0,  l0, u1]);
      tris.push([11, u1, l0]);
      tris.push([11, l1, u1]);
    }

    const positions = [];
    const normals   = [];
    const uvs       = [];

    tris.forEach(([ai, bi, ci]) => {
      const va = V[ai], vb = V[bi], vc = V[ci];
      positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
      const nor = triNormal(va, vb, vc);
      for (let k = 0; k < 3; k++) normals.push(nor.x, nor.y, nor.z);
      uvs.push(0, 0,  1, 0,  0.5, 1);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));

    // Cannon convex hull — just needs the unique vertex cloud
    const cVerts = V.map(v => new CANNON.Vec3(v.x, v.y, v.z));
    const cannon  = new CANNON.ConvexPolyhedron(cVerts, tris.map(t => [...t]));

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
    const THREE  = window.THREE;
    const CANNON = window.CANNON;

    // Let Three.js compute reliable outward-facing normals from the geometry
    bufGeo.computeVertexNormals();

    const pos  = bufGeo.attributes.position;
    const vMap = new Map();
    const verts = [];
    const faces = [];

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
        if (a !== b && b !== c && a !== c) {
          // Verify winding produces an outward normal before adding to Cannon
          const va = verts[a], vb = verts[b], vc = verts[c];
          const ab = new CANNON.Vec3(vb.x-va.x, vb.y-va.y, vb.z-va.z);
          const ac = new CANNON.Vec3(vc.x-va.x, vc.y-va.y, vc.z-va.z);
          const nor = ab.cross(ac);
          const cen = new CANNON.Vec3((va.x+vb.x+vc.x)/3, (va.y+vb.y+vc.y)/3, (va.z+vb.z+vc.z)/3);
          // dot < 0 means normal points inward — swap b and c to flip
          if (nor.dot(cen) < 0) faces.push([a, c, b]);
          else                   faces.push([a, b, c]);
        }
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        const a = vid(i), b = vid(i+1), c = vid(i+2);
        if (a !== b && b !== c && a !== c) {
          const va = verts[a], vb = verts[b], vc = verts[c];
          const ab = new CANNON.Vec3(vb.x-va.x, vb.y-va.y, vb.z-va.z);
          const ac = new CANNON.Vec3(vc.x-va.x, vc.y-va.y, vc.z-va.z);
          const nor = ab.cross(ac);
          const cen = new CANNON.Vec3((va.x+vb.x+vc.x)/3, (va.y+vb.y+vc.y)/3, (va.z+vb.z+vc.z)/3);
          if (nor.dot(cen) < 0) faces.push([a, c, b]);
          else                   faces.push([a, b, c]);
        }
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

    // Start high and slightly off-centre so it tumbles on landing
    body.position.set(
      offsetX + (Math.random() - 0.5) * 1.5,
      5.5 + Math.random() * 1.5,
      (Math.random() - 0.5) * 1.5
    );

    if (fastSpin) {
      // Vigorous throw: strong horizontal velocity + furious spin
      const dir = Math.random() * Math.PI * 2;
      body.velocity.set(
        Math.cos(dir) * (6 + Math.random() * 4),
        -(3 + Math.random() * 2),
        Math.sin(dir) * (6 + Math.random() * 4)
      );
      body.angularVelocity.set(
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 60
      );
    } else {
      // Preview: gentle drop with mild tumble
      body.velocity.set(
        (Math.random() - 0.5) * 1.5,
        -2,
        (Math.random() - 0.5) * 1.5
      );
      body.angularVelocity.set(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      );
    }

    // Low damping — let physics + friction do the work
    body.angularDamping = 0.04;
    body.linearDamping  = 0.04;
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
  let lastTime = null;

  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    lastTime = null;
    (function tick(now) {
      rafId = requestAnimationFrame(tick);
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 1/30) : 1/60;
      lastTime = now;
      // Multiple substeps per frame keeps fast-moving dice stable
      world.step(1 / 60, dt, SUBSTEPS);
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

    // Settle detection: watch velocity rather than using a fixed timer
    const rollStart = performance.now();
    let settleTimer = null;

    function checkSettled() {
      if (!rolling) return;

      const elapsed = performance.now() - rollStart;
      const bodies  = [bodyA, bodyB].filter(Boolean);

      const allSlow = bodies.every(b => {
        const lv = b.velocity;
        const av = b.angularVelocity;
        const linSpd = Math.sqrt(lv.x*lv.x + lv.y*lv.y + lv.z*lv.z);
        const angSpd = Math.sqrt(av.x*av.x + av.y*av.y + av.z*av.z);
        return linSpd < 0.4 && angSpd < 0.4;
      });

      if (allSlow && elapsed > 800) {
        // Die has genuinely stopped — wait a beat then show result
        if (!settleTimer) {
          settleTimer = setTimeout(finishRoll, SETTLE_MS);
        }
      } else {
        // Still moving — cancel any pending settle and keep checking
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        // Force-settle after max time regardless
        if (elapsed < MAX_ROLL_MS) {
          requestAnimationFrame(checkSettled);
        } else {
          // Hard brake then finish
          bodies.forEach(b => { b.velocity.set(0,0,0); b.angularVelocity.set(0,0,0); });
          setTimeout(finishRoll, SETTLE_MS);
        }
      }
    }

    function finishRoll() {
      stopLoop();
      rolling = false;
      rollBtn.classList.remove('rolling');

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
    }

    requestAnimationFrame(checkSettled);
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