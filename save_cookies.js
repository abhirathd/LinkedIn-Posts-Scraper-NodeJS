const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false }); // headless false so you can see + solve CAPTCHA
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  await page.goto('https://www.linkedin.com/login');

  // Wait for you to login manually in the browser window
  console.log('⏳ Please login manually in the browser window...');
  console.log('⏳ Waiting for redirect to feed...');

  // Wait until LinkedIn redirects to feed after login
  await page.waitForURL('**/feed**', { timeout: 120000 });

  console.log('✓ Logged in! Saving cookies...');

  const cookies = await context.cookies();
  fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));

  console.log(`✓ Saved ${cookies.length} cookies to cookies.json`);

  await browser.close();
})();