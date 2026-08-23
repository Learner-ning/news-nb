// ============================================================
// 新闻知识树 · 厂家模块注册表（枝叶）
// 枝干 = 分类（category），枝叶 = 不同厂家的新闻模块（source）。
// 新增一个厂家：只需在对应分类的 sources 数组里加一项，
// 前端树、列表、详情、状态点会自动生成，无需改其他文件。
// ============================================================

export const CATEGORIES = [
  {
    id: "general",
    name: "综合",
    icon: "🌐",
    color: "#0f766e",
    description: "国内外要闻、时政与社会资讯",
    sources: [
      {
        id: "google-news",
        name: "Google News 中文",
        feed: "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
        note: "聚合全网头条"
      },
      {
        id: "xinhua",
        name: "新华社",
        feed: "http://www.xinhuanet.com/politics/news_politics.xml",
        note: "权威时政要闻"
      },
      {
        id: "chinanews",
        name: "中国新闻网",
        feed: "http://www.chinanews.com.cn/rss/scroll-news.xml",
        note: "国内滚动新闻"
      }
    ]
  },
  {
    id: "tech",
    name: "科技",
    icon: "🔬",
    color: "#2563eb",
    description: "互联网、AI 与前沿科技",
    sources: [
      {
        id: "kr36",
        name: "36氪",
        feed: "https://36kr.com/feed",
        note: "创投与科技媒体"
      },
      {
        id: "ithome",
        name: "IT之家",
        feed: "https://www.ithome.com/rss/",
        note: "科技资讯与数码评测"
      },
      {
        id: "ifanr",
        name: "爱范儿",
        feed: "https://www.ifanr.com/feed",
        note: "数字生活媒体"
      },
      {
        id: "geekpark",
        name: "极客公园",
        feed: "https://www.geekpark.net/rss",
        note: "科技商业观察"
      },
      {
        id: "tmtpost",
        name: "钛媒体",
        feed: "https://www.tmtpost.com/rss",
        note: "科技财经新媒体"
      }
    ]
  },
  {
    id: "digital",
    name: "数码",
    icon: "📱",
    color: "#9333ea",
    description: "消费电子、软件与数字生活",
    sources: [
      {
        id: "sspai",
        name: "少数派",
        feed: "https://sspai.com/feed",
        note: "效率工具与数字生活"
      }
    ]
  },
  {
    id: "finance",
    name: "财经",
    icon: "📈",
    color: "#b45309",
    description: "市场、公司与宏观经济",
    sources: [
      {
        id: "wallstreetcn",
        name: "华尔街见闻",
        feed: "https://dedicated.wallstreetcn.com/rss.xml",
        note: "全球市场资讯"
      },
      {
        id: "xueqiu",
        name: "雪球",
        feed: "https://xueqiu.com/hots/topic/rss",
        note: "热门话题与观点"
      },
      {
        id: "sina-finance",
        name: "新浪财经",
        feed: "https://rss.sina.com.cn/finance/rollnews.xml",
        note: "财经滚动新闻"
      }
    ]
  }
];

function withMeta(cat, s) {
  return {
    ...s,
    category: cat.id,
    categoryName: cat.name,
    icon: cat.icon,
    color: cat.color
  };
}

export const ALL_SOURCES = CATEGORIES.flatMap((cat) =>
  cat.sources.map((s) => withMeta(cat, s))
);

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function getSource(id) {
  return ALL_SOURCES.find((s) => s.id === id) || null;
}

export function sourcesByCategory(catId) {
  return ALL_SOURCES.filter((s) => s.category === catId);
}
