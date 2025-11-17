// public/js/dashboard.js
(() => {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function waitForChart(cb) {
    if (window.Chart) return cb();
    let tries = 0;
    const t = setInterval(() => {
      if (window.Chart || ++tries > 80) { // ~4s max
        clearInterval(t);
        if (window.Chart) cb();
        else console.error('[dashboard] Chart.js not available.');
      }
    }, 50);
  }

  onReady(() => {
    const canvas   = document.getElementById('overallChart');
    const noDataEl = document.getElementById('noData');
    if (!canvas) return;

    waitForChart(() => {
      // Global defaults: make all chart text white on the dark UI
      Chart.defaults.color = '#ffffff';
      Chart.defaults.font.family =
        'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial';

      // Read totals from data-* attributes set by EJS
      const ds = canvas.dataset;

      // Stable order so colors always match legend slices
      const labels = ['Products', 'Testimonials', 'Blog Posts', 'Contacts'];
      const values = [
        Number(ds.products     || 0),
        Number(ds.testimonials || 0),
        Number(ds.blogposts    || 0),
        Number(ds.contacts     || 0),
      ];
      const sum = values.reduce((a, b) => a + b, 0);

      if (!sum) {
        if (noDataEl) noDataEl.style.display = 'block';
        canvas.style.display = 'none';
        return;
      }
      if (noDataEl) noDataEl.style.display = 'none';
      canvas.style.display = 'block';

      const colors = [
        '#f59e0b', // Products – yellow
        '#16a34a', // Testimonials – green
        '#60a5fa', // Blog Posts – blue
        '#ef4444', // Contacts – red
      ];

      const chart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: colors,
            borderColor: 'rgba(255,255,255,.12)',
            borderWidth: 1,
            hoverOffset: 10
          }]
        },
        options: {
          responsive: true,
          cutout: '58%',
          interaction: { mode: 'nearest', intersect: true },
          onHover: (evt, el) => {
            evt.native.target.style.cursor = el.length ? 'pointer' : 'default';
          },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: '#ffffff',
                usePointStyle: true,
                pointStyle: 'rect',
                boxWidth: 18,
                boxHeight: 12,
                padding: 16,
                font: { weight: '700' },
                // Show "Label: value (xx.x%)" in legend with matching color swatch
                generateLabels(chart) {
                  const ds0 = chart.data.datasets[0];
                  const total = ds0.data.reduce((a, b) => a + b, 0) || 1;
                  const meta = chart.getDatasetMeta(0);
                  return chart.data.labels.map((lbl, i) => {
                    const v = Number(ds0.data[i] || 0);
                    const pct = ((v / total) * 100).toFixed(1);
                    return {
                      text: `${lbl}: ${v} (${pct}%)`,
                      fillStyle: ds0.backgroundColor[i],
                      strokeStyle: ds0.backgroundColor[i],
                      lineWidth: 1,
                      hidden: meta.data[i]?.hidden === true || ds0.hidden === true,
                      index: i
                    };
                  });
                }
              }
            },
            tooltip: {
              enabled: true,
              position: 'nearest',
              caretPadding: 8,
              bodySpacing: 6,
              displayColors: true,
              backgroundColor: 'rgba(15,27,52,0.95)',
              borderColor: 'rgba(255,255,255,.18)',
              borderWidth: 1,
              titleColor: '#ffffff',
              bodyColor:  '#ffffff',
              callbacks: {
                label(ctx) {
                  const v = Number(ctx.parsed || 0);
                  const pct = sum ? ((v / sum) * 100).toFixed(1) : 0;
                  return `${ctx.label}: ${v} (${pct}%)`;
                }
              }
            }
          }
        }
      });

      // Expose for debugging if needed
      window._overallChart = chart;
    });
  });
})();
