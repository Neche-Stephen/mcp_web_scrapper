

##  Getting Started with MCP Server Scraper

This project allows you to scrape and extract **MCP web servers** from [glama.ai](https://glama.ai). Follow the steps below to set up and run the scraper efficiently.

### 📦 Prerequisites

- Node.js 
- npm

### 🔧 Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Neche-Stephen/mcp_web_scrapper
   cd mcp_web_scrapper
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

---

### 🗃 Check for Existing Data

Before running a fresh scrape:

1. Check if the `servers-json` folder **exists**.
2. If it does and contains files, it means data has been previously scraped.
3. To run a fresh batch, **delete** the `servers-json` folder:

   ```bash
   rm -rf servers-json
   ```

---

### Step 1: Scrape MCP Server Links

Run the scraper to collect all MCP server links from the website:

```bash
node scraper.js
```

- The scraper will launch a headless browser and start collecting data.
- Be patient — this might take a few minutes.
- Once you see the message **"Closing browser"**, the scraping is complete.
- You can then safely terminate the process using `CTRL + C`.

> Output: A file named `server-links.json` will be generated in a folder `servers-json` containing all scraped links.

---

### Step 2: Process and Extract Server Data

Now, fetch and process detailed information from each server link:

```bash
node process-links.js
```

- The script reads from `server-links.json` and visits each link to scrape the necessary data.
- A progress report will be displayed in the terminal as the script runs.
- When you see the success message indicating completion, press `CTRL + C` to terminate the process.

> All scraped data will be stored in the `servers-json` directory in different files named after the mcp servers