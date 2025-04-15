import axios from "axios"
import * as cheerio from "cheerio"
import express from "express"

const PORT = process.env.PORT || 5000
const app = express()

const URL = 'https://www.manchestereveningnews.co.uk/sport/football/'



axios(URL)
    .then(res => {
        const htmlData = res.data
        const $ = cheerio.load(htmlData)
        const articles = []

        console.log($)

        $('.teaser', htmlData).each((index, element) => {
            // console.log("here comes the element")
            // console.log(element)
            // console.log("/n")
            const title = $(element).children('.headline').text()
            console.log(title)
            const titleURL = $(element).children('.headline').attr('href')
            console.log(titleURL)
            articles.push({
                title,
                titleURL
            })
        })
        console.log(articles)
    }).catch(err => console.error(err))

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`))