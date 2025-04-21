const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);
const toml = require("@iarna/toml"); // For parsing pyproject.toml

// Target URL for testing
const TEST_URL = "https://glama.ai/mcp/servers/@translated/lara-mcp";
// const TEST_URL = "https://glama.ai/mcp/servers/@ThetaBird/mcp-server-axiom-js";
// const TEST_URL = "https://glama.ai/mcp/servers/@oxylabs/oxylabs-mcp";

async function testExtraction() {
  console.log("Starting test extraction...");
  let browser = null;

  try {
    // Launch browser
    console.log("Launching browser...");
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Open page
    const page = await browser.newPage();
    console.log(`Navigating to ${TEST_URL}`);
    await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });

    // Wait for content to load
    console.log("Waiting for content to load...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Extract the data we want to test
    console.log("Extracting data...");
    const extractedData = await page.evaluate(async () => {
      const data = {};

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

      // Author
      const authorElement = document.querySelector(
        "a.bejlTa.bhFGkb.BdEWC.jEevvj.jClhju.koJNIU.iWtjzs.iVlkKm.bUvkqG.efWClb.gxojcW.jsLxaN.bZRhvx.JAEma.gXlbfc.bXBpoe.ecmYYS.bVhrBr.fLteVe.ghwNBd"
      );

      if (authorElement) {
        data.Author = authorElement.textContent.trim();
        data.AuthorUrl = authorElement.getAttribute("href");
      } else {
        data.Author = "";
        data.AuthorUrl = "";
        data.debug = { error: "Author element not found" };
      }
      // Category
      const categoryElement = document.querySelector(
        'a[data-sentry-element="RemixLink"][href^="/mcp/servers/categories/"]'
      );
      data.category = categoryElement ? categoryElement.textContent.trim() : "";

      // License extraction (new)
      const licenseElement = document.querySelector(
        'div[data-sentry-component="License"]'
      );
      data.license = licenseElement ? licenseElement.textContent.trim() : "";

      // Package and Source URLs

      // Find the container div that holds links containg both package and source URLs
      const linksContainer = document.querySelector("div.fPSBzf.bAasmd.dAaUHp");

      // Get all external links WITHIN this container that have SVG icons
      const iconLinks = linksContainer
        ? Array.from(
            linksContainer.querySelectorAll('a[target="_blank"]:has(svg)')
          )
        : [];

      // Extract just the URLs from these links
      const iconUrls = iconLinks.map((link) => link.href);

      // Assign URLs based on position (first = package, second = source)
      data.package_url = iconUrls[0] || "";
      data.source_url = iconUrls[1] || "";

      // Language
      const languageElement = document.querySelector(
        'div[data-sentry-component="RepositoryLanguageAttribute"] a'
      );
      data.language = languageElement ? languageElement.textContent.trim() : "";

      // Server Configuration (added here)

      // Handle Schema tab click and table extraction
      try {
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
                name: cells[0]?.querySelector("var")?.textContent.trim() || "",
                required: cells[1]?.textContent.trim() || "",
                description: cells[2]?.textContent.trim() || "",
                default: cells[3]?.textContent.trim() || "",
              };
            });
          } else {
            data.server_configuration = [];
            console.warn("Configuration table not found after clicking Schema");
          }
        } else {
          data.server_configuration = [];
          console.warn("Schema tab not found");
        }
      } catch (err) {
        data.server_configuration = [];
        console.warn("Error during Schema tab interaction:", err);
      }

      // Also grab page title for reference
      const titleElement = document.querySelector("h1");
      data.Title = titleElement ? titleElement.textContent.trim() : "Unknown";

      return data;
    });

    extractedData.tools = [];

    try {
      const toolLinks = await page.$$eval(
        'table[data-sentry-element="Table.Root"] a[href*="/tools/"]',
        (links) =>
          links.map((link) => ({
            name: link.textContent.trim(),
            href: link.href,
          }))
      );

      for (const tool of toolLinks) {
        try {
          await page.goto(tool.href, { waitUntil: "networkidle0" });

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

            // RESTORE THE WORKING JSON SCHEMA EXTRACTION
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

          extractedData.tools.push({
            name: tool.name,
            ...toolData,
          });

          await page.goBack({ waitUntil: "networkidle0" });
          await page.waitForSelector('table[data-sentry-element="Table.Root"]');
        } catch (err) {
          console.warn(`Error processing tool ${tool.name}:`, err);
          extractedData.tools.push({
            name: tool.name,
            error: err.message,
          });
        }
      }
    } catch (err) {
      console.warn("Error extracting tools:", err);
    }

    // Add version and keywords extraction
    console.log("Extracting version and keywords...");
    extractedData.version = "";
    extractedData.keywords = [];

    try {
      if (
        extractedData.source_url &&
        extractedData.source_url.includes("github.com")
      ) {
        const repoUrl = extractedData.source_url;
        const tempDir = path.join(__dirname, "temp_repo");

        // Clone repository
        await exec(`git clone ${repoUrl} ${tempDir}`);

        // Check for Node.js project
        const packageJsonPath = path.join(tempDir, "package.json");
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf8")
          );
          extractedData.version = packageJson.version || "";
          extractedData.keywords = packageJson.keywords || [];
        }
        // Check for Python project
        else {
          const pyprojectPath = path.join(tempDir, "pyproject.toml");
          if (fs.existsSync(pyprojectPath)) {
            const pyproject = toml.parse(
              fs.readFileSync(pyprojectPath, "utf8")
            );
            extractedData.version = pyproject?.project?.version || "";
            extractedData.keywords = pyproject?.project?.keywords || [];
          }
        }

        // Clean up
        await exec(`rm -rf ${tempDir}`);
      }
    } catch (err) {
      console.warn("Error extracting repository metadata:", err.message);
      // Keep empty values if extraction fails
    }

    // Log the results
    console.log("\nEXTRACTION RESULTS:");
    console.log("Extracted Data:", extractedData);
    // console.log('-------------------');
    // console.log(`Title: ${extractedData.Title}`);
    // console.log(`Author: ${extractedData.Author}`);
    // console.log(`AuthorUrl: ${extractedData.AuthorUrl}`);
    // console.log('\nDEBUG INFO:');
    // console.log(extractedData.debug);
  } catch (error) {
    console.error("Error during extraction test:", error);
  } finally {
    // Close the browser
    if (browser) {
      console.log("Closing browser...");
      await browser.close();
    }
    console.log("Test completed.");
  }
}

// Run the test
testExtraction().catch((err) => {
  console.error("Unhandled error:", err);
});
