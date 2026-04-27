/**
 * dice-roller.js  —  3D physics dice with Three.js + Cannon.js
 *
 * Key design: visual mesh (pretty) and physics body (simple primitive) are SEPARATE.
 * Cannon.js ConvexPolyhedron is unreliable for custom shapes — we use only
 * Box, Sphere, and Cylinder for physics, which are rock-solid.
 * The visual mesh just copies the physics body's position/quaternion each frame.
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════════════ */
  const SIZE        = 280;
  const FLOOR_Y     = -1.8;
  const WALL        = 4.0;
  const MAX_ROLL_MS = 5000;
  const MIN_ROLL_MS = 1200;   // die must roll for at least this long
  const SETTLE_MS   = 500;    // pause after settling before showing number
  const SUBSTEPS    = 8;

  /*
   * For each die type:
   *   visGeo  — Three.js geometry (beautiful)
   *   physGeo — what Cannon.js actually simulates ('box'|'sphere'|'cylinder'|'convex')
   *   physArgs — args for the physics shape
   */
  const DIE_DEFS = {
    // phys: box settles cleanly on a face; sphere never stops on a plane
    '2':        { visGeo: 'cylinder32', phys: 'cylinder', physArgs: [0.9, 0.9, 0.35, 32] },
    '3':        { visGeo: 'tetra',      phys: 'box',      physArgs: [0.72, 0.72, 0.72]  },
    '4':        { visGeo: 'tetra',      phys: 'box',      physArgs: [0.72, 0.72, 0.72]  },
    '5':        { visGeo: 'cylinder5',  phys: 'cylinder', physArgs: [0.9, 0.9, 0.55, 5] },
    '6':        { visGeo: 'box',        phys: 'box',      physArgs: [0.85, 0.85, 0.85]  },
    '7':        { visGeo: 'cylinder7',  phys: 'cylinder', physArgs: [0.9, 0.9, 0.55, 7] },
    '8':        { visGeo: 'octa',       phys: 'box',      physArgs: [0.78, 0.78, 0.78]  },
    '10':       { visGeo: 'd10',        phys: 'cylinder', physArgs: [0.85, 0.3, 1.15, 5]},
    '12':       { visGeo: 'dodeca',     phys: 'box',      physArgs: [0.82, 0.82, 0.82]  },
    '14':       { visGeo: 'octa',       phys: 'box',      physArgs: [0.78, 0.78, 0.78]  },
    '16':       { visGeo: 'icosa',      phys: 'box',      physArgs: [0.82, 0.82, 0.82]  },
    '20':       { visGeo: 'icosa',      phys: 'box',      physArgs: [0.82, 0.82, 0.82]  },
    '100':      { visGeo: 'sphere',     phys: 'box',      physArgs: [0.82, 0.82, 0.82]  },
    'hopefear': { visGeo: 'box',        phys: 'box',      physArgs: [0.85, 0.85, 0.85]  },
  };

  /* ═══════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════ */
  let selectedDie = null;
  let rolling     = false;
  let rafId       = null;
  let lastTime    = null;
  let scene, camera, renderer, world, groundMat, dieMat;
  let meshA, bodyA, meshB, bodyB;
  let spriteA = null, spriteB = null;

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
    dieWrap.querySelectorAll('*').forEach(el => el.style.display = 'none');
    dieWrap.style.cssText = 'width:' + SIZE + 'px;height:' + SIZE + 'px;display:flex;align-items:center;justify-content:center;';
    const cv = document.createElement('canvas');
    cv.id = 'diceCanvas';
    cv.width = SIZE; cv.height = SIZE;
    cv.style.cssText = 'width:' + SIZE + 'px;height:' + SIZE + 'px;border-radius:14px;display:block;';
    dieWrap.appendChild(cv);
  }

  /* ═══════════════════════════════════════════════════
     THREE.JS
  ═══════════════════════════════════════════════════ */
  function setupThree() {
    const THREE = window.THREE;
    const cv = document.getElementById('diceCanvas');
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();

    // Camera angled down like looking at a real dice tray
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 7.5, 5.5);
    camera.lookAt(0, FLOOR_Y + 0.5, 0);

    // Rich lighting so ivory dice pop
    scene.add(new THREE.AmbientLight(0xfff8f0, 0.6));

    const key = new THREE.DirectionalLight(0xfff5e0, 1.8);
    key.position.set(3, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far  = 30;
    key.shadow.camera.left = key.shadow.camera.bottom = -8;
    key.shadow.camera.right = key.shadow.camera.top   =  8;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xc0d8ff, 0.5);
    fill.position.set(-4, 5, -3);
    scene.add(fill);

    const back = new THREE.DirectionalLight(0xffe0c0, 0.3);
    back.position.set(0, 3, -6);
    scene.add(back);

    // Visible felt-green table surface
    const tableGeo = new THREE.PlaneGeometry(WALL * 2.2, WALL * 2.2);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x1a3a1a, roughness: 0.95, metalness: 0.0,
    });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.rotation.x = -Math.PI / 2;
    table.position.y = FLOOR_Y;
    table.receiveShadow = true;
    scene.add(table);
  }

  /* ═══════════════════════════════════════════════════
     CANNON.JS
  ═══════════════════════════════════════════════════ */
  function setupCannon() {
    const CANNON = window.CANNON;
    world = new CANNON.World();
    world.gravity.set(0, -45, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 30;
    world.allowSleep = true;

    groundMat = new CANNON.Material('ground');
    dieMat    = new CANNON.Material('die');

    world.addContactMaterial(new CANNON.ContactMaterial(groundMat, dieMat, {
      friction:    0.8,    // high friction = tumbling, not sliding
      restitution: 0.05,   // near-zero = energy dies on first bounce
    }));
    world.addContactMaterial(new CANNON.ContactMaterial(dieMat, dieMat, {
      friction:    0.6,
      restitution: 0.02,
    }));

    // Floor
    const floor = new CANNON.Body({ mass: 0, material: groundMat });
    floor.addShape(new CANNON.Plane());
    floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
    floor.position.y = FLOOR_Y;
    world.addBody(floor);

    // Four walls + ceiling
    const wallDefs = [
      { pos: [ WALL, 0, 0], ax:[0,0,1], ang:  Math.PI/2 },
      { pos: [-WALL, 0, 0], ax:[0,0,1], ang: -Math.PI/2 },
      { pos: [0, 0,  WALL], ax:[1,0,0], ang: -Math.PI/2 },
      { pos: [0, 0, -WALL], ax:[1,0,0], ang:  Math.PI/2 },
      { pos: [0, 8,  0],    ax:[1,0,0], ang:  Math.PI/2 },
    ];
    wallDefs.forEach(w => {
      const b = new CANNON.Body({ mass: 0, material: groundMat });
      b.addShape(new CANNON.Plane());
      b.position.set(...w.pos);
      b.quaternion.setFromAxisAngle(new CANNON.Vec3(...w.ax), w.ang);
      world.addBody(b);
    });
  }

  /* ═══════════════════════════════════════════════════
     VISUAL GEOMETRIES
  ═══════════════════════════════════════════════════ */
  function makeVisGeo(type) {
    const THREE = window.THREE;
    const R = 1.1;
    switch (type) {
      case 'box':        return new THREE.BoxGeometry(1.7, 1.7, 1.7);
      case 'tetra':      return new THREE.TetrahedronGeometry(R);
      case 'octa':       return new THREE.OctahedronGeometry(R);
      case 'dodeca':     return new THREE.DodecahedronGeometry(R);
      case 'icosa':      return new THREE.IcosahedronGeometry(R);
      case 'sphere':     return new THREE.SphereGeometry(R, 32, 32);
      case 'cylinder32': return new THREE.CylinderGeometry(R * 0.82, R * 0.82, 0.32, 32);
      case 'cylinder5':  return new THREE.CylinderGeometry(R * 0.82, R * 0.82, 0.55, 5);
      case 'cylinder7':  return new THREE.CylinderGeometry(R * 0.82, R * 0.82, 0.55, 7);
      case 'd10':        return makeD10VisGeo(R);
      default:           return new THREE.SphereGeometry(R, 16, 16);
    }
  }

  function makeD10VisGeo(R) {
    const THREE  = window.THREE;
    const n      = 5;
    const topY   =  R * 1.2;
    const botY   = -R * 1.2;
    const upY    =  R * 0.22;
    const loY    = -R * 0.22;
    const twist  = Math.PI / n;

    const V = [new THREE.Vector3(0, topY, 0)]; // 0 = top apex
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      V.push(new THREE.Vector3(R * Math.cos(a), upY, R * Math.sin(a)));
    }
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + twist;
      V.push(new THREE.Vector3(R * Math.cos(a), loY, R * Math.sin(a)));
    }
    V.push(new THREE.Vector3(0, botY, 0)); // 11 = bot apex

    // Build triangles ensuring outward normals via centroid test
    const tris = [];
    for (let i = 0; i < n; i++) {
      const u0 = 1+i, u1 = 1+(i+1)%n, l0 = 6+i, l1 = 6+(i+1)%n;
      tris.push([0,u0,l0],[0,l0,u1],[11,u1,l0],[11,l1,u1]);
    }

    const pos=[], nor=[], uv=[];
    tris.forEach(([ai,bi,ci]) => {
      const va=V[ai], vb=V[bi], vc=V[ci];
      pos.push(va.x,va.y,va.z, vb.x,vb.y,vb.z, vc.x,vc.y,vc.z);
      const ab=new THREE.Vector3().subVectors(vb,va);
      const ac=new THREE.Vector3().subVectors(vc,va);
      const n3=new THREE.Vector3().crossVectors(ab,ac).normalize();
      const cen=new THREE.Vector3().addVectors(va,vb).add(vc).multiplyScalar(1/3);
      if(n3.dot(cen)<0) n3.negate();
      for(let k=0;k<3;k++) nor.push(n3.x,n3.y,n3.z);
      uv.push(0,0,1,0,0.5,1);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,  2));
    return geo;
  }

  /* ═══════════════════════════════════════════════════
     PHYSICS SHAPES  — simple primitives only, no ConvexPolyhedron
  ═══════════════════════════════════════════════════ */
  function makePhysShape(type, args) {
    const CANNON = window.CANNON;
    switch (type) {
      case 'box':
        return new CANNON.Box(new CANNON.Vec3(...args));
      case 'sphere':
        return new CANNON.Sphere(args[0]);
      case 'cylinder':
        return new CANNON.Cylinder(args[0], args[1], args[2], args[3]);
      default:
        return new CANNON.Sphere(1.1);
    }
  }

  /* ═══════════════════════════════════════════════════
     VISUAL MATERIALS
  ═══════════════════════════════════════════════════ */
  function matDefault() {
    return new THREE.MeshStandardMaterial({
      color: 0xf2ece0, roughness: 0.3, metalness: 0.1,
      emissive: 0x1a1408, emissiveIntensity: 0.05,
    });
  }
  function matHope() {
    return new THREE.MeshStandardMaterial({
      color: 0xc8e8ff, roughness: 0.3, metalness: 0.15,
      emissive: 0x001828, emissiveIntensity: 0.08,
    });
  }
  function matFear() {
    return new THREE.MeshStandardMaterial({
      color: 0xffd8d0, roughness: 0.3, metalness: 0.15,
      emissive: 0x280008, emissiveIntensity: 0.08,
    });
  }

  /* ═══════════════════════════════════════════════════
     SPAWN ONE DIE
     Returns { mesh, body }
  ═══════════════════════════════════════════════════ */
  function spawnDie(dieKey, visMat, offsetX, isRoll) {
    const THREE  = window.THREE;
    const CANNON = window.CANNON;
    const def    = DIE_DEFS[dieKey] || DIE_DEFS['6'];

    // Visual mesh
    const geo  = makeVisGeo(def.visGeo);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, visMat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Physics body — always a simple primitive
    const shape = makePhysShape(def.phys, def.physArgs);
    const body  = new CANNON.Body({
      mass:            1,
      material:        dieMat,
      linearDamping:   0.6,   // absorbs energy between bounces fast
      angularDamping:  0.6,   // spin dies out quickly after landing
      sleepTimeLimit:  0.3,   // sleep after 0.3s of low motion
      sleepSpeedLimit: 0.15,  // aggressive sleep threshold
    });
    body.allowSleep = true;
    body.addShape(shape);

    if (isRoll) {
      // Throw: spawn above tray with strong horizontal+spin
      const angle = Math.random() * Math.PI * 2;
      const speed = 7 + Math.random() * 5;
      body.position.set(
        offsetX + (Math.random() - 0.5) * 1.2,
        4.5 + Math.random() * 2,
        (Math.random() - 0.5) * 1.2
      );
      body.velocity.set(
        Math.cos(angle) * speed,
        -(2 + Math.random() * 2),
        Math.sin(angle) * speed
      );
      body.angularVelocity.set(
        (Math.random() - 0.5) * 50,
        (Math.random() - 0.5) * 50,
        (Math.random() - 0.5) * 50
      );
    } else {
      // Preview: gentle drop
      body.position.set(
        offsetX + (Math.random() - 0.5) * 0.4,
        3.5 + Math.random(),
        (Math.random() - 0.5) * 0.4
      );
      body.velocity.set(
        (Math.random() - 0.5) * 1.5,
        -1,
        (Math.random() - 0.5) * 1.5
      );
      body.angularVelocity.set(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6
      );
    }

    world.addBody(body);
    return { mesh, body };
  }

  /* ═══════════════════════════════════════════════════
     CLEAR
  ═══════════════════════════════════════════════════ */
  function clearDice() {
    removeSprites();
    [meshA, meshB].forEach(m => {
      if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    });
    [bodyA, bodyB].forEach(b => { if (b) world.remove(b); });
    meshA = meshB = bodyA = bodyB = null;
  }

  /* ═══════════════════════════════════════════════════
     RENDER LOOP
  ═══════════════════════════════════════════════════ */
  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    lastTime = null;
    function tick(now) {
      rafId = requestAnimationFrame(tick);
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 1/20) : 1/60;
      lastTime = now;
      world.step(1/60, dt, SUBSTEPS);
      if (meshA && bodyA) { meshA.position.copy(bodyA.position); meshA.quaternion.copy(bodyA.quaternion); }
      if (meshB && bodyB) { meshB.position.copy(bodyB.position); meshB.quaternion.copy(bodyB.quaternion); }
      renderer.render(scene, camera);
    }
    requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (renderer) renderer.render(scene, camera);
  }

  /* ═══════════════════════════════════════════════════
     NUMBER LABEL SPRITE
  ═══════════════════════════════════════════════════ */
  function makeSprite(text, color) {
    const THREE = window.THREE;
    const cv    = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(8,6,18,0.82)';
    ctx.beginPath();
    ctx.roundRect(20, 70, 216, 116, 22);
    ctx.fill();
    ctx.fillStyle   = color || '#f2ece0';
    ctx.font        = 'bold 100px "Fira Sans", Arial, sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(2.8, 2.8, 1);
    return spr;
  }

  function removeSprites() {
    [spriteA, spriteB].forEach(s => { if (s) scene.remove(s); });
    spriteA = spriteB = null;
  }

  function showSprite(mesh, text, color) {
    const spr = makeSprite(text, color);
    spr.position.set(mesh.position.x, mesh.position.y + 2.6, mesh.position.z);
    scene.add(spr);
    return spr;
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
    stopLoop();
    if (die === 'hopefear') {
      const h = spawnDie('hopefear', matHope(), -1.1, false);
      const f = spawnDie('hopefear', matFear(),  1.1, false);
      meshA = h.mesh; bodyA = h.body;
      meshB = f.mesh; bodyB = f.body;
    } else {
      const d = spawnDie(die, matDefault(), 0, false);
      meshA = d.mesh; bodyA = d.body;
    }
    startLoop();
    setTimeout(stopLoop, 2000);
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
    if (!selectedDie || rolling) return;
    rolling = true;
    rollBtn.classList.add('rolling');
    setResult('', '');
    removeSprites();
    playRollSound();

    const result = computeRoll(selectedDie);

    clearDice();
    stopLoop();

    if (selectedDie === 'hopefear') {
      const h = spawnDie('hopefear', matHope(), -1.2, true);
      const f = spawnDie('hopefear', matFear(),  1.2, true);
      meshA = h.mesh; bodyA = h.body;
      meshB = f.mesh; bodyB = f.body;
    } else {
      const d = spawnDie(selectedDie, matDefault(), 0, true);
      meshA = d.mesh; bodyA = d.body;
    }

    startLoop();

    const rollStart  = performance.now();
    let settleTimer  = null;
    let checkStopped;

    checkStopped = function () {
      if (!rolling) return;
      const elapsed = performance.now() - rollStart;
      const bodies  = [bodyA, bodyB].filter(Boolean);

      const allSettled = bodies.every(b => {
        // Consider sleeping bodies settled too
        if (b.sleepState === 2) return true; // CANNON.Body.SLEEPING = 2
        const lv = b.velocity, av = b.angularVelocity;
        const linSpd = Math.sqrt(lv.x*lv.x + lv.y*lv.y + lv.z*lv.z);
        const angSpd = Math.sqrt(av.x*av.x + av.y*av.y + av.z*av.z);
        return linSpd < 0.15 && angSpd < 0.15;
      });

      if (elapsed > MAX_ROLL_MS) {
        // Force stop
        bodies.forEach(b => { b.velocity.set(0,0,0); b.angularVelocity.set(0,0,0); });
        if (settleTimer) clearTimeout(settleTimer);
        setTimeout(finishRoll, SETTLE_MS);
        return;
      }

      if (allSettled && elapsed > MIN_ROLL_MS) {
        if (!settleTimer) settleTimer = setTimeout(finishRoll, SETTLE_MS);
      } else {
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        requestAnimationFrame(checkStopped);
      }
    };

    requestAnimationFrame(checkStopped);

    function finishRoll() {
      stopLoop();
      rolling = false;
      rollBtn.classList.remove('rolling');

      if (selectedDie === 'hopefear') {
        spriteA = showSprite(meshA, String(result.hope), '#6bbde8');
        spriteB = showSprite(meshB, String(result.fear), '#e07070');
      } else {
        const col = result.modifier === 'crit' ? '#ffe066'
                  : result.modifier === 'fumble' ? '#e07070'
                  : '#f2ece0';
        spriteA = showSprite(meshA, String(result.value), col);
      }
      renderer.render(scene, camera);
      setResult(result.label, result.modifier);
      addHistory(result.label, result.modifier);
      setTimeout(() => speakResult(result), 200);
    }
  }

  /* ═══════════════════════════════════════════════════
     COMPUTE / DISPLAY / SPEAK
  ═══════════════════════════════════════════════════ */
  function computeRoll(die) {
    if (die === 'hopefear') {
      const hope = rand(1,12), fear = rand(1,12);
      const outcome = hope >= fear ? 'hope' : 'fear';
      return { type:'hopefear', hope, fear, total: hope+fear, outcome,
               label: (hope+fear) + ' with ' + outcome, modifier: outcome };
    }
    const sides = parseInt(die, 10);
    const value = rand(1, sides);
    const mod   = die==='20' && value===20 ? 'crit'
                : die==='20' && value===1  ? 'fumble' : '';
    return { type:'normal', sides, value, label:'D'+sides+': '+value, modifier: mod };
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
    if (!audioCache[src]) { const a = new Audio(src); a.preload='auto'; audioCache[src]=a; }
    return audioCache[src];
  }
  function playRollSound() {
    try {
      const a = getAudio('/assets/dice-roll.mp3');
      a.currentTime = 0;
      const p = a.play();
      if (p) p.then(() => setTimeout(() => { a.pause(); a.currentTime=0; }, 1200)).catch(()=>{});
    } catch(_) {}
  }
  function playNumberSound(n) {
    try {
      const a = getAudio('/assets/number-'+n+'.mp3');
      a.currentTime = 0; a.play().catch(()=>{});
    } catch(_) {}
  }

  /* ═══════════════════════════════════════════════════
     STREAMER MODE
  ═══════════════════════════════════════════════════ */
  const streamerBtn  = document.getElementById('streamerToggle');
  const STREAMER_KEY = 'diceroller-streamer';

  function setStreamerMode(on) {
    document.body.classList.toggle('streamer-mode', on);
    streamerBtn.classList.toggle('active', on);
    streamerBtn.querySelector('.streamer-label').textContent = on ? 'Exit' : 'Streamer';
    try { localStorage.setItem(STREAMER_KEY, on ? '1' : ''); } catch(_) {}
  }

  streamerBtn.addEventListener('click', () => {
    setStreamerMode(!document.body.classList.contains('streamer-mode'));
  });

  try { if (localStorage.getItem(STREAMER_KEY)) setStreamerMode(true); } catch(_) {}

  boot();

})();