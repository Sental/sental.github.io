/**
 * dice-roller.js
 * Three.js visuals + scripted roll animation. No physics engine.
 * The die follows a hand-crafted arc: thrown across the table, bounces
 * with decreasing height, spins fast then decelerates, lands naturally.
 */

(function () {
  'use strict';

  /* ─── geometry definitions ───────────────────────── */
  const DIE_DEFS = {
    '2':        'cylinder32',
    '3':        'tetra',
    '4':        'tetra',
    '5':        'cylinder5',
    '6':        'box',
    '7':        'cylinder7',
    '8':        'octa',
    '10':       'd10',
    '12':       'dodeca',
    '14':       'octa',
    '16':       'icosa',
    '20':       'icosa',
    '100':      'sphere',
    'hopefear': 'box',
  };

  const SIZE    = 280;
  const FLOOR_Y = -1.5;   // y position of the table surface in 3D space

  /* ─── state ──────────────────────────────────────── */
  let selectedDie = null;
  let rolling     = false;
  let rafId       = null;
  let scene, camera, renderer;
  let meshA, meshB;
  let spriteA = null, spriteB = null;

  /* ─── DOM ────────────────────────────────────────── */
  const rollBtn    = document.getElementById('rollBtn');
  const rollResult = document.getElementById('rollResult');
  const historyLog = document.getElementById('historyLog');
  const clearBtn   = document.getElementById('clearBtn');
  const dieWrap    = document.getElementById('dieWrap');

  /* ─── boot ───────────────────────────────────────── */
  function boot() {
    if (!window.THREE) { setTimeout(boot, 50); return; }
    setupCanvas();
    setupThree();
    renderer.render(scene, camera);
  }

  function setupCanvas() {
    dieWrap.querySelectorAll('*').forEach(el => el.style.display = 'none');
    dieWrap.style.cssText = `width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center;`;
    const cv = document.createElement('canvas');
    cv.id = 'diceCanvas';
    cv.width = SIZE; cv.height = SIZE;
    cv.style.cssText = `width:${SIZE}px;height:${SIZE}px;border-radius:14px;display:block;`;
    dieWrap.appendChild(cv);
  }

  /* ─── three.js scene ─────────────────────────────── */
  function setupThree() {
    const THREE = window.THREE;
    const cv = document.getElementById('diceCanvas');

    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 6, 5.5);
    camera.lookAt(0, FLOOR_Y + 0.5, 0);

    scene.add(new THREE.AmbientLight(0xfff8f0, 0.7));

    const key = new THREE.DirectionalLight(0xfff5e0, 1.8);
    key.position.set(4, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xc0d8ff, 0.4);
    fill.position.set(-4, 5, -3);
    scene.add(fill);

    // Table surface
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshStandardMaterial({ color: 0x1a3320, roughness: 0.95, metalness: 0 })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = FLOOR_Y;
    table.receiveShadow = true;
    scene.add(table);
  }

  /* ─── geometries ─────────────────────────────────── */
  function makeGeo(type) {
    const THREE = window.THREE;
    const R = 1.05;
    switch (type) {
      case 'box':        return new THREE.BoxGeometry(1.65, 1.65, 1.65);
      case 'tetra':      return new THREE.TetrahedronGeometry(R);
      case 'octa':       return new THREE.OctahedronGeometry(R);
      case 'dodeca':     return new THREE.DodecahedronGeometry(R);
      case 'icosa':      return new THREE.IcosahedronGeometry(R);
      case 'sphere':     return new THREE.SphereGeometry(R, 32, 32);
      case 'cylinder32': return new THREE.CylinderGeometry(R*0.85, R*0.85, 0.38, 32);
      case 'cylinder5':  return new THREE.CylinderGeometry(R*0.85, R*0.85, 0.6,  5);
      case 'cylinder7':  return new THREE.CylinderGeometry(R*0.85, R*0.85, 0.6,  7);
      case 'd10':        return makeD10Geo(R);
      default:           return new THREE.SphereGeometry(R, 16, 16);
    }
  }

  function makeD10Geo(R) {
    const THREE = window.THREE;
    const n = 5, twist = Math.PI / n;
    const topY = R*1.2, botY = -R*1.2, upY = R*0.22, loY = -R*0.22;
    const V = [new THREE.Vector3(0, topY, 0)];
    for (let i = 0; i < n; i++) {
      const a = 2*Math.PI*i/n;
      V.push(new THREE.Vector3(R*Math.cos(a), upY, R*Math.sin(a)));
    }
    for (let i = 0; i < n; i++) {
      const a = 2*Math.PI*i/n + twist;
      V.push(new THREE.Vector3(R*Math.cos(a), loY, R*Math.sin(a)));
    }
    V.push(new THREE.Vector3(0, botY, 0));
    const tris = [];
    for (let i = 0; i < n; i++) {
      const u0=1+i, u1=1+(i+1)%n, l0=6+i, l1=6+(i+1)%n;
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
      if (n3.dot(cen) < 0) n3.negate();
      for (let k=0; k<3; k++) nor.push(n3.x,n3.y,n3.z);
      uv.push(0,0,1,0,0.5,1);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,  2));
    return geo;
  }

  /* ─── materials ──────────────────────────────────── */
  function matDefault() {
    return new THREE.MeshStandardMaterial({ color:0xf2ece0, roughness:0.3, metalness:0.12 });
  }
  function matHope() {
    return new THREE.MeshStandardMaterial({ color:0xc8e8ff, roughness:0.3, metalness:0.15 });
  }
  function matFear() {
    return new THREE.MeshStandardMaterial({ color:0xffd8d0, roughness:0.3, metalness:0.15 });
  }

  /* ─── spawn a static mesh ────────────────────────── */
  function spawnMesh(geoType, mat) {
    const THREE = window.THREE;
    const geo   = makeGeo(geoType);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  /* ─── clear dice ─────────────────────────────────── */
  function clearDice() {
    removeSprites();
    [meshA, meshB].forEach(m => {
      if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    });
    meshA = meshB = null;
  }

  /* ─── render loop ────────────────────────────────── */
  function startLoop(onFrame) {
    if (rafId) cancelAnimationFrame(rafId);
    function tick(now) {
      rafId = requestAnimationFrame(tick);
      onFrame(now);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    renderer.render(scene, camera);
  }

  /* ─── number sprite ──────────────────────────────── */
  function makeSprite(text, color) {
    const THREE = window.THREE;
    const cv    = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx   = cv.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(8,6,18,0.85)';
    ctx.beginPath();
    ctx.roundRect(18, 68, 220, 120, 24);
    ctx.fill();
    ctx.fillStyle    = color || '#f2ece0';
    ctx.font         = 'bold 100px "Fira Sans", Arial, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    );
    spr.scale.set(3, 3, 1);
    return spr;
  }

  function removeSprites() {
    [spriteA, spriteB].forEach(s => { if (s) scene.remove(s); });
    spriteA = spriteB = null;
  }

  function showSprite(mesh, text, color) {
    const spr = makeSprite(text, color);
    spr.position.set(mesh.position.x, mesh.position.y + 2.8, mesh.position.z);
    scene.add(spr);
    return spr;
  }

  /* ─── scripted roll animation ────────────────────── */
  /*
   * The die follows a hand-crafted path:
   *
   *  Phase 1 — throw arc  (0% → 40% of duration)
   *    Die travels from offscreen edge, arcing down to first floor contact.
   *    Spins fast.
   *
   *  Phase 2 — bounces    (40% → 80%)
   *    Three progressively smaller bounces simulated with a custom
   *    bounce-ease on the Y axis. Spin decelerates.
   *
   *  Phase 3 — settle     (80% → 100%)
   *    Die slides to a gentle stop, spin almost zero, lands flat.
   */

  const ROLL_DURATION = 2400; // ms total

  function animateRoll(meshes, duration, onDone) {
    const startTime = performance.now();

    // Each die gets its own random roll parameters
    const params = meshes.map((mesh, idx) => {
      const sign  = idx === 0 ? 1 : -1;
      // Start position: off to one side, above table
      const startX = sign * (2.5 + Math.random() * 0.5);
      const startZ = (Math.random() - 0.5) * 1.5;
      const endX   = (Math.random() - 0.5) * 1.2 + (meshes.length > 1 ? -sign * 0.8 : 0);
      const endZ   = (Math.random() - 0.5) * 1.2;

      // Random spin axes
      const spinX = (Math.random() - 0.5) * 2;
      const spinY = (Math.random() - 0.5) * 2;
      const spinZ = (Math.random() - 0.5) * 2;
      const spinLen = Math.sqrt(spinX*spinX + spinY*spinY + spinZ*spinZ);

      return {
        startX, startZ, endX, endZ,
        spinAxis: { x: spinX/spinLen, y: spinY/spinLen, z: spinZ/spinLen },
        totalRotations: 4 + Math.random() * 3,  // how many full tumbles
        startY: FLOOR_Y + 2.8,                  // thrown from above
      };
    });

    startLoop(function (now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1); // 0 → 1

      meshes.forEach((mesh, idx) => {
        const p = params[idx];

        // ── X/Z position: smooth lerp from start to end ──
        // Use ease-out so it decelerates as it settles
        const tXZ   = easeOut(t);
        mesh.position.x = lerp(p.startX, p.endX, tXZ);
        mesh.position.z = lerp(p.startZ, p.endZ, tXZ);

        // ── Y position: throw arc + bounces ──
        mesh.position.y = FLOOR_Y + bounceY(t, p.startY - FLOOR_Y);

        // ── Rotation: fast at start, decelerates to near-stop ──
        // Total angle = totalRotations * 2PI, driven by eased t
        const rotT    = easeOutCubic(t);
        const angle   = rotT * p.totalRotations * Math.PI * 2;
        const THREE   = window.THREE;
        const axis    = new THREE.Vector3(p.spinAxis.x, p.spinAxis.y, p.spinAxis.z);
        mesh.quaternion.setFromAxisAngle(axis, angle);
      });

      if (t >= 1) {
        stopLoop();
        onDone();
      }
    });
  }

  /* ─── easing helpers ─────────────────────────────── */
  function lerp(a, b, t) { return a + (b - a) * t; }

  function easeOut(t) { return 1 - Math.pow(1 - t, 2); }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  /*
   * bounceY: returns height above floor for time t ∈ [0,1]
   * Simulates throw arc + 3 diminishing bounces
   * h0 = initial height above floor
   */
  function bounceY(t, h0) {
    // Segments: [0, 0.35] arc down, [0.35, 0.55] bounce1, [0.55, 0.72] bounce2,
    //           [0.72, 0.84] bounce3, [0.84, 1.0] final rest
    if (t < 0.35) {
      // Arc: parabola from h0 down to 0
      const s = t / 0.35;
      return h0 * (1 - s * s);
    }
    if (t < 0.55) {
      // Bounce 1: up to h0*0.28, back down
      const s = (t - 0.35) / 0.20;
      return h0 * 0.28 * 4 * s * (1 - s);
    }
    if (t < 0.72) {
      // Bounce 2: up to h0*0.10
      const s = (t - 0.55) / 0.17;
      return h0 * 0.10 * 4 * s * (1 - s);
    }
    if (t < 0.84) {
      // Bounce 3: tiny — h0*0.035
      const s = (t - 0.72) / 0.12;
      return h0 * 0.035 * 4 * s * (1 - s);
    }
    // Settled on floor
    return 0;
  }

  /* ─── die selection ──────────────────────────────── */
  document.querySelectorAll('.die-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (rolling) return;
      selectedDie = btn.dataset.sides;
      document.querySelectorAll('.die-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rollBtn.disabled = false;
      rollBtn.querySelector('.roll-btn-label').textContent = 'Roll ' + btn.dataset.label;
      setResult('', '');
      previewDie(selectedDie);
    });
  });

  function previewDie(die) {
    clearDice();
    stopLoop();
    if (die === 'hopefear') {
      meshA = spawnMesh(DIE_DEFS['6'], matHope());
      meshB = spawnMesh(DIE_DEFS['6'], matFear());
      meshA.position.set(-1.0, FLOOR_Y + 0.85, 0);
      meshB.position.set( 1.0, FLOOR_Y + 0.85, 0);
    } else {
      meshA = spawnMesh(DIE_DEFS[die] || 'box', matDefault());
      meshA.position.set(0, FLOOR_Y + 0.85, 0);
    }
    // Slow idle rotation for preview
    const startTime = performance.now();
    startLoop(function (now) {
      const t = (now - startTime) / 1000;
      if (meshA) meshA.rotation.y = t * 0.6;
      if (meshB) meshB.rotation.y = t * 0.6;
    });
  }

  /* ─── roll ───────────────────────────────────────── */
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

    let meshes;
    if (selectedDie === 'hopefear') {
      meshA  = spawnMesh(DIE_DEFS['6'], matHope());
      meshB  = spawnMesh(DIE_DEFS['6'], matFear());
      meshes = [meshA, meshB];
    } else {
      meshA  = spawnMesh(DIE_DEFS[selectedDie] || 'box', matDefault());
      meshes = [meshA];
    }

    animateRoll(meshes, ROLL_DURATION, () => {
      rolling = false;
      rollBtn.classList.remove('rolling');

      if (selectedDie === 'hopefear') {
        spriteA = showSprite(meshA, String(result.hope), '#6bbde8');
        spriteB = showSprite(meshB, String(result.fear), '#e07070');
      } else {
        const col = result.modifier === 'crit'   ? '#ffe066'
                  : result.modifier === 'fumble' ? '#e07070'
                  : '#f2ece0';
        spriteA = showSprite(meshA, String(result.value), col);
      }

      // Idle rotation restarts after showing number
      const doneTime = performance.now();
      startLoop(function (now) {
        const t = (now - doneTime) / 1000;
        if (meshA) {
          meshA.position.y = FLOOR_Y + 0.85;
          meshA.rotation.y += 0.005;
        }
        if (meshB) {
          meshB.position.y = FLOOR_Y + 0.85;
          meshB.rotation.y += 0.005;
        }
        if (spriteA) spriteA.position.y = (meshA ? meshA.position.y : 0) + 2.8;
        if (spriteB) spriteB.position.y = (meshB ? meshB.position.y : 0) + 2.8;
      });

      setResult(result.label, result.modifier);
      addHistory(result.label, result.modifier);
      setTimeout(() => speakResult(result), 200);
    });
  }

  /* ─── compute / speak / display ──────────────────── */
  function computeRoll(die) {
    if (die === 'hopefear') {
      const hope = rand(1,12), fear = rand(1,12);
      const outcome = hope >= fear ? 'hope' : 'fear';
      return { type:'hopefear', hope, fear, total:hope+fear, outcome,
               label:(hope+fear)+' with '+outcome, modifier:outcome };
    }
    const sides = parseInt(die, 10);
    const value = rand(1, sides);
    const mod   = die==='20' && value===20 ? 'crit'
                : die==='20' && value===1  ? 'fumble' : '';
    return { type:'normal', sides, value, label:'D'+sides+': '+value, modifier:mod };
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

  /* ─── history ────────────────────────────────────── */
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

  /* ─── audio ──────────────────────────────────────── */
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
      if (p) p.then(() => setTimeout(() => { a.pause(); a.currentTime=0; }, 1500)).catch(()=>{});
    } catch(_) {}
  }
  function playNumberSound(n) {
    try {
      const a = getAudio('/assets/number-'+n+'.mp3');
      a.currentTime = 0; a.play().catch(()=>{});
    } catch(_) {}
  }

  /* ─── streamer mode ──────────────────────────────── */
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