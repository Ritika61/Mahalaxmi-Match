/* /public/js/testimonials-carousel.js */
(() => {
  const root = document.getElementById('arcCarousel');
  if (!root) return;

  const items    = Array.from(root.querySelectorAll('.tcardA'));
  const dotsWrap = document.getElementById('arcDots');
  const prevBtn  = document.getElementById('arcPrev');
  const nextBtn  = document.getElementById('arcNext');

  const n = items.length;
  if (!n) return;

  if (n === 1) {
    items[0].className = 'tcardA pos-center';
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (dotsWrap) dotsWrap.style.display = 'none';
    return;
  }

  const DUR = 650; // match CSS transition
  let i = 0;
  let anim = false;

  function paint() {
    const L2 = (i - 2 + n) % n, L1 = (i - 1 + n) % n, C = i, R1 = (i + 1) % n, R2 = (i + 2) % n;
    items.forEach((el, idx) => {
      el.className = 'tcardA';
           if (idx === C)  el.classList.add('pos-center');
      else if (idx === L1) el.classList.add('pos-left');
      else if (idx === R1) el.classList.add('pos-right');
      else if (idx === L2) el.classList.add('pos-backL');
      else if (idx === R2) el.classList.add('pos-backR');
      else                 el.classList.add('pos-queue');
    });

    if (dotsWrap) {
      dotsWrap.querySelectorAll('.dot').forEach((d, di) =>
        d.classList.toggle('active', di === i)
      );
    }
  }

  function go(to) {
    if (anim) return;
    anim = true;
    i = (to + n) % n;
    paint();
    setTimeout(() => { anim = false; }, DUR);
  }
  const next = () => go(i + 1);
  const prev = () => go(i - 1);

  // Build dots
  if (dotsWrap) {
    dotsWrap.innerHTML = '';
    for (let d = 0; d < n; d++) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (d === i ? ' active' : '');
      dotsWrap.appendChild(dot);
    }
  }

  // Bind buttons (capture to catch icon clicks)
  if (nextBtn) nextBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); next(); }, true);
  if (prevBtn) prevBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); prev(); }, true);

  // Delegation fallback (any click inside the button)
  root.addEventListener('click', (e) => {
    if (e.target.closest('#arcNext')) { e.preventDefault(); next(); }
    if (e.target.closest('#arcPrev')) { e.preventDefault(); prev(); }
  });

  // Keyboard support
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); prev(); }
  });

  // Initial state
  paint();
})();
