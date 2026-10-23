/**
 * Посредник между «Проявочной» и DeepL — Cloudflare Worker.
 *
 * Зачем: DeepL отвечает 403 на запросы прямо со страницы, а ключ нельзя класть
 * в сайт — его увидит любой. Worker хранит ключ в секрете и пересылает запрос.
 *
 * Настройка (Cloudflare → Workers & Pages → Create → Hello World → Edit code):
 *   1. Вставить этот файл целиком вместо примера → Deploy.
 *   2. Settings → Variables and Secrets:
 *        DEEPL_KEY        (тип Secret) — ключ DeepL API, у бесплатного он кончается на ":fx"
 *        ALLOWED_ORIGINS  (тип Text)   — адрес сайта без слэша в конце, например
 *                                        https://логин.github.io
 *                                        (несколько — через запятую; пусто = любой сайт)
 *   3. Адрес Worker вида https://имя.логин.workers.dev вставить в приложении:
 *      Перевод → Настройки → Переводчик: DeepL → «Адрес Worker для DeepL».
 *
 * Принимает POST {text, target, source?} и отдаёт ответ DeepL как есть:
 *   {"translations":[{"detected_source_language":"RU","text":"..."}]}
 */

const MAX_CHARS = 5000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGINS || "")
      .split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
    const originOk = allowed.length === 0 || allowed.includes(origin);

    const cors = {
      "Access-Control-Allow-Origin": originOk ? (origin || "*") : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const json = (obj, status) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!originOk) return json({ message: "Этот сайт не в списке ALLOWED_ORIGINS" }, 403);
    if (request.method !== "POST") return json({ message: "Нужен POST" }, 405);
    if (!env.DEEPL_KEY) return json({ message: "В Worker не задан секрет DEEPL_KEY" }, 500);

    let body;
    try { body = await request.json(); } catch { return json({ message: "Тело запроса — не JSON" }, 400); }

    const text = typeof body.text === "string" ? body.text : "";
    const target = String(body.target || "").toUpperCase();
    const source = body.source ? String(body.source).toUpperCase() : "";
    if (!text.trim() || !/^[A-Z]{2}(-[A-Z]{2,4})?$/.test(target)) return json({ message: "Нужны text и target" }, 400);
    if (text.length > MAX_CHARS) return json({ message: "Слишком длинный текст" }, 413);

    const key = String(env.DEEPL_KEY).trim();
    const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
    const payload = { text: [text], target_lang: target };
    if (/^[A-Z]{2}$/.test(source)) payload.source_lang = source;

    let upstream;
    try {
      upstream = await fetch(host + "/v2/translate", {
        method: "POST",
        headers: { "Authorization": "DeepL-Auth-Key " + key, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json({ message: "DeepL недоступен: " + (e && e.message || e) }, 502);
    }

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });
  },
};
