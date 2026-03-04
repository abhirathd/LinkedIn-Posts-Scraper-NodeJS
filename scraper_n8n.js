const express = require('express');
const { chromium } = require('playwright');
const { Mutex } = require('async-mutex');
const fs = require('fs');

const app = express();
app.use(express.json());

// ─── Profile browser state ────────────────────────────────────────────────────
let browserProfile = null;
let contextProfile = null;
let pageProfile = null;
let isInitializedProfile = false;
const profileLock = new Mutex();

// ─── Company browser state ────────────────────────────────────────────────────
let browserCompany = null;
let contextCompany = null;
let pageCompany = null;
let isInitializedCompany = false;
const companyLock = new Mutex();

// ─── Cookie loader ────────────────────────────────────────────────────────────
function loadCookies() {
  if (!fs.existsSync('cookies.json')) {
    console.error('✗ cookies.json not found. Run save_cookies.js on your local machine first.');
    process.exit(1);
  }
  const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf-8'));
  console.log(`✓ Loaded ${cookies.length} cookies from cookies.json`);
  return cookies;
}

// ─── Browser helpers ──────────────────────────────────────────────────────────
async function initProfileBrowser() {
  if (isInitializedProfile) {
    console.log('[PROFILE] Already initialized');
    return true;
  }

  console.log('[PROFILE] Initializing browser with cookies...');
  browserProfile = await chromium.launch({ headless: true });
  contextProfile = await browserProfile.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  // Inject cookies
  const cookies = loadCookies();
  await contextProfile.addCookies(cookies);

  pageProfile = await contextProfile.newPage();

  // Verify session
  console.log('[PROFILE] Verifying session...');
  await pageProfile.goto('https://www.linkedin.com/feed');
  await pageProfile.waitForTimeout(3000);

  if (!pageProfile.url().includes('feed')) {
    console.log('[PROFILE] ✗ Session invalid or cookies expired. Re-run save_cookies.js to get fresh cookies.');
    isInitializedProfile = false;
    return false;
  }

  console.log('[PROFILE] ✓ Session valid');
  isInitializedProfile = true;
  return true;
}

async function initCompanyBrowser() {
  if (isInitializedCompany) {
    console.log('[COMPANY] Already initialized');
    return true;
  }

  console.log('[COMPANY] Initializing browser with cookies...');
  browserCompany = await chromium.launch({ headless: true });
  contextCompany = await browserCompany.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  // Inject cookies
  const cookies = loadCookies();
  await contextCompany.addCookies(cookies);

  pageCompany = await contextCompany.newPage();

  // Verify session
  console.log('[COMPANY] Verifying session...');
  await pageCompany.goto('https://www.linkedin.com/feed');
  await pageCompany.waitForTimeout(3000);

  if (!pageCompany.url().includes('feed')) {
    console.log('[COMPANY] ✗ Session invalid or cookies expired. Re-run save_cookies.js to get fresh cookies.');
    isInitializedCompany = false;
    return false;
  }

  console.log('[COMPANY] ✓ Session valid');
  isInitializedCompany = true;
  return true;
}

async function cleanupBrowsers() {
  if (browserProfile) {
    try {
      await browserProfile.close();
      isInitializedProfile = false;
      console.log('[PROFILE] Browser closed');
    } catch (_) {}
  }
  if (browserCompany) {
    try {
      await browserCompany.close();
      isInitializedCompany = false;
      console.log('[COMPANY] Browser closed');
    } catch (_) {}
  }
}

// ─── Scraping logic ───────────────────────────────────────────────────────────
async function scrapeProfilePosts(profileUrl, numPosts = 20) {
  console.log('\n' + '='.repeat(60));
  console.log(`[PROFILE] Scraping: ${profileUrl}`);
  console.log('='.repeat(60));

  const activityUrl = `${profileUrl.replace(/\/$/, '')}/recent-activity/all/`;
  await pageProfile.goto(activityUrl);
  await pageProfile.waitForTimeout(4000);

  for (let i = 0; i < 5; i++) {
    await pageProfile.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await pageProfile.waitForTimeout(2000);
    console.log(`[PROFILE] Scroll ${i + 1}/5 completed`);
  }

  const postElements = await pageProfile.$$('.feed-shared-update-v2');
  console.log(`[PROFILE] Found ${postElements.length} post elements`);

  const posts = [];
  const textSelectors = [
    '.feed-shared-inline-show-more-text',
    '.feed-shared-text',
    '.break-words',
    '.update-components-text',
  ];

  for (let idx = 0; idx < Math.min(postElements.length, numPosts); idx++) {
    const element = postElements[idx];
    try {
      let isRepost = false;
      const repostHeader = await element.$('.update-components-header__text-wrapper');
      if (repostHeader) {
        const headerText = await repostHeader.innerText();
        if (headerText.toLowerCase().includes('reposted this')) isRepost = true;
      }

      let text = null;
      for (const selector of textSelectors) {
        const el = await element.$(selector);
        if (el) {
          text = await el.innerText();
          break;
        }
      }

      if (!text) {
        console.log(`[PROFILE] Post ${idx + 1}: No text found`);
        continue;
      }

      let originalAuthor = null;
      if (isRepost) {
        const actorEl = await element.$('.update-components-actor__title');
        if (actorEl) originalAuthor = (await actorEl.innerText()).trim();
      }

      posts.push({
        text,
        is_repost: isRepost,
        original_author: originalAuthor,
        post_type: isRepost ? 'repost' : 'original',
      });

      const label = isRepost ? 'REPOST' : 'ORIGINAL';
      const authorInfo = originalAuthor ? ` (by ${originalAuthor})` : '';
      console.log(`[PROFILE] ✓ Post ${idx + 1} [${label}]${authorInfo}: Extracted (${text.length} chars)`);
    } catch (e) {
      console.log(`[PROFILE] ✗ Post ${idx + 1}: Error - ${e.message}`);
    }
  }

  console.log(`\n[PROFILE] Total posts extracted: ${posts.length}`);
  console.log(`[PROFILE]   - Original posts: ${posts.filter(p => !p.is_repost).length}`);
  console.log(`[PROFILE]   - Reposts: ${posts.filter(p => p.is_repost).length}`);
  return posts;
}

async function scrapeCompanyPosts(companyUrl, numPosts = 20) {
  console.log('\n' + '='.repeat(60));
  console.log(`[COMPANY] Scraping: ${companyUrl}`);
  console.log('='.repeat(60));

  if (!companyUrl.includes('/posts/')) {
    companyUrl = `${companyUrl.replace(/\/$/, '')}/posts/?feedView=all`;
  }

  await pageCompany.goto(companyUrl);
  await pageCompany.waitForTimeout(4000);

  for (let i = 0; i < 5; i++) {
    await pageCompany.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await pageCompany.waitForTimeout(2000);
    console.log(`[COMPANY] Scroll ${i + 1}/5 completed`);
  }

  const postElements = await pageCompany.$$('.feed-shared-update-v2');
  console.log(`[COMPANY] Found ${postElements.length} post elements`);

  const posts = [];
  const textSelectors = [
    '.feed-shared-inline-show-more-text',
    '.feed-shared-text',
    '.break-words',
    '.update-components-text',
  ];

  for (let idx = 0; idx < Math.min(postElements.length, numPosts); idx++) {
    const element = postElements[idx];
    try {
      let text = null;
      for (const selector of textSelectors) {
        const el = await element.$(selector);
        if (el) {
          text = await el.innerText();
          break;
        }
      }

      if (!text) {
        console.log(`[COMPANY] Post ${idx + 1}: No text found`);
        continue;
      }

      posts.push({ text, post_type: 'company_post' });
      console.log(`[COMPANY] ✓ Post ${idx + 1}: Extracted (${text.length} chars)`);
    } catch (e) {
      console.log(`[COMPANY] ✗ Post ${idx + 1}: Error - ${e.message}`);
    }
  }

  console.log(`\n[COMPANY] Total company posts extracted: ${posts.length}`);
  return posts;
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.post('/scrape', async (req, res) => {
  const { profile_url, num_posts = 20 } = req.body ?? {};

  if (!profile_url) {
    return res.status(400).json({
      success: false,
      message: 'Missing profile_url in request body',
      error: 'invalid_request',
    });
  }

  const release = await profileLock.acquire();
  try {
    if (!isInitializedProfile) {
      console.log('[PROFILE] First request - initializing browser...');
      const ok = await initProfileBrowser();
      if (!ok) {
        return res.status(500).json({
          success: false,
          message: 'Session invalid or cookies expired. Re-run save_cookies.js and upload fresh cookies.json.',
          error: 'session_invalid',
        });
      }
    }

    const posts = await scrapeProfilePosts(profile_url, num_posts);
    return res.json({
      success: true,
      profile_url,
      posts,
      count: posts.length,
      original_count: posts.filter(p => !p.is_repost).length,
      repost_count: posts.filter(p => p.is_repost).length,
    });
  } catch (e) {
    console.error(`[PROFILE] Error: ${e.message}`);
    // Reset so next request re-initializes
    isInitializedProfile = false;
    return res.status(500).json({
      success: false,
      profile_url,
      message: `Error: ${e.message}`,
      error: 'scraping_failed',
    });
  } finally {
    release();
  }
});

app.post('/scrape-company', async (req, res) => {
  const { company_url, num_posts = 20 } = req.body ?? {};

  if (!company_url) {
    return res.status(400).json({
      success: false,
      message: 'Missing company_url in request body',
      error: 'invalid_request',
    });
  }

  const release = await companyLock.acquire();
  try {
    if (!isInitializedCompany) {
      console.log('[COMPANY] First request - initializing browser...');
      const ok = await initCompanyBrowser();
      if (!ok) {
        return res.status(500).json({
          success: false,
          message: 'Session invalid or cookies expired. Re-run save_cookies.js and upload fresh cookies.json.',
          error: 'session_invalid',
        });
      }
    }

    const posts = await scrapeCompanyPosts(company_url, num_posts);
    return res.json({
      success: true,
      company_url,
      posts,
      count: posts.length,
    });
  } catch (e) {
    console.error(`[COMPANY] Error: ${e.message}`);
    isInitializedCompany = false;
    return res.status(500).json({
      success: false,
      company_url,
      message: `Error: ${e.message}`,
      error: 'scraping_failed',
    });
  } finally {
    release();
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    profile_browser: isInitializedProfile,
    company_browser: isInitializedCompany,
  });
});

// ─── Startup / shutdown ───────────────────────────────────────────────────────
const PORT = 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

async function gracefulShutdown() {
  console.log('\nShutting down...');
  await cleanupBrowsers();
  server.close(() => process.exit(0));
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);