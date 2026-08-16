import express from "express";
import Parser from "rss-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const parser = new Parser({ timeout: 10000 });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const feeds = [
  {name:"Google News", url:"https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans", tag:"综合"},
  {name:"36氪", url:"https://36kr.com/feed", tag:"科技"},
  {name:"少数派", url:"https://sspai.com/feed", tag:"数码"}
];

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/news", async (req, res) => {
  const source = req.query.source || "all";
  const selected = source === "all" ? feeds : feeds.filter(x => x.tag === source);
  const results = [];
  for (const feed of selected) {
    try {
      const data = await parser.parseURL(feed.url);
      for (const item of (data.items || []).slice(0, 12)) {
        results.push({
          title: item.title || "无标题",
          url: item.link || "#",
          source: feed.name,
          tag: feed.tag,
          time: item.isoDate || item.pubDate || null,
          summary: (item.contentSnippet || "").slice(0, 180)
        });
      }
    } catch (e) {
      console.error("Feed error:", feed.name, e.message);
    }
  }
  results.sort((a,b) => new Date(b.time||0) - new Date(a.time||0));
  res.json({updatedAt: new Date().toISOString(), items: results.slice(0, 40)});
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public/index.html")));
app.listen(process.env.PORT || 3000, () => console.log("NewsNow Bold running"));
