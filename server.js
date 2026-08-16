import express from "express";
import Parser from "rss-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const app = express();
const parser = new Parser({
  timeout: 12000,
  customFields: {
    item: ["content:encoded", "description"]
  }
});
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const feeds = [
  { name: "Google News", url: "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans", tag: "综合" },
  { name: "36氪", url: "https://36kr.com/feed", tag: "科技" },
  { name: "少数派", url: "https://sspai.com/feed", tag: "数码" }
];

function makeId(url) {
  return crypto.createHash("sha1").update(url || Math.random().toString()).digest("hex").slice(0, 12);
}

function cleanHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/news", async (req, res) => {
  const source = req.query.source || "all";
  const selected = source === "all" ? feeds : feeds.filter((x) => x.tag === source);
  const results = [];

  await Promise.all(
    selected.map(async (feed) => {
      try {
        const data = await parser.parseURL(feed.url);
        for (const item of (data.items || []).slice(0, 15)) {
          const link = item.link || item.guid || "";
          const rawContent =
            item["content:encoded"] ||
            item.content ||
            item.description ||
            item.contentSnippet ||
            item.summary ||
            "";
          const snippet = (item.contentSnippet || cleanHtml(rawContent) || "").slice(0, 220);
          const fullText = cleanHtml(rawContent).slice(0, 2000);

          results.push({
            id: makeId(link),
            title: item.title || "无标题",
            url: link || "#",
            source: feed.name,
            tag: feed.tag,
            time: item.isoDate || item.pubDate || null,
            summary: snippet,
            content: fullText || snippet
          });
        }
      } catch (e) {
        console.error("Feed error:", feed.name, e.message);
      }
    })
  );

  results.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  res.json({
    updatedAt: new Date().toISOString(),
    items: results.slice(0, 48)
  });
});

app.get("/api/news/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const all = await Promise.all(
      feeds.map(async (feed) => {
        try {
          const data = await parser.parseURL(feed.url);
          return (data.items || []).slice(0, 15).map((item) => {
            const link = item.link || item.guid || "";
            const rawContent =
              item["content:encoded"] ||
              item.content ||
              item.description ||
              item.contentSnippet ||
              item.summary ||
              "";
            const snippet = (item.contentSnippet || cleanHtml(rawContent) || "").slice(0, 220);
            const fullText = cleanHtml(rawContent).slice(0, 2000);
            return {
              id: makeId(link),
              title: item.title || "无标题",
              url: link || "#",
              source: feed.name,
              tag: feed.tag,
              time: item.isoDate || item.pubDate || null,
              summary: snippet,
              content: fullText || snippet
            };
          });
        } catch {
          return [];
        }
      })
    );
    const flat = all.flat();
    const found = flat.find((x) => x.id === id);
    if (!found) {
      return res.status(404).json({ error: "新闻不存在或已过期" });
    }
    res.json(found);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`NewsNow Bold running on http://localhost:${port}`));
