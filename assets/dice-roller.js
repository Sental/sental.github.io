/**
 * dice-roller.js
 * Place this in /assets/dice-roller.js
 *
 * Audio file conventions expected in /assets/:
 *   dice-roll.mp3        — rolling/shaking sound (same as existing dice.mp3)
 *   number-1.mp3         — spoken "one"
 *   number-2.mp3         — spoken "two"
 *   ... etc up to number-20.mp3
 *   number-hope.mp3      — spoken "with hope" (optional)
 *   number-fear.mp3      — spoken "with fear" (optional)
 *
 * If an audio file is missing, rolls still work — audio is silent.
 */

(function () {

  /* ── State ──────────────────────────────────────────── */
  let selectedDie = null;   // '2','3','4','5','6','7','8','10','12','14','16','20','100','hopefear'
  let rolling = false;

  /* ── DOM refs ───────────────────────────────────────── */
  const rollBtn      = document.getElementById('rollBtn');
  const rollResult   = document.getElementById('rollResult');
  const historyLog   = document.getElementById('historyLog');
  const clearBtn     = document.getElementById('clearBtn');
  const dieWrap      = document.getElementById('dieWrap');

  // Map die type → SVG element id + number text element id
  const dieAssets = {
    '2':         { svg: 'dieD2',        numEl: 'dieD2Num'    },
    '3':         { svg: 'dieD3',        numEl: 'dieD3Num'    },
    '4':         { svg: 'dieD4',        numEl: 'dieD4Num'    },
    '5':         { svg: 'dieD5',        numEl: 'dieD5Num'    },
    '6':         { svg: 'dieSvg',       numEl: 'dieFaceNum'  },
    '7':         { svg: 'dieD7',        numEl: 'dieD7Num'    },
    '8':         { svg: 'dieD8',        numEl: 'dieD8Num'    },
    '10':        { svg: 'dieD10',       numEl: 'dieD10Num'   },
    '12':        { svg: 'dieD12',       numEl: 'dieD12Num'   },
    '14':        { svg: 'dieD14',       numEl: 'dieD14Num'   },
    '16':        { svg: 'dieD16',       numEl: 'dieD16Num'   },
    '20':        { svg: 'dieD20',       numEl: 'dieD20Num'   },
    '100':       { svg: 'dieD100',      numEl: 'dieD100Num'  },
    'hopefear':  { svg: 'dieHopeFear',  numEl: null          },
  };

  /* ── Audio ──────────────────────────────────────────── */
  const audioCache = {};

  function getAudio(src) {
    if (!audioCache[src]) {
      const a = new Audio(src);
      a.preload = 'auto';
      audioCache[src] = a;
    }
    return audioCache[src];
  }

  function playRollSound() {
    try {
      const a = getAudio('/assets/dice.mp3');
      a.currentTime = 0;
      const p = a.play();
      // Stop after 600ms so it doesn't run forever
      if (p) p.then(() => setTimeout(() => { a.pause(); a.currentTime = 0; }, 600)).catch(() => {});
    } catch (_) {}
  }

  function playNumberSound(n) {
    // n can be a number (1-20) or a string like 'hope'/'fear'
    try {
      const src = `/assets/number-${n}.mp3`;
      const a = getAudio(src);
      a.currentTime = 0;
      a.play().catch(() => {});   // silent fail if file missing
    } catch (_) {}
  }

  /* ── Die selection ──────────────────────────────────── */
  document.querySelectorAll('.die-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (rolling) return;
      selectedDie = btn.dataset.sides;
      document.querySelectorAll('.die-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show correct die shape, hide others
      Object.entries(dieAssets).forEach(([key, asset]) => {
        const el = document.getElementById(asset.svg);
        if (el) el.style.display = (key === selectedDie) ? '' : 'none';
      });

      // Reset display
      setResult('', '');
      if (dieAssets[selectedDie]?.numEl) {
        const numEl = document.getElementById(dieAssets[selectedDie].numEl);
        if (numEl) numEl.textContent = '?';
      } else if (selectedDie === 'hopefear') {
        document.getElementById('hopeNum').textContent = '?';
        document.getElementById('fearNum').textContent = '?';
      }

      rollBtn.disabled = false;
      rollBtn.querySelector('.roll-btn-label').textContent =
        `Roll ${btn.dataset.label}`;
    });
  });

  /* ── Roll ───────────────────────────────────────────── */
  rollBtn.addEventListener('click', doRoll);

  // Space / Enter keyboard shortcut
  document.addEventListener('keydown', e => {
    if ((e.code === 'Space' || e.code === 'Enter') && !rolling && selectedDie) {
      e.preventDefault();
      doRoll();
    }
  });

  function rand(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function doRoll() {
    if (!selectedDie || rolling) return;
    rolling = true;
    rollBtn.classList.add('rolling');
    setResult('', '');

    playRollSound();

    // Trigger CSS animation
    dieWrap.classList.add('rolling');

    const SPIN_MS = 650;  // match CSS animation duration

    setTimeout(() => {
      // Compute result
      const result = computeRoll(selectedDie);

      // Update die face(s)
      showResult(selectedDie, result);

      // Remove rolling class
      dieWrap.classList.remove('rolling');
      rolling = false;
      rollBtn.classList.remove('rolling');

      // Display text result
      const { label, modifier } = result;
      setResult(label, modifier);

      // Add to history
      addHistory(label, modifier);

      // Speak the number(s) after a short delay
      setTimeout(() => speakResult(result), 200);

    }, SPIN_MS);
  }

  function computeRoll(die) {
    if (die === 'hopefear') {
      const hope = rand(1, 12);
      const fear = rand(1, 12);
      const total = hope + fear;
      const outcome = hope >= fear ? 'hope' : 'fear';
      return { type: 'hopefear', hope, fear, total, outcome,
               label: `${total} with ${outcome}`,
               modifier: outcome };
    }
    const sides = parseInt(die, 10);
    const value = rand(1, sides);
    const crit = (die === '20' && value === 20) ? 'crit' :
                 (die === '20' && value === 1)  ? 'fumble' : '';
    return { type: 'normal', sides, value,
             label: `D${sides}: ${value}`,
             modifier: crit };
  }

  function showResult(die, result) {
    if (die === 'hopefear') {
      const hopeEl = document.getElementById('hopeNum');
      const fearEl = document.getElementById('fearNum');
      hopeEl.textContent = result.hope;
      fearEl.textContent = result.fear;
      // Flash animation
      [hopeEl, fearEl].forEach(el => {
        el.classList.remove('revealed');
        void el.offsetWidth;
        el.classList.add('revealed');
      });
    } else {
      const numEl = document.getElementById(dieAssets[die].numEl);
      if (numEl) {
        numEl.textContent = result.value;
        numEl.classList.remove('revealed');
        void numEl.offsetWidth;
        numEl.classList.add('revealed');
      }
    }
  }

  function speakResult(result) {
    if (result.type === 'hopefear') {
      playNumberSound(result.total);
      // Optionally queue hope/fear audio after total
      setTimeout(() => playNumberSound(result.outcome), 900);
    } else {
      playNumberSound(result.value);
    }
  }

  function setResult(text, modifier) {
    rollResult.textContent = text;
    rollResult.className = 'roll-result';
    if (text) {
      rollResult.classList.add('visible');
      if (modifier === 'hope') rollResult.classList.add('hope');
      if (modifier === 'fear') rollResult.classList.add('fear');
    }
  }

  /* ── History ────────────────────────────────────────── */
  function addHistory(label, modifier) {
    const empty = historyLog.querySelector('.history-empty');
    if (empty) empty.remove();

    const chip = document.createElement('span');
    chip.className = 'history-chip';
    if (modifier === 'hope') chip.classList.add('hope');
    if (modifier === 'fear') chip.classList.add('fear');
    chip.textContent = label;

    // Prepend — newest on left
    historyLog.insertBefore(chip, historyLog.firstChild);
  }

  clearBtn.addEventListener('click', () => {
    historyLog.innerHTML = '<span class="history-empty">No rolls yet</span>';
  });

  /* ── Initial state: show D6 shape by default but idle ─ */
  document.getElementById('dieD2').style.display    = 'none';
  document.getElementById('dieD3').style.display    = 'none';
  document.getElementById('dieD4').style.display    = 'none';
  document.getElementById('dieD5').style.display    = 'none';
  document.getElementById('dieD7').style.display    = 'none';
  document.getElementById('dieD8').style.display    = 'none';
  document.getElementById('dieD10').style.display   = 'none';
  document.getElementById('dieD12').style.display   = 'none';
  document.getElementById('dieD14').style.display   = 'none';
  document.getElementById('dieD16').style.display   = 'none';
  document.getElementById('dieD20').style.display   = 'none';
  document.getElementById('dieD100').style.display  = 'none';
  document.getElementById('dieHopeFear').style.display = 'none';
  document.getElementById('dieSvg').style.display   = '';  // D6 default

})();
