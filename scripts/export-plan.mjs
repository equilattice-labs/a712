import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(root, 'website/public/docs/business-plan.html')).href, { waitUntil: 'networkidle' });
  await page.pdf({
    path: path.join(root, 'docs/Voxcora-Business-Plan.pdf'),
    format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;padding:0 18mm;display:flex;justify-content:space-between;font:8px Arial;color:#6a7c6c"><span>Voxcora 路 BUSINESS & EXECUTION PLAN 路 SEPTEMBER 2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  console.log('Exported docs/Voxcora-Business-Plan.pdf');
} finally { await browser.close(); }

