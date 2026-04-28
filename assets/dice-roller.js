/**
 * dice-roller.js
 * Three.js visuals + scripted roll animation.
 * Rich per-die materials, coin-flip for D2, nicer table stage.
 */

(function () {
  'use strict';

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

  const SIZE         = 280;
  const FLOOR_Y      = -1.5;
  const ROLL_DURATION = 2400;

  let selectedDie = null;
  let rolling     = false;
  let rafId       = null;
  let scene, camera, renderer;
  let meshA, meshB;
  let spriteA = null, spriteB = null;

  const rollBtn    = document.getElementById('rollBtn');
  const rollResult = document.getElementById('rollResult');
  const historyLog = document.getElementById('historyLog');
  const clearBtn   = document.getElementById('clearBtn');
  const dieWrap    = document.getElementById('dieWrap');

  /* ══════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════ */
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
    cv.style.cssText = `width:${SIZE}px;height:${SIZE}px;border-radius:16px;display:block;`;
    dieWrap.appendChild(cv);
  }

  /* ══════════════════════════════════════════════════
     SCENE
  ══════════════════════════════════════════════════ */
  function setupThree() {
    const THREE = window.THREE;
    const cv = document.getElementById('diceCanvas');

    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x0a0a12, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    scene  = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a12, 12, 22);

    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 5.8, 5.2);
    camera.lookAt(0, FLOOR_Y + 0.8, 0);

    // ── Lighting ──
    scene.add(new THREE.AmbientLight(0x8899bb, 0.5));

    const key = new THREE.DirectionalLight(0xfff8ee, 2.2);
    key.position.set(3, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far  = 20;
    key.shadow.camera.left = key.shadow.camera.bottom = -6;
    key.shadow.camera.right = key.shadow.camera.top   =  6;
    key.shadow.bias = -0.001;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x4466ff, 0.6);
    rim.position.set(-5, 4, -4);
    scene.add(rim);

    const warm = new THREE.DirectionalLight(0xff9944, 0.3);
    warm.position.set(5, 2, -3);
    scene.add(warm);

    // Soft point light under camera — gives dice a nice face glow
    const camLight = new THREE.PointLight(0xffeedd, 0.8, 12);
    camLight.position.set(0, 4, 4);
    scene.add(camLight);

    // ── Table surface ──
    // Layered: dark wood border ring + green felt centre
    const feltGeo = new THREE.CircleGeometry(4.2, 64);
    const feltMat = new THREE.MeshStandardMaterial({
      color: 0x1c4a28, roughness: 0.92, metalness: 0.0,
    });
    const felt = new THREE.Mesh(feltGeo, feltMat);
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = FLOOR_Y;
    felt.receiveShadow = true;
    scene.add(felt);

    // Wood border ring
    const ringGeo = new THREE.RingGeometry(4.0, 5.5, 64);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x3d1f0a, roughness: 0.75, metalness: 0.05,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = FLOOR_Y - 0.01;
    ring.receiveShadow = true;
    scene.add(ring);

    // Subtle inner shadow on felt edge — dark gradient disc
    const vigGeo = new THREE.RingGeometry(2.8, 4.2, 64);
    const vigMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.35, side: THREE.FrontSide,
    });
    const vig = new THREE.Mesh(vigGeo, vigMat);
    vig.rotation.x = -Math.PI / 2;
    vig.position.y = FLOOR_Y + 0.001;
    scene.add(vig);

    // Thin brass rail on the inner edge of the wood border
    const railGeo = new THREE.TorusGeometry(4.05, 0.07, 8, 64);
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xc8922a, roughness: 0.3, metalness: 0.9,
    });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.rotation.x = -Math.PI / 2;
    rail.position.y = FLOOR_Y + 0.04;
    scene.add(rail);
  }

  /* ══════════════════════════════════════════════════
     GEOMETRIES
  ══════════════════════════════════════════════════ */
  function makeGeo(type) {
    const THREE = window.THREE;
    const R = 1.05;
    switch (type) {
      case 'box':        return new THREE.BoxGeometry(1.65, 1.65, 1.65);
      case 'tetra':      return new THREE.TetrahedronGeometry(R);
      case 'octa':       return new THREE.OctahedronGeometry(R);
      case 'dodeca':     return new THREE.DodecahedronGeometry(R);
      case 'icosa':      return new THREE.IcosahedronGeometry(R);
      case 'sphere':     return new THREE.SphereGeometry(R, 48, 48);
      case 'cylinder32': return new THREE.CylinderGeometry(R*0.88, R*0.88, 0.22, 64);
      case 'cylinder5':  return new THREE.CylinderGeometry(R*0.85, R*0.85, 0.6, 5);
      case 'cylinder7':  return new THREE.CylinderGeometry(R*0.85, R*0.85, 0.6, 7);
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
      const va=V[ai],vb=V[bi],vc=V[ci];
      pos.push(va.x,va.y,va.z, vb.x,vb.y,vb.z, vc.x,vc.y,vc.z);
      const ab=new THREE.Vector3().subVectors(vb,va);
      const ac=new THREE.Vector3().subVectors(vc,va);
      const n3=new THREE.Vector3().crossVectors(ab,ac).normalize();
      const cen=new THREE.Vector3().addVectors(va,vb).add(vc).multiplyScalar(1/3);
      if (n3.dot(cen) < 0) n3.negate();
      for (let k=0;k<3;k++) nor.push(n3.x,n3.y,n3.z);
      uv.push(0,0,1,0,0.5,1);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,  2));
    return geo;
  }

  /* ══════════════════════════════════════════════════
     MATERIALS — each die family has its own look
  ══════════════════════════════════════════════════ */
  function makeMat(die) {
    const THREE = window.THREE;
    const M = (c, r, m, e, ei) => new THREE.MeshStandardMaterial({
      color: c, roughness: r, metalness: m,
      emissive: e || 0x000000, emissiveIntensity: ei || 0,
    });

    switch (die) {
      case '2':   // coin — bright gold
        return M(0xd4a427, 0.15, 0.95, 0x7a5500, 0.1);
      case '3':   // d3 tetra — deep red bone
        return M(0xb03030, 0.45, 0.05, 0x300000, 0.08);
      case '4':   // d4 — forest green with slight sheen
        return M(0x2d6a3f, 0.38, 0.15, 0x001a08, 0.06);
      case '5':   // d5 — purple
        return M(0x6a3a9a, 0.35, 0.2,  0x1a0030, 0.08);
      case '6':   // d6 — classic cream ivory
        return M(0xf0e8d0, 0.25, 0.08, 0x1a1408, 0.04);
      case '7':   // d7 — teal
        return M(0x1a7a6e, 0.4,  0.18, 0x001a18, 0.06);
      case '8':   // d8 — steel blue-grey metallic
        return M(0x607d8b, 0.22, 0.75, 0x0a1520, 0.1);
      case '10':  // d10 — deep navy with shimmer
        return M(0x1a2a6c, 0.28, 0.45, 0x000830, 0.12);
      case '12':  // d12 — warm amber
        return M(0xc47a20, 0.3,  0.6,  0x301800, 0.1);
      case '14':  // d14 — crimson
        return M(0x8b1a1a, 0.35, 0.3,  0x200000, 0.08);
      case '16':  // d16 — dark silver
        return M(0x9a9aaa, 0.18, 0.85, 0x0a0a15, 0.08);
      case '20':  // d20 — iconic black with green tint
        return M(0x1a1a2e, 0.2,  0.6,  0x002010, 0.15);
      case '100': // d100 — pearl white
        return M(0xe8e8f8, 0.12, 0.5,  0x0a0a20, 0.08);
      case 'hope':
        return M(0x2a6caf, 0.25, 0.55, 0x001840, 0.12);
      case 'fear':
        return M(0x8b1a1a, 0.25, 0.55, 0x200000, 0.12);
      default:
        return M(0xf0e8d0, 0.25, 0.08);
    }
  }

  /* ══════════════════════════════════════════════════
     MESH SPAWN
  ══════════════════════════════════════════════════ */
  function spawnMesh(geoType, mat) {
    const THREE = window.THREE;
    const geo = makeGeo(geoType);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  function clearDice() {
    removeSprites();
    [meshA, meshB].forEach(m => {
      if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    });
    meshA = meshB = null;
  }

  /* ══════════════════════════════════════════════════
     RENDER LOOP
  ══════════════════════════════════════════════════ */
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

  /* ══════════════════════════════════════════════════
     SPRITES
  ══════════════════════════════════════════════════ */
  function makeSprite(text, color) {
    const THREE = window.THREE;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    // pill background
    ctx.fillStyle = 'rgba(6,4,16,0.88)';
    ctx.beginPath();
    ctx.roundRect(14, 64, 228, 128, 28);
    ctx.fill();
    // subtle border
    ctx.strokeStyle = color || '#f0e8d0';
    ctx.lineWidth = 3;
    ctx.stroke();
    // number
    ctx.fillStyle    = color || '#f0e8d0';
    ctx.font         = 'bold 96px "Fira Sans", Arial, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 130);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    );
    spr.scale.set(3.2, 3.2, 1);
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

  /* ══════════════════════════════════════════════════
     ANIMATION
  ══════════════════════════════════════════════════ */
  function lerp(a, b, t)     { return a + (b - a) * t; }
  function easeOut(t)        { return 1 - Math.pow(1 - t, 2); }
  function easeOutCubic(t)   { return 1 - Math.pow(1 - t, 3); }

  function bounceY(t, h0) {
    if (t < 0.35) { const s=t/0.35;          return h0*(1-s*s); }
    if (t < 0.55) { const s=(t-0.35)/0.20;   return h0*0.28*4*s*(1-s); }
    if (t < 0.72) { const s=(t-0.55)/0.17;   return h0*0.10*4*s*(1-s); }
    if (t < 0.84) { const s=(t-0.72)/0.12;   return h0*0.035*4*s*(1-s); }
    return 0;
  }

  function animateRoll(meshes, isCoin, duration, onDone) {
    const startTime = performance.now();
    const THREE = window.THREE;

    const params = meshes.map((mesh, idx) => {
      const sign  = meshes.length > 1 ? (idx === 0 ? -1 : 1) : 0;
      const startX = (sign !== 0 ? sign : (Math.random()<0.5?1:-1)) * (2.2 + Math.random()*0.4);
      const startZ = (Math.random()-0.5)*1.4;
      const endX   = (Math.random()-0.5)*1.0 + (meshes.length>1 ? sign*0.75 : 0);
      const endZ   = (Math.random()-0.5)*1.0;

      if (isCoin) {
        // Coin: flips around its local Z axis (tumbles face-over-face like a real coin toss)
        // Random number of full flips (3–6), axis is perpendicular to the throw direction
        return {
          startX, startZ, endX, endZ,
          isCoin: true,
          flipAxis: new THREE.Vector3(Math.random()*0.2, 0, 1).normalize(),
          totalFlips: 3 + Math.floor(Math.random()*4),
          yawSpeed:   (Math.random()-0.5)*2,  // slight random yaw as it flies
        };
      }

      // Regular die — random tumble axis
      const sx=(Math.random()-0.5)*2, sy=(Math.random()-0.5)*2, sz=(Math.random()-0.5)*2;
      const sl=Math.sqrt(sx*sx+sy*sy+sz*sz);
      return {
        startX, startZ, endX, endZ,
        isCoin: false,
        spinAxis: { x:sx/sl, y:sy/sl, z:sz/sl },
        totalRotations: 4 + Math.random()*3,
      };
    });

    startLoop(function (now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);

      meshes.forEach((mesh, idx) => {
        const p = params[idx];
        mesh.position.x = lerp(p.startX, p.endX, easeOut(t));
        mesh.position.z = lerp(p.startZ, p.endZ, easeOut(t));
        mesh.position.y = FLOOR_Y + bounceY(t, 3.0);

        const rotT  = easeOutCubic(t);
        const angle = rotT * (p.isCoin ? p.totalFlips : p.totalRotations) * Math.PI * 2;

        if (p.isCoin) {
          // Coin: flip around the flip axis + gentle yaw
          const flipQ = new THREE.Quaternion().setFromAxisAngle(p.flipAxis, angle);
          const yawQ  = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0,1,0), rotT * p.yawSpeed * Math.PI
          );
          mesh.quaternion.multiplyQuaternions(yawQ, flipQ);
        } else {
          const axis = new THREE.Vector3(p.spinAxis.x, p.spinAxis.y, p.spinAxis.z);
          mesh.quaternion.setFromAxisAngle(axis, angle);
        }
      });

      if (t >= 1) {
        stopLoop();
        onDone();
      }
    });
  }

  /* ══════════════════════════════════════════════════
     DIE SELECTION
  ══════════════════════════════════════════════════ */
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
    const restY = FLOOR_Y + 0.85;
    if (die === 'hopefear') {
      meshA = spawnMesh(DIE_DEFS['6'], makeMat('hope'));
      meshB = spawnMesh(DIE_DEFS['6'], makeMat('fear'));
      meshA.position.set(-1.0, restY, 0);
      meshB.position.set( 1.0, restY, 0);
    } else {
      meshA = spawnMesh(DIE_DEFS[die] || 'box', makeMat(die));
      meshA.position.set(0, restY, 0);
    }
    const startTime = performance.now();
    // Coin preview: tilt on its side to show it's a coin
    if (die === '2' && meshA) {
      meshA.rotation.z = Math.PI / 2;
    }
    startLoop(function (now) {
      const t = (now - startTime) / 1000;
      if (meshA) meshA.rotation.y = t * 0.55;
      if (meshB) meshB.rotation.y = t * 0.55;
    });
  }

  /* ══════════════════════════════════════════════════
     ROLL
  ══════════════════════════════════════════════════ */
  rollBtn.addEventListener('click', doRoll);
  document.addEventListener('keydown', e => {
    if ((e.code === 'Space' || e.code === 'Enter') && !rolling && selectedDie) {
      e.preventDefault(); doRoll();
    }
  });

  function rand(min, max) { return min + Math.floor(Math.random()*(max-min+1)); }

  function doRoll() {
    if (!selectedDie || rolling) return;
    rolling = true;
    rollBtn.classList.add('rolling');
    setResult('', '');
    removeSprites();
    playRollSound();

    const result = computeRoll(selectedDie);
    const isCoin = selectedDie === '2';

    clearDice();
    stopLoop();

    let meshes;
    if (selectedDie === 'hopefear') {
      meshA  = spawnMesh(DIE_DEFS['6'], makeMat('hope'));
      meshB  = spawnMesh(DIE_DEFS['6'], makeMat('fear'));
      meshes = [meshA, meshB];
    } else {
      meshA  = spawnMesh(DIE_DEFS[selectedDie] || 'box', makeMat(selectedDie));
      meshes = [meshA];
    }

    animateRoll(meshes, isCoin, ROLL_DURATION, () => {
      rolling = false;
      rollBtn.classList.remove('rolling');

      // Coin: ensure it ends flat (rotation.z = 0 or PI)
      if (isCoin && meshA) {
        meshA.rotation.x = 0;
        meshA.rotation.z = 0;
      }

      if (selectedDie === 'hopefear') {
        spriteA = showSprite(meshA, String(result.hope), '#6bbde8');
        spriteB = showSprite(meshB, String(result.fear), '#e07070');
      } else {
        const col = result.modifier==='crit'   ? '#ffe066'
                  : result.modifier==='fumble' ? '#e07070'
                  : null;
        spriteA = showSprite(meshA, String(result.value), col);
      }

      // Idle slow spin after landing
      const doneTime = performance.now();
      startLoop(function () {
        if (meshA) { meshA.position.y = FLOOR_Y+0.85; meshA.rotation.y += 0.004; }
        if (meshB) { meshB.position.y = FLOOR_Y+0.85; meshB.rotation.y += 0.004; }
        if (spriteA && meshA) spriteA.position.y = meshA.position.y + 2.8;
        if (spriteB && meshB) spriteB.position.y = meshB.position.y + 2.8;
      });

      setResult(result.label, result.modifier);
      addHistory(result.label, result.modifier);
      setTimeout(() => speakResult(result), 200);
    });
  }

  /* ══════════════════════════════════════════════════
     COMPUTE / SPEAK / DISPLAY
  ══════════════════════════════════════════════════ */
  function computeRoll(die) {
    if (die === 'hopefear') {
      const hope=rand(1,12), fear=rand(1,12);
      const outcome = hope>=fear ? 'hope' : 'fear';
      return { type:'hopefear', hope, fear, total:hope+fear, outcome,
               label:(hope+fear)+' with '+outcome, modifier:outcome };
    }
    const sides = parseInt(die,10);
    const value = rand(1, sides);
    const mod   = die==='20'&&value===20 ? 'crit' : die==='20'&&value===1 ? 'fumble' : '';
    return { type:'normal', sides, value, label:'D'+sides+': '+value, modifier:mod };
  }

  function speakResult(result) {
    if (result.type==='hopefear') {
      playNumberSound(result.total);
      setTimeout(()=>playNumberSound(result.outcome), 900);
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

  /* ══════════════════════════════════════════════════
     HISTORY
  ══════════════════════════════════════════════════ */
  function addHistory(label, modifier) {
    const empty = historyLog.querySelector('.history-empty');
    if (empty) empty.remove();
    const chip = document.createElement('span');
    chip.className = 'history-chip'+(modifier?' '+modifier:'');
    chip.textContent = label;
    historyLog.insertBefore(chip, historyLog.firstChild);
  }
  clearBtn.addEventListener('click', ()=>{
    historyLog.innerHTML = '<span class="history-empty">No rolls yet</span>';
  });

  /* ══════════════════════════════════════════════════
     AUDIO
  ══════════════════════════════════════════════════ */
  const audioCache = {};
  function getAudio(src) {
    if (!audioCache[src]) { const a=new Audio(src); a.preload='auto'; audioCache[src]=a; }
    return audioCache[src];
  }
  function playRollSound() {
    try {
      const a=getAudio('/assets/dice-roll.mp3'); a.currentTime=0;
      const p=a.play();
      if(p) p.then(()=>setTimeout(()=>{a.pause();a.currentTime=0;},1500)).catch(()=>{});
    } catch(_){}
  }
  function playNumberSound(n) {
    try { const a=getAudio('/assets/number-'+n+'.mp3'); a.currentTime=0; a.play().catch(()=>{}); }
    catch(_){}
  }

  /* ══════════════════════════════════════════════════
     STREAMER MODE
  ══════════════════════════════════════════════════ */
  const streamerBtn  = document.getElementById('streamerToggle');
  const STREAMER_KEY = 'diceroller-streamer';
  function setStreamerMode(on) {
    document.body.classList.toggle('streamer-mode', on);
    streamerBtn.classList.toggle('active', on);
    streamerBtn.querySelector('.streamer-label').textContent = on ? 'Exit' : 'Streamer';
    try { localStorage.setItem(STREAMER_KEY, on?'1':''); } catch(_){}
  }
  streamerBtn.addEventListener('click', ()=>{
    setStreamerMode(!document.body.classList.contains('streamer-mode'));
  });
  try { if(localStorage.getItem(STREAMER_KEY)) setStreamerMode(true); } catch(_){}

  boot();
})();