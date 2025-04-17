const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configuration
const MAX_RETRIES = 2;
const DELAY_BETWEEN_REQUESTS = 5000;
const PAGE_LOAD_TIMEOUT = 30000;
const BROWSER_OPERATION_TIMEOUT = 60000; // 1 minute timeout for browser operations

// Output directory
const outputDir = 'servers-json';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
  console.log(`Created directory: ${outputDir}`);
}

// Add a timeout wrapper for browser operations
async function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId;
  
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout (${timeoutMs}ms): ${errorMessage}`));
    }, timeoutMs);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Function to process a single server
async function processServer(server, safeTitle, outputFilename) {
  let retryCount = 0;
  let success = false;
  
  // Retry logic with fresh browser for each attempt
  while (retryCount <= MAX_RETRIES && !success) {
    let serverBrowser = null;
    
    try {
      if (retryCount > 0) {
        console.log(`Retrying ${server.title} (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
      }
      
      // Launch a fresh browser for this server with timeout
      console.log(`Launching browser for ${server.title}...`);
      serverBrowser = await withTimeout(
        puppeteer.launch({ 
          headless: "new",
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }),
        BROWSER_OPERATION_TIMEOUT,
        'Browser launch timed out'
      );
      
      console.log(`Opening new page for ${server.title}...`);
      const page = await withTimeout(
        serverBrowser.newPage(),
        BROWSER_OPERATION_TIMEOUT,
        'New page creation timed out'
      );
      
      page.setDefaultNavigationTimeout(PAGE_LOAD_TIMEOUT);
      
      console.log(`Navigating to ${server.url}`);
      await withTimeout(
        page.goto(server.url, { waitUntil: 'domcontentloaded' }),
        PAGE_LOAD_TIMEOUT,
        `Navigation to ${server.url} timed out`
      );
      
      // Wait a moment for any dynamic content
      console.log(`Waiting for content to load for ${server.title}...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract information with timeout
      console.log(`Extracting data from ${server.title}...`);
      const serverData = await withTimeout(
        page.evaluate(() => {
          const data = {};
          
          // Basic information
          const titleElement = document.querySelector('h1');
          data.Name = titleElement ? titleElement.textContent.trim() : 'Unknown';
          
          // Description
          const descriptionElement = document.querySelector('.description, [data-sentry-component="Description"]');
          data.description = descriptionElement ? descriptionElement.textContent.trim() : '';
          

            // Author information
          const authorElement = document.querySelector('a[data-sentry-component="Link"], a[data-sentry-element="RemixLink"]');
          if (authorElement) {
            data.Author = authorElement.textContent.trim();
            data.AuthorUrl = authorElement.getAttribute('href');
          } else {
            data.author = '';
            data.authorUrl = '';
          }
          
          // GitHub URL
          const githubLinkElement = document.querySelector('a[href*="github.com"]');
          data.githubUrl = githubLinkElement ? githubLinkElement.getAttribute('href') : '';
          
          return data;
        }),
        BROWSER_OPERATION_TIMEOUT,
        `Data extraction timed out for ${server.title}`
      );
      
      // Add the URL to the data
      serverData.ScrapeSource = server.url;
      
      // Save the data
      console.log(`Saving data to ${outputFilename}`);
      fs.writeFileSync(outputFilename, JSON.stringify(serverData, null, 2));
      
      success = true;
      
    } catch (serverError) {
      retryCount++;
      console.log(`Error processing ${server.title}: ${serverError.message}`);
      
      if (retryCount > MAX_RETRIES) {
        console.log(`Failed to process ${server.title} after ${MAX_RETRIES + 1} attempts.`);
        
        // Save basic information about the failure
        const failedFilename = path.join(outputDir, `${safeTitle}-failed.json`);
        const basicData = {
          title: server.title,
          url: server.url,
          error: serverError.message,
          status: 'failed'
        };
        fs.writeFileSync(failedFilename, JSON.stringify(basicData, null, 2));
      }
    } finally {
      // Always close the browser for this attempt with a timeout
      if (serverBrowser) {
        try {
          console.log(`Closing browser for ${server.title}...`);
          await withTimeout(
            serverBrowser.close(),
            30000, // 30 second timeout for browser closing
            `Browser close operation timed out for ${server.title}`
          );
          console.log(`Successfully closed browser for ${server.title}`);
        } catch (closeError) {
          console.error(`Error closing browser for ${server.title}:`, closeError.message);
          console.log('Continuing to next server despite browser close error');
          
          // Force kill the browser process if it's hanging
          try {
            // This is a bit hacky but can help when the browser is stuck
            process.kill(serverBrowser.process().pid);
            console.log(`Forcefully killed browser process for ${server.title}`);
          } catch (killError) {
            console.error(`Could not kill browser process: ${killError.message}`);
          }
        }
      }
    }
  }
  
  return success;
}

// Main function to process server links from the file
async function processServerLinksFromFile() {
  try {
    // Read the server links from the file
    const linksFile = path.join(outputDir, 'server-links.json');
    
    if (!fs.existsSync(linksFile)) {
      console.error('Server links file not found:', linksFile);
      return;
    }
    
    console.log(`Reading server links from ${linksFile}...`);
    const fileData = fs.readFileSync(linksFile, 'utf8');
    const serverLinks = JSON.parse(fileData);
    
    console.log(`Found ${serverLinks.length} server links to process.`);
    
    // Process each server page
    let successCount = 0;
    let failureCount = 0;
    
    // Create a progress tracker file
    const progressFile = path.join(outputDir, 'progress.json');
    let progress = { lastProcessed: -1 };
    
    // Check if we have a progress file to resume from
    if (fs.existsSync(progressFile)) {
      try {
        const progressData = fs.readFileSync(progressFile, 'utf8');
        progress = JSON.parse(progressData);
        console.log(`Resuming from server index ${progress.lastProcessed + 1}`);
      } catch (progressError) {
        console.error('Error reading progress file:', progressError);
        console.log('Starting from the beginning.');
      }
    }
    
    // Add a quick skip option if needed
    const startFromIndex = progress.lastProcessed + 1;
    
    // Start processing from where we left off
    for (let i = startFromIndex; i < serverLinks.length; i++) {
      const server = serverLinks[i];
      console.log(`\n--- Processing server ${i+1}/${serverLinks.length}: ${server.title} ---`);
      
      if (!server.url) {
        console.log(`Skipping server with no URL: ${server.title}`);
        failureCount++;
        continue;
      }
      
      // Create a safe filename from the server title
      const theTitle = server.title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const filename = path.join(outputDir, `${theTitle}.json`);
      
      // Skip if already processed successfully
      if (fs.existsSync(filename)) {
        console.log(`Server ${server.title} already processed. Skipping.`);
        successCount++;
        continue;
      }
      
      try {
        // Set a timeout for the entire server processing operation
        let timeoutId = setTimeout(() => {
          console.error(`\n!!! TIMEOUT: Processing of server ${server.title} took too long (3 minutes). Moving to next server. !!!`);
          
          // Mark this as failed
          const failedFilename = path.join(outputDir, `${theTitle}-timeout-failed.json`);
          const timeoutData = {
            title: server.title,
            url: server.url,
            error: "Processing timed out after 3 minutes",
            status: 'failed'
          };
          fs.writeFileSync(failedFilename, JSON.stringify(timeoutData, null, 2));
          
          // Update progress and move to next server
          progress.lastProcessed = i;
          fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
          
          // This doesn't actually stop the operation, but we'll skip to the next iteration
          // We'd need to restructure using async/await with AbortController for true cancellation
        }, 180000); // 3 minute timeout for entire server processing
        
        // Process this server
        let success = await processServer(server, theTitle, filename);
        
        // Clear the timeout since we completed successfully
        clearTimeout(timeoutId);
        
        if (success) {
          successCount++;
        } else {
          failureCount++;
        }
      } catch (processingError) {
        console.error(`Unexpected error processing server ${server.title}:`, processingError);
        failureCount++;
      }
      
      // Update progress
      progress.lastProcessed = i;
      fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
      
      // Wait between requests
      if (i < serverLinks.length - 1) {
        console.log(`Waiting ${DELAY_BETWEEN_REQUESTS/1000} seconds before next request...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      }
    }
    
    console.log(`\nScraping completed with ${successCount} successes and ${failureCount} failures.`);
    
  } catch (error) {
    console.error('Error processing server links:', error);
  }
}

// Run the main function
console.log('Starting to process server links from file...');
processServerLinksFromFile().catch(err => {
  console.error('Unhandled error:', err);
});