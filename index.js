const cheerio = require('cheerio');
const axios = require('axios');

const url = "https://glama.ai/mcp/servers"

axios(url).
    then((response) => {
        const html = response.data;
        const $ = cheerio.load(html);
        const servers = [];

        $('article[data-sentry-component="McpServerCard"]').each((index, element) => {
            const title = $(element).find('h2 a').text().trim();
            const href = $(element).find('h2 a').attr('href');
            console.log({ title, href });
          });
    })
    .catch((error) => {
        console.error(error);
    });

    


    
