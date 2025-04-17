const puppeteer = require('puppeteer');

// Target URL for testing
const TEST_URL = 'https://glama.ai/mcp/servers/@translated/lara-mcp';

async function testExtraction() {
  console.log('Starting test extraction...');
  let browser = null;
  
  try {
    // Launch browser
    console.log('Launching browser...');
    browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    // Open page
    const page = await browser.newPage();
    console.log(`Navigating to ${TEST_URL}`);
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded' });
    
    // Wait for content to load
    console.log('Waiting for content to load...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Extract the data we want to test
    console.log('Extracting data...');
    const extractedData = await page.evaluate(() => {
      const data = {};
      
      // Test author extraction
      const authorElement = document.querySelector('a[data-sentry-component="Link"], a[data-sentry-element="RemixLink"]');
      if (authorElement) {
        data.Author = authorElement.textContent.trim();
        data.AuthorUrl = authorElement.getAttribute('href');
        
        // Log additional details about the element for debugging
        data.debug = {
          authorElementTagName: authorElement.tagName,
          authorElementClasses: authorElement.className,
          authorElementAttributes: Object.entries(authorElement.attributes)
            .map(attr => `${attr[0]}: ${attr[1].value}`)
            .join(', ')
        };
      } else {
        data.Author = '';
        data.AuthorUrl = '';
        data.debug = { error: 'Author element not found' };
      }
      
      // Also grab page title for reference
      const titleElement = document.querySelector('h1');
      data.Title = titleElement ? titleElement.textContent.trim() : 'Unknown';
      
      return data;
    });
    
    // Log the results
    console.log('\nEXTRACTION RESULTS:');
    console.log('-------------------');
    console.log(`Title: ${extractedData.Title}`);
    console.log(`Author: ${extractedData.Author}`);
    console.log(`AuthorUrl: ${extractedData.AuthorUrl}`);
    console.log('\nDEBUG INFO:');
    console.log(extractedData.debug);
    
    
  } catch (error) {
    console.error('Error during extraction test:', error);
  } finally {
    // Close the browser
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
    console.log('Test completed.');
  }
}

// Run the test
testExtraction().catch(err => {
  console.error('Unhandled error:', err);
});