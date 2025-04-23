// server-class.js
class Server {
    constructor(page) {
      this.page = page;
    }
  
    // Helper method to wait for element
    async waitFor(selector, timeout = 1000) {
      return this.page.evaluate((sel, to) => {
        return new Promise((resolve) => {
          const endTime = Date.now() + to;
          const check = () => {
            const el = document.querySelector(sel);
            if (el) return resolve(el);
            if (Date.now() < endTime) {
              setTimeout(check, 100);
            } else {
              resolve(null);
            }
          };
          check();
        });
      }, selector, timeout);
    }
  
    async extractName() {
      return this.page.evaluate(() => {
        const titleElement = document.querySelector("h1");
        return titleElement ? titleElement.textContent.trim() : "Unknown";
      });
    }
  
    async extractAuthor() {
      return this.page.evaluate(() => {
        const authorElement = document.querySelector(
          "a.bejlTa.bhFGkb.BdEWC.jEevvj.jClhju.koJNIU.iWtjzs.iVlkKm.bUvkqG.efWClb.gxojcW.jsLxaN.bZRhvx.JAEma.gXlbfc.bXBpoe.ecmYYS.bVhrBr.fLteVe.ghwNBd"
        );
        return {
          author: authorElement ? authorElement.textContent.trim() : "",
          author_url: authorElement ? authorElement.getAttribute("href") : ""
        };
      });
    }
  
    async extractCategory() {
      return this.page.evaluate(() => {
        const categoryElement = document.querySelector(
          'a[data-sentry-element="RemixLink"][href^="/mcp/servers/categories/"]'
        );
        return categoryElement ? categoryElement.textContent.trim() : "";
      });
    }
  
    async extractLicense() {
      return this.page.evaluate(() => {
        const licenseElement = document.querySelector(
          'div[data-sentry-component="License"]'
        );
        return licenseElement ? licenseElement.textContent.trim() : "";
      });
    }
  
    async extractPackageAndSourceUrls() {
      return this.page.evaluate(() => {
        const linksContainer = document.querySelector("div.fPSBzf.bAasmd.dAaUHp");
        const result = {
          package_url: "",
          source_url: ""
        };
  
        if (linksContainer) {
          const iconLinks = Array.from(
            linksContainer.querySelectorAll('a[target="_blank"]:has(svg)')
          );
  
          iconLinks.forEach((link) => {
            const url = link.href;
            if (url.includes("npmjs.com")) {
              result.package_url = url;
            } else if (url.includes("github.com")) {
              result.source_url = url;
            }
          });
        }
  
        return result;
      });
    }
  
    async extractLanguage() {
      return this.page.evaluate(() => {
        const languageElement = document.querySelector(
          'div[data-sentry-component="RepositoryLanguageAttribute"] a'
        );
        return languageElement ? languageElement.textContent.trim() : "";
      });
    }
  
    async extractServerConfiguration() {
      try {
        const schemaTab = await this.waitFor('a[href*="/schema"]');
        if (schemaTab) {
          await this.page.evaluate((tab) => tab.click(), schemaTab);
          
          const configTable = await this.waitFor(
            'table[data-sentry-component="McpServerArgumentsJsonSchema"]',
            2000
          );
  
          if (configTable) {
            return this.page.evaluate((table) => {
              return Array.from(table.querySelectorAll("tbody tr")).map((row) => {
                const cells = row.querySelectorAll("td");
                return {
                  name: cells[0]?.querySelector("var")?.textContent.trim() || "",
                  required: cells[1]?.textContent.trim() || "",
                  description: cells[2]?.textContent.trim() || "",
                  default: cells[3]?.textContent.trim() || "",
                };
              });
            }, configTable);
          }
        }
        return [];
      } catch (err) {
        console.warn("Error during Schema tab interaction:", err);
        return [];
      }
    }
  
    async extractTools() {
      return this.page.$$eval(
        'table[data-sentry-element="Table.Root"] a[href*="/tools/"]',
        (links) => links.map((link) => ({
          name: link.textContent.trim(),
          href: link.href
        }))
      );
    }
  }
  
  module.exports = Server;