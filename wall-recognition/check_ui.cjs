// Optional browser smoke check: NODE_PATH must contain Playwright.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const output=path.join(__dirname,process.env.REVIEW_OUTPUT||'output/pipeline-v1');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:8766/');
    await page.locator('#detect:not([disabled])').waitFor();
    await page.locator('#detect').click();
    await page.locator('.opening-row').first().waitFor();
    const count=await page.locator('.opening-row').count();assert(count>0);
    await page.locator('#overlay-toggle').uncheck();
    await page.locator('.opening-row button').first().click();
    await page.locator('#toast').waitFor({state:'hidden'});
    const review=page.waitForResponse(r=>r.url().endsWith('/api/review-opening'));
    await page.locator('.opening-row select').first().selectOption('rejected');
    assert.equal((await review).status(),200);
    await page.waitForFunction(n=>document.querySelectorAll('.opening-hit').length===n,count-1);
    const undo=page.waitForResponse(r=>r.url().endsWith('/api/undo-edit'));
    await page.locator('#undo').click();await undo;
    await page.waitForFunction(n=>document.querySelectorAll('.opening-hit').length===n,count);
    await page.locator('#openings-toggle').uncheck();assert.equal(await page.locator('.opening-hit').count(),0);
    await page.locator('#openings-toggle').check();
    await page.locator('#overlay-toggle').check();
    // Existing wall modification remains usable with the new overlay enabled.
    await page.locator('#wall-layer .wall-label').first().click();
    await page.locator('#issue-type').selectOption('thickness');await page.locator('#amount').fill('12');
    const edit=page.waitForResponse(r=>r.url().endsWith('/api/apply-edit'));
    await page.locator('#add-issue').click();assert.equal((await edit).status(),200);
    await page.locator('#undo').click();await page.locator('#undo[disabled]').waitFor();
    // Extend a real sample wall through O002; the SVG must still have a hole.
    await page.locator('#wall-layer g[aria-hidden="true"]').filter({hasText:/^W005$/}).locator('.wall-label').click();
    await page.locator('#issue-type').selectOption('too_short');
    await page.locator('#direction').selectOption('right');await page.locator('#target').selectOption('W004');
    const extension=page.waitForResponse(r=>r.url().endsWith('/api/apply-edit'));
    await page.locator('#add-issue').click();const extended=await (await extension).json();
    assert(extended.document.walls.find(w=>w.id==='W005').opening_hints.length>0);
    const fillsGap=()=>page.locator('#wall-layer g[role="button"][aria-label^="W005"] .wall-shape').evaluateAll(nodes=>nodes.some(n=>{
      const b=n.getBBox();return b.x<345&&b.x+b.width>345;
    }));
    assert.equal(await fillsGap(),false);
    await page.locator('#opening-O002 select').selectOption('rejected');
    await page.locator('#opening-O002 small').filter({hasText:'已排除'}).waitFor();
    assert.equal(await fillsGap(),true);
    await page.locator('#undo').click();await page.locator('#opening-O002 small').filter({hasText:'待校核'}).waitFor();
    assert.equal(await fillsGap(),false);
    await page.locator('#undo').click();await page.locator('#undo[disabled]').waitFor();
    await page.locator('#clear-selection').click();
    await page.locator('#overlay-toggle').check();
    await page.locator('.opening-row button').first().click();
    await page.locator('#toast').waitFor({state:'hidden'});
    await page.screenshot({path:path.join(output,'page-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('.opening-row').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'page-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({opening_count:count,review_undo:true,wall_edit_undo:true,console_errors:errors}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
