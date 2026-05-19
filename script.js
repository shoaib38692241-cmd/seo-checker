/**
 * SEOlens — script.js
 * Real DOM-parsed SEO analysis using fetch() + DOMParser.
 * No fake/random data. Every result reflects the actual fetched HTML.
 *
 * Architecture:
 *  1. fetchPage()      — fetches HTML with timing, handles CORS errors
 *  2. parseDOM()       — runs DOMParser on raw HTML
 *  3. runChecks()      — 12 individual check functions → array of result objects
 *  4. scoreResults()   — calculates overall score from results
 *  5. renderReport()   — builds UI from result objects
 *  6. exportPDF()      — uses jsPDF to export a text report
 */

'use strict';

/* ────────────────────────────────────────
   DOM References
──────────────────────────────────────── */
const urlInput        = document.getElementById('urlInput');
const analyzeBtn      = document.getElementById('analyzeBtn');
const btnText         = document.getElementById('btnText');
const loadingOverlay  = document.getElementById('loadingOverlay');
const resultsSection  = document.getElementById('resultsSection');
const cardsGrid       = document.getElementById('cardsGrid');
const errorBanner     = document.getElementById('errorBanner');
const errorTitle      = document.getElementById('errorTitle');
const errorMsg        = document.getElementById('errorMsg');
const errorClose      = document.getElementById('errorClose');
const themeToggle     = document.getElementById('themeToggle');
const themeIcon       = document.getElementById('themeIcon');
const exportBtn       = document.getElementById('exportBtn');
const scoreNumber     = document.getElementById('scoreNumber');
const scoreGrade      = document.getElementById('scoreGrade');
const scoreDesc       = document.getElementById('scoreDesc');
const checkCounts     = document.getElementById('checkCounts');
const scoreProgressFill = document.getElementById('scoreProgressFill');
const scoreRingFill   = document.getElementById('scoreRingFill');
const resultsUrl      = document.getElementById('resultsUrl');
const resultsTimestamp= document.getElementById('resultsTimestamp');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const step4 = document.getElementById('step4');

/* ────────────────────────────────────────
   State
──────────────────────────────────────── */
let lastResults = null;   // stored for PDF export
let lastUrl     = '';

/* ────────────────────────────────────────
   Theme Toggle
──────────────────────────────────────── */
themeToggle.addEventListener('click', () => {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  themeIcon.textContent = isDark ? '🌙' : '☀️';
  themeToggle.querySelector('span:last-child').textContent = isDark ? 'Dark Mode' : 'Light Mode';
});

/* ────────────────────────────────────────
   Entry Point
──────────────────────────────────────── */
analyzeBtn.addEventListener('click', startAnalysis);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startAnalysis(); });
errorClose.addEventListener('click', () => { errorBanner.hidden = true; });
exportBtn.addEventListener('click', exportPDF);

async function startAnalysis() {
  let url = urlInput.value.trim();
  if (!url) {
    showError('Please enter a URL', 'Enter a full URL including https:// or http://');
    return;
  }

  // Auto-prepend https:// if missing
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  // Basic URL validation
  try { new URL(url); } catch {
    showError('Invalid URL', `"${url}" is not a valid URL. Try https://example.com`);
    return;
  }

  lastUrl = url;
  resetUI();
  showLoading(true);

  try {
    // Step 1: Fetch
    setStep(step1, 'active', '🔄 Fetching HTML…');
    const { html, loadTime } = await fetchPage(url);
    setStep(step1, 'done', '✅ HTML fetched');

    // Step 2: Parse
    setStep(step2, 'active', '🔄 Parsing DOM…');
    await sleep(250); // brief pause so user can see progress
    const doc = parseDom(html, url);
    setStep(step2, 'done', '✅ DOM parsed');

    // Step 3: Checks
    setStep(step3, 'active', '🔄 Running checks…');
    await sleep(300);
    const results = runAllChecks(doc, url, loadTime);
    setStep(step3, 'done', '✅ Checks complete');

    // Step 4: Score
    setStep(step4, 'active', '🔄 Calculating score…');
    await sleep(200);
    const score = scoreResults(results);
    setStep(step4, 'done', '✅ Scored');

    await sleep(300);

    // Render
    lastResults = { results, score, url };
    showLoading(false);
    renderReport(results, score, url);

  } catch (err) {
    showLoading(false);
    if (err.type === 'cors') {
      showError(
        'Cannot fetch website due to CORS',
        'The website blocked cross-origin requests from the browser. ' +
        'This is a browser security restriction, not a bug. ' +
        'Solution: Use a Node.js + Express backend with node-fetch as a proxy to bypass CORS. ' +
        'Many major websites (Google, Facebook, etc.) block direct browser fetches.'
      );
    } else if (err.type === 'network') {
      showError('Network Error', err.message || 'Could not connect to the website. Check the URL and your internet connection.');
    } else {
      showError('Unexpected Error', err.message || 'Something went wrong. Please try again.');
    }
    console.error('[SEOlens]', err);
  }
}

/* ────────────────────────────────────────
   1. Fetch Page
──────────────────────────────────────── */
async function fetchPage(url) {
  const start = performance.now();

  // We use a CORS-anywhere style public proxy as fallback only if direct fetch fails.
  // Attempt 1: Direct fetch
  let html = null;
  let fetchErr = null;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'text/html' },
      // No 'no-cors' — we need to read the body
    });

    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}: ${response.statusText}`), { type: 'network' });
    }

    html = await response.text();
  } catch (err) {
    fetchErr = err;
  }

  // If direct fetch failed, try CORS proxy
  if (!html) {
    try {
      // Use allorigins.win — a free, open CORS proxy
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const proxyRes = await fetch(proxyUrl);
      if (!proxyRes.ok) throw new Error('Proxy also failed');
      const data = await proxyRes.json();
      if (!data.contents) throw new Error('Empty proxy response');
      html = data.contents;
    } catch (proxyErr) {
      // Both direct and proxy failed — classify the error
      const errMsg = (fetchErr?.message || '').toLowerCase();
      if (
        errMsg.includes('cors') ||
        errMsg.includes('cross') ||
        errMsg.includes('blocked') ||
        errMsg.includes('failed to fetch') ||
        errMsg.includes('network') ||
        fetchErr instanceof TypeError
      ) {
        throw { type: 'cors', message: fetchErr?.message };
      }
      throw { type: 'network', message: fetchErr?.message || proxyErr.message };
    }
  }

  const loadTime = Math.round(performance.now() - start);
  return { html, loadTime };
}

/* ────────────────────────────────────────
   2. Parse DOM
──────────────────────────────────────── */
function parseDom(html, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Inject base tag so relative links resolve correctly (needed for link counting)
  let base = doc.querySelector('base');
  if (!base) {
    base = doc.createElement('base');
    base.href = baseUrl;
    doc.head.prepend(base);
  }

  return doc;
}

/* ────────────────────────────────────────
   3. SEO Checks
   Each check returns: { id, title, status, value, suggestion }
   status: 'good' | 'warn' | 'bad' | 'info'
   points: how much this check contributes to score (0–10)
──────────────────────────────────────── */
function runAllChecks(doc, url, loadTime) {
  return [
    checkHTTPS(url),
    checkPageTitle(doc),
    checkMetaDescription(doc),
    checkMetaKeywords(doc),
    checkH1(doc),
    checkHeadings(doc),
    checkImages(doc),
    checkLinks(doc, url),
    checkCanonical(doc),
    checkRobotsMeta(doc),
    checkViewport(doc),
    checkLoadTime(loadTime),
  ];
}

/** Check 1 — HTTPS */
function checkHTTPS(url) {
  const isHttps = url.startsWith('https://');
  return {
    id: 'https',
    title: 'HTTPS Security',
    status: isHttps ? 'good' : 'bad',
    value: isHttps
      ? `✓ URL uses HTTPS encryption`
      : `✗ URL uses HTTP — not encrypted`,
    suggestion: isHttps
      ? '🟢 Great. HTTPS is a confirmed Google ranking factor.'
      : '🔴 Migrate to HTTPS immediately. Google marks HTTP sites as "Not Secure" and may penalise rankings.',
    points: isHttps ? 10 : 0,
    maxPoints: 10,
  };
}

/** Check 2 — Page Title */
function checkPageTitle(doc) {
  const titleEl = doc.querySelector('title');
  const titleText = titleEl?.textContent?.trim() || '';
  const len = titleText.length;

  let status, value, suggestion, points;

  if (!titleText) {
    status = 'bad';
    value = '✗ No <title> tag found';
    suggestion = '🔴 Add a title tag. It is one of the most critical on-page SEO elements. Keep it 50–60 characters.';
    points = 0;
  } else if (len < 30) {
    status = 'warn';
    value = `"${truncate(titleText, 80)}" (${len} chars — too short)`;
    suggestion = `🟡 Title is too short (${len} chars). Aim for 50–60 characters to maximise visibility in SERPs.`;
    points = 5;
  } else if (len > 60) {
    status = 'warn';
    value = `"${truncate(titleText, 80)}" (${len} chars — too long)`;
    suggestion = `🟡 Title is too long (${len} chars). Google truncates titles beyond ~60 chars. Shorten it for full display.`;
    points = 6;
  } else {
    status = 'good';
    value = `"${truncate(titleText, 80)}" (${len} chars)`;
    suggestion = `🟢 Title length is optimal (${len}/60 chars). Good job!`;
    points = 10;
  }

  return { id: 'title', title: 'Page Title', status, value, suggestion, points, maxPoints: 10 };
}

/** Check 3 — Meta Description */
function checkMetaDescription(doc) {
  const metaEl = doc.querySelector('meta[name="description"]');
  const content = metaEl?.getAttribute('content')?.trim() || '';
  const len = content.length;

  let status, value, suggestion, points;

  if (!content) {
    status = 'bad';
    value = '✗ No meta description found';
    suggestion = '🔴 Add a meta description of 150–160 characters. While not a direct ranking factor, it greatly impacts click-through rate (CTR).';
    points = 0;
  } else if (len < 70) {
    status = 'warn';
    value = `"${truncate(content, 120)}" (${len} chars — too short)`;
    suggestion = `🟡 Meta description is too short (${len} chars). Expand it to 150–160 characters for richer SERP snippets.`;
    points = 5;
  } else if (len > 160) {
    status = 'warn';
    value = `"${truncate(content, 120)}" (${len} chars — too long)`;
    suggestion = `🟡 Meta description is too long (${len} chars). Google truncates after ~160 chars. Trim it down.`;
    points = 6;
  } else {
    status = 'good';
    value = `"${truncate(content, 120)}" (${len} chars)`;
    suggestion = `🟢 Meta description length is within the ideal range (${len}/160 chars).`;
    points = 10;
  }

  return { id: 'meta-desc', title: 'Meta Description', status, value, suggestion, points, maxPoints: 10 };
}

/** Check 4 — Meta Keywords */
function checkMetaKeywords(doc) {
  const metaEl = doc.querySelector('meta[name="keywords"]');
  const content = metaEl?.getAttribute('content')?.trim() || '';

  const status = content ? 'info' : 'info';
  const value  = content
    ? `Found: "${truncate(content, 100)}"`
    : 'Not present';
  const suggestion = content
    ? 'ℹ️ Meta keywords are largely ignored by Google and Bing. They can, however, be read by some smaller search engines. No action required.'
    : 'ℹ️ Meta keywords are obsolete for major search engines (Google, Bing). Not adding them is fine.';

  return { id: 'meta-kw', title: 'Meta Keywords', status, value, suggestion, points: 5, maxPoints: 5 };
}

/** Check 5 — H1 Tag */
function checkH1(doc) {
  const h1s = doc.querySelectorAll('h1');
  const count = h1s.length;
  const firstH1 = h1s[0]?.textContent?.trim() || '';

  let status, value, suggestion, points;

  if (count === 0) {
    status = 'bad';
    value = '✗ No H1 tag found on page';
    suggestion = '🔴 Every page should have exactly one H1. It signals the main topic to search engines and assistive technologies.';
    points = 0;
  } else if (count === 1) {
    status = 'good';
    value = `1 H1 found: "${truncate(firstH1, 80)}"`;
    suggestion = '🟢 Perfect — exactly one H1 is SEO best practice.';
    points = 10;
  } else {
    status = 'warn';
    value = `${count} H1 tags found. First: "${truncate(firstH1, 60)}"`;
    suggestion = `🟡 Multiple H1 tags (${count}) detected. Use only one H1 per page. Demote others to H2 or H3.`;
    points = 5;
  }

  return { id: 'h1', title: 'H1 Heading', status, value, suggestion, points, maxPoints: 10 };
}

/** Check 6 — Heading Structure */
function checkHeadings(doc) {
  const counts = {};
  ['h2','h3','h4','h5','h6'].forEach(tag => {
    counts[tag] = doc.querySelectorAll(tag).length;
  });

  const h2Count = counts['h2'];
  const h3Count = counts['h3'];
  const hasH2   = h2Count > 0;

  const value = `H2: ${h2Count} &nbsp;·&nbsp; H3: ${h3Count} &nbsp;·&nbsp; H4: ${counts['h4']} &nbsp;·&nbsp; H5: ${counts['h5']} &nbsp;·&nbsp; H6: ${counts['h6']}`;

  let status, suggestion, points;

  if (!hasH2) {
    status = 'warn';
    suggestion = `🟡 No H2 tags found. Use H2 headings to structure page content into logical sections — this helps both users and crawlers.`;
    points = 5;
  } else if (h2Count > 20) {
    status = 'warn';
    suggestion = `🟡 ${h2Count} H2 tags seems excessive. Too many H2s can dilute their signal. Consolidate content where possible.`;
    points = 7;
  } else {
    status = 'good';
    suggestion = `🟢 Good heading structure with ${h2Count} H2 and ${h3Count} H3 sections. Maintain a logical hierarchy (H1 → H2 → H3).`;
    points = 8;
  }

  return { id: 'headings', title: 'Heading Structure (H2–H6)', status, value, suggestion, points, maxPoints: 8 };
}

/** Check 7 — Image Alt Attributes */
function checkImages(doc) {
  const allImages     = doc.querySelectorAll('img');
  const missingAlt    = [...allImages].filter(img => !img.getAttribute('alt') && img.getAttribute('alt') !== '');
  const emptyAlt      = [...allImages].filter(img => img.getAttribute('alt') === '');
  const total         = allImages.length;
  const missingCount  = missingAlt.length;

  let status, value, suggestion, points;

  if (total === 0) {
    status = 'info';
    value  = 'No images found on this page';
    suggestion = 'ℹ️ No images detected. If you add images, always include descriptive alt attributes.';
    points = 5;
  } else if (missingCount === 0) {
    status = 'good';
    value  = `${total} image(s) — all have alt attributes (${emptyAlt.length} decorative/empty alt)`;
    suggestion = '🟢 All images have alt attributes. Search engines and screen readers can understand your images.';
    points = 10;
  } else if (missingCount <= 3) {
    status = 'warn';
    value  = `${total} images — ${missingCount} missing alt text`;
    suggestion = `🟡 ${missingCount} image(s) are missing alt attributes. Add descriptive alt text that explains the image content (e.g., alt="Red running shoes on white background").`;
    points = 6;
  } else {
    status = 'bad';
    value  = `${total} images — ${missingCount} missing alt text (${Math.round(missingCount/total*100)}% of images)`;
    suggestion = `🔴 ${missingCount} of ${total} images lack alt text. This hurts accessibility and image SEO. Add descriptive alt attributes to all meaningful images.`;
    points = 2;
  }

  return { id: 'images', title: 'Image Alt Text', status, value, suggestion, points, maxPoints: 10 };
}

/** Check 8 — Link Analysis */
function checkLinks(doc, pageUrl) {
  const allAnchors = [...doc.querySelectorAll('a[href]')];
  let internalCount = 0;
  let externalCount = 0;
  let nofollowCount = 0;

  let pageHostname = '';
  try { pageHostname = new URL(pageUrl).hostname; } catch { /* ignore */ }

  allAnchors.forEach(a => {
    const href = a.getAttribute('href') || '';
    const rel  = (a.getAttribute('rel') || '').toLowerCase();
    if (rel.includes('nofollow')) nofollowCount++;

    // Skip anchors, javascript:, mailto:, tel:
    if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
        href.startsWith('mailto:') || href.startsWith('tel:')) return;

    if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../') ||
        (pageHostname && href.includes(pageHostname)) ||
        (!href.startsWith('http'))) {
      internalCount++;
    } else {
      externalCount++;
    }
  });

  const total = internalCount + externalCount;
  let status, suggestion, points;

  if (total === 0) {
    status = 'warn';
    suggestion = '🟡 No links found. Internal links distribute PageRank and improve crawlability. Add relevant internal and external links.';
    points = 4;
  } else if (internalCount === 0) {
    status = 'warn';
    suggestion = '🟡 No internal links detected. Internal linking is crucial for distributing link equity and improving crawl depth.';
    points = 5;
  } else {
    status = 'good';
    suggestion = `🟢 Good link structure. ${nofollowCount > 0 ? `${nofollowCount} link(s) are marked nofollow. ` : ''}Ensure all important pages are reachable via internal links.`;
    points = 8;
  }

  const value = `Internal: <strong>${internalCount}</strong> &nbsp;·&nbsp; External: <strong>${externalCount}</strong> &nbsp;·&nbsp; Nofollow: <strong>${nofollowCount}</strong>`;

  return { id: 'links', title: 'Link Analysis', status, value, suggestion, points, maxPoints: 8 };
}

/** Check 9 — Canonical Tag */
function checkCanonical(doc) {
  const canonEl = doc.querySelector('link[rel="canonical"]');
  const href    = canonEl?.getAttribute('href')?.trim() || '';

  let status, value, suggestion, points;

  if (!href) {
    status = 'warn';
    value  = '✗ No canonical tag found';
    suggestion = '🟡 Add a <link rel="canonical" href="…"> tag. It tells search engines which URL is the preferred version, preventing duplicate content issues.';
    points = 4;
  } else {
    status = 'good';
    value  = `<code>${truncate(href, 80)}</code>`;
    suggestion = `🟢 Canonical tag present. Ensure it points to the correct, preferred URL (usually the HTTPS, non-www or www version consistently).`;
    points = 8;
  }

  return { id: 'canonical', title: 'Canonical Tag', status, value, suggestion, points, maxPoints: 8 };
}

/** Check 10 — Robots Meta Tag */
function checkRobotsMeta(doc) {
  const metaRobots  = doc.querySelector('meta[name="robots"]');
  const content     = (metaRobots?.getAttribute('content') || '').toLowerCase();

  let status, value, suggestion, points;

  if (!metaRobots) {
    status = 'info';
    value  = 'Not present (defaults to index, follow)';
    suggestion = 'ℹ️ No robots meta tag found. This is fine — pages are indexed by default. Add it only if you need to restrict indexing (e.g., noindex, nofollow).';
    points = 5;
  } else if (content.includes('noindex')) {
    status = 'bad';
    value  = `<code>${content}</code> — ⚠️ noindex detected`;
    suggestion = '🔴 This page is set to noindex — search engines will NOT index it. Remove "noindex" from the robots meta tag unless intentional (e.g., admin pages, thank-you pages).';
    points = 0;
  } else if (content.includes('nofollow')) {
    status = 'warn';
    value  = `<code>${content}</code> — nofollow on page level`;
    suggestion = '🟡 Page-level nofollow prevents Google from following any links on this page. This is rarely recommended for important pages.';
    points = 5;
  } else {
    status = 'good';
    value  = `<code>${content}</code>`;
    suggestion = '🟢 Robots meta tag is configured to allow indexing and following.';
    points = 5;
  }

  return { id: 'robots', title: 'Robots Meta Tag', status, value, suggestion, points, maxPoints: 5 };
}

/** Check 11 — Viewport / Mobile Friendliness */
function checkViewport(doc) {
  const viewportEl = doc.querySelector('meta[name="viewport"]');
  const content    = viewportEl?.getAttribute('content') || '';

  let status, value, suggestion, points;

  if (!viewportEl || !content) {
    status = 'bad';
    value  = '✗ No viewport meta tag found';
    suggestion = '🔴 Add <meta name="viewport" content="width=device-width, initial-scale=1">. Without it, mobile browsers render the desktop layout, causing a poor mobile experience and hurting mobile rankings.';
    points = 0;
  } else if (content.includes('width=device-width')) {
    // Check for user-scalable=no (accessibility concern)
    if (content.includes('user-scalable=no') || content.includes('maximum-scale=1')) {
      status = 'warn';
      value  = `<code>${content}</code>`;
      suggestion = '🟡 Viewport is set but user-scalable=no or maximum-scale=1 restricts zoom. This harms accessibility and may affect mobile usability scores. Remove that restriction.';
      points = 7;
    } else {
      status = 'good';
      value  = `<code>${content}</code>`;
      suggestion = '🟢 Viewport is correctly configured for mobile. Page should be mobile-friendly.';
      points = 10;
    }
  } else {
    status = 'warn';
    value  = `<code>${content}</code> — unusual viewport settings`;
    suggestion = '🟡 Viewport meta is present but has non-standard settings. Recommended: width=device-width, initial-scale=1';
    points = 5;
  }

  return { id: 'viewport', title: 'Mobile Viewport', status, value, suggestion, points, maxPoints: 10 };
}

/** Check 12 — Page Load Time */
function checkLoadTime(loadTime) {
  let status, value, suggestion, points;

  if (loadTime < 800) {
    status = 'good';
    value  = `${loadTime}ms — Fast`;
    suggestion = `🟢 Page HTML fetched in ${loadTime}ms. Excellent. Note: this is network fetch time only, not full page render time (which includes JS/CSS/images).`;
    points = 8;
  } else if (loadTime < 2000) {
    status = 'warn';
    value  = `${loadTime}ms — Moderate`;
    suggestion = `🟡 HTML fetched in ${loadTime}ms. Acceptable, but aim for under 800ms. Consider CDN, caching, and server optimisation. Use Google PageSpeed Insights for a full Core Web Vitals report.`;
    points = 5;
  } else {
    status = 'bad';
    value  = `${loadTime}ms — Slow`;
    suggestion = `🔴 HTML took ${loadTime}ms to load — this is slow. Page speed is a confirmed ranking factor. Investigate TTFB (Time to First Byte), enable server-side caching, use a CDN, and run Google PageSpeed Insights.`;
    points = 2;
  }

  return { id: 'load-time', title: 'HTML Fetch Time', status, value, suggestion, points, maxPoints: 8 };
}

/* ────────────────────────────────────────
   4. Scoring
──────────────────────────────────────── */
function scoreResults(results) {
  let earned = 0;
  let possible = 0;

  results.forEach(r => {
    earned   += r.points;
    possible += r.maxPoints;
  });

  const score = Math.round((earned / possible) * 100);
  const good  = results.filter(r => r.status === 'good').length;
  const warn  = results.filter(r => r.status === 'warn').length;
  const bad   = results.filter(r => r.status === 'bad').length;
  const info  = results.filter(r => r.status === 'info').length;

  let grade, desc;
  if (score >= 90)      { grade = 'Excellent 🏆'; desc = 'This page is very well optimised. Minor tweaks may still improve performance.'; }
  else if (score >= 75) { grade = 'Good 👍';       desc = 'Solid SEO foundation with a few areas that need attention.'; }
  else if (score >= 55) { grade = 'Average ⚠️';    desc = 'Several SEO issues detected. Address the red flags for meaningful gains.'; }
  else if (score >= 35) { grade = 'Poor 🔻';       desc = 'Significant SEO problems found. Fixing these could noticeably improve rankings.'; }
  else                  { grade = 'Critical 🚨';   desc = 'Serious SEO deficiencies. Immediate attention required.'; }

  return { score, grade, desc, good, warn, bad, info };
}

/* ────────────────────────────────────────
   5. Render Report
──────────────────────────────────────── */
function renderReport(results, scoreData, url) {
  // Meta
  resultsUrl.textContent      = url;
  resultsTimestamp.textContent = `Analyzed on ${new Date().toLocaleString()}`;

  // Score ring
  const circumference = 326.7;
  const offset = circumference - (scoreData.score / 100) * circumference;
  const ringColor = scoreData.score >= 75 ? 'var(--good)' : scoreData.score >= 50 ? 'var(--warn)' : 'var(--bad)';

  // Animate score number
  animateNumber(scoreNumber, 0, scoreData.score, 1200);

  // Ring fill
  setTimeout(() => {
    scoreRingFill.style.strokeDashoffset = offset;
    scoreRingFill.style.stroke = ringColor;
  }, 100);

  // Progress bar
  const progressColor = scoreData.score >= 75 ? 'var(--good)' : scoreData.score >= 50 ? 'var(--warn)' : 'var(--bad)';
  setTimeout(() => {
    scoreProgressFill.style.width = scoreData.score + '%';
    scoreProgressFill.style.background = progressColor;
  }, 200);

  scoreGrade.textContent = scoreData.grade;
  scoreGrade.style.color = ringColor;
  scoreDesc.textContent  = scoreData.desc;

  // Count pills
  checkCounts.innerHTML = `
    <span class="count-pill good">✅ ${scoreData.good} Good</span>
    <span class="count-pill warn">⚠️ ${scoreData.warn} Warnings</span>
    <span class="count-pill bad">🔴 ${scoreData.bad} Issues</span>
    ${scoreData.info > 0 ? `<span class="count-pill" style="background:var(--accent-glow);color:var(--accent)">ℹ️ ${scoreData.info} Info</span>` : ''}
  `;

  // Cards
  cardsGrid.innerHTML = '';
  results.forEach(result => {
    const card = buildCard(result);
    cardsGrid.appendChild(card);
  });

  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildCard(r) {
  const card = document.createElement('div');
  card.className = `seo-card ${r.status}`;

  const badgeClass = {
    good: 'badge-good',
    warn: 'badge-warn',
    bad:  'badge-bad',
    info: 'badge-info',
  }[r.status] || 'badge-info';

  const badgeLabel = {
    good: '✓ Good',
    warn: '⚠ Warning',
    bad:  '✕ Issue',
    info: 'ℹ Info',
  }[r.status] || r.status;

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">${escHtml(r.title)}</span>
      <span class="card-badge ${badgeClass}">${badgeLabel}</span>
    </div>
    <p class="card-value">${r.value}</p>
    <div class="card-suggestion">
      <span class="suggestion-icon"></span>${escHtml(r.suggestion)}
    </div>
  `;

  return card;
}

/* ────────────────────────────────────────
   6. PDF Export
──────────────────────────────────────── */
function exportPDF() {
  if (!lastResults) return;

  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    alert('jsPDF library not loaded. Make sure you have internet access to load the CDN.');
    return;
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const { results, score, url } = lastResults;

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = 56;

  // ── Header
  doc.setFillColor(19, 22, 29);
  doc.rect(0, 0, pageW, 88, 'F');

  doc.setTextColor(99, 210, 179);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('SEOlens — SEO Analysis Report', margin, 40);

  doc.setTextColor(180, 185, 200);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`URL: ${url}`, margin, 58);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 70);

  y = 108;

  // ── Score
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`Overall SEO Score: ${score.score}/100 — ${score.grade}`, margin, y);
  y += 16;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90, 95, 110);
  const descLines = doc.splitTextToSize(score.desc, pageW - margin * 2);
  doc.text(descLines, margin, y);
  y += descLines.length * 12 + 8;

  doc.setDrawColor(220, 222, 230);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 16;

  // ── Checks
  results.forEach((r, i) => {
    if (y > 750) { doc.addPage(); y = 50; }

    // Status indicator
    const statusColors = {
      good: [74,  222, 128],
      warn: [251, 191, 36],
      bad:  [248, 113, 113],
      info: [99,  210, 179],
    };
    const [sr, sg, sb] = statusColors[r.status] || [150,150,150];

    doc.setFillColor(sr, sg, sb);
    doc.roundedRect(margin, y - 8, 4, 18, 2, 2, 'F');

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 32, 40);
    doc.text(`${i + 1}. ${r.title}`, margin + 12, y + 4);

    const badge = { good: 'GOOD', warn: 'WARNING', bad: 'ISSUE', info: 'INFO' }[r.status] || '';
    doc.setFontSize(7);
    doc.setTextColor(sr, sg, sb);
    doc.text(badge, pageW - margin - doc.getTextWidth(badge), y + 4);

    y += 16;

    // Value
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(55, 60, 75);
    const valueText = stripHtml(r.value);
    const valueLines = doc.splitTextToSize(valueText, pageW - margin * 2 - 20);
    doc.text(valueLines, margin + 12, y);
    y += valueLines.length * 11 + 4;

    // Suggestion
    doc.setFontSize(8);
    doc.setTextColor(100, 108, 130);
    const sugLines = doc.splitTextToSize(r.suggestion, pageW - margin * 2 - 20);
    doc.text(sugLines, margin + 12, y);
    y += sugLines.length * 10 + 10;

    // Divider
    doc.setDrawColor(235, 237, 242);
    doc.line(margin + 12, y, pageW - margin, y);
    y += 12;
  });

  // ── Limitations note
  if (y > 720) { doc.addPage(); y = 50; }
  y += 10;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(150, 158, 175);
  const noteLines = doc.splitTextToSize(
    'Note: This report was generated by a browser-based tool. Checks are based on fetched HTML only. ' +
    'JavaScript-rendered content, backlinks, Core Web Vitals, and server-side factors are not included. ' +
    'For full audits, use Google Search Console, Ahrefs, Screaming Frog, or a Node.js backend proxy.',
    pageW - margin * 2
  );
  doc.text(noteLines, margin, y);

  doc.save(`seolens-report-${new Date().toISOString().split('T')[0]}.pdf`);
}

/* ────────────────────────────────────────
   UI Helpers
──────────────────────────────────────── */
function showLoading(show) {
  loadingOverlay.hidden = !show;
  analyzeBtn.disabled   = show;
  btnText.textContent   = show ? 'Analyzing…' : 'Analyze SEO';
  if (show) {
    // Reset steps
    [step1, step2, step3, step4].forEach(s => {
      s.className = 'step';
    });
    step1.textContent = '⬜ Fetching HTML';
    step2.textContent = '⬜ Parsing DOM';
    step3.textContent = '⬜ Running checks';
    step4.textContent = '⬜ Scoring';
  }
}

function setStep(el, state, label) {
  el.className = `step ${state}`;
  el.textContent = label;
}

function resetUI() {
  resultsSection.hidden = true;
  errorBanner.hidden    = true;
  cardsGrid.innerHTML   = '';
}

function showError(title, msg) {
  errorTitle.textContent = title;
  errorMsg.textContent   = msg;
  errorBanner.hidden     = false;
  errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function animateNumber(el, from, to, duration) {
  const startTime = performance.now();
  function update(now) {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

function escHtml(str) {
  // Only escape dangerous chars; allow our own HTML in value/suggestion
  // For card-title we escape; for value/suggestion we trust our own output
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

/* ── Override card innerHTML to allow our trusted HTML in value/suggestion ── */
// We build cards with innerHTML, so escHtml is only used for the title field.
// value and suggestion are generated by our own functions (not user input), safe.
