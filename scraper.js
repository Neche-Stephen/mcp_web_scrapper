const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Create output directory
const outputDir = 'servers-json';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
  console.log(`Created directory: ${outputDir}`);
}

async function collectServerLinks() {
  console.log('Starting to collect server links...');
  
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null
  });
  
  let serverLinks = [];
  
  try {
    const page = await browser.newPage();
    
    // Navigate to the website
    console.log('Navigating to the website...');
    await page.goto('https://glama.ai/mcp/servers', { 
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    console.log('Starting to load all servers...');
    
    // Here is clicking the "load more" button until it's no longer visible
    let buttonVisible = true;
    let clickCount = 0;
    
    while (buttonVisible) {
      try {
        // Check if the button exists and is visible
        const loadMoreButtonExists = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const loadMoreButton = buttons.find(button => 
            button.textContent.trim() === 'Load More'
          );
          
          return loadMoreButton && 
                 window.getComputedStyle(loadMoreButton).display !== 'none' && 
                 window.getComputedStyle(loadMoreButton).visibility !== 'hidden';
        });
        
        if (loadMoreButtonExists) {
          // Click the button
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const loadMoreButton = buttons.find(button => 
              button.textContent.trim() === 'Load More'
            );
            if (loadMoreButton) loadMoreButton.click();
          });
          
          clickCount++;
          console.log(`Clicked "Load More" button ${clickCount} times`);
          
          // Wait for new content to load
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          buttonVisible = false;
          console.log('No more "Load More" button found. All servers should be loaded.');
        }
      } catch (clickError) {
        console.error('Error during "Load More" clicking:', clickError);
        buttonVisible = false; // Stop trying if errors occur
      }
    }
    
    console.log('Complete! All servers have been loaded.');
    
    console.log('Waiting for server cards...');
    try {
      await page.waitForSelector('article[data-sentry-component="McpServerCard"]', { timeout: 10000 });
      
      console.log('Collecting server URLs and Title...');
      serverLinks = await page.evaluate(() => {
        const serverCards = document.querySelectorAll('article[data-sentry-component="McpServerCard"]');
        console.log("Found server cards:", serverCards.length);
        
        return Array.from(serverCards).map(card => {
          const titleElement = card.querySelector('h2 a');
          const title = titleElement ? titleElement.textContent.trim() : 'Unknown';
          const serverUrl = titleElement ? titleElement.getAttribute('href') : '';
          
          return {
            title,
            url: serverUrl ? `https://glama.ai${serverUrl}` : ''
          };
        }).filter(server => server.url !== '');
      });
      
      console.log(`Found ${serverLinks.length} server links to process`);
      
      // Save the links to a file
      const linksFile = path.join(outputDir, 'server-links.json');
      fs.writeFileSync(linksFile, JSON.stringify(serverLinks, null, 2));
      console.log(`Server links saved to ${linksFile}`);
      
    } catch (selectorError) {
      console.error('Error finding server cards:', selectorError);
    }
  } catch (mainError) {
    console.error('Error in main collection process:', mainError);
  } finally {
    console.log('Closing browser...');
    await browser.close();
    console.log('Browser closed.');
  }
  
  return serverLinks;
}

// Main function to run the scraper
async function main() {
  try {
    let serverLinks = [];
    
    serverLinks = await collectServerLinks();

    if (serverLinks.length === 0) {
      console.log('No server links found to process. Exiting.');
      return;
    }
    
  } catch (error) {
    console.error('Fatal error in main function:', error);
  }
}

// Run the main function
main().catch(err => {
  console.error('Unhandled error in main function:', err);
});


  