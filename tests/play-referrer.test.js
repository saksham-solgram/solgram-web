// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const R = require("../assets/play-referrer.js");
const PLAY = "https://play.google.com/store/apps/details?id=world.solgram.customer&referrer=";
const ROOT = path.join(__dirname, "..");

// The app decodes the referrer once (Play hands it decoded), then `dl` once more.
const decodeTwice = (playUrl) => {
  const referrer = new URL(playUrl).searchParams.get("referrer"); // decoded once by URL parsing
  assert.ok(referrer.startsWith("dl="));
  return decodeURIComponent(referrer.slice(3));
};

test("encodes dl twice and round-trips", () => {
  const dest = "https://solgram.world/product/SKU-1";
  const url = R.playUrlFor(dest);
  assert.strictEqual(url, PLAY + encodeURIComponent("dl=" + encodeURIComponent(dest)));
  assert.strictEqual(decodeTwice(url), dest);
});

test("keeps the query string of a referral destination intact", () => {
  const dest = R.referralDestination("SG1A");
  assert.strictEqual(dest, "https://solgram.world/referral?referral_code=SG1A&deep_link_sub1=SG1A");
  assert.strictEqual(decodeTwice(R.playUrlFor(dest)), dest);
});

test("rejects a bad referral code", () => {
  for (const bad of ["", "a", "x".repeat(33), "SG 1", "SG1&x=1", "SG1/../", null, undefined]) {
    assert.strictEqual(R.referralDestination(bad), null, String(bad));
  }
  assert.ok(R.referralDestination("ab"));
  assert.ok(R.referralDestination("x".repeat(32)));
  assert.ok(R.referralDestination("A_b-9"));
});

test("rejects wrong host, scheme, port, userinfo", () => {
  for (const dest of [
    "https://www.solgram.world/product/1",
    "https://evil.com/product/1",
    "https://solgram.world.evil.com/product/1",
    "http://solgram.world/product/1",
    "https://solgram.world:8443/product/1",
    "https://user@solgram.world/product/1",
    "https://user:pw@solgram.world/product/1",
    "not a url",
    "",
    null,
  ]) {
    assert.strictEqual(R.playUrlFor(dest), null, String(dest));
  }
});

test("rejects whitespace, control characters and encoded ones", () => {
  for (const dest of [
    "https://solgram.world/product/a b",
    "https://solgram.world/product/a\tb",
    "https://solgram.world/product/a\nb",
    "https://solgram.world/product/a%20b",
    "https://solgram.world/product/a%0Ab",
    "https://solgram.world/product/a%00b",
  ]) {
    assert.strictEqual(R.playUrlFor(dest), null, JSON.stringify(dest));
  }
});

test("enforces the 512 character limit", () => {
  const base = "https://solgram.world/product/";
  assert.ok(R.playUrlFor(base + "a".repeat(512 - base.length)));
  assert.strictEqual(R.playUrlFor(base + "a".repeat(513 - base.length)), null);
});

test("rejects a malformed percent sequence", () => {
  assert.strictEqual(R.playUrlFor("https://solgram.world/product/%E0%A4%A"), null);
});

test("canonicalFromLocation drops hash-free noise: noredirect and utm_*", () => {
  const loc = { hostname: "solgram.world", pathname: "/category/ABC/DEF", search: "?x=1&utm_source=a&noredirect=1&UTM_medium=b&y=2" };
  assert.strictEqual(R.canonicalFromLocation(loc), "https://solgram.world/category/ABC/DEF?x=1&y=2");
  assert.strictEqual(
    R.canonicalFromLocation({ hostname: "solgram.world", pathname: "/cart", search: "" }),
    "https://solgram.world/cart",
  );
});

test("www host is rejected end to end (falls back to OneLink)", () => {
  const dest = R.canonicalFromLocation({ hostname: "www.solgram.world", pathname: "/product/1", search: "" });
  assert.strictEqual(R.playUrlFor(dest), null);
});

// ---- run the real inline page scripts against stubs ----

const ONELINK = "https://solgram.onelink.me/kyZR/referral2026";
const SINGULAR_BASE = "https://solgram.sng.link/D6ktt/dxit?_smtype=3";
const SINGULAR_PRODUCT =
  "https://solgram.sng.link/D6ktt/dxit?_smtype=3&_dl=https%3A%2F%2Fsolgram.world%2Fproduct%2FNSDRI016&_ddl=https%3A%2F%2Fsolgram.world%2Fproduct%2FNSDRI016";
const SINGULAR_REFERRAL =
  "https://solgram.sng.link/D6ktt/dxit?_smtype=3&_dl=https%3A%2F%2Fsolgram.world%2Freferral%3Freferral_code%3DSG9EA%26deep_link_sub1%3DSG9EA&_ddl=https%3A%2F%2Fsolgram.world%2Freferral%3Freferral_code%3DSG9EA%26deep_link_sub1%3DSG9EA&referral_code=SG9EA&deep_link_sub1=SG9EA";

const runPage = (file, { ua, platform = "Linux armv8l", pathname, search, helper = true }) => {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.strictEqual(scripts.length, 1);

  const content = { innerHTML: "" };
  const logo = { style: {} };
  const replaced = [];
  const timers = [];
  const location = { pathname, search, hostname: "solgram.world", replace: (u) => replaced.push(u), href: "" };
  const window = {};
  if (helper) window.solgramPlayReferrer = R;
  const sandbox = {
    window,
    location,
    document: {
      getElementById: (id) => (id.endsWith("-logo") || id === "redirect-logo" ? logo : id.endsWith("content") ? content : { addEventListener() {} }),
    },
    navigator: { userAgent: ua, vendor: "", platform, maxTouchPoints: 0 },
    setTimeout: (fn) => timers.push(fn),
    decodeURIComponent,
    encodeURIComponent,
    RegExp,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(scripts[0], sandbox);
  timers.forEach((fn) => fn());
  return { html: content.innerHTML, replaced };
};

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36";

test("404 page: Android product link goes to the Singular link with the page URL as dl", () => {
  const r = runPage("404.html", { ua: ANDROID, pathname: "/product/SKU-1", search: "" });
  assert.strictEqual(r.replaced.length, 1);
  const parsed = new URL(r.replaced[0]);
  assert.strictEqual(parsed.origin + parsed.pathname, "https://solgram.sng.link/D6ktt/dxit");
  assert.strictEqual(parsed.searchParams.get("_dl"), "https://solgram.world/product/SKU-1");
  assert.strictEqual(parsed.searchParams.get("_ddl"), "https://solgram.world/product/SKU-1");
  assert.ok(r.html.includes('href="' + r.replaced[0] + '"'));
});

test("404 page: every supported path type works on Android", () => {
  for (const p of ["/category/C1", "/category/C1/S1", "/subcategory/S1", "/screen/diwali", "/order/SOLG-123", "/cart"]) {
    const r = runPage("404.html", { ua: ANDROID, pathname: p, search: "" });
    assert.strictEqual(r.replaced.length, 1, p);
    const parsed = new URL(r.replaced[0]);
    assert.strictEqual(parsed.origin + parsed.pathname, "https://solgram.sng.link/D6ktt/dxit", p);
    assert.strictEqual(parsed.searchParams.get("_dl"), "https://solgram.world" + p, p);
    assert.strictEqual(parsed.searchParams.get("_ddl"), "https://solgram.world" + p, p);
  }
});

test("404 page: iPhone goes to the Singular link, desktop does not redirect", () => {
  const ios = runPage("404.html", { ua: IPHONE, platform: "iPhone", pathname: "/product/NSDRI016", search: "" });
  assert.strictEqual(ios.replaced.length, 1);
  assert.strictEqual(ios.replaced[0], SINGULAR_PRODUCT);
  assert.ok(ios.html.includes('href="' + SINGULAR_PRODUCT + '"'));
  const desk = runPage("404.html", { ua: DESKTOP, platform: "Win32", pathname: "/product/SKU-1", search: "" });
  assert.strictEqual(desk.replaced.length, 0);
});

test("404 page: Android falls back to OneLink when the URL is invalid or the helper is missing", () => {
  const long = runPage("404.html", { ua: ANDROID, pathname: "/product/" + "a".repeat(600), search: "" });
  assert.ok(long.replaced[0].startsWith(ONELINK));
  const noHelper = runPage("404.html", { ua: ANDROID, pathname: "/product/SKU-1", search: "", helper: false });
  assert.ok(noHelper.replaced[0].startsWith(ONELINK));
});

test("404 page: unknown path stays a plain 404 and noredirect still stops the redirect", () => {
  const nf = runPage("404.html", { ua: ANDROID, pathname: "/nope", search: "" });
  assert.strictEqual(nf.replaced.length, 0);
  const nr = runPage("404.html", { ua: ANDROID, pathname: "/product/SKU-1", search: "?noredirect=1" });
  assert.strictEqual(nr.replaced.length, 0);
});

test("referral page: Android gets the Singular link with the referral link as dl", () => {
  const r = runPage("referral/index.html", { ua: ANDROID, pathname: "/referral/", search: "?referral_code=SG1A&deep_link_sub1=SG1A" });
  assert.strictEqual(r.replaced.length, 1);
  const parsed = new URL(r.replaced[0]);
  assert.strictEqual(parsed.origin + parsed.pathname, "https://solgram.sng.link/D6ktt/dxit");
  const dest = "https://solgram.world/referral?referral_code=SG1A&deep_link_sub1=SG1A";
  assert.strictEqual(parsed.searchParams.get("_dl"), dest);
  assert.strictEqual(parsed.searchParams.get("_ddl"), dest);
  assert.strictEqual(parsed.searchParams.get("referral_code"), "SG1A");
  assert.strictEqual(parsed.searchParams.get("deep_link_sub1"), "SG1A");
});

test("referral page: only one of the two params still yields both in dl", () => {
  const r = runPage("referral/index.html", { ua: ANDROID, pathname: "/referral/", search: "?deep_link_sub1=SG9" });
  const parsed = new URL(r.replaced[0]);
  const dest = "https://solgram.world/referral?referral_code=SG9&deep_link_sub1=SG9";
  assert.strictEqual(parsed.searchParams.get("_dl"), dest);
  assert.strictEqual(parsed.searchParams.get("_ddl"), dest);
});

test("referral page: invalid code on Android keeps the OneLink", () => {
  const bad = runPage("referral/index.html", { ua: ANDROID, pathname: "/referral/", search: "?referral_code=a" });
  assert.ok(bad.replaced[0].startsWith(ONELINK));
});

test("referral page: no code renders the existing message and no redirect", () => {
  const r = runPage("referral/index.html", { ua: ANDROID, pathname: "/referral/", search: "" });
  assert.strictEqual(r.replaced.length, 0);
});

// ---- iPhone: Singular link ----

test("singularUrlFor matches the documented product example exactly", () => {
  assert.strictEqual(R.singularUrlFor("https://solgram.world/product/NSDRI016"), SINGULAR_PRODUCT);
});

test("singularUrlFor matches the documented referral example exactly", () => {
  const dest = R.referralDestination("SG9EA");
  assert.strictEqual(R.singularUrlFor(dest, "SG9EA"), SINGULAR_REFERRAL);
});

test("singular link keeps the base as issued and joins every parameter with '&'", () => {
  const url = R.singularUrlFor(R.referralDestination("SG9EA"), "SG9EA");
  assert.ok(url.startsWith(SINGULAR_BASE + "&_dl="));
  assert.strictEqual((url.match(/\?/g) || []).length, 1);
  assert.ok(url.includes("_smtype=3"));
});

test("_dl and _ddl carry the same value, encoded once", () => {
  const dest = "https://solgram.world/category/C1/S1?x=1&y=2";
  const url = R.singularUrlFor(dest);
  const parsed = new URL(url);
  assert.strictEqual(parsed.searchParams.get("_dl"), dest);
  assert.strictEqual(parsed.searchParams.get("_ddl"), dest);
  assert.strictEqual(parsed.searchParams.get("_smtype"), "3");
  assert.ok(!url.includes("%25"), "no double encoding");
});

test("singularUrlFor applies the same destination rules as the Android link", () => {
  for (const dest of [
    "https://www.solgram.world/product/1",
    "http://solgram.world/product/1",
    "https://solgram.world:8443/product/1",
    "https://user@solgram.world/product/1",
    "https://solgram.world/product/a b",
    "https://solgram.world/product/a%0Ab",
    "https://solgram.world/product/" + "a".repeat(600),
    "",
    null,
  ]) {
    assert.strictEqual(R.singularUrlFor(dest), null, String(dest).slice(0, 60));
    assert.strictEqual(R.playUrlFor(dest), null, String(dest).slice(0, 60));
  }
});

test("singularUrlFor rejects a bad referral code instead of dropping it", () => {
  const dest = "https://solgram.world/referral?referral_code=SG1A&deep_link_sub1=SG1A";
  for (const bad of ["", "a", "x".repeat(33), "SG 1", "SG1&x=1"]) {
    assert.strictEqual(R.singularUrlFor(dest, bad), null, JSON.stringify(bad));
  }
});

test("404 page: iPhone gets the Singular link for every supported path type", () => {
  for (const p of ["/product/SKU-1", "/category/C1", "/category/C1/S1", "/subcategory/S1", "/screen/diwali", "/order/SOLG-123", "/cart"]) {
    const r = runPage("404.html", { ua: IPHONE, platform: "iPhone", pathname: p, search: "" });
    assert.strictEqual(r.replaced.length, 1, p);
    const parsed = new URL(r.replaced[0]);
    assert.strictEqual(parsed.origin + parsed.pathname, "https://solgram.sng.link/D6ktt/dxit", p);
    assert.strictEqual(parsed.searchParams.get("_dl"), "https://solgram.world" + p, p);
    assert.strictEqual(parsed.searchParams.get("_ddl"), "https://solgram.world" + p, p);
  }
});

test("404 page: iPhone keeps the OneLink when the URL is invalid or the helper is missing", () => {
  const long = runPage("404.html", { ua: IPHONE, platform: "iPhone", pathname: "/product/" + "a".repeat(600), search: "" });
  assert.ok(long.replaced[0].startsWith(ONELINK + "?deep_link_sub3=product"));
  const noHelper = runPage("404.html", { ua: IPHONE, platform: "iPhone", pathname: "/product/SKU-1", search: "", helper: false });
  assert.ok(noHelper.replaced[0].startsWith(ONELINK + "?deep_link_sub3=product"));
});

test("404 page: Android is sent through the Singular link, not the bare Play referrer", () => {
  const r = runPage("404.html", { ua: ANDROID, pathname: "/product/NSDRI016", search: "" });
  assert.ok(r.replaced[0].startsWith("https://solgram.sng.link/"));
  assert.ok(!r.html.includes("play.google.com"));
});

test("404 page: Android falls back to the Play referrer when only the Singular builder fails", () => {
  const stub = Object.assign({}, R, { singularUrlFor: () => null });
  const html = fs.readFileSync(path.join(ROOT, "404.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const content = { innerHTML: "" };
  const logo = { style: {} };
  const replaced = [];
  const timers = [];
  const location = { pathname: "/product/SKU-1", search: "", hostname: "solgram.world", replace: (u) => replaced.push(u), href: "" };
  const window = { solgramPlayReferrer: stub };
  const sandbox = {
    window,
    location,
    document: { getElementById: (id) => (id.endsWith("-logo") ? logo : id.endsWith("content") ? content : { addEventListener() {} }) },
    navigator: { userAgent: ANDROID, vendor: "", platform: "Linux armv8l", maxTouchPoints: 0 },
    setTimeout: (fn) => timers.push(fn),
    decodeURIComponent,
    encodeURIComponent,
    RegExp,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(scripts[0], sandbox);
  timers.forEach((fn) => fn());
  assert.ok(replaced[0].startsWith("https://play.google.com/"));
  assert.strictEqual(decodeTwice(replaced[0]), "https://solgram.world/product/SKU-1");
});

test("referral page: iPhone button points at the Singular referral link and does not auto-redirect", () => {
  const r = runPage("referral/index.html", { ua: IPHONE, platform: "iPhone", pathname: "/referral/", search: "?referral_code=SG9EA&deep_link_sub1=SG9EA" });
  assert.strictEqual(r.replaced.length, 0);
  assert.ok(r.html.includes('href="' + SINGULAR_REFERRAL + '"'));
  assert.ok(!r.html.includes("onelink"));
});

test("referral page: iPhone with a bad code or no helper keeps today's OneLink button", () => {
  const bad = runPage("referral/index.html", { ua: IPHONE, platform: "iPhone", pathname: "/referral/", search: "?referral_code=a" });
  assert.ok(bad.html.includes(ONELINK + "?referral_code=a"));
  const noHelper = runPage("referral/index.html", { ua: IPHONE, platform: "iPhone", pathname: "/referral/", search: "?referral_code=SG9EA", helper: false });
  assert.ok(noHelper.html.includes(ONELINK + "?referral_code=SG9EA"));
});

test("referral page: Android is sent through the Singular referral link, not the bare Play URL", () => {
  const r = runPage("referral/index.html", { ua: ANDROID, pathname: "/referral/", search: "?referral_code=SG9EA&deep_link_sub1=SG9EA" });
  assert.strictEqual(r.replaced[0], SINGULAR_REFERRAL);
  assert.ok(!r.html.includes("play.google.com"));
});

test("referral page: Android falls back to the Play referrer when only the Singular builder fails", () => {
  const stub = Object.assign({}, R, { singularUrlFor: () => null });
  const html = fs.readFileSync(path.join(ROOT, "referral/index.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const content = { innerHTML: "" };
  const logo = { style: {} };
  const replaced = [];
  const timers = [];
  const location = {
    pathname: "/referral/",
    search: "?referral_code=SG9EA&deep_link_sub1=SG9EA",
    hostname: "solgram.world",
    replace: (u) => replaced.push(u),
    href: "",
  };
  const window = { solgramPlayReferrer: stub };
  const sandbox = {
    window,
    location,
    document: { getElementById: (id) => (id.endsWith("-logo") ? logo : id.endsWith("content") ? content : { addEventListener() {} }) },
    navigator: { userAgent: ANDROID, vendor: "", platform: "Linux armv8l", maxTouchPoints: 0 },
    setTimeout: (fn) => timers.push(fn),
    decodeURIComponent,
    encodeURIComponent,
    RegExp,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(scripts[0], sandbox);
  timers.forEach((fn) => fn());
  assert.ok(replaced[0].startsWith("https://play.google.com/"));
  assert.strictEqual(
    decodeTwice(replaced[0]),
    "https://solgram.world/referral?referral_code=SG9EA&deep_link_sub1=SG9EA",
  );
});
