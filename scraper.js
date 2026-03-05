const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeProfilePosts(page, profileUrl, numPosts = 20) {
  console.log('\n' + '='.repeat(60));
  console.log(`Scraping: ${profileUrl}`);
  console.log('='.repeat(60));

  // Navigate to the profile first to resolve any redirects (e.g. numeric ID → vanity URL)
  await page.goto(profileUrl);
  await page.waitForTimeout(2000);
  const resolvedUrl = page.url().replace(/\/$/, '');
  const activityUrl = `${resolvedUrl}/recent-activity/all/`;
  console.log(`Resolved URL: ${resolvedUrl}`);
  await page.goto(activityUrl);
  await page.waitForTimeout(4000);

  // Scroll to load posts
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
    console.log(`Scroll ${i + 1}/5 completed`);
  }

  const postElements = await page.$$('.feed-shared-update-v2');
  console.log(`Found ${postElements.length} post elements`);

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
      // Check if it's a repost
      let isRepost = false;
      const repostHeader = await element.$('.update-components-header__text-wrapper');
      if (repostHeader) {
        const headerText = await repostHeader.innerText();
        if (headerText.toLowerCase().includes('reposted this')) isRepost = true;
      }

      // Extract post text
      let text = null;
      for (const selector of textSelectors) {
        const el = await element.$(selector);
        if (el) {
          text = await el.innerText();
          break;
        }
      }

      if (!text) {
        console.log(`Post ${idx + 1}: No text found`);
        continue;
      }

      // Get original author if repost
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
      console.log(`✓ Post ${idx + 1} [${label}]${authorInfo}: Extracted (${text.length} chars)`);
    } catch (e) {
      console.log(`✗ Post ${idx + 1}: Error - ${e.message}`);
    }
  }

  console.log(`\nTotal posts extracted: ${posts.length}`);
  console.log(`  - Original posts: ${posts.filter(p => !p.is_repost).length}`);
  console.log(`  - Reposts: ${posts.filter(p => p.is_repost).length}`);
  return posts;
}

async function scrapeMultipleProfiles(profileUrls, numPosts = 20) {
  const allResults = {};

  // Load cookies
  if (!fs.existsSync('cookies.json')) {
    console.log('✗ cookies.json not found. Run save_cookies.js first.');
    process.exit(1);
  }
  const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf-8'));
  console.log(`✓ Loaded ${cookies.length} cookies`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  // Inject cookies instead of logging in
  await context.addCookies(cookies);

  const page = await context.newPage();

  // Verify session is valid
  console.log('Verifying session...');
  await page.goto('https://www.linkedin.com/feed');
  await page.waitForTimeout(3000);

  if (!page.url().includes('feed')) {
    console.log('✗ Session invalid or cookies expired. Re-run save_cookies.js to get fresh cookies.');
    await browser.close();
    process.exit(1);
  }
  console.log('✓ Session valid, starting scrape...');

  // Scrape each profile
  for (const profileUrl of profileUrls) {
    try {
      const posts = await scrapeProfilePosts(page, profileUrl, numPosts);
      allResults[profileUrl] = {
        success: true,
        posts,
        count: posts.length,
        original_count: posts.filter(p => !p.is_repost).length,
        repost_count: posts.filter(p => p.is_repost).length,
      };

      await page.waitForTimeout(3000);
    } catch (e) {
      console.log(`✗ Failed to scrape ${profileUrl}: ${e.message}`);
      allResults[profileUrl] = {
        success: false,
        error: e.message,
        posts: [],
      };
    }
  }

  await browser.close();
  return allResults;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const profiles = [
    'https://www.linkedin.com/in/ACwAAAvx0X4Be8Yngdw6ctjVJCz0T9L0kxkJK3g/',
    // Add more profiles here
  ];

  const results = await scrapeMultipleProfiles(profiles, 20);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SCRAPING SUMMARY');
  console.log('='.repeat(60));

  for (const [profile, data] of Object.entries(results)) {
    if (data.success) {
      console.log(`✓ ${profile}`);
      console.log(`   Total: ${data.count} posts (Original: ${data.original_count}, Reposts: ${data.repost_count})`);
    } else {
      console.log(`✗ ${profile}: ${data.error ?? 'Unknown error'}`);
    }
  }

  fs.writeFileSync('linkedin_posts.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log('\n✓ Results saved to linkedin_posts.json');
})();