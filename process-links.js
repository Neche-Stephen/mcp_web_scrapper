const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);
const toml = require("@iarna/toml"); // For parsing pyproject.toml

// Configuration
const MAX_RETRIES = 2;
const DELAY_BETWEEN_REQUESTS = 5000;
const PAGE_LOAD_TIMEOUT = 45000;
const BROWSER_OPERATION_TIMEOUT = 60000;
const TOOL_PAGE_TIMEOUT = 40000;

// Output directory
const outputDir = "servers-json";
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
  console.log(`Created directory: ${outputDir}`);
}

// Function to create filename from GitHub URL
function createFilenameFromSourceUrl(serverData, fallbackTitle) {
  try {
    // Check if we have a source_url from GitHub
    if (
      serverData &&
      serverData.source_url &&
      serverData.source_url.includes("github.com")
    ) {
      // Parse GitHub URL to extract username and repo
      const url = new URL(serverData.source_url);
      const pathParts = url.pathname
        .split("/")
        .filter((part) => part.length > 0);

      if (pathParts.length >= 2) {
        const username = pathParts[0];
        const repoName = pathParts[1];

        // Create filename in the requested format
        return `github.com@${username}@${repoName}.json`;
      }
    }

    // Fallback to using the title if no valid GitHub URL is available
    return `${fallbackTitle.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.json`;
  } catch (error) {
    console.warn(`Error creating filename from source URL: ${error.message}`);
    // Fallback to the original title-based naming
    return `${fallbackTitle.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.json`;
  }
}

// Add a timeout wrapper for browser operations
// This function will create a race between the provided promise and a timeout
// If the timeout wins, it rejects with an error message
// If the original promise completes first, it returns the result
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

// Simple sleep function
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to clone and extract repository metadata
async function extractRepoMetadata(serverData) {
  console.log("Extracting version and keywords from repository...");
  serverData.version = "";
  serverData.keywords = [];

  try {
    if (serverData.source_url && serverData.source_url.includes("github.com")) {
      const repoUrl = serverData.source_url;
      const tempDir = path.join(
        __dirname,
        "temp_repos",
        serverData.name.replace(/[^a-z0-9]/gi, "_")
      );

      // Create temp directory if it doesn't exist
      if (!fs.existsSync(path.join(__dirname, "temp_repos"))) {
        fs.mkdirSync(path.join(__dirname, "temp_repos"));
      }

      // Clone repository with timeout
      console.log(`Cloning repository from ${repoUrl}...`);
      await withTimeout(
        exec(`git clone ${repoUrl} ${tempDir}`),
        300000, // 5 minute timeout for cloning
        "Repository cloning timed out"
      );

      // Check for Node.js project
      const packageJsonPath = path.join(tempDir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        console.log("Found package.json - Node.js project");
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf8")
        );
        serverData.version = packageJson.version || "";
        serverData.keywords = packageJson.keywords || [];
      }
      // Check for Python project
      else {
        const pyprojectPath = path.join(tempDir, "pyproject.toml");
        if (fs.existsSync(pyprojectPath)) {
          console.log("Found pyproject.toml - Python project");
          const pyprojectContent = fs.readFileSync(pyprojectPath, "utf8");
          const pyproject = toml.parse(pyprojectContent);
          serverData.version = pyproject?.project?.version || "";
          serverData.keywords = pyproject?.project?.keywords || [];
        }
      }

      // Clean up
      console.log("Cleaning up temporary repository...");
      await exec(`rm -rf ${tempDir}`);
    }
  } catch (err) {
    console.warn("Error extracting repository metadata:", err.message);
  }

  return serverData;
}

// Function to process a single server
async function processServer(server, safeTitle, outputFilename) {
  let retryCount = 0;
  let success = false;
  let serverData = null;

  // Retry logic with fresh browser for each attempt to process a server
  while (retryCount <= MAX_RETRIES && !success) {
    let serverBrowser = null;

    try {
      if (retryCount > 0) {
        console.log(
          `Retrying ${server.title} (Attempt ${retryCount + 1}/${
            MAX_RETRIES + 1
          })...`
        );
      }

      // Launch a fresh browser for this server with timeout
      console.log(`Launching browser for ${server.title}...`);
      serverBrowser = await withTimeout(
        puppeteer.launch({
          headless: "new",
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage", // Added for stability
            "--disable-gpu", // Added for stability
          ],
        }),
        BROWSER_OPERATION_TIMEOUT,
        "Browser launch timed out"
      );

      console.log(`Opening new page for ${server.title}...`);
      const page = await withTimeout(
        serverBrowser.newPage(),
        BROWSER_OPERATION_TIMEOUT,
        "New page creation timed out"
      );

      // Set viewport size for more stable rendering
      await page.setViewport({ width: 1280, height: 800 });

      // Set request interception to abort requesting for non-essential resources
      await page.setRequestInterception(true); // Turns on request interception to pause every request the page wants to make
      page.on("request", (req) => {
        // Listens for every single network request the page tries to make.
        const resourceType = req.resourceType(); // What kind of resource is this?
        if (
          resourceType === "image" ||
          resourceType === "font" ||
          resourceType === "media"
        ) {
          req.abort(); // Don't load this
        } else {
          req.continue(); // Let it load
        }
      });

      // Set a time limit for how long Puppeteer will wait for a page to load when using navigation methods
      page.setDefaultNavigationTimeout(PAGE_LOAD_TIMEOUT);

      console.log(`Navigating to ${server.url}`);

      // Go to the server URL with timeout
      await withTimeout(
        page.goto(server.url, { waitUntil: "domcontentloaded" }),
        PAGE_LOAD_TIMEOUT,
        `Navigation to ${server.url} timed out`
      );

      // Wait a moment for any dynamic content
      console.log(`Waiting for content to load for ${server.title}...`);
      await sleep(2000);

      // Extract information with timeout
      console.log(`Extracting data from ${server.title}...`);

      // Begin to extract data from the page - except tools, which will be handled separately
      serverData = await withTimeout(
        page.evaluate(async () => {
          // Helper function to wait for element
          const waitFor = (selector, timeout = 1000) => {
            return new Promise((resolve) => {
              const endTime = Date.now() + timeout;
              const check = () => {
                const el = document.querySelector(selector);
                if (el) return resolve(el);
                if (Date.now() < endTime) {
                  setTimeout(check, 100);
                } else {
                  resolve(null);
                }
              };
              check();
            });
          };

          const data = {};

          // Extract Name of Server
          const titleElement = document.querySelector("h1");
          data.name = titleElement
            ? titleElement.textContent.trim()
            : "Unknown";

          // Extract Author information
          const authorElement = document.querySelector(
            "a.bejlTa.bhFGkb.BdEWC.jEevvj.jClhju.koJNIU.iWtjzs.iVlkKm.bUvkqG.efWClb.gxojcW.jsLxaN.bZRhvx.JAEma.gXlbfc.bXBpoe.ecmYYS.bVhrBr.fLteVe.ghwNBd"
          );
          if (authorElement) {
            data.author = authorElement.textContent.trim();
            data.author_url = authorElement.getAttribute("href");
          } else {
            data.author = "";
            data.authorUrl = "";
          }

          // Extract Category
          const categoryElement = document.querySelector(
            'a[data-sentry-element="RemixLink"][href^="/mcp/servers/categories/"]'
          );
          data.category = categoryElement
            ? categoryElement.textContent.trim()
            : "";

          // Extract License
          const licenseElement = document.querySelector(
            'div[data-sentry-component="License"]'
          );
          data.license = licenseElement
            ? licenseElement.textContent.trim()
            : "";

          // Extract Package and Source URLs
          const linksContainer = document.querySelector(
            "div.fPSBzf.bAasmd.dAaUHp"
          );

          // Initialize both as empty
          data.package_url = "";
          data.source_url = "";

          if (linksContainer) {
            const iconLinks = Array.from(
              linksContainer.querySelectorAll('a[target="_blank"]:has(svg)')
            );

            // Check each link to determine if it's npm (package) or GitHub (source)
            iconLinks.forEach((link) => {
              const url = link.href;

              // Check for npm URL
              if (url.includes("npmjs.com")) {
                data.package_url = url;
              }
              // Check for GitHub URL
              else if (url.includes("github.com")) {
                data.source_url = url;
              }
            });
          }

          // Extract Language
          const languageElement = document.querySelector(
            'div[data-sentry-component="RepositoryLanguageAttribute"] a'
          );
          data.language = languageElement
            ? languageElement.textContent.trim()
            : "";

          // Extract Server Configuration
          try {
            // Handle Schema tab click before extracting table data
            const schemaTab = await waitFor('a[href*="/schema"]');
            if (schemaTab) {
              schemaTab.click();

              // Wait for table to load
              const configTable = await waitFor(
                'table[data-sentry-component="McpServerArgumentsJsonSchema"]',
                2000
              );

              if (configTable) {
                data.server_configuration = Array.from(
                  configTable.querySelectorAll("tbody tr")
                ).map((row) => {
                  const cells = row.querySelectorAll("td");
                  return {
                    name:
                      cells[0]?.querySelector("var")?.textContent.trim() || "",
                    required: cells[1]?.textContent.trim() || "",
                    description: cells[2]?.textContent.trim() || "",
                    default: cells[3]?.textContent.trim() || "",
                  };
                });
              } else {
                data.server_configuration = [];
                console.warn(
                  "Configuration table not found after clicking Schema"
                );
              }
            } else {
              data.server_configuration = [];
              console.warn("Schema tab not found");
            }
          } catch (err) {
            data.server_configuration = [];
            console.warn("Error during Schema tab interaction:", err);
          }

          return data;
        }),
        BROWSER_OPERATION_TIMEOUT,
        `Data extraction timed out for ${server.title}`
      );

      // Extract tools

      // Initialize tools array
      serverData.tools = [];
      // Extract tool links before starting tool processing
      const toolLinks = await page.$$eval(
        'table[data-sentry-element="Table.Root"] a[href*="/tools/"]',
        (links) =>
          links.map((link) => ({
            name: link.textContent.trim(),
            href: link.href,
          }))
      );

      console.log(`Found ${toolLinks.length} tools for ${server.title}`);

      // Determine the proper filename format with the source_url
      const githubFilename = createFilenameFromSourceUrl(
        serverData,
        server.title
      );
      const finalOutputFilename = path.join(outputDir, githubFilename);

      // Update the output filename to use the GitHub-based format
      outputFilename = finalOutputFilename;

      // Process each tool individually with its own error handling
      for (const tool of toolLinks) {
        try {
          console.log(`Processing tool: ${tool.name}`);

          // Navigation with explicit timeout for tool pages
          await withTimeout(
            page.goto(tool.href, { waitUntil: "domcontentloaded" }),
            TOOL_PAGE_TIMEOUT,
            `Navigation to tool page ${tool.href} timed out`
          );

          // Wait a bit for content to load (using the sleep function instead of waitForTimeout)
          await sleep(1500);

          const toolData = await page.evaluate(() => {
            // Get description (from the first prose div after the main title)
            const getDescription = () => {
              const descriptionDiv = document.querySelector(
                "main#tool h2 + div.prose"
              );
              return descriptionDiv?.textContent.trim() || "";
            };

            // Get instructions (from the section with h3 "Instructions")
            const getInstructions = () => {
              const instructionsSection = Array.from(
                document.querySelectorAll("section")
              ).find((section) => {
                const h3 = section.querySelector("h3");
                return h3 && h3.textContent.includes("Instructions");
              });

              if (!instructionsSection) return "";

              // Check for list format
              const ol = instructionsSection.querySelector("ol");
              if (ol) {
                return Array.from(ol.querySelectorAll("li"))
                  .map((li) => li.textContent.trim())
                  .join("\n");
              }

              // Check for paragraph format
              const prose = instructionsSection.querySelector(".prose");
              if (prose) {
                return prose.textContent.trim();
              }

              return "";
            };

            // JSON Schema extraction
            const getJsonSchema = () => {
              const schemaElement = document.evaluate(
                "//h3[contains(., 'Input Schema')]/following-sibling::div//div[contains(@class, 'gFWrJr')]",
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
              ).singleNodeValue;

              return (
                schemaElement?.textContent.replace(/\s+/g, " ").trim() || ""
              );
            };

            return {
              description: getDescription(),
              instructions: getInstructions(),
              jsonSchema: getJsonSchema(),
            };
          });

          // Add tool data (object) to the tools key (array) of serverData object
          serverData.tools.push({
            name: tool.name,
            ...toolData,
          });

          // Save partial data after each successful tool using the GitHub-based filename
          const partialFilename = path.join(
            outputDir,
            `${githubFilename.replace(".json", "")}-partial.json`
          );
          fs.writeFileSync(
            partialFilename,
            JSON.stringify(serverData, null, 2)
          );
        } catch (toolError) {
          console.warn(
            `Error processing tool ${tool.name}:`,
            toolError.message
          );

          // Add error info to the tools array but continue processing
          serverData.tools.push({
            name: tool.name,
            error: toolError.message,
            partial_data: true,
          });

          // Save partial data after each error using the GitHub-based filename
          const partialFilename = path.join(
            outputDir,
            `${githubFilename.replace(".json", "")}-partial.json`
          );
          fs.writeFileSync(
            partialFilename,
            JSON.stringify(serverData, null, 2)
          );
        }

        // Navigate back to the server page after each tool (whether successful or not)
        try {
          await withTimeout(
            page.goto(server.url, { waitUntil: "domcontentloaded" }),
            PAGE_LOAD_TIMEOUT,
            `Navigation back to server page timed out after tool ${tool.name}`
          );

          // Wait for the tools table to be visible again
          try {
            await page.waitForSelector(
              'table[data-sentry-element="Table.Root"]',
              { timeout: 10000 }
            );
          } catch (selectorError) {
            // console.log("Table selector not found after navigation back");
          }
        } catch (navigationError) {
          console.warn(
            `Error navigating back after tool ${tool.name}:`,
            navigationError.message
          );

          // If navigation back fails, try once more from fresh
          try {
            await page.goto(server.url, { waitUntil: "domcontentloaded" });
            await sleep(2000); // Give it a moment to load
          } catch (retryNavError) {
            console.error(
              `Failed to navigate back after tool ${tool.name}, skipping remaining tools`
            );
            break; // Exit the tool processing loop
          }
        }

        // Wait between tool requests
        await sleep(1000);
      }

      // Add the URL to the data
      serverData.scrape_source = server.url;

      // Extract version and keywords from repository if available
      if (serverData.source_url) {
        try {
          serverData = await extractRepoMetadata(serverData);
        } catch (metadataError) {
          console.warn(
            "Failed to extract repository metadata:",
            metadataError.message
          );
          serverData.version = "";
          serverData.keywords = [];
        }
      } else {
        serverData.version = "";
        serverData.keywords = [];
      }

      // Save the final data with the GitHub-based filename
      console.log(`Saving data to ${outputFilename}`);
      fs.writeFileSync(outputFilename, JSON.stringify(serverData, null, 2));

      // Cleanup partial file
      try {
        const partialFilename = path.join(
          outputDir,
          `${githubFilename.replace(".json", "")}-partial.json`
        );
        if (fs.existsSync(partialFilename)) {
          fs.unlinkSync(partialFilename); // Delete the partial file
          console.log(`Removed partial backup: ${partialFilename}`);
        }

        // Also clean up any original temporary files
        const tempFilename = path.join(outputDir, `${safeTitle}-partial.json`);
        if (fs.existsSync(tempFilename)) {
          fs.unlinkSync(tempFilename);
          console.log(`Removed old temp file: ${tempFilename}`);
        }
      } catch (cleanupErr) {
        console.warn(`Could not delete partial file: ${cleanupErr.message}`);
      }

      success = true;
    } catch (serverError) {
      retryCount++;
      console.log(`Error processing ${server.title}: ${serverError.message}`);

      // Save partial data if we have any
      if (serverData) {
        // Determine the proper filename format for partial data
        const githubFilename = serverData.source_url
          ? createFilenameFromSourceUrl(serverData, server.title)
          : `${safeTitle}.json`;

        const partialFilename = path.join(
          outputDir,
          `${githubFilename.replace(".json", "")}-partial.json`
        );

        serverData.partial_data = true;
        serverData.error = serverError.message;
        fs.writeFileSync(partialFilename, JSON.stringify(serverData, null, 2));
        console.log(`Saved partial data to ${partialFilename}`);
      }

      if (retryCount > MAX_RETRIES) {
        console.log(
          `Failed to process ${server.title} after ${MAX_RETRIES + 1} attempts.`
        );

        // Save basic information about the failure
        // Use title-based filename for failures since we might not have source_url
        const failedFilename = path.join(outputDir, `${safeTitle}-failed.json`);
        const basicData = {
          title: server.title,
          url: server.url,
          error: serverError.message,
          status: "failed",
          partial_data: !!serverData,
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
          console.error(
            `Error closing browser for ${server.title}:`,
            closeError.message
          );
          console.log("Continuing to next server despite browser close error");

          // Force kill the browser process if it's hanging
          try {
            // This is a bit hacky but can help when the browser is stuck
            process.kill(serverBrowser.process().pid);
            console.log(
              `Forcefully killed browser process for ${server.title}`
            );
          } catch (killError) {
            console.error(
              `Could not kill browser process: ${killError.message}`
            );
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
    const linksFile = path.join(outputDir, "server-links.json");

    if (!fs.existsSync(linksFile)) {
      console.error("Server links file not found:", linksFile);
      return;
    }

    console.log(`Reading server links from ${linksFile}...`);
    const fileData = fs.readFileSync(linksFile, "utf8");
    const serverLinks = JSON.parse(fileData);

    console.log(`Found ${serverLinks.length} server links to process.`);

    // Process each server page
    let successCount = 0;
    let failureCount = 0;
    let partialCount = 0;

    // Create a progress tracker file
    const progressFile = path.join(outputDir, "progress.json");
    let progress = {
      lastProcessed: -1,
      processed: {},
      stats: { success: 0, failure: 0, partial: 0 },
    };

    // Check if we have a progress file to resume from
    if (fs.existsSync(progressFile)) {
      try {
        const progressData = fs.readFileSync(progressFile, "utf8");
        progress = JSON.parse(progressData);
        console.log(`Resuming from server index ${progress.lastProcessed + 1}`);
        successCount = progress.stats.success || 0;
        failureCount = progress.stats.failure || 0;
        partialCount = progress.stats.partial || 0;
      } catch (progressError) {
        console.error("Error reading progress file:", progressError);
        console.log("Starting from the beginning.");
      }
    }

    // Start processing from where we left off
    const startFromIndex = progress.lastProcessed + 1;

    // Start processing from where we left off
    for (let i = startFromIndex; i < serverLinks.length; i++) {
      const server = serverLinks[i];
      console.log(
        `\n--- Processing server ${i + 1}/${serverLinks.length}: ${
          server.title
        } ---`
      );

      if (!server.url) {
        console.log(`Skipping server with no URL: ${server.title}`);
        failureCount++;
        progress.processed[server.title] = "skipped";
        continue;
      }

      // Create a safe temporary filename from the server title
      const safeTitle = server.title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      const tempFilename = path.join(outputDir, `${safeTitle}.json`);

      // Check if we've already processed this server in our progress
      if (progress.processed[server.title] === "complete") {
        console.log(
          `Server ${server.title} already processed according to progress. Skipping.`
        );
        successCount++;
        continue;
      }

      try {
        // Set a timeout for the entire server processing operation
        const serverTimeoutMs = 960000;
        const serverTimeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            const timeoutError = new Error(
              `Processing timed out after ${serverTimeoutMs / 60000} minutes`
            );
            timeoutError.isServerTimeout = true;
            reject(timeoutError);
          }, serverTimeoutMs);
        });

        // Race the server processing against the timeout
        let success = false;
        let raceError;
        try {
          // Using Promise.race to handle timeout
          success = await Promise.race([
            processServer(server, safeTitle, tempFilename),
            serverTimeoutPromise,
          ]);
        } catch (error) {
          raceError = error;
          if (raceError && raceError.isServerTimeout) {
            console.error(
              `\n!!! TIMEOUT: Processing of server ${
                server.title
              } took too long (${
                serverTimeoutMs / 60000
              } minutes). !!! \n Moving to next server. !!!`
            );

            // Mark this as failed with timeout
            const failedFilename = path.join(
              outputDir,
              `${safeTitle}-timeout-failed.json`
            );
            const timeoutData = {
              title: server.title,
              url: server.url,
              error: raceError.message,
              status: "timeout-failed",
            };
            fs.writeFileSync(
              failedFilename,
              JSON.stringify(timeoutData, null, 2)
            );

            failureCount++;
            progress.processed[server.title] = "timeout";
          } else {
            throw raceError; // Re-throw if it's not our timeout error
          }
        }

        if (success) {
          successCount++;
          progress.processed[server.title] = "complete";
        } else if (!raceError?.isServerTimeout) {
          // Only mark as failed if it wasn't a timeout (already handled)
          failureCount++;
          progress.processed[server.title] = "failed";
        }
      } catch (processingError) {
        console.error(
          `Unexpected error processing server ${server.title}:`,
          processingError
        );
        failureCount++;
        progress.processed[server.title] = "error";
      }

      // Update progress
      progress.lastProcessed = i;
      progress.stats = {
        success: successCount,
        failure: failureCount,
        partial: partialCount,
      };
      fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));

      // Wait between requests
      if (i < serverLinks.length - 1) {
        console.log(
          `Waiting ${
            DELAY_BETWEEN_REQUESTS / 1000
          } seconds before next request...`
        );
        await sleep(DELAY_BETWEEN_REQUESTS);
      }
    }

    console.log(
      `\nScraping completed with ${successCount} successes, ${partialCount} partials, and ${failureCount} failures.`
    );
  } catch (error) {
    console.error("Error processing server links:", error);
  }
}

// Run the main function
console.log("Starting to process server links from file...");
processServerLinksFromFile().catch((err) => {
  console.error("Unhandled error:", err);
});
