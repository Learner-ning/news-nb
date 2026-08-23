// 新闻数据模块：加载模拟数据，预留真实 API 接入接口
let state = { data: null, leafById: new Map(), leaves: [] };

function normalize(data) {
  state.data = data;
  state.leafById.clear();
  state.leaves = [];
  const cats = data.categories || [];
  for (let ci = 0; ci < cats.length; ci++) {
    const cat = cats[ci];
    const twigs = cat.twigs || [];
    for (let ti = 0; ti < twigs.length; ti++) {
      const twig = twigs[ti];
      const leaves = twig.leaves || [];
      for (let li = 0; li < leaves.length; li++) {
        const news = leaves[li];
        news.categoryName = cat.name;
        news.color = cat.color;
        news.leafId = news.leaf;
        state.leafById.set(news.leaf, news);
        state.leaves.push(news);
      }
    }
  }
  return data;
}

export async function loadNews() {
  if (state.data) return state.data;
  const res = await fetch("./data/news.json");
  if (!res.ok) throw new Error("news data load failed: " + res.status);
  return normalize(await res.json());
}

// 未来接入真实新闻 API：直接调用 loadNewsFromAPI(url)
export async function loadNewsFromAPI(endpoint) {
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("news api failed: " + res.status);
  return normalize(await res.json());
}

export function getNews(leafId) { return state.leafById.get(leafId) || null; }
export function getLeafList() { return state.leaves; }
export function getCategories() { return state.data ? state.data.categories : []; }
