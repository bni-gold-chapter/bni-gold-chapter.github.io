/*
  全鑫分會管理網站動態（第二版，2026-10-06）：
  - 平滑捲動（Lenis，assets/vendor/lenis.min.js；觸控仍用手機原生捲動）
  - 捲動進場：清單、面板、卡片依序淡入上移，細線由左畫出（IntersectionObserver；之後動態產生的內容也會套用）
  - 大標：每個字母由下往上升起，字級自動撐滿畫面寬度（.fit 內每行 .ln）
  - 首頁影片：視差、往下捲淡出；頁首捲動後變霧面、往下滑隱藏往上滑出現
  - 數字跳動（data-count）、換頁淡出淡入
  系統設定「減少動態效果」時全部停用。放在 <head> 同步載入（很小），先加上 html.motion 避免內容閃一下。
*/
(function (w, d) {
  'use strict';
  var root = d.documentElement;
  var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) root.classList.add('motion');
  var M = w.MOTION = { lenis: null, reduce: reduce };

  function ready(fn) { if (d.readyState !== 'loading') fn(); else d.addEventListener('DOMContentLoaded', fn); }
  function $$(q, el) { return Array.prototype.slice.call((el || d).querySelectorAll(q)); }

  // ── 大標：拆字、撐滿寬度 ──
  function split(el) {
    if (el.dataset.split) return;
    el.dataset.split = '1';
    $$('.ln', el).forEach(function (ln) {
      var text = ln.textContent;
      var i = Number(el.dataset.i0 || 0);
      ln.innerHTML = '<span class="lt">' + text.split('').map(function (c) {
        var s = c === ' ' ? '&nbsp;' : c.replace(/[&<>]/g, function (x) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]; });
        return '<span class="ch" style="--i:' + (i++) + '">' + s + '</span>';
      }).join('') + '</span>';
      el.dataset.i0 = i;
    });
  }
  function fit(el) {
    var lines = $$('.lt', el);
    if (!lines.length) return;
    var box = el.clientWidth;
    if (!box) return;
    el.style.fontSize = '100px';
    var widest = 0;
    lines.forEach(function (l) { widest = Math.max(widest, l.getBoundingClientRect().width); });
    if (!widest) return;
    var size = 100 * box / widest * Number(el.dataset.scale || 1);
    var max = Number(el.dataset.max || 0);
    if (max) size = Math.min(size, max);
    // data-reserve：同一畫面還要放的其他內容高度（px），大標不可把它們擠出畫面
    var reserve = Number(el.dataset.reserve || 0);
    if (reserve) size = Math.min(size, Math.max(48, (w.innerHeight - reserve) / (lines.length * 0.86)));
    el.style.fontSize = size.toFixed(2) + 'px';
  }
  function fitAll() { $$('.fit').forEach(fit); }
  M.fit = fitAll;

  // ── 捲動進場 ──
  var AUTO = '.item,.panel,.card,.cards > *,.app-item,.how,.foot-grid > div,.stat,.row-m,.hero-foot > *,.kv,.tabs,h2.sec,.stack > *';
  var io = null;
  function show(el) {
    el.classList.add('in');
    if (el.hasAttribute('data-count')) count(el);
    $$('[data-count]', el).forEach(count);
  }
  function scan(scope) {
    if (reduce) { $$('[data-count]', scope).forEach(count); return; }
    var els = [];
    if (scope.matches && (scope.matches(AUTO + ',.fit,.foot') || scope.hasAttribute('data-rv'))) els.push(scope);
    els = els.concat($$(AUTO + ',[data-rv],.fit,.foot,[data-count]', scope));
    var group = new Map();
    els.forEach(function (el) {
      if (el.dataset.rvSeen || el.closest('.modal,.sheet,.toast')) return;
      el.dataset.rvSeen = '1';
      if (!el.classList.contains('fit') && !el.classList.contains('foot') && !el.hasAttribute('data-rv')) el.setAttribute('data-rv', '');
      if (el.classList.contains('fit')) split(el);
      // 同一個容器裡的兄弟元素依序出現
      var p = el.parentNode, n = group.get(p) || 0;
      group.set(p, n + 1);
      if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', Math.min(n, 8) * 0.07 + 's');
      if (io) io.observe(el); else show(el);
    });
    if ($$('.fit', scope).length || (scope.classList && scope.classList.contains('fit'))) requestAnimationFrame(fitAll);
  }
  M.scan = scan;

  // ── 數字跳動 ──
  function count(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = '1';
    var to = Number(el.getAttribute('data-count')), dec = Number(el.dataset.dec || 0);
    var fmt = function (v) { return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
    if (reduce || !isFinite(to)) { el.textContent = fmt(to || 0); return; }
    var t0 = performance.now(), dur = 1500;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
      el.textContent = fmt(to * e);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  // ── 捲動：頁首、首頁視差 ──
  var lastY = 0, ticking = false;
  function onScroll(y) {
    var top = d.querySelector('.top');
    if (top) {
      top.classList.toggle('solid', y > 24);
      if (y > lastY + 4 && y > 240) top.classList.add('hide');
      else if (y < lastY - 4 || y < 120) top.classList.remove('hide');
      root.classList.toggle('top-hidden', top.classList.contains('hide'));
    }
    lastY = y;
    if (reduce) return;
    var hero = d.querySelector('.hero-full,.hero-page');
    if (!hero) return;
    var h = hero.offsetHeight || 1;
    if (y > h * 1.2) return;
    var body = hero.querySelector('.hero-body'), media = hero.querySelector('.hero-media');
    if (body) {
      body.style.transform = 'translate3d(0,' + (y * 0.28).toFixed(1) + 'px,0)';
      body.style.opacity = Math.max(0, 1 - y / (h * 0.85)).toFixed(3);
    }
    if (media) media.style.transform = 'translate3d(0,' + (y * 0.45).toFixed(1) + 'px,0)';
  }
  function scrolled(y) {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; onScroll(y === undefined ? w.scrollY : y); });
  }

  // ── 換頁淡出 ──
  function leave(e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || reduce || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== '_self') return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin || a.hasAttribute('download')) return;
    if (url.pathname === location.pathname && url.search === location.search) return;   // 同頁（只有 # 不同）
    e.preventDefault();
    root.classList.add('leaving');
    setTimeout(function () { location.href = url.href; }, 300);
  }
  w.addEventListener('pageshow', function (e) { if (e.persisted) root.classList.remove('leaving'); });

  // ── 首頁影片：手機用小檔，看不到時暫停 ──
  function video() {
    $$('video[data-src]').forEach(function (v) {
      if (reduce) return;
      var small = w.matchMedia('(max-width: 760px)').matches || (navigator.connection && navigator.connection.saveData);
      v.src = small && v.dataset.srcM ? v.dataset.srcM : v.dataset.src;
      v.muted = true;
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* 省電模式不自動播放：留在靜態影格 */ });
      if ('IntersectionObserver' in w) {
        new IntersectionObserver(function (es) {
          es.forEach(function (x) { if (x.isIntersecting) { var q = v.play(); if (q && q.catch) q.catch(function () {}); } else v.pause(); });
        }).observe(v);
      }
    });
  }

  ready(function () {
    if (!reduce && 'IntersectionObserver' in w) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (x) { if (x.isIntersecting) { show(x.target); io.unobserve(x.target); } });
      }, { rootMargin: '0px 0px -2% 0px', threshold: 0 });
    }
    scan(d.body);
    video();
    // 之後由程式產生的內容（帳號、申請、儀表板）也套用
    if ('MutationObserver' in w) {
      var pending = [];
      new MutationObserver(function (ms) {
        ms.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) pending.push(n); }); });
        if (pending.length === 1 || pending.length > 0) requestAnimationFrame(function () {
          var list = pending; pending = [];
          list.forEach(function (n) {
            if (n.closest('.modal,.sheet')) n.closest('.modal,.sheet').setAttribute('data-lenis-prevent', '');
            if (n.isConnected) scan(n);
          });
        });
      }).observe(d.body, { childList: true, subtree: true });
    }
    if (!reduce && w.Lenis) {
      try {
        M.lenis = new w.Lenis({ lerp: 0.085, wheelMultiplier: 0.95, smoothWheel: true });
        M.lenis.on('scroll', function (l) { scrolled(l.scroll); });
        (function raf(t) { M.lenis.raf(t); requestAnimationFrame(raf); })(performance.now());
      } catch (err) { M.lenis = null; }
    }
    if (!M.lenis) w.addEventListener('scroll', function () { scrolled(); }, { passive: true });
    onScroll(w.scrollY);
    d.addEventListener('click', leave);
    var rt = 0;
    w.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(fitAll, 120); });
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(fitAll);
    w.addEventListener('load', fitAll);
  });
})(window, document);
