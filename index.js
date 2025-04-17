const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Some Configuration stuff to help control flow
const MAX_RETRIES = 2;
const DELAY_BETWEEN_REQUESTS = 5000; 
const PAGE_LOAD_TIMEOUT = 90000; 

async function scrapeMcpServers() {
  let browser;
  try {
    
    const outputDir = 'servers-json'; // This is where the JSON files for each server will be saved
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
      console.log(`Created directory: ${outputDir}`);
    }

    browser = await puppeteer.launch({ 
      headless: "new",
    });
    
    // Create a new page
    const page = await browser.newPage();
    
    // SetTING longer timeouts
    page.setDefaultNavigationTimeout(PAGE_LOAD_TIMEOUT);
    page.setDefaultTimeout(30000);


    console.log('Navigating to glama.ai/mcp/servers...');
    

    await page.goto('https://glama.ai/mcp/servers', { 
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT
    });
    
    console.log('Waiting for server cards...');
    await page.waitForSelector('article[data-sentry-component="McpServerCard"]', { timeout: 30000 });
    
    console.log('Collecting server URLs and Title...');
    const serverLinks = await page.evaluate(() => {
      const serverCards = document.querySelectorAll('article[data-sentry-component="McpServerCard"]');
      
      return Array.from(serverCards).map(card => {
        // Extract the title
        const titleElement = card.querySelector('h2 a');
        const title = titleElement ? titleElement.textContent.trim() : 'Unknown';
        
        // Extract the server URL
        const serverUrl = titleElement ? titleElement.getAttribute('href') : '';
        
        return {
          title,
          url: serverUrl ? `https://glama.ai${serverUrl}` : ''
        };
      }).filter(server => server.url !== '');
    });
    
    console.log(`Found ${serverLinks.length} server links to process`);
    
    // Process each server page one by one
    let successCount = 0; // Number that was succesfull
    let failureCount = 0; // Number that failed
    
    for (let i = 0; i < serverLinks.length; i++) {
      const server = serverLinks[i];
      console.log(`Processing server ${i+1}/${serverLinks.length}: ${server.title}`);
      
      if (!server.url) {
        console.log(`Skipping server with no URL: ${server.title}`);
        failureCount++;
        continue;
      }
      
      let retryCount = 0; // number of times to retry scrapping this server
      let success = false; // whether the scraping was successful
    
      // Retry logic for each server - this logic will retry the server if it fails to load
      while (retryCount <= MAX_RETRIES && !success) {
        try {
          if (retryCount > 0) {
            console.log(`Retrying ${server.title} (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
          }
          
          console.log(`Navigating to ${server.url}`);
          
          await page.goto(server.url, { 
            waitUntil: 'domcontentloaded',
            timeout: PAGE_LOAD_TIMEOUT
          });
          
          // Waiting an additional moment for content to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          
          // Extract information
          const serverData = await page.evaluate(() => {
            // An object to store all the data
            const data = {};
            
            // Basic information
            const titleElement = document.querySelector('h1');
            data.title = titleElement ? titleElement.textContent.trim() : 'Unknown';
            
            // Description
            const descriptionElement = document.querySelector('.description, [data-sentry-component="Description"]');
            data.description = descriptionElement ? descriptionElement.textContent.trim() : '';
            
            // Author information
            const authorElement = document.querySelector('[data-sentry-component="AuthorInfo"] a, .author-info a');
            data.author = authorElement ? authorElement.textContent.trim() : '';
            
            // GitHub URL
            const githubLinkElement = document.querySelector('a[href*="github.com"]');
            data.githubUrl = githubLinkElement ? githubLinkElement.getAttribute('href') : '';

            return data;
            
    
          });
          
          
          // Creating filename from title
          const theTitle = server.title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
          const filename = path.join(outputDir, `${theTitle}.json`);
          
          // Save the data
          console.log(`Saving data to ${filename}`);
          fs.writeFileSync(filename, JSON.stringify(serverData, null, 2));
          
          success = true;
          successCount++;
          
        } catch (serverError) {
          retryCount++;
          console.log(`Error processing ${server.title}: ${serverError.message}`);
          
          if (retryCount > MAX_RETRIES) {
            console.log(`Failed to process ${server.title} after ${MAX_RETRIES + 1} attempts.`);
            failureCount++;
            
            // Save basic information to show the server was found but failed to process
            const theTitle = server.title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            const filename = path.join(outputDir, `${theTitle}-failed.json`);
            const basicData = {
              title: server.title,
              error: serverError.message,
              status: 'failed'
            };
            fs.writeFileSync(filename, JSON.stringify(basicData, null, 2));
          }
        }
      }
      
      // Wait between requests whether success or failure
      console.log(`Waiting ${DELAY_BETWEEN_REQUESTS/1000} seconds before next request...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
    }
    
    console.log(`\nScraping completed with ${successCount} successes and ${failureCount} failures.`);
    
    console.log('Closing browser...');
    await browser.close();
    console.log('Browser closed');
    
  } catch (error) {
    console.error('Error in main scraping process:', error);
    
    if (browser) {
      try {
        await browser.close();
        console.log('Browser closed after error');
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
    }
  }
}

scrapeMcpServers();

